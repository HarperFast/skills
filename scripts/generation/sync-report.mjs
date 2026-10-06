// Sync provenance + freshness reporter for the docs-driven rule pipeline.
//
// Every `generate` / `direct` rule records the docs commit and source-content
// hash it was last produced from (`metadata.sourceCommit` / `metadata.inputHash`
// in the rule's frontmatter). That recorded baseline reflects whatever local
// docs checkout the author had when they ran `npm run generate` — which can lag
// docs `main`. When it lags, the next auto-sync regenerates the rule against
// current docs and produces what looks like an unrelated change (e.g. a docs
// commit about feature X regenerates the loadEnv rule, because the loadEnv
// source actually changed in an *earlier* unsynced commit). See
// docs/plans/docs-driven-skills.md.
//
// This script makes that drift legible. It compares each rule's recorded
// inputHash against the hash of its current resolved source content in a docs
// build, and reports which rules are stale (i.e. will regenerate).
//
// Two jobs, selected by --format:
//
//   --format text|json   Freshness report. Used locally, with --strict, as an
//                         author-time guard before opening a manual rule PR.
//                         Pass --out <file> to also write the JSON.
//
//   --format pr-body     Compose the sync PR body for the checked-out branch:
//                         every rule file it changes relative to --base (default
//                         origin/main), the docs commit each was last synced from
//                         on that base, and the docs commit range since the
//                         oldest such baseline — so a reviewer sees *why* each
//                         rule changed, not just the head SHA. Derived from git,
//                         not from one run, so it covers every run on a rolling
//                         sync branch. Needs git history in both checkouts (the
//                         workflow checks out both at fetch-depth: 0).
//                         --generation-report <file> (the generator's --report)
//                         adds the rules this run held back, and repairs;
//                         --previous-body <file> (the open PR's current body)
//                         carries earlier runs' repairs forward.
//
//   --format failure-details
//                         Print what a generation report (--generation-report
//                         <file>) says about a failed run: the rule it stopped
//                         on and the rules held back, or nothing. The workflow
//                         adds it to the auto-sync failure issue.
//
// Offline-first: hashing reads only the local docs build; pr-body reads only
// local git history. No network calls.
//
// Usage:
//   node scripts/generation/sync-report.mjs --docs-path ../documentation
//   node scripts/generation/sync-report.mjs --docs-path ../documentation --strict
//   node scripts/generation/sync-report.mjs --docs-path ../documentation --out ../provenance.json
//   node scripts/generation/sync-report.mjs --docs-path ../documentation --format pr-body \
//     [--base origin/main] [--generation-report ../generation-report.json] [--previous-body ../pr-body.md]
//   node scripts/generation/sync-report.mjs --format failure-details --generation-report ../generation-report.json
//
// Exit codes (report modes): 1 only when --strict and there is at least one
// stale rule or resolution error; 0 otherwise. pr-body and failure-details
// always exit 0.

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import matter from 'gray-matter';

import { loadManifest, SKILLS } from './lib/manifest.mjs';
import { computeInputHash, resolveSources } from './lib/sources.mjs';
import {
	failureDetailsMarkdown,
	heldBackMarkdown,
	loadGenerationReport,
	mergeRepaired,
	readSyncState,
	repairedMarkdown,
	syncStateComment,
} from './lib/generation-report.mjs';

const PLAN_PATH = 'docs/plans/docs-driven-skills.md';

function parseArgs(argv) {
	const args = {
		docsPath: process.env.DOCS_PATH || '../documentation',
		format: 'text',
		strict: false,
		out: null,
		base: 'origin/main',
		generationReport: null,
		previousBody: null,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--docs-path') args.docsPath = argv[++i];
		else if (a === '--format') args.format = argv[++i];
		else if (a === '--strict') args.strict = true;
		else if (a === '--out') args.out = argv[++i];
		else if (a === '--base') args.base = argv[++i];
		else if (a === '--generation-report') args.generationReport = argv[++i];
		else if (a === '--previous-body') args.previousBody = argv[++i];
		else throw new Error(`Unknown argument: ${a}`);
	}
	const formats = ['text', 'json', 'pr-body', 'failure-details'];
	if (!formats.includes(args.format)) {
		throw new Error(`--format must be one of ${formats.join(' / ')} (got ${args.format})`);
	}
	return args;
}

const short = (sha) => (sha && sha !== 'unknown' ? sha.slice(0, 7) : 'unknown');

