// Tests for the shared fact-retention check. Run with `npm test` (node --test).
//
// The generator and validate-generated.mjs both call droppedFacts, so these
// pin the behavior the auto-sync gate depends on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
	anchorsBeyondFacts,
	bodyAtHead,
	droppedFacts,
	inlineCodeSpans,
	missingAnchors,
} from './retention.mjs';

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

test('an unreadable baseline is an error, not a missing one', () => {
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
	const cwd = process.cwd();
	try {
		process.chdir(outside);
		assert.throws(() => bodyAtHead('rules/x.md'), /Cannot read the committed baseline/);
	} finally {
		process.chdir(cwd);
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

test('an anchor that is only a dropped fact again, backticks or not, is not repeated', () => {
	assert.deepEqual(anchorsBeyondFacts(['`Accept`', 'Accept', 'other'], ['Accept']), ['other']);
});

test('a repository with no commit yet has no readable baseline either', () => {
	const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'unborn-head-'));
	const cwd = process.cwd();
	try {
		execFileSync('git', ['init', '-q'], { cwd: fresh });
		process.chdir(fresh);
		assert.throws(() => bodyAtHead('rules/x.md'), /Cannot read the committed baseline/);
	} finally {
		process.chdir(cwd);
		fs.rmSync(fresh, { recursive: true, force: true });
	}
});
