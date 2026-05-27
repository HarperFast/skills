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
//   npm run generate -- --docs-path ../documentation
//
// Flags:
//   --docs-path <dir>  Path to the docs repo checkout (default: ../documentation,
//                      or DOCS_PATH env). The build output is <docs-path>/build.
//   --rule <slug>      Only (re)generate this one rule. Useful for local iteration.
//   --force            Regenerate even if the input hash is unchanged.
//
// Environment:
//   ANTHROPIC_API_KEY  Required for any rule in `mode: generate`.
//   GENERATE_MODEL     Override the model (default claude-sonnet-4-6).
//   DOCS_PATH          Default for --docs-path.
//   DOCS_SHA           Docs commit SHA to record (default: git HEAD of the checkout).

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFileSync, execSync } from 'node:child_process';
import matter from 'gray-matter';

import { loadManifest, SKILLS, sortedRules } from './lib/manifest.mjs';
import { computeInputHash, resolveSources } from './lib/sources.mjs';
import { generateRuleBody, generationModel } from './lib/llm.mjs';
import {
	assembleAgentsMd,
	assembleSkillIndex,
	bodyOf,
	buildFrontmatter,
	composeRuleFile,
	SKILL_INDEX_BEGIN,
	SKILL_INDEX_END,
} from './lib/render.mjs';

const AGENTS_LEAD =
	'Guidelines for building scalable, secure, and performant applications on Harper. These practices cover everything from initial schema design to advanced deployment strategies.';

function parseArgs(argv) {
	const args = { docsPath: process.env.DOCS_PATH || '../documentation', rule: null, force: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--docs-path') args.docsPath = argv[++i];
		else if (a === '--rule') args.rule = argv[++i];
		else if (a === '--force') args.force = true;
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

// Read the existing rule file's frontmatter metadata, or null if the file
// doesn't exist yet. Attempt the read and handle ENOENT rather than checking
// for existence first — a separate check would race with the read.
async function readExistingMeta(filePath) {
	let raw;
	try {
		raw = await fs.readFile(filePath, 'utf-8');
	} catch (err) {
		if (err.code === 'ENOENT') return null;
		throw err;
	}
	return matter(raw).data?.metadata ?? null;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const docsRepoPath = path.resolve(args.docsPath);
	const docsBuildDir = path.join(docsRepoPath, 'build');

	const docsSha = resolveDocsSha(docsRepoPath);
	console.log(`Docs build: ${docsBuildDir}`);
	console.log(`Docs SHA:   ${docsSha}`);

	let changed = 0;
	let skipped = 0;
	let synthesized = 0;
	let totalUsage = { input: 0, output: 0, cacheRead: 0 };

	for (const skill of SKILLS) {
		const manifest = await loadManifest(skill);
		const rulesDir = path.join(process.cwd(), skill.dir, skill.rulesDir);
		const rules = args.rule
			? manifest.rules.filter((r) => r.rule === args.rule)
			: sortedRules(manifest);

		if (args.rule && rules.length === 0) {
			console.error(`Rule "${args.rule}" not found in ${skill.manifestFile}`);
			process.exit(1);
		}

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
				console.error(`✗ ${entry.rule}: failed to resolve sources — ${err.message}`);
				if (err.code === 'ENOENT') {
					console.error(
						`  No flat-markdown found under ${docsBuildDir}. ` +
							`Run \`npm ci && npm run build\` in the docs checkout (or fix --docs-path).`,
					);
				}
				process.exit(1);
			}
			const inputHash = computeInputHash(sourceContent);

			// Skip if unchanged.
			const existingMeta = await readExistingMeta(filePath);
			const unchanged =
				existingMeta && existingMeta.mode === entry.mode && existingMeta.inputHash === inputHash;
			if (unchanged && !args.force) {
				skipped++;
				continue;
			}

			// Produce the body.
			let body;
			if (entry.mode === 'direct') {
				body = sourceContent;
			} else if (entry.mode === 'generate') {
				const result = await generateRuleBody({
					rule: entry.rule,
					description: entry.description,
					sourceContent,
					mustCover: entry.must_cover,
					crossLinks: entry.cross_links,
				});
				body = result.body;
				totalUsage.input += result.usage.input_tokens ?? 0;
				totalUsage.output += result.usage.output_tokens ?? 0;
				totalUsage.cacheRead += result.usage.cache_read_input_tokens ?? 0;
			} else {
				console.error(`✗ ${entry.rule}: unknown mode "${entry.mode}"`);
				process.exit(1);
			}

			const frontmatter = buildFrontmatter(entry, { sourceCommit: docsSha, inputHash });
			await fs.writeFile(filePath, composeRuleFile(frontmatter, body), 'utf-8');
			console.log(`✓ ${entry.rule} (${entry.mode})`);
			changed++;
		}

		skill.__manifest = manifest;
		skill.__rulesDir = rulesDir;
	}

	// Format the generated rule files first, so AGENTS.md is assembled from the
	// final (formatted) rule bodies. This keeps the validator's round-trip check
	// exact: it assembles from the same formatted bodies and re-runs oxfmt.
	try {
		execSync('npm run format', { stdio: 'inherit' });
	} catch (err) {
		console.warn(`Could not run formatter after generation: ${err.message}`);
	}

	// Reassemble AGENTS.md from the formatted rule bodies (skip on single-rule
	// runs — AGENTS.md is regenerated on the next full run).
	if (!args.rule) {
		for (const skill of SKILLS) {
			const manifest = skill.__manifest ?? (await loadManifest(skill));
			const rulesDir = skill.__rulesDir ?? path.join(process.cwd(), skill.dir, skill.rulesDir);
			const bodies = new Map();
			for (const entry of manifest.rules) {
				const raw = await fs.readFile(path.join(rulesDir, `${entry.rule}.md`), 'utf-8');
				bodies.set(entry.rule, bodyOf(raw));
			}
			const agentsMd = assembleAgentsMd(manifest, (slug) => bodies.get(slug), {
				lead: AGENTS_LEAD,
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
	}

	console.log(
		`\nGeneration complete: ${changed} regenerated, ${skipped} unchanged, ${synthesized} synthesized (skipped).`,
	);
	if (totalUsage.input || totalUsage.output) {
		console.log(
			`Model: ${generationModel()}  |  tokens in: ${totalUsage.input} ` +
				`(cache read: ${totalUsage.cacheRead}), out: ${totalUsage.output}`,
		);
	}
}

main().catch((err) => {
	console.error('generate-rules crashed:', err);
	process.exit(2);
});
