// Tests for rendering the generator's report into the sync PR body and the
// failure issue. Run with `npm test` (node --test).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
	code,
	HELD_BACK_BEGIN,
	HELD_BACK_END,
	heldBackBlock,
	heldBackMarkdown,
	loadGenerationReport,
	repairedMarkdown,
	spliceHeldBack,
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
			},
			{
				skill: 'harper-best-practices',
				rule: 'v5-upgrade',
				repairs: 1,
				dropped: [],
				missingAnchors: [],
				error: 'overloaded',
			},
		],
	});
	assert.match(md, /^### Held back/);
	assert.match(
		md,
		/- `querying-rest-apis` \(harper-best-practices\) — after 2 repairs, still dropped `name==null`, `sort\(property\)`; still missing `must_cover` `` `Accept` ``$/m,
	);
	assert.match(
		md,
		/- `v5-upgrade` \(harper-best-practices\) — after 1 repair, model call failed: overloaded$/m,
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

const held = {
	...empty,
	heldBack: [{ skill: 's', rule: 'r', repairs: 2, dropped: ['f()'], missingAnchors: [] }],
};

test('the held-back block keeps its markers even when empty', () => {
	assert.equal(heldBackBlock(empty), `${HELD_BACK_BEGIN}\n${HELD_BACK_END}`);
	assert.ok(heldBackBlock(held).includes('still dropped `f()`'));
});

test('splicing replaces only the marked section of an existing PR body', () => {
	const body = `Intro.\n\n${heldBackBlock(held)}\n\nFooter.\n`;
	assert.equal(spliceHeldBack(body, empty), `Intro.\n\n${heldBackBlock(empty)}\n\nFooter.\n`);
	assert.equal(spliceHeldBack(body, held), body);
});

test('a body without markers gets the section appended, and only when needed', () => {
	assert.equal(spliceHeldBack('Old body.\n', empty), 'Old body.\n');
	assert.equal(spliceHeldBack('Old body.\n', held), `Old body.\n\n${heldBackBlock(held)}\n`);
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
