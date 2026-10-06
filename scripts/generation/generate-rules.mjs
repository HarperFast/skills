// Docs-driven rule generator.
//
// Reads the rules manifest, resolves each rule's sources from a local docs
// build directory, and (re)writes rule bodies — via an LLM rewrite for
// `mode: generate`, verbatim for `mode: direct`, and untouched for
// `mode: synthesized`. Then reassembles AGENTS.md and formats the output.
//
// Offline-first: this never fetches docs over the network. It reads from a
// local docs checkout that has been built (the plugin's flat-markdown lives
// under `<docs>/build/`). In CI the workflow checks out + builds the docs
// repo; locally, point at a sibling checkout.
//
// Usage:
//   node scripts/generation/generate-rules.mjs [--docs-path <dir>] [--rule <slug>] [--force]
//                                              [--report <file>]
//   npm run generate -- --docs-path ../documentation
//
// Flags:
//   --docs-path <dir>  Path to the docs repo checkout (default: ../documentation,
//                      or DOCS_PATH env). The build output is <docs-path>/build.
//   --rule <slug>      Only (re)generate this one rule. Useful for local iteration.
//                      AGENTS.md and the SKILL.md index are still reassembled from
//                      the on-disk rule bodies, so the result is committable.
//   --force            Regenerate even if the input hash is unchanged.
//   --report <file>    Write a JSON report of this run: rules regenerated,
//                      rules repaired (and what was restored), and rules held
//                      back (and what they still lacked). The auto-sync
//                      workflow renders it into the sync PR body.
//
// A `mode: generate` body must keep every fact its committed version carries
// that the docs still state, contain every `must_cover` string, and pass the
// structural checks — what the validators gate on (lib/regenerate.mjs
// checkBody). A body that fails goes back to the model with what is wrong, up
// to GENERATE_MAX_REPAIRS times. A rule that still fails is held back: its
// file is left untouched (so its stale inputHash retries it next run) and the
// run carries on, so one bad rule cannot block every other docs change. The
// run still stops (exit 1) on a model error, and on a rule whose existing file
// could not pass validate-generated either.
//
// Environment:
//   ANTHROPIC_API_KEY     Required for any rule in `mode: generate`.
//   GENERATE_MODEL        Override the model (default claude-sonnet-4-6).
//   GENERATE_MAX_REPAIRS  Repair attempts per rule before holding it back (default 2).
//   DOCS_PATH             Default for --docs-path.
//   DOCS_SHA              Docs commit SHA to record (default: git HEAD of the checkout).

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFileSync, execSync } from 'node:child_process';
import matter from 'gray-matter';

import { loadManifest, SKILLS, sortedRules } from './lib/manifest.mjs';
import { computeInputHash, resolveSources } from './lib/sources.mjs';
import { generationModel, ruleConversation } from './lib/llm.mjs';
import {
	checkBody,
	hasProblems,
	parseMaxRepairs,
	regenerateFaithfully,
} from './lib/regenerate.mjs';
import { bodyAtHead } from './lib/retention.mjs';
import {
	assembleAgentsMd,
	assembleSkillIndex,
	bodyOf,
	buildFrontmatter,
	composeRuleFile,
	frontmatterProblems,
	SKILL_INDEX_BEGIN,
	SKILL_INDEX_END,
} from './lib/render.mjs';

function parseArgs(argv) {
	const args = {
		docsPath: process.env.DOCS_PATH || '../documentation',
		rule: null,
		force: false,
		report: null,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--docs-path') args.docsPath = argv[++i];
		else if (a === '--rule') args.rule = argv[++i];
		else if (a === '--force') args.force = true;
		else if (a === '--report') args.report = argv[++i];
		else throw new Error(`Unknown argument: ${a}`);
	}
	return args;
}

function resolveDocsSha(docsRepoPath) {
	if (process.env.DOCS_SHA) return process.env.DOCS_SHA;
	try {
		return execFileSync('git', ['-C', docsRepoPath, 'rev-parse', 'HEAD'], {
			encoding: 'utf-8',
		}).trim();
	} catch {
		return 'unknown';
	}
}

// Exit 1 rather than a crash; `rule` ({ skill, rule }) goes in the report.
class StopRun extends Error {
	constructor(message, rule) {
		super(message);
		this.rule = rule;
	}
}

