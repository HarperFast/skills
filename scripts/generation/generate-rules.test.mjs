// End-to-end tests for generate-rules.mjs: a scratch repository with one docs
// page and two generated rules, and a local server standing in for the
// Messages API. They cover what the unit tests cannot reach — a held-back file
// left byte-for-byte untouched, the report written on every exit, and
// validate-generated accepting what the generator kept.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

import { SKILLS } from './lib/manifest.mjs';
import { buildFrontmatter, composeRuleFile } from './lib/render.mjs';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const GENERATE = path.join(REPO, 'scripts/generation/generate-rules.mjs');
const VALIDATE = path.join(REPO, 'scripts/generation/validate-generated.mjs');

const SOURCE = 'Call `alpha()` first, then `beta()`, and never `gamma()` alone.';
const padding = 'Prose that clears the minimum body length for a generated rule. '.repeat(4);
const body = (title, facts) => `# ${title}\n\n${facts}\n\n${padding}`;
const FULL = 'Call `alpha()`, then `beta()`; never `gamma()` alone.';
const LOSSY = 'Call `alpha()`; never `gamma()` alone.'; // drops `beta()`

const entry = (rule) => ({
	rule,
	description: `The ${rule} rule.`,
	category: 'api',
	priority: 1,
	order: rule === 'kept' ? 1 : 2,
	mode: 'generate',
	sources: [{ path: 'page.md' }],
});

// A committed repository whose two rules are stale against the docs page.
function scaffold() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-rules-'));
	const write = (rel, content) => {
		fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		fs.writeFileSync(path.join(root, rel), content);
	};
	for (const skill of SKILLS) {
		const rules = skill.dir === 'harper-best-practices' ? [entry('kept'), entry('fixed')] : [];
		write(path.join(skill.dir, skill.manifestFile), JSON.stringify({ rules }, null, 2));
		write(
			path.join(skill.dir, skill.skillFile),
			'# Skill\n\n<!-- BEGIN GENERATED INDEX -->\n<!-- END GENERATED INDEX -->\n',
		);
		write(path.join(skill.dir, skill.agentsFile), '# Placeholder\n');
		fs.mkdirSync(path.join(root, skill.dir, skill.rulesDir), { recursive: true });
		for (const rule of rules) {
			const frontmatter = buildFrontmatter(rule, { sourceCommit: 'old', inputHash: 'stale' });
			write(
				path.join(skill.dir, skill.rulesDir, `${rule.rule}.md`),
				composeRuleFile(frontmatter, body(rule.rule, FULL)),
			);
		}
	}
	write('docs/build/page.md', `# Page\n\n${SOURCE}\n`);
	write('package.json', JSON.stringify({ private: true, scripts: { format: 'oxfmt' } }));
	fs.copyFileSync(path.join(REPO, '.oxfmtrc.json'), path.join(root, '.oxfmtrc.json'));
	fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(root, 'node_modules'));
	// Committed rules are formatted, so a held-back one is left byte-identical.
	execFileSync('npx', ['oxfmt'], { cwd: root, stdio: 'ignore' });
	const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
	git('init', '-q');
	git('add', '-A');
	git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'base');
	return root;
}

// A Messages API stand-in. `replies[rule]` lists one reply per call for that
// rule: a body string, or a number to answer with that HTTP status.
async function fakeApi(replies) {
	const calls = {};
	const server = http.createServer((req, res) => {
		let raw = '';
		req.on('data', (chunk) => (raw += chunk));
		req.on('end', () => {
			const { messages } = JSON.parse(raw);
			const rule = messages[0].content.match(/^# Rule to generate: (\S+)/m)[1];
			const reply = replies[rule][(calls[rule] = (calls[rule] ?? 0) + 1) - 1];
			if (typeof reply === 'number') {
				res.writeHead(reply, { 'content-type': 'application/json' });
				res.end(
					JSON.stringify({
						type: 'error',
						error: { type: 'invalid_request_error', message: 'no' },
					}),
				);
				return;
			}
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(
				JSON.stringify({
					id: 'msg',
					type: 'message',
					role: 'assistant',
					model: 'fake',
					content: [{ type: 'text', text: reply }],
					stop_reason: 'end_turn',
					stop_sequence: null,
					usage: { input_tokens: 1, output_tokens: 1 },
				}),
			);
		});
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	return { calls, server, url: `http://127.0.0.1:${server.address().port}` };
}

// Run a script in `cwd` without blocking this process, so the fake API can
// answer while it runs.
function run(script, args, { cwd, env = {} }) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [script, ...args], {
			cwd,
			env: { ...process.env, ...env },
		});
		let output = '';
		child.stdout.on('data', (chunk) => (output += chunk));
		child.stderr.on('data', (chunk) => (output += chunk));
		child.on('close', (status) => resolve({ status, output }));
	});
}

