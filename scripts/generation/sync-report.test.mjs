// End-to-end tests for `sync-report.mjs --format pr-body` on a rolling sync
// branch: a scratch skills repository whose branch carries several runs, and
// a scratch docs repository whose commits the rules were synced from. The
// body must describe the whole branch, not only the latest run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { repairTrailers } from './lib/generation-report.mjs';
import { SKILLS } from './lib/manifest.mjs';
import { buildFrontmatter, composeRuleFile } from './lib/render.mjs';

const SYNC_REPORT = path.resolve(import.meta.dirname, 'sync-report.mjs');
const SKILL = 'harper-best-practices';
const RULES_DIR = `${SKILL}/rules`;

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

const repaired = (rule, restored) => ({ skill: SKILL, rule, repairs: 1, restored, fixed: [] });

// A sync commit as the workflow writes it, with one trailer per repair.
function syncCommit(skills, repairs) {
	const message = ['docs: regenerate rules', ''];
	message.push(...repairTrailers({ repaired: repairs }));
	git(skills, 'commit', '-qa', '-m', message.join('\n'));
}

// Docs with three commits; skills whose main synced rules `a`, `c` and `d`
// from the first docs commit and `b` from the second; then a sync branch on
// which run 1 regenerated `a` with a repair and run 2 regenerated `b` with one.
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
	writeRule(skills, 'd', docsCommits[0], 'D as on main.');
	git(skills, 'add', '-A');
	git(skills, 'commit', '-qm', 'main');

	git(skills, 'checkout', '-qb', 'auto/docs-sync');
	writeRule(skills, 'a', docsCommits[2], 'A regenerated in run 1.');
	syncCommit(skills, [repaired('a', ['a()'])]);
	writeRule(skills, 'b', docsCommits[2], 'B regenerated in run 2.');
	syncCommit(skills, [repaired('b', ['b()'])]);
	return { root, docs, skills, docsCommits };
}

// The latest run's report: it held `c` back.
const latestRun = {
	regenerated: [],
	repaired: [],
	heldBack: [
		{ skill: SKILL, rule: 'c', repairs: 2, dropped: ['c()'], missingAnchors: [], invalid: [] },
	],
};

function prBody({ skills, docs, root }) {
	const reportPath = path.join(root, 'report.json');
	fs.writeFileSync(reportPath, JSON.stringify(latestRun));
	const args = ['--docs-path', docs, '--format', 'pr-body', '--base', 'main'];
	args.push('--generation-report', reportPath);
	return execFileSync(process.execPath, [SYNC_REPORT, ...args], { cwd: skills, encoding: 'utf-8' });
}

const changedSection = (body) => body.split('### Why these rules changed')[1].split('###')[0];

test('the body lists every rule the branch changes, not only the latest run', () => {
	const repo = scaffold();
	try {
		const [one, two, three] = repo.docsCommits.map((sha) => sha.slice(0, 7));
		const body = prBody(repo);
		assert.match(body, /relative to `main`/);
		assert.match(body, new RegExp(`^- \`a\` — last synced from docs@${one}$`, 'm'));
		assert.match(body, new RegExp(`^- \`b\` — last synced from docs@${two}$`, 'm'));
		// `c` is unchanged on the branch: held back, not changed.
		assert.doesNotMatch(changedSection(body), /`c`/);
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

test('repairs come from every run’s commit, until a later change to the rule', () => {
	const repo = scaffold();
	try {
		let body = prBody(repo);
		assert.match(body, /^- `a` — 1 repair: restored `a\(\)`$/m);
		assert.match(body, /^- `b` — 1 repair: restored `b\(\)`$/m);

		// Run 3 regenerates `a` cleanly, so its run-1 repair no longer
		// describes what the PR carries.
		writeRule(repo.skills, 'a', repo.docsCommits[2], 'A regenerated again in run 3.');
		syncCommit(repo.skills, []);
		body = prBody(repo);
		assert.doesNotMatch(body, /^- `a` — 1 repair/m);
		assert.match(body, /^- `b` — 1 repair: restored `b\(\)`$/m);
	} finally {
		fs.rmSync(repo.root, { recursive: true, force: true });
	}
});

test('added and deleted rule files are named for what they are', () => {
	const repo = scaffold();
	try {
		fs.rmSync(path.join(repo.skills, RULES_DIR, 'd.md'));
		writeRule(repo.skills, 'e', repo.docsCommits[2], 'E is new.');
		git(repo.skills, 'add', '-A');
		git(repo.skills, 'commit', '-qm', 'review fix');
		const changed = changedSection(prBody(repo));
		assert.match(changed, /^- `d` — deleted in this PR$/m);
		assert.match(changed, /^- `e` — new in this PR$/m);
	} finally {
		fs.rmSync(repo.root, { recursive: true, force: true });
	}
});
