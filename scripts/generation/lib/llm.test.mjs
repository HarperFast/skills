// Tests for the prompts the generator sends. Run with `npm test` (node --test).
// No network: only the message builders are exercised.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { repairRequest, ruleConversation, ruleRequest } from './llm.mjs';

const md = (...lines) => lines.join('\n');

test('the rule request carries anchors, links and the source', () => {
	const req = ruleRequest({
		rule: 'querying-rest-apis',
		description: 'Query REST APIs.',
		sourceContent: 'SOURCE',
		mustCover: ['sort('],
		crossLinks: ['automatic-apis'],
	});
	assert.match(req, /^# Rule to generate: querying-rest-apis$/m);
	assert.match(req, /^- sort\($/m);
	assert.match(req, /^- automatic-apis\.md$/m);
	assert.match(req, /^----\nSOURCE\n----$/m);
});

test('the repair request quotes the committed line each dropped fact came from', () => {
	const previousBody = md(
		'| `name==null`     | Converts to `null`   |',
		'```',
		'GET /Product/?sort(+name)',
		'```',
		'Use `sort(+property,-property,...)` to sort.',
	);
	const req = repairRequest({
		dropped: ['name==null', 'sort(+property,-property,...)'],
		missingAnchors: ['`Accept`'],
		previousBody,
	});
	assert.match(
		req,
		/^- `name==null` — the current rule has: \| `name==null` \| Converts to `null` \|$/m,
	);
	assert.match(
		req,
		/^- `sort\(\+property,-property,\.\.\.\)` — the current rule has: Use `sort\(\+property,-property,\.\.\.\)` to sort\.$/m,
	);
	assert.match(req, /^## Required strings your body is missing$/m);
	assert.match(req, /^- `Accept`$/m);
});

test('a pinned fact that was dropped is asked for once, not twice', () => {
	const req = repairRequest({
		dropped: ['instanceof'],
		missingAnchors: ['instanceof', 'logger'],
		previousBody: 'Breaks `instanceof`.',
	});
	assert.equal(req.split('instanceof').length - 1, 2); // the fact and its context line
	assert.match(req, /^## Required strings your body is missing\n.*\n- logger$/m);
});

test('a repair for anchors alone has no dropped-facts section', () => {
	const req = repairRequest({ missingAnchors: ['select('], previousBody: null });
	assert.doesNotMatch(req, /Facts the current rule states/);
	assert.match(req, /^- select\($/m);
});

test('structural problems are listed for the model to fix', () => {
	const req = repairRequest({ invalid: ['does not start with an H1 title'], previousBody: null });
	assert.match(
		req,
		/^## Structural problems to fix\n- The body does not start with an H1 title\.$/m,
	);
});

// A stand-in for the Messages API that answers with `replies` in order and
// records each request's messages.
function fakeApi(...replies) {
	const requests = [];
	const createMessage = async (params) => {
		requests.push(structuredClone(params.messages));
		const { text, stop = 'end_turn' } = replies.shift();
		return {
			content: [{ type: 'text', text }],
			stop_reason: stop,
			usage: { input_tokens: 1, output_tokens: 1 },
		};
	};
	return { requests, createMessage };
}

const conversationArgs = { rule: 'r', description: 'd', sourceContent: 'SOURCE' };

test('a repair continues the conversation with the draft and the problems', async () => {
	const api = fakeApi({ text: '# Draft' }, { text: '# Fixed' });
	const conversation = ruleConversation({ ...conversationArgs, createMessage: api.createMessage });
	assert.equal((await conversation.generate()).body, '# Draft');
	assert.equal((await conversation.repair({ missingAnchors: ['x()'] })).body, '# Fixed');
	assert.deepEqual(
		api.requests[1].map((m) => m.role),
		['user', 'assistant', 'user'],
	);
	assert.equal(api.requests[1][1].content, '# Draft');
	assert.match(api.requests[1][2].content, /^- x\(\)$/m);
});

test('a body cut off at max_tokens, or an empty one, is an error', async () => {
	const truncated = fakeApi({ text: '# Half a rule', stop: 'max_tokens' });
	await assert.rejects(
		ruleConversation({ ...conversationArgs, createMessage: truncated.createMessage }).generate(),
		/cut off at max_tokens/,
	);
	const empty = fakeApi({ text: '  ' });
	await assert.rejects(
		ruleConversation({ ...conversationArgs, createMessage: empty.createMessage }).generate(),
		/empty body/,
	);
});
