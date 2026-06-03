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
//   --format text|json   Freshness report. Used locally (with --strict, as an
//                         author-time guard before opening a manual rule PR)
//                         and in CI (non-strict, to capture provenance before
//                         regeneration runs). Pass --out <file> to also write
//                         the JSON snapshot for a later pr-body pass to consume.
//
//   --format pr-body     Compose the sync PR body from a pre-regeneration JSON
//                         snapshot (--from <file>). Lists the rules that changed,
//                         the docs commit each was last synced from, and the full
//                         docs commit range since the oldest such baseline — so a
//                         reviewer sees *why* each rule regenerated, not just the
//                         head SHA. Needs git history in the docs checkout
//                         (the workflow checks out documentation at fetch-depth: 0).
//
// Offline-first: hashing reads only the local docs build; pr-body reads only the
// local docs git history. No network calls.
//
// Usage:
//   node scripts/generation/sync-report.mjs --docs-path ../documentation
//   node scripts/generation/sync-report.mjs --docs-path ../documentation --strict
//   node scripts/generation/sync-report.mjs --docs-path ../documentation --out ../provenance.json
//   node scripts/generation/sync-report.mjs --docs-path ../documentation --format pr-body --from ../provenance.json
//
// Exit codes (report modes): 1 only when --strict and there is at least one
// stale rule or resolution error; 0 otherwise. pr-body always exits 0.

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import matter from 'gray-matter';

import { loadManifest, SKILLS } from './lib/manifest.mjs';
import { computeInputHash, resolveSources } from './lib/sources.mjs';

const PLAN_PATH = 'docs/plans/docs-driven-skills.md';

function parseArgs(argv) {
	const args = {
		docsPath: process.env.DOCS_PATH || '../documentation',
		format: 'text',
		strict: false,
		out: null,
		from: null,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--docs-path') args.docsPath = argv[++i];
		else if (a === '--format') args.format = argv[++i];
		else if (a === '--strict') args.strict = true;
		else if (a === '--out') args.out = argv[++i];
		else if (a === '--from') args.from = argv[++i];
		else throw new Error(`Unknown argument: ${a}`);
	}
	if (!['text', 'json', 'pr-body'].includes(args.format)) {
		throw new Error(`--format must be one of text / json / pr-body (got ${args.format})`);
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
// pr-body: compose the sync PR description from a pre-regen snapshot.
// ---------------------------------------------------------------------------

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

function composePrBody(docsRepoPath, snapshot) {
	const headSha = gitDocs(docsRepoPath, ['rev-parse', 'HEAD']);
	const headShort = short(headSha);
	const changed = snapshot.filter((r) => r.stale);

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
			'Each rule regenerated because its source content differs from the docs ' +
				'commit it was last synced from. The trigger commit is **not** ' +
				'necessarily what changed a given rule — drift accumulates across every ' +
				'docs commit since the rule’s recorded baseline (below).',
			'',
		);
		for (const r of changed) {
			lines.push(`- \`${r.rule}\` — last synced from docs@${short(r.recordedCommit)}`);
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

	lines.push(
		`Produced by \`.github/workflows/generate.yaml\`. Review the diff as you ` +
			`would any rule change — the generator reads the docs build output and ` +
			`rewrites \`mode: generate\` / imports \`mode: direct\` rule bodies, then ` +
			`reassembles AGENTS.md. See ${PLAN_PATH}.`,
		'',
		'🤖 Generated with [Claude Code](https://claude.com/claude-code)',
	);
	return lines.join('\n');
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const docsRepoPath = path.resolve(args.docsPath);
	const docsBuildDir = path.join(docsRepoPath, 'build');

	if (args.format === 'pr-body') {
		if (!args.from) throw new Error('--format pr-body requires --from <snapshot.json>');
		const snapshot = JSON.parse(await fs.readFile(args.from, 'utf-8'));
		process.stdout.write(composePrBody(docsRepoPath, snapshot) + '\n');
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
