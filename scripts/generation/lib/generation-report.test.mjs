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
	parseRepairTrailers,
	repairedMarkdown,
	repairTrailers,
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

test('repair trailers round-trip through a commit message, whatever the facts contain', () => {
	const entries = [repaired('a', ['x --> y', 'a\\tb']), repaired('b')];
	const message = ['docs: regenerate', '', ...repairTrailers({ ...empty, repaired: entries })].join(
		'\n',
	);
	assert.deepEqual(parseRepairTrailers(message), entries);
	assert.deepEqual(repairTrailers(empty), []);
});

test('a damaged or foreign trailer is skipped, not trusted', () => {
	const message = [
		'Sync-Repaired: not json',
		'Sync-Repaired: {"skill":"s","rule":"r","repairs":1,"restored":[1],"fixed":[]}',
		`Sync-Repaired: ${JSON.stringify(repaired('ok'))}`,
		'Co-Authored-By: someone',
	].join('\n');
	assert.deepEqual(parseRepairTrailers(message), [repaired('ok')]);
});
