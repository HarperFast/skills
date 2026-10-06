// Tests for rendering the generator's report into the sync PR body and the
// failure issue. Run with `npm test` (node --test).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
	code,
	failureDetailsMarkdown,
	heldBackMarkdown,
	loadGenerationReport,
	mergeRepaired,
	readSyncState,
	repairedMarkdown,
	syncStateComment,
} from './generation-report.mjs';

const empty = { regenerated: [], repaired: [], heldBack: [] };

test('code() wraps text containing backticks in a longer delimiter', () => {
	assert.equal(code('name==null'), '`name==null`');
	assert.equal(code('`Accept`'), '`` `Accept` ``');
	assert.equal(code('a`b'), '``a`b``');
});

test('nothing held back or repaired renders nothing', () => {
	assert.equal(heldBackMarkdown(empty), '');
	assert.equal(repairedMarkdown(empty), '');
});

test('held-back rules are named with what they still lacked', () => {
	const md = heldBackMarkdown({
		...empty,
		heldBack: [
			{
				skill: 'harper-best-practices',
				rule: 'querying-rest-apis',
				repairs: 2,
				dropped: ['name==null', 'sort(property)'],
				missingAnchors: ['`Accept`'],
				invalid: [],
			},
		],
	});
	assert.match(md, /^### Held back/);
	assert.match(
		md,
		/- `querying-rest-apis` \(harper-best-practices\) — after 2 repairs, still dropped `name==null`, `sort\(property\)`; still missing `must_cover` `` `Accept` ``$/m,
	);
});

test('failure details name the rule the run stopped on, then what was held back', () => {
	const stopped = {
		...empty,
		heldBack: [
			{ skill: 's', rule: 'a', repairs: 2, dropped: ['f()'], missingAnchors: [], invalid: [] },
		],
		stoppedOn: { skill: 's', rule: 'b', reason: 'b: model call failed: 401' },
	};
	assert.match(
		failureDetailsMarkdown(stopped),
		/^\*\*Generation stopped on `b` \(s\):\*\* `b: model call failed: 401`\n\n### Held back/,
	);
	assert.equal(failureDetailsMarkdown(empty), '');
	assert.match(
		failureDetailsMarkdown({ ...empty, stoppedOn: { reason: 'x' } }),
		/^\*\*Generation stopped:\*\* `x`$/,
	);
});

test('repaired rules list what the repair restored and fixed', () => {
	const md = repairedMarkdown({
		...empty,
		repaired: [
			{ skill: 's', rule: 'automatic-apis', repairs: 1, restored: ['@hidden'], fixed: [] },
			{ skill: 's', rule: 'v5-upgrade', repairs: 2, restored: [], fixed: ['lacks an H1'] },
		],
	});
	assert.match(md, /^### Repaired during generation/);
	assert.match(md, /- `automatic-apis` — 1 repair: restored `@hidden`$/m);
	assert.match(md, /- `v5-upgrade` — 2 repairs: fixed: body lacks an H1$/m);
});

test('held-back structural problems are named', () => {
	const md = heldBackMarkdown({
		...empty,
		heldBack: [
			{ skill: 's', rule: 'r', repairs: 2, dropped: [], missingAnchors: [], invalid: ['x'] },
		],
	});
	assert.match(md, /- `r` \(s\) — after 2 repairs, body still x$/m);
});

test('a missing report path loads as empty, and absent lists default to empty', async () => {
	assert.deepEqual(await loadGenerationReport(null), empty);
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'generation-report-'));
	try {
		const file = path.join(dir, 'report.json');
		await fs.writeFile(file, JSON.stringify({ docsSha: 'abc', heldBack: [] }));
		assert.deepEqual(await loadGenerationReport(file), { ...empty, docsSha: 'abc' });
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});

const repaired = (rule, restored = ['f()']) => ({
	skill: 's',
	rule,
	repairs: 1,
	restored,
	fixed: [],
});

test('sync state survives a round trip through the PR body, whatever the facts contain', () => {
	const state = { repaired: [repaired('a', ['x --> y', '`--`'])] };
	const body = `Intro.\n\n${syncStateComment(state)}\n`;
	assert.doesNotMatch(syncStateComment(state).slice(4, -3), /-->/);
	assert.deepEqual(readSyncState(body), state);
});

test('a body without sync state, or with a damaged one, starts from nothing', () => {
	assert.deepEqual(readSyncState(null), { repaired: [] });
	assert.deepEqual(readSyncState('No state here.'), { repaired: [] });
	assert.deepEqual(readSyncState('<!-- sync-state:v1 bm90IGpzb24= -->'), { repaired: [] });
	const partial = syncStateComment({ repaired: [{ rule: 'no skill' }, repaired('a')] });
	assert.deepEqual(readSyncState(partial), { repaired: [repaired('a')] });
});

test('repairs carry forward until the rule is regenerated again or leaves the PR', () => {
	const changed = ['a', 'b', 'c'].map((rule) => ({ skill: 's', rule }));
	const previous = [repaired('a'), repaired('b'), repaired('gone')];
	const generation = {
		...empty,
		regenerated: [
			{ skill: 's', rule: 'b' },
			{ skill: 's', rule: 'c' },
		],
		repaired: [repaired('c', ['g()'])],
	};
	// `a` carries forward; `b` was regenerated cleanly this run, so its old
	// repair no longer describes the PR; `c` is this run's; `gone` left the PR.
	assert.deepEqual(
		mergeRepaired(previous, generation, changed).map((entry) => entry.rule),
		['a', 'c'],
	);
});