// Read the existing rule file as { frontmatter, meta, body }, or null if the
// file doesn't exist yet. Attempt the read and handle ENOENT rather than
// checking for existence first — a separate check would race with the read.
async function readExisting(filePath) {
	let raw;
	try {
		raw = await fs.readFile(filePath, 'utf-8');
	} catch (err) {
		if (err.code === 'ENOENT') return null;
		throw err;
	}
	const { data } = matter(raw);
	return { frontmatter: data, meta: data?.metadata ?? null, body: bodyOf(raw) };
}

// Capped so one rule cannot bury the log; --report carries every entry.
function listForLog(items, max = 12) {
	const shown = items.slice(0, max).map((item) => JSON.stringify(item));
	return items.length > max
		? `${shown.join(', ')} (+${items.length - max} more)`
		: shown.join(', ');
}

function describeProblems({ dropped, missingAnchors, invalid, frontmatter = [] }) {
	return [
		dropped.length && `dropped ${listForLog(dropped)}`,
		missingAnchors.length && `missing must_cover ${listForLog(missingAnchors)}`,
		...invalid.map((problem) => `body ${problem}`),
		...frontmatter,
	]
		.filter(Boolean)
		.join('; ');
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const report = { regenerated: [], repaired: [], heldBack: [] };
	let failure = null;
	try {
		await run(args, report);
	} catch (err) {
		if (err instanceof StopRun) report.stoppedOn = { ...err.rule, reason: err.message };
		failure = err;
	}
	// Written when the run stops too: the failure issue reads what was held
	// back. A failed write fails a run that otherwise succeeded, but must not
	// replace the error that stopped one.
	if (args.report) {
		try {
			await fs.writeFile(args.report, JSON.stringify(report, null, 2) + '\n', 'utf-8');
		} catch (err) {
			if (!failure) throw err;
			console.error(`Could not write the report to ${args.report}: ${err.message}`);
		}
	}
	if (failure) throw failure;
}

