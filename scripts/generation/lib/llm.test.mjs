// Tests for the prompts the generator sends. Run with `npm test` (node --test).
// No network: only the message builders are exercised.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { repairRequest, ruleRequest } from './llm.mjs';

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
