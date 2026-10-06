// Tests for the repair-then-hold-back loop. Run with `npm test` (node --test).
//
// The model is a scripted fake: each test lists the bodies it returns, in
// order, and the loop's verdict is checked against what the validator would
// say about the same bodies.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { regenerateFaithfully } from './regenerate.mjs';

// A conversation that returns `bodies` in order and records each repair
// request, so tests can assert on what the model was asked to restore.
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

const previousBody = 'Use `limit(end)` and `sort(property)` to page.';
const source = 'limit(end) and sort(property) and select()';

test('accepts a first body that keeps every fact', async () => {
	const conversation = scripted('Use `limit(end)` with `sort(property)`.');
	const out = await regenerateFaithfully({ conversation, previousBody, source });
	assert.equal(out.ok, true);
	assert.equal(out.repairs, 0);
	assert.deepEqual(out.restored, []);
	assert.deepEqual(conversation.repairs, []);
});

test('asks the model to restore exactly the dropped facts, then accepts the repair', async () => {
	const conversation = scripted('Use `limit(end)`.', 'Use `limit(end)` and `sort(property)`.');
	const out = await regenerateFaithfully({ conversation, previousBody, source });
	assert.equal(out.ok, true);
	assert.equal(out.body, 'Use `limit(end)` and `sort(property)`.');
	assert.equal(out.repairs, 1);
	assert.deepEqual(out.restored, ['sort(property)']);
	assert.deepEqual(conversation.repairs, [
		{ dropped: ['sort(property)'], missingAnchors: [], previousBody },
	]);
	assert.deepEqual(out.usage, { input_tokens: 20, output_tokens: 10, cache_read_input_tokens: 0 });
});

test('holds back after maxRepairs, reporting what the last body still lacked', async () => {
	const conversation = scripted('Nothing.', 'Use `limit(end)`.', 'Use `limit(end)`.');
	const out = await regenerateFaithfully({ conversation, previousBody, source, maxRepairs: 2 });
	assert.equal(out.ok, false);
	assert.equal(out.repairs, 2);
	assert.deepEqual(out.dropped, ['sort(property)']);
	assert.equal(conversation.repairs.length, 2);
});

test('a repair that drops something new is caught, not accepted', async () => {
	const conversation = scripted(
		'Use `limit(end)`.',
		'Use `sort(property)`.', // restores one fact, loses the other
		'Use `limit(end)` and `sort(property)`.',
	);
	const out = await regenerateFaithfully({ conversation, previousBody, source });
	assert.equal(out.ok, true);
	assert.equal(out.repairs, 2);
	assert.deepEqual(conversation.repairs[1].dropped, ['limit(end)']);
	// `restored` reports what the first body lacked, which is what review needs.
	assert.deepEqual(out.restored, ['sort(property)']);
});

test('must_cover misses are repaired the same way', async () => {
	const conversation = scripted('No anchors here, long enough.', 'Now with select() inside.');
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

test('allow_dropped facts are not enforced', async () => {
	const conversation = scripted('Use `limit(end)`.');
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
	const conversation = scripted('Use `limit(end)`.');
	const out = await regenerateFaithfully({ conversation, previousBody, source, maxRepairs: 0 });
	assert.equal(out.ok, false);
	assert.equal(out.repairs, 0);
	assert.deepEqual(conversation.repairs, []);
});

test('a model error holds the rule back instead of crashing the run', async () => {
	const conversation = scripted('Use `limit(end)`.', new Error('overloaded'));
	const out = await regenerateFaithfully({ conversation, previousBody, source });
	assert.equal(out.ok, false);
	assert.equal(out.error, 'overloaded');
	assert.equal(out.repairs, 1);
});
