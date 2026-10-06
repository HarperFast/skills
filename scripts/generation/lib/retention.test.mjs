// Tests for the shared fact-retention check. Run with `npm test` (node --test).
//
// The generator and validate-generated.mjs both call droppedFacts, so these
// pin the behavior the auto-sync gate depends on.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bodyAtHead, droppedFacts, inlineCodeSpans, missingAnchors } from './retention.mjs';

const md = (...lines) => lines.join('\n');

test('inline code spans skip fenced blocks and short tokens', () => {
	const spans = inlineCodeSpans(
		md('Use `name==null` or `id`.', '~~~', 'const x = `fenced`;', '~~~', 'Then `409`.'),
	);
	assert.deepEqual([...spans].sort(), ['409', 'name==null']);
});

test('a fact dropped from the body but still in the source is reported', () => {
	const dropped = droppedFacts({
		previousBody: 'Use `sort(property)` and `limit(end)`.',
		body: 'Use `limit(end)`.',
		source: 'sort(property) limit(end)',
	});
	assert.deepEqual(dropped, ['sort(property)']);
});

test('a fact the docs no longer state may be dropped', () => {
	const dropped = droppedFacts({
		previousBody: 'Use `oldOption`.',
		body: 'Nothing.',
		source: 'newOption only',
	});
	assert.deepEqual(dropped, []);
});

test('a fact kept outside inline code still counts as kept', () => {
	const dropped = droppedFacts({
		previousBody: 'Send `Sec-WebSocket-Protocol: mqtt`.',
		body: md('```http', 'Sec-WebSocket-Protocol: mqtt', '```'),
		source: 'Sec-WebSocket-Protocol: mqtt',
	});
	assert.deepEqual(dropped, []);
});

test('allow_dropped waives a fact, and no previous body means nothing to retain', () => {
	const args = { previousBody: 'Use `a.b.c`.', body: 'x', source: 'a.b.c' };
	assert.deepEqual(droppedFacts({ ...args, allowDropped: ['a.b.c'] }), []);
	assert.deepEqual(droppedFacts({ ...args, previousBody: null }), []);
});

test('dropped facts are sorted', () => {
	const dropped = droppedFacts({
		previousBody: 'Use `zeta` then `alpha`.',
		body: '',
		source: 'alpha zeta',
	});
	assert.deepEqual(dropped, ['alpha', 'zeta']);
});

test('missing anchors keep manifest order', () => {
	assert.deepEqual(missingAnchors('has `Accept`', ['zz', '`Accept`', 'aa']), ['zz', 'aa']);
	assert.deepEqual(missingAnchors('anything', undefined), []);
});

test('the HEAD baseline is the committed body without frontmatter, or null', () => {
	// Run from the repo root, as `npm test` does.
	const body = bodyAtHead('harper-best-practices/rules/querying-rest-apis.md');
	assert.match(body, /^# /);
	assert.equal(bodyAtHead('harper-best-practices/rules/no-such-rule.md'), null);
});