// Compute the freshness of every generate/direct rule against a docs build.
async function computeFreshness(docsBuildDir) {
	const results = [];
	for (const skill of SKILLS) {
		const manifest = await loadManifest(skill);
		const rulesDir = path.join(process.cwd(), skill.dir, skill.rulesDir);
		for (const entry of manifest.rules) {
			if (entry.mode !== 'generate' && entry.mode !== 'direct') continue;

			const row = {
				skill: skill.dir,
				rule: entry.rule,
				mode: entry.mode,
				recordedCommit: null,
				recordedHash: null,
				currentHash: null,
				stale: false,
				error: null,
			};

			try {
				const raw = await fs.readFile(path.join(rulesDir, `${entry.rule}.md`), 'utf-8');
				const meta = matter(raw).data?.metadata ?? {};
				row.recordedCommit = meta.sourceCommit ?? null;
				row.recordedHash = meta.inputHash ?? null;
			} catch (err) {
				row.error = `cannot read rule file: ${err.message}`;
				results.push(row);
				continue;
			}

			try {
				const resolved = await resolveSources(docsBuildDir, entry.sources);
				row.currentHash = computeInputHash(resolved);
				row.stale = row.recordedHash !== row.currentHash;
			} catch (err) {
				row.error = `cannot resolve sources: ${err.message}`;
			}
			results.push(row);
		}
	}
	return results;
}

function printText(results) {
	const stale = results.filter((r) => r.stale);
	const errored = results.filter((r) => r.error);
	const fresh = results.length - stale.length - errored.length;

	console.log('Rule baseline freshness (recorded vs. current docs build):\n');
	for (const r of results) {
		const status = r.error ? '⚠ error ' : r.stale ? '✗ stale ' : '✓ fresh ';
		const detail = r.error
			? r.error
			: r.stale
				? `recorded ${short(r.recordedCommit)} (${r.recordedHash}) → current ${r.currentHash}`
				: `current with ${short(r.recordedCommit)}`;
		console.log(`  ${status} ${r.rule.padEnd(32)} ${detail}`);
	}
	console.log(`\n${fresh} fresh, ${stale.length} stale, ${errored.length} error(s).`);
	if (stale.length > 0) {
		console.log(
			'\nStale rules will be regenerated on the next sync. If a rule is stale\n' +
				'immediately after you authored it, your local docs checkout likely lags\n' +
				`docs main — pull + rebuild docs at main HEAD and regenerate. See ${PLAN_PATH}.`,
		);
	}
}

// ---------------------------------------------------------------------------
// pr-body: compose the sync PR description from the branch and docs history.
// ---------------------------------------------------------------------------