async function generate(root, replies) {
	const api = await fakeApi(replies);
	try {
		const result = await run(
			GENERATE,
			['--docs-path', path.join(root, 'docs'), '--report', path.join(root, 'report.json')],
			{
				cwd: root,
				env: { ANTHROPIC_API_KEY: 'test', ANTHROPIC_BASE_URL: api.url, DOCS_SHA: 'new' },
			},
		);
		const report = JSON.parse(fs.readFileSync(path.join(root, 'report.json'), 'utf-8'));
		return { ...result, report, calls: api.calls };
	} finally {
		api.server.close();
	}
}

const rulePath = (root, rule) => path.join(root, 'harper-best-practices/rules', `${rule}.md`);

test('a rule that stays lossy is held back untouched while a repaired one is written', async () => {
	const root = scaffold();
	try {
		const keptBefore = fs.readFileSync(rulePath(root, 'kept'), 'utf-8');
		const { status, output, report, calls } = await generate(root, {
			kept: [body('Kept', LOSSY), body('Kept', LOSSY), body('Kept', LOSSY)],
			fixed: [body('Fixed', LOSSY), body('Fixed', FULL)],
		});
		assert.equal(status, 0, output);
		assert.deepEqual(calls, { kept: 3, fixed: 2 });
		assert.deepEqual(
			report.heldBack.map((held) => [held.rule, held.dropped]),
			[['kept', ['beta()']]],
		);
		assert.deepEqual(
			report.repaired.map((repaired) => [repaired.rule, repaired.restored]),
			[['fixed', ['beta()']]],
		);
		assert.equal(fs.readFileSync(rulePath(root, 'kept'), 'utf-8'), keptBefore);
		assert.match(fs.readFileSync(rulePath(root, 'fixed'), 'utf-8'), /sourceCommit: new/);

		const validation = await run(VALIDATE, ['--docs-path', path.join(root, 'docs')], { cwd: root });
		assert.equal(validation.status, 0, validation.output);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('a model error stops the run, and the report still names the rule', async () => {
	const root = scaffold();
	try {
		const { status, output, report } = await generate(root, {
			kept: [body('Kept', LOSSY), body('Kept', LOSSY), body('Kept', LOSSY)],
			fixed: [400],
		});
		assert.equal(status, 1, output);
		assert.equal(report.stoppedOn.rule, 'fixed');
		assert.match(report.stoppedOn.reason, /model call failed/);
		assert.deepEqual(
			report.heldBack.map((held) => held.rule),
			['kept'],
		);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('a rule is not held back on a file the validator would reject', async () => {
	const root = scaffold();
	try {
		// The manifest moved on without the rule file, so keeping the file would
		// fail validate-generated's frontmatter reconciliation.
		const manifestPath = path.join(root, 'harper-best-practices/rules.manifest.yaml');
		const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf-8'));
		manifest.rules[0].description = 'A new description.';
		fs.writeFileSync(manifestPath, yaml.dump(manifest));

		const { status, output, report } = await generate(root, {
			kept: [body('Kept', LOSSY), body('Kept', LOSSY), body('Kept', LOSSY)],
		});
		assert.equal(status, 1, output);
		assert.equal(report.stoppedOn.rule, 'kept');
		assert.match(report.stoppedOn.reason, /cannot be kept instead: .*"description" diverges/);
		assert.deepEqual(report.heldBack, []);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