async function run(args, report) {
	const docsRepoPath = path.resolve(args.docsPath);
	const docsBuildDir = path.join(docsRepoPath, 'build');

	const docsSha = resolveDocsSha(docsRepoPath);
	report.docsSha = docsSha;
	const repairLimit = parseMaxRepairs(process.env.GENERATE_MAX_REPAIRS);
	console.log(`Docs build: ${docsBuildDir}`);
	console.log(`Docs SHA:   ${docsSha}`);

	let changed = 0;
	let skipped = 0;
	let synthesized = 0;
	// Whether `--rule <slug>` matched an entry in *any* skill's manifest. A slug
	// lives in exactly one manifest, so the not-found check cannot be made per
	// skill — it belongs after the loop over SKILLS.
	let ruleMatched = false;
	let totalUsage = { input: 0, output: 0, cacheRead: 0 };

	for (const skill of SKILLS) {
		const manifest = await loadManifest(skill);
		const rulesDir = path.join(process.cwd(), skill.dir, skill.rulesDir);
		const rules = args.rule
			? manifest.rules.filter((r) => r.rule === args.rule)
			: sortedRules(manifest);

		if (args.rule && rules.length > 0) ruleMatched = true;

		for (const entry of rules) {
			const filePath = path.join(rulesDir, `${entry.rule}.md`);

			if (entry.mode === 'synthesized') {
				synthesized++;
				continue;
			}

			// Resolve + hash sources. A missing source surfaces here at the
			// point of use (rather than via an upfront existence check).
			let sourceContent;
			try {
				sourceContent = await resolveSources(docsBuildDir, entry.sources);
			} catch (err) {
				const hint =
					err.code === 'ENOENT'
						? `\n  No flat-markdown found under ${docsBuildDir}. ` +
							`Run \`npm ci && npm run build\` in the docs checkout (or fix --docs-path).`
						: '';
				throw new StopRun(`${entry.rule}: failed to resolve sources — ${err.message}${hint}`, {
					skill: skill.dir,
					rule: entry.rule,
				});
			}
			const inputHash = computeInputHash(sourceContent);

			// Skip if unchanged.
			const existing = await readExisting(filePath);
			const existingMeta = existing?.meta;
			const unchanged =
				existingMeta && existingMeta.mode === entry.mode && existingMeta.inputHash === inputHash;

			// ...but not if the body on disk does not satisfy its own anchors.
			// `inputHash` covers the resolved sources only, so editing
			// `must_cover` leaves it matching and the rule is skipped — the new
			// anchor never reaches the model, and validate-generated then fails
			// on it forever. That is the remediation path the fact-retention
			// check points at ("restore them"), so it has to actually work
			// without a manual --force.
			let anchorsUnsatisfied = false;
			if (unchanged && entry.mode === 'generate' && entry.must_cover?.length) {
				anchorsUnsatisfied = entry.must_cover.some((m) => !existing.body.includes(m));
				if (anchorsUnsatisfied) {
					console.log(
						`  ${entry.rule}: source unchanged but must_cover unsatisfied — regenerating`,
					);
				}
			}

			if (unchanged && !anchorsUnsatisfied && !args.force) {
				skipped++;
				continue;
			}

			// Produce the body.
			let body;
			if (entry.mode === 'direct') {
				body = sourceContent;
			} else if (entry.mode === 'generate') {
				// The same baseline validate-generated compares against.
				const previousBody = bodyAtHead(
					path.posix.join(skill.dir, skill.rulesDir, `${entry.rule}.md`),
				);
				const checks = {
					previousBody,
					source: sourceContent,
					mustCover: entry.must_cover,
					allowDropped: entry.allow_dropped,
				};
				const outcome = await regenerateFaithfully({
					conversation: ruleConversation({
						rule: entry.rule,
						description: entry.description,
						sourceContent,
						mustCover: entry.must_cover,
						crossLinks: entry.cross_links,
					}),
					...checks,
					maxRepairs: repairLimit,
				});
				totalUsage.input += outcome.usage.input_tokens;
				totalUsage.output += outcome.usage.output_tokens;
				totalUsage.cacheRead += outcome.usage.cache_read_input_tokens;

				const where = { skill: skill.dir, rule: entry.rule };
				// An API, auth or truncation error says nothing about the rule, and
				// holding back on it could leave a green run with nothing synced.
				if (outcome.error) {
					throw new StopRun(`${entry.rule}: model call failed: ${outcome.error}`, where);
				}
				if (!outcome.ok) {
					const reason = describeProblems(outcome);
					// Holding back keeps the file on disk, so it is only safe when
					// that file passes everything validate-generated checks.
					if (!existing) throw new StopRun(`${entry.rule}: ${reason}`, where);
					const keptProblems = {
						...checkBody({ body: existing.body, ...checks }),
						frontmatter: frontmatterProblems(entry, existing.frontmatter),
					};
					if (hasProblems(keptProblems)) {
						throw new StopRun(
							`${entry.rule}: ${reason} — and the existing body cannot be kept instead: ` +
								describeProblems(keptProblems),
							where,
						);
					}
					console.warn(
						`⚠ ${entry.rule}: held back, existing body kept — ` +
							`after ${outcome.repairs} repair(s), ${reason}`,
					);
					report.heldBack.push({
						...where,
						repairs: outcome.repairs,
						dropped: outcome.dropped,
						missingAnchors: outcome.missingAnchors,
						invalid: outcome.invalid,
					});
					continue;
				}
				body = outcome.body;
				if (outcome.repairs > 0) {
					const fixes = [
						outcome.restored.length && `restored ${listForLog(outcome.restored)}`,
						...outcome.fixed.map((problem) => `fixed: body ${problem}`),
					];
					console.log(
						`  ${entry.rule}: repaired in ${outcome.repairs} pass(es) — ` +
							fixes.filter(Boolean).join('; '),
					);
					report.repaired.push({
						skill: skill.dir,
						rule: entry.rule,
						repairs: outcome.repairs,
						restored: outcome.restored,
						fixed: outcome.fixed,
					});
				}
			} else {
				throw new StopRun(`${entry.rule}: unknown mode "${entry.mode}"`, {
					skill: skill.dir,
					rule: entry.rule,
				});
			}

			const frontmatter = buildFrontmatter(entry, { sourceCommit: docsSha, inputHash });
			await fs.writeFile(filePath, composeRuleFile(frontmatter, body), 'utf-8');
			console.log(`✓ ${entry.rule} (${entry.mode})`);
			report.regenerated.push({ skill: skill.dir, rule: entry.rule });
			changed++;
		}

		skill.__manifest = manifest;
		skill.__rulesDir = rulesDir;
	}

	// Unknown --rule slug: nothing was written, so exit before the formatting
	// and reassembly phases below.
	if (args.rule && !ruleMatched) {
		const manifests = SKILLS.map((s) => path.join(s.dir, s.manifestFile)).join(', ');
		throw new StopRun(`Rule "${args.rule}" not found in any manifest (${manifests})`);
	}

	// Format the generated rule files first, so AGENTS.md is assembled from the
	// final (formatted) rule bodies. This keeps the validator's round-trip check
	// exact: it assembles from the same formatted bodies and re-runs oxfmt.
	try {
		execSync('npm run format', { stdio: 'inherit' });
	} catch (err) {
		console.warn(`Could not run formatter after generation: ${err.message}`);
	}

	// Reassemble AGENTS.md from the formatted rule bodies. This runs on
	// single-rule runs too: it is a pure function of the on-disk rule bodies plus
	// the manifest, so it is cheap and idempotent, and the validator asserts
	// AGENTS.md is an exact round-trip of those bodies — skipping it would leave
	// a `--rule` run in a state that cannot be committed.
	for (const skill of SKILLS) {
		const manifest = skill.__manifest ?? (await loadManifest(skill));
		const rulesDir = skill.__rulesDir ?? path.join(process.cwd(), skill.dir, skill.rulesDir);
		const bodies = new Map();
		for (const entry of manifest.rules) {
			const raw = await fs.readFile(path.join(rulesDir, `${entry.rule}.md`), 'utf-8');
			bodies.set(entry.rule, bodyOf(raw));
		}
		const agentsMd = assembleAgentsMd(manifest, (slug) => bodies.get(slug), {
			title: skill.agentsTitle,
			lead: skill.agentsLead,
		});
		const agentsPath = path.join(process.cwd(), skill.dir, skill.agentsFile);
		await fs.writeFile(agentsPath, agentsMd, 'utf-8');
		// Format AGENTS.md itself so the committed file equals
		// oxfmt(assemble(formatted bodies)) — the exact value the validator
		// recomputes for its round-trip equality check. execFileSync (no
		// shell) avoids any quoting concern with the path argument.
		try {
			execFileSync('npx', ['oxfmt', agentsPath], { stdio: 'inherit' });
		} catch (err) {
			console.warn(`Could not format ${skill.agentsFile}: ${err.message}`);
		}

		// Splice the generated index block into SKILL.md. The sentinel
		// comments delimit the region the generator owns; everything outside
		// them is human-authored and left untouched.
		const skillPath = path.join(process.cwd(), skill.dir, skill.skillFile);
		let rawSkill;
		try {
			rawSkill = await fs.readFile(skillPath, 'utf-8');
		} catch (err) {
			console.warn(`Could not read ${skill.skillFile} for index update: ${err.message}`);
			rawSkill = null;
		}
		if (rawSkill !== null) {
			const startIdx = rawSkill.indexOf(SKILL_INDEX_BEGIN);
			const endIdx = rawSkill.indexOf(SKILL_INDEX_END);
			if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
				const newIndex = assembleSkillIndex(manifest);
				const updated =
					rawSkill.slice(0, startIdx + SKILL_INDEX_BEGIN.length) +
					'\n\n' +
					newIndex +
					'\n\n' +
					rawSkill.slice(endIdx);
				await fs.writeFile(skillPath, updated, 'utf-8');
				try {
					execFileSync('npx', ['oxfmt', skillPath], { stdio: 'inherit' });
				} catch (err) {
					console.warn(`Could not format ${skill.skillFile}: ${err.message}`);
				}
			} else {
				console.warn(
					`${skill.skillFile} is missing sentinel comments — index not updated. ` +
						`Add ${SKILL_INDEX_BEGIN} / ${SKILL_INDEX_END} to mark the generated block.`,
				);
			}
		}
	}

	console.log(
		`\nGeneration complete: ${changed} regenerated, ${report.heldBack.length} held back, ` +
			`${skipped} unchanged, ${synthesized} synthesized (skipped).`,
	);
	if (report.heldBack.length > 0) {
		console.warn(
			`Held back (existing bodies kept; retried next run): ` +
				report.heldBack.map((held) => held.rule).join(', '),
		);
	}
	if (totalUsage.input || totalUsage.output) {
		console.log(
			`Model: ${generationModel()}  |  tokens in: ${totalUsage.input} ` +
				`(cache read: ${totalUsage.cacheRead}), out: ${totalUsage.output}`,
		);
	}
}

main().catch((err) => {
	if (err instanceof StopRun) {
		console.error(`✗ ${err.message}`);
		process.exit(1);
	}
	console.error('generate-rules crashed:', err);
	process.exit(2);
});