function git(args) {
	return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// Every rule file the checked-out branch changes relative to `base`, with the
// docs commit it was last synced from on `base`: null when the rule has no
// recorded baseline there, and `onBase` false when the branch adds the rule.
function changedRules(base) {
	const changed = [];
	for (const skill of SKILLS) {
		const rulesDir = path.posix.join(skill.dir, skill.rulesDir);
		const paths = git(['diff', '--name-only', '--diff-filter=d', `${base}...HEAD`, '--', rulesDir])
			.split('\n')
			.filter((relPath) => relPath.endsWith('.md'));
		for (const relPath of paths) {
			let raw = null;
			try {
				raw = git(['show', `${base}:${relPath}`]);
			} catch {
				// Not on the base: a rule this branch adds.
			}
			changed.push({
				skill: skill.dir,
				rule: path.posix.basename(relPath, '.md'),
				onBase: raw !== null,
				recordedCommit: raw === null ? null : (matter(raw).data?.metadata?.sourceCommit ?? null),
			});
		}
	}
	return changed;
}

function gitDocs(docsRepoPath, args) {
	return execFileSync('git', ['-C', docsRepoPath, ...args], { encoding: 'utf-8' }).trim();
}

// Oldest (by commit time) of the given commits that exist in docs history.
function oldestCommit(docsRepoPath, commits) {
	let oldest = null;
	for (const sha of commits) {
		let ts;
		try {
			ts = Number(gitDocs(docsRepoPath, ['show', '-s', '--format=%ct', sha]));
		} catch {
			continue; // not in history (shallow clone / rebased) — skip
		}
		if (oldest === null || ts < oldest.ts) oldest = { sha, ts };
	}
	return oldest?.sha ?? null;
}

function composePrBody({ docsRepoPath, base, generation, previousBody }) {
	const headSha = gitDocs(docsRepoPath, ['rev-parse', 'HEAD']);
	const headShort = short(headSha);
	const changed = changedRules(base);
	const repairedRules = mergeRepaired(readSyncState(previousBody).repaired, generation, changed);

	const lines = [
		`Automated regeneration of docs-driven skill rules, now synced to ` +
			`\`HarperFast/documentation@${headShort}\`.`,
		'',
	];

	if (changed.length === 0) {
		// Force-run or AGENTS.md-only change with no stale rules.
		lines.push('No rule sources changed since the last sync (derived artifacts refreshed).');
	} else {
		lines.push('### Why these rules changed', '');
		lines.push(
			`This PR changes each rule below relative to \`${base.replace(/^origin\//, '')}\`, where it was last ` +
				'synced from the docs commit shown. The trigger commit is **not** ' +
				'necessarily what changed a given rule — drift accumulates across every ' +
				'docs commit since the rule’s recorded baseline (below).',
			'',
		);
		for (const r of changed) {
			const from = r.recordedCommit
				? `last synced from docs@${short(r.recordedCommit)}`
				: r.onBase
					? 'no recorded docs baseline'
					: 'new in this PR';
			lines.push(`- \`${r.rule}\` — ${from}`);
		}
		lines.push('');

		const baselines = [...new Set(changed.map((r) => r.recordedCommit).filter(Boolean))];
		const start = oldestCommit(docsRepoPath, baselines);
		if (start) {
			let log = '';
			try {
				log = gitDocs(docsRepoPath, [
					'log',
					'--no-merges',
					'--format=%h%x09%s',
					`${start}..${headSha}`,
				]);
			} catch {
				log = '';
			}
			lines.push(`### Docs commits since baseline (\`${short(start)}..${headShort}\`)`, '');
			if (log) {
				lines.push('```');
				lines.push(log);
				lines.push('```');
			} else {
				lines.push('_(no intervening commits resolved — docs history may be shallow)_');
			}
			lines.push('');
		}
	}

	const heldBack = heldBackMarkdown(generation);
	if (heldBack) lines.push(heldBack, '');
	const repaired = repairedMarkdown({ repaired: repairedRules });
	if (repaired) lines.push(repaired, '');

	lines.push(
		`Produced by \`.github/workflows/generate.yaml\`. Review the diff as you ` +
			`would any rule change — the generator reads the docs build output and ` +
			`rewrites \`mode: generate\` / imports \`mode: direct\` rule bodies, then ` +
			`reassembles AGENTS.md. See ${PLAN_PATH}.`,
		'',
		'🤖 Generated with [Claude Code](https://claude.com/claude-code)',
		'',
		syncStateComment({ repaired: repairedRules }),
	);
	return lines.join('\n');
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const docsRepoPath = path.resolve(args.docsPath);
	const docsBuildDir = path.join(docsRepoPath, 'build');

	if (args.format === 'pr-body') {
		const generation = await loadGenerationReport(args.generationReport);
		const previousBody = args.previousBody ? await fs.readFile(args.previousBody, 'utf-8') : null;
		process.stdout.write(
			composePrBody({ docsRepoPath, base: args.base, generation, previousBody }) + '\n',
		);
		return;
	}

	if (args.format === 'failure-details') {
		if (!args.generationReport) {
			throw new Error('--format failure-details requires --generation-report <file>');
		}
		const details = failureDetailsMarkdown(await loadGenerationReport(args.generationReport));
		if (details) process.stdout.write(details + '\n');
		return;
	}

	if (!fsSync.existsSync(docsBuildDir)) {
		console.error(
			`--docs-path given but ${docsBuildDir} does not exist. ` +
				'Run `npm ci && npm run build` in the docs checkout first.',
		);
		process.exit(args.strict ? 1 : 0);
	}

	const results = await computeFreshness(docsBuildDir);

	if (args.out) {
		await fs.writeFile(args.out, JSON.stringify(results, null, 2), 'utf-8');
	}

	if (args.format === 'json') {
		process.stdout.write(JSON.stringify(results, null, 2) + '\n');
	} else {
		printText(results);
	}

	const anyStale = results.some((r) => r.stale);
	const anyError = results.some((r) => r.error);
	process.exit(args.strict && (anyStale || anyError) ? 1 : 0);
}

main().catch((err) => {
	console.error('sync-report crashed:', err);
	process.exit(2);
});
