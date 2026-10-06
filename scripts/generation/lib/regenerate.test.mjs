// Tests for the repair-then-hold-back loop. Run with `npm test` (node --test).
//
// The model is a scripted fake: each test lists the bodies it returns, in
// order, and the loop's verdict is checked against what the validators would
// say about the same bodies.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkBody, hasProblems, parseMaxRepairs, regenerateFaithfully } from './regenerate.mjs';

// A structurally valid rule body (H1, over the minimum length) around `text`,
// so tests about facts are not also tests about structure.
const valid = (text) =>
	`# Rule\n\n${text}\n\n${'Padding prose for the minimum length. '.repeat(6)}`;

// A conversation that returns `bodies` in order and records each repair
// request, so tests can assert on what the model was asked to fix.
function scripted(...bodies) {
	const repairs = [];
	let i = 0;
	const next = async () => {
		const body = bodies[i++];
		if (body instanceof Error) throw body;
		if (body === undefined) throw new Error('fake model: no more scripted bodies');
		return { body, usage: { input_tokens: 10, output_tokens: 5 } };
	};
	return {
		repairs,
		generate: next,
		repair: (problems) => {
			repairs.push(problems);
			return next();
		},
	};
}

const previousBody = valid('Use `limit(end)` and `sort(property)` to page.');
const source = 'limit(end) and sort(property) and select()';

test('accepts a first body that keeps every fact', async () => {
	const conversation = scripted(valid('Use `limit(end)` with `sort(property)`.'));
	const out = await regenerateFaithfully({ conversation, previousBody, source });
	assert.equal(out.ok, true);
	assert.equal(out.repairs, 0);
	assert.deepEqual(out.restored, []);
	assert.deepEqual(out.fixed, []);
	assert.deepEqual(conversation.repairs, []);
});

test('asks the model to restore exactly the dropped facts, then accepts the repair', async () => {
	const repaired = valid('Use `limit(end)` and `sort(property)`.');
	const conversation = scripted(valid('Use `limit(end)`.'), repaired);
	const out = await regenerateFaithfully({ conversation, previousBody, source });
	assert.equal(out.ok, true);
	assert.equal(out.body, repaired);
	assert.equal(out.repairs, 1);
	assert.deepEqual(out.restored, ['sort(property)']);
	assert.deepEqual(conversation.repairs, [
		{ dropped: ['sort(property)'], missingAnchors: [], invalid: [], previousBody },
	]);
	assert.deepEqual(out.usage, { input_tokens: 20, output_tokens: 10, cache_read_input_tokens: 0 });
});

test('holds back after maxRepairs, reporting what the last body still lacked', async () => {
	const conversation = scripted(
		valid('Nothing.'),
		valid('Use `limit(end)`.'),
		valid('Use `limit(end)`.'),
	);
	const out = await regenerateFaithfully({ conversation, previousBody, source, maxRepairs: 2 });
	assert.equal(out.ok, false);
	assert.equal(out.repairs, 2);
	assert.deepEqual(out.dropped, ['sort(property)']);
	assert.equal(conversation.repairs.length, 2);
});

test('a repair that drops something new is caught, not accepted', async () => {
	const conversation = scripted(
		valid('Use `limit(end)`.'),
		valid('Use `sort(property)`.'), // restores one fact, loses the other
		valid('Use `limit(end)` and `sort(property)`.'),
	);
	const out = await regenerateFaithfully({ conversation, previousBody, source });
	assert.equal(out.ok, true);
	assert.equal(out.repairs, 2);
	assert.deepEqual(conversation.repairs[1].dropped, ['limit(end)']);
	// `restored` reports what the first body lacked, which is what review needs.
	assert.deepEqual(out.restored, ['sort(property)']);
});

test('must_cover misses are repaired the same way', async () => {
	const conversation = scripted(valid('No anchors here.'), valid('Now with select() inside.'));
	const out = await regenerateFaithfully({
		conversation,
		previousBody: null,
		source,
		mustCover: ['select()'],
	});
	assert.equal(out.ok, true);
	assert.deepEqual(conversation.repairs[0].missingAnchors, ['select()']);
	assert.deepEqual(out.restored, ['select()']);
});

test('a pinned fact restored by a repair is reported once', async () => {
	const conversation = scripted(
		valid('Use `limit(end)`.'),
		valid('Use `limit(end)` and `sort(property)`.'),
	);
	const out = await regenerateFaithfully({
		conversation,
		previousBody,
		source,
		mustCover: ['`sort(property)`'],
	});
	assert.deepEqual(out.restored, ['sort(property)']);
});

test('structural problems are repaired, and reported as fixed', async () => {
	const conversation = scripted(
		'Preamble before the title.\n\n' + valid('Use `limit(end)` and `sort(property)`.'),
		valid('Use `limit(end)` and `sort(property)`.'),
	);
	const out = await regenerateFaithfully({ conversation, previousBody, source });
	assert.equal(out.ok, true);
	assert.deepEqual(conversation.repairs[0].invalid, ['does not start with an H1 title']);
	assert.deepEqual(out.restored, []);
	assert.deepEqual(out.fixed, ['does not start with an H1 title']);
});

test('a body with leaked MDX is held back if the repairs keep it', async () => {
	const leaky = valid('Use `limit(end)` and `sort(property)`.\n\n<Tabs>\n');
	const conversation = scripted(leaky, leaky);
	const out = await regenerateFaithfully({ conversation, previousBody, source, maxRepairs: 1 });
	assert.equal(out.ok, false);
	assert.deepEqual(out.dropped, []);
	assert.match(out.invalid[0], /leaked MDX/);
});

test('allow_dropped facts are not enforced', async () => {
	const conversation = scripted(valid('Use `limit(end)`.'));
	const out = await regenerateFaithfully({
		conversation,
		previousBody,
		source,
		allowDropped: ['sort(property)'],
	});
	assert.equal(out.ok, true);
	assert.equal(out.repairs, 0);
});

test('maxRepairs 0 holds back on the first failure without a repair call', async () => {
	const conversation = scripted(valid('Use `limit(end)`.'));
	const out = await regenerateFaithfully({ conversation, previousBody, source, maxRepairs: 0 });
	assert.equal(out.ok, false);
	assert.equal(out.repairs, 0);
	assert.deepEqual(conversation.repairs, []);
});

test('a model error ends the attempt with the error instead of throwing', async () => {
	const conversation = scripted(valid('Use `limit(end)`.'), new Error('overloaded'));
	const out = await regenerateFaithfully({ conversation, previousBody, source });
	assert.equal(out.ok, false);
	assert.equal(out.error, 'overloaded');
	assert.equal(out.repairs, 1);
});

test('checkBody is what decides whether a committed body can be kept instead', () => {
	const args = { previousBody, source, mustCover: ['select()'] };
	assert.equal(hasProblems(checkBody({ body: previousBody, ...args })), true);
	assert.equal(hasProblems(checkBody({ body: previousBody, ...args, mustCover: [] })), false);
});

test('the repair budget is a non-negative integer, default 2', () => {
	assert.equal(parseMaxRepairs(undefined), 2);
	assert.equal(parseMaxRepairs(''), 2);
	assert.equal(parseMaxRepairs('0'), 0);
	assert.equal(parseMaxRepairs('3'), 3);
	for (const bad of ['-1', '1.5', 'Infinity', 'two']) {
		assert.throws(() => parseMaxRepairs(bad), /non-negative integer/);
	}
});
