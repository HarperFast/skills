// End-to-end tests for `sync-report.mjs --format pr-body` on a rolling sync
// branch: a scratch skills repository whose branch carries two runs of
// changes, and a scratch docs repository whose commits the rules were synced
// from. The body must describe the whole branch, not only the latest run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readSyncState, syncStateComment } from './lib/generation-report.mjs';
import { SKILLS } from './lib/manifest.mjs';
import { buildFrontmatter, composeRuleFile } from './lib/render.mjs';

const SYNC_REPORT = path.resolve(import.meta.dirname, 'sync-report.mjs');
const RULES_DIR = 'harper-best-practices/rules';

function git(cwd, ...args) {
	return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
		cwd,
		encoding: 'utf-8',
	}).trim();
}

const entry = (rule) => ({
	rule,
	description: `The ${rule} rule.`,
	category: 'api',
	priority: 1,
	order: 1,
	mode: 'generate',
	sources: [{ path: 'page.md' }],
});

function writeRule(root, rule, sourceCommit, text) {
	const frontmatter = buildFrontmatter(entry(rule), { sourceCommit, inputHash: sourceCommit });
	fs.writeFileSync(
		path.join(root, RULES_DIR, `${rule}.md`),
		composeRuleFile(frontmatter, `# ${rule}\n\n${text}`),
	);
}

// Docs with three commits; skills whose main synced rules `a` and `c` from the
// first docs commit and `b` from the second; then a sync branch on which run 1
// regenerated `a` and run 2 regenerated `b`.
function scaffold() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-report-'));
	const docs = path.join(root, 'docs');
	const skills = path.join(root, 'skills');
	fs.mkdirSync(docs);
	git(docs, 'init', '-q');
	const docsCommits = ['one', 'two', 'three'].map((message) => {
		fs.writeFileSync(path.join(docs, 'page.md'), message);
		git(docs, 'add', '-A');
		git(docs, 'commit', '-qm', `docs: ${message}`);
		return git(docs, 'rev-parse', 'HEAD');
	});

	for (const skill of SKILLS) {
		fs.mkdirSync(path.join(skills, skill.dir, skill.rulesDir), { recursive: true });
	}
	git(skills, 'init', '-q', '-b', 'main');
	writeRule(skills, 'a', docsCommits[0], 'A as on main.');
	writeRule(skills, 'b', docsCommits[1], 'B as on main.');
	writeRule(skills, 'c', docsCommits[0], 'C as on main.');
	git(skills, 'add', '-A');
	git(skills, 'commit', '-qm', 'main');

	git(skills, 'checkout', '-qb', 'auto/docs-sync');
	writeRule(skills, 'a', docsCommits[2], 'A regenerated in run 1.');
	git(skills, 'commit', '-qam', 'run 1');
	writeRule(skills, 'b', docsCommits[2], 'B regenerated in run 2.');
	git(skills, 'commit', '-qam', 'run 2');
	return { root, docs, skills, docsCommits };
}

const repaired = (rule, restored) => ({
	skill: 'harper-best-practices',
	rule,
	repairs: 1,
	restored,
	fixed: [],
});

// Run 2's report: it regenerated `b` with a repair, and held `c` back.
const run2 = {
	regenerated: [{ skill: 'harper-best-practices', rule: 'b' }],
	repaired: [repaired('b', ['b()'])],
	heldBack: [
		{
			skill: 'harper-best-practices',
			rule: 'c',
			repairs: 2,
			dropped: ['c()'],
			missingAnchors: [],
			invalid: [],
		},
	],
};

function prBody({ skills, docs, root }, previousBody) {
	const reportPath = path.join(root, 'report.json');
	fs.writeFileSync(reportPath, JSON.stringify(run2));
	const args = ['--docs-path', docs, '--format', 'pr-body', '--base', 'main'];
	args.push('--generation-report', reportPath);
	if (previousBody !== undefined) {
		const previousPath = path.join(root, 'previous.md');
		fs.writeFileSync(previousPath, previousBody);
		args.push('--previous-body', previousPath);
	}
	return execFileSync(process.execPath, [SYNC_REPORT, ...args], { cwd: skills, encoding: 'utf-8' });
}

test('the body lists every rule the branch changes, not only the latest run', () => {
	const repo = scaffold();
	try {
		const [one, two, three] = repo.docsCommits.map((sha) => sha.slice(0, 7));
		const body = prBody(repo);
		assert.match(body, new RegExp(`^- \`a\` — last synced from docs@${one}$`, 'm'));
		assert.match(body, new RegExp(`^- \`b\` — last synced from docs@${two}$`, 'm'));
		// `c` is unchanged on the branch: held back, not changed.
		assert.doesNotMatch(body, /^- `c` — last synced/m);
		assert.match(
			body,
			/^- `c` \(harper-best-practices\) — after 2 repairs, still dropped `c\(\)`$/m,
		);
		// The docs range starts at the oldest baseline of any changed rule.
		assert.match(
			body,
			new RegExp(`^### Docs commits since baseline \\(\`${one}\\.\\.${three}\`\\)$`, 'm'),
		);
		assert.match(body, /\tdocs: three\n.*\tdocs: two\n/);
	} finally {
		fs.rmSync(repo.root, { recursive: true, force: true });
	}
});

test('repairs from earlier runs carry forward through the previous body', () => {
	const repo = scaffold();
	try {
		const withoutPrevious = prBody(repo);
		assert.deepEqual(
			readSyncState(withoutPrevious).repaired.map((entry) => entry.rule),
			['b'],
		);

		// Run 1 repaired `a`, and the open PR's body still says so.
		const previous = `Old body.\n\n${syncStateComment({ repaired: [repaired('a', ['a()'])] })}\n`;
		const body = prBody(repo, previous);
		assert.match(body, /^- `a` — 1 repair: restored `a\(\)`$/m);
		assert.match(body, /^- `b` — 1 repair: restored `b\(\)`$/m);
		assert.deepEqual(
			readSyncState(body).repaired.map((entry) => entry.rule),
			['a', 'b'],
		);
		// Recomposing from its own output changes nothing, so a run with
		// nothing new leaves the PR body alone.
		assert.equal(prBody(repo, body), body);
	} finally {
		fs.rmSync(repo.root, { recursive: true, force: true });
	}
});
