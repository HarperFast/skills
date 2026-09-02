// Validator for the docs-driven skill generation system.
//
// Implements Layers 2–4 of the validation taxonomy in
// docs/plans-archive/docs-driven-skills.md:
//
//   - Layer 2 (manifest lint): the manifest conforms to the schema.
//   - Layer 3 (manifest ↔ frontmatter reconciliation): each rule file's
//     frontmatter matches the manifest. This is the gate that makes the
//     manifest causally authoritative.
//   - Layer 4 (per-mode body checks): generated/imported rule bodies satisfy
//     the per-mode invariants (must-cover, byte-identical, min length, no
//     leaked MDX, source-exists), plus AGENTS.md round-trip equality.
//
// Layer 1 (basic skill schema) is handled separately by validate-skills.mjs.
//
// Some Layer 4 checks need the docs build output (source-exists,
// byte-identical, fact-retention). Pass --docs-path <docs-checkout> to enable
// them; without it they are skipped with a note. A bare local
// `npm run validate` runs everything that doesn't require docs.
//
// Note on where the gate bites: the auto-sync workflow's Validate step passes
// --docs-path, so fact-retention blocks a lossy regeneration before it opens
// or updates the sync PR. The PR-time validate-skills workflow runs plain
// `npm run validate` with no docs checkout, so a green check there does NOT
// mean retention was verified.

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import matter from 'gray-matter';

import {
	loadManifest,
	normalizeSource,
	SKILLS,
	VALID_CATEGORIES,
	VALID_MODES,
	VALID_SOURCE_ROLES,
} from './lib/manifest.mjs';
import { computeInputHash, resolveSources, sourceFilePath } from './lib/sources.mjs';
import {
	assembleAgentsMd,
	assembleSkillIndex,
	bodyOf,
	SKILL_INDEX_BEGIN,
	SKILL_INDEX_END,
} from './lib/render.mjs';

const MIN_GENERATED_BODY_CHARS = 200;

function parseArgs(argv) {
	const args = { docsPath: process.env.DOCS_PATH || null };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--docs-path') args.docsPath = argv[++i];
	}
	return args;
}

function isPlainObject(v) {
	return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function isPositiveInteger(v) {
	return Number.isInteger(v) && v > 0;
}
function isNonEmptyString(v) {
	return typeof v === 'string' && v.length > 0;
}

// Remove fenced and inline code so leaked-MDX heuristics don't false-positive
// on legitimate `import`/JSX-like syntax inside code examples.
function stripCode(md) {
	return md.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
}

// ===========================================================================
// Layer 2 — Manifest lint
// ===========================================================================

function lintManifest(manifest, scope, errors) {
	if (!isPlainObject(manifest) || !Array.isArray(manifest.rules)) {
		errors.push(`[${scope}] Manifest must be an object with a \`rules\` array`);
		return false;
	}

	const seen = new Set();
	const allSlugs = new Set(manifest.rules.map((r) => r?.rule).filter(isNonEmptyString));

	for (let i = 0; i < manifest.rules.length; i++) {
		const e = manifest.rules[i];
		const where = `[${scope}] rules[${i}]${e?.rule ? ` (${e.rule})` : ''}`;
		if (!isPlainObject(e)) {
			errors.push(`${where}: must be an object`);
			continue;
		}
		for (const f of ['rule', 'description']) {
			if (!isNonEmptyString(e[f])) errors.push(`${where}: missing or non-string "${f}"`);
		}
		if (isNonEmptyString(e.rule)) {
			if (!/^[a-z0-9-]+$/.test(e.rule))
				errors.push(`${where}: "rule" must be lowercase/digits/hyphens`);
			if (seen.has(e.rule)) errors.push(`${where}: duplicate slug`);
			seen.add(e.rule);
		}
		if (!VALID_CATEGORIES.has(e.category)) {
			errors.push(`${where}: "category" must be one of ${[...VALID_CATEGORIES].join(' / ')}`);
		}
		for (const f of ['priority', 'order']) {
			if (!isPositiveInteger(e[f])) errors.push(`${where}: "${f}" must be a positive integer`);
		}
		if (!VALID_MODES.has(e.mode)) {
			errors.push(`${where}: "mode" must be one of ${[...VALID_MODES].join(' / ')}`);
		}

		const needsSources = e.mode === 'generate' || e.mode === 'direct';
		if (needsSources) {
			if (!Array.isArray(e.sources) || e.sources.length === 0) {
				errors.push(`${where}: "sources" required and non-empty for mode "${e.mode}"`);
			} else {
				e.sources.forEach((s, si) => {
					const sw = `${where}.sources[${si}]`;
					if (!isPlainObject(s)) return errors.push(`${sw}: must be an object`);
					if (!isNonEmptyString(s.path)) errors.push(`${sw}: missing "path"`);
					else if (s.path.startsWith('/') || s.path.includes('..')) {
						errors.push(`${sw}: "path" must be relative without "..": ${JSON.stringify(s.path)}`);
					}
					if (s.section !== undefined && !isNonEmptyString(s.section)) {
						errors.push(`${sw}: "section" must be a non-empty string`);
					}
					if (s.role !== undefined && !VALID_SOURCE_ROLES.has(s.role)) {
						errors.push(`${sw}: "role" must be one of ${[...VALID_SOURCE_ROLES].join(' / ')}`);
					}
				});
			}
		} else if (e.sources !== undefined) {
			errors.push(`${where}: "sources" must be omitted for mode "${e.mode}"`);
		}

		if (e.mode === 'generate') {
			if (e.must_cover !== undefined) {
				if (!Array.isArray(e.must_cover)) errors.push(`${where}: "must_cover" must be an array`);
				else {
					e.must_cover.forEach((m, mi) => {
						if (!isNonEmptyString(m))
							errors.push(`${where}.must_cover[${mi}]: must be a non-empty string`);
					});
				}
			}
		} else if (e.must_cover !== undefined) {
			errors.push(`${where}: "must_cover" only applies to mode "generate"`);
		}

		// Facts the fact-retention check may stop enforcing for this rule —
		// each entry is a deliberate, reviewed removal.
		if (e.mode === 'generate') {
			if (e.allow_dropped !== undefined) {
				if (!Array.isArray(e.allow_dropped))
					errors.push(`${where}: "allow_dropped" must be an array`);
				else {
					e.allow_dropped.forEach((d, di) => {
						if (!isNonEmptyString(d))
							errors.push(`${where}.allow_dropped[${di}]: must be a non-empty string`);
					});
				}
			}
		} else if (e.allow_dropped !== undefined) {
			errors.push(`${where}: "allow_dropped" only applies to mode "generate"`);
		}

		if (e.cross_links !== undefined) {
			if (!Array.isArray(e.cross_links)) errors.push(`${where}: "cross_links" must be an array`);
			else {
				e.cross_links.forEach((c, ci) => {
					if (!isNonEmptyString(c))
						errors.push(`${where}.cross_links[${ci}]: must be a non-empty string`);
					else if (!allSlugs.has(c))
						errors.push(`${where}.cross_links[${ci}]: unknown rule "${c}"`);
				});
			}
		}
	}
	return errors.length === 0;
}

// ===========================================================================
// Layer 3 — Manifest ↔ frontmatter reconciliation, and Layer 4 body checks
// ===========================================================================

async function checkRules(manifest, skill, scope, docsBuildDir, errors) {
	const rulesDir = path.join(process.cwd(), skill.dir, skill.rulesDir);
	const manifestSlugs = new Set(manifest.rules.map((r) => r.rule));

	// Orphan rule files (on disk but not in manifest).
	const onDisk = (await fs.readdir(rulesDir)).filter((f) => f.endsWith('.md'));
	for (const f of onDisk) {
		const slug = path.basename(f, '.md');
		if (!manifestSlugs.has(slug)) {
			errors.push(`[${scope}] rules[${slug}]: file exists on disk but has no manifest entry`);
		}
	}

	for (const entry of manifest.rules) {
		const slug = entry.rule;
		const where = `[${scope}] rules[${slug}]`;
		const filePath = path.join(rulesDir, `${slug}.md`);

		let raw;
		try {
			raw = await fs.readFile(filePath, 'utf-8');
		} catch {
			errors.push(`${where}: manifest declares rule but ${slug}.md is missing`);
			continue;
		}

		const parsed = matter(raw);
		const fm = parsed.data;
		const body = parsed.content.trim();

		// --- Layer 3: reconciliation ---
		if (fm.name !== slug) errors.push(`${where}: frontmatter "name" must equal "${slug}"`);
		if (fm.description !== entry.description) {
			errors.push(`${where}: frontmatter "description" diverges from manifest`);
		}
		const meta = fm.metadata;
		if (!isPlainObject(meta)) {
			errors.push(`${where}: frontmatter must have a "metadata" object`);
			continue;
		}
		if (meta.mode !== entry.mode) {
			errors.push(
				`${where}: metadata.mode (${JSON.stringify(meta.mode)}) != manifest mode (${JSON.stringify(entry.mode)})`,
			);
		}

		if (entry.mode === 'generate' || entry.mode === 'direct') {
			if (!isNonEmptyString(meta.sourceCommit))
				errors.push(`${where}: metadata.sourceCommit required`);
			if (!isNonEmptyString(meta.inputHash)) errors.push(`${where}: metadata.inputHash required`);
			const manifestNorm = entry.sources.map(normalizeSource);
			const fmNorm = Array.isArray(meta.sources) ? meta.sources : [];
			if (manifestNorm.length !== fmNorm.length || !manifestNorm.every((s, i) => s === fmNorm[i])) {
				errors.push(`${where}: metadata.sources does not match manifest sources (regenerate)`);
			}
		} else {
			for (const f of ['sources', 'sourceCommit', 'inputHash']) {
				if (meta[f] !== undefined)
					errors.push(`${where}: metadata.${f} must be omitted for synthesized`);
			}
		}

		// --- Layer 4: per-mode body checks ---
		if (entry.mode === 'generate' || entry.mode === 'direct') {
			// No leaked MDX: JSX components or MDX `import` statements that appear
			// outside fenced/inline code. Code examples legitimately contain
			// `import ... from` and `<Generic>` type params, so strip code first.
			const prose = stripCode(body);
			if (/^import\s.+\sfrom\s/m.test(prose) || /<[A-Z][A-Za-z0-9]*[\s/>]/.test(prose)) {
				errors.push(
					`${where}: body contains leaked MDX (JSX component or import outside a code block)`,
				);
			}
		}
		if (entry.mode === 'generate') {
			if (body.length < MIN_GENERATED_BODY_CHARS) {
				errors.push(
					`${where}: generated body suspiciously short (${body.length} < ${MIN_GENERATED_BODY_CHARS} chars)`,
				);
			}
			for (const must of entry.must_cover ?? []) {
				if (!body.includes(must)) {
					errors.push(`${where}: must_cover string not found in body: ${JSON.stringify(must)}`);
				}
			}
		}

		// Docs-dependent Layer 4 checks (CI only).
		if (docsBuildDir && (entry.mode === 'generate' || entry.mode === 'direct')) {
			for (const source of entry.sources) {
				if (!fsSync.existsSync(sourceFilePath(docsBuildDir, source))) {
					errors.push(`${where}: source not found in docs build: ${source.path}`);
				}
			}
			if (entry.mode === 'direct') {
				try {
					const resolved = await resolveSources(docsBuildDir, entry.sources);
					if (resolved.trim() !== body) {
						errors.push(
							`${where}: direct body is not byte-identical to its flat-markdown source (regenerate)`,
						);
					}
					if (meta.inputHash && computeInputHash(resolved) !== meta.inputHash) {
						errors.push(`${where}: metadata.inputHash is stale vs current source (regenerate)`);
					}
				} catch (err) {
					errors.push(`${where}: cannot resolve sources for byte-identical check — ${err.message}`);
				}
			}
		}
	}
}

// ===========================================================================
// Fact retention
// ===========================================================================

// Minimum length of a code span to treat as a retainable fact. Below this the
// tokens are things like `id`, `or`, `{}` — too generic to carry meaning and
// too noisy to gate on. `409` (3 chars) is the shortest real one observed.
const MIN_FACT_CHARS = 3;

// Cap per rule so one heavily-restructured body cannot bury the rest of the
// report. The count is always stated, so nothing is silently hidden.
const MAX_REPORTED_FACTS = 12;

// Inline code spans, which is where this corpus keeps its facts: identifiers,
// config keys, status codes, header names, enum values, error strings. Prose
// is deliberately excluded — rewording prose is expected and legitimate;
// dropping `Sec-WebSocket-Protocol: mqtt` is not.
//
// Fenced blocks are excluded too: a body may legitimately move an example into
// a cross-linked rule, and fence contents would otherwise pin whole snippets
// in place.
function inlineCodeSpans(md) {
	const withoutFences = md.replace(/```[\s\S]*?```/g, '');
	const spans = new Set();
	for (const m of withoutFences.matchAll(/`([^`\n]+)`/g)) {
		const token = m[1].trim();
		if (token.length >= MIN_FACT_CHARS) spans.add(token);
	}
	return spans;
}

// The rule body as committed at HEAD, or null when it cannot be read (a new
// rule, a shallow checkout, or a non-git tree). Callers skip on null rather
// than failing: absence of a baseline is not a retention violation.
function bodyAtHead(relPath) {
	try {
		const raw = execFileSync('git', ['show', `HEAD:${relPath}`], {
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
		return matter(raw).content.trim();
	} catch {
		return null;
	}
}

// Fail when a fact that is present in BOTH the previously committed body AND
// the current docs source has disappeared from the regenerated body.
//
// Requiring presence in the current source is what makes this safe to gate on:
// a fact deleted upstream is correctly dropped and never reported. Only facts
// the docs still assert, and that this rule used to carry, are enforced.
//
// This is the retention check `must_cover` cannot be: must_cover requires a
// human to have predicted each fact in advance, and a substring assertion
// passes as long as the word appears somewhere — it cannot tell "the term is
// still here" from "the fact is still intact". This check is derived from the
// diff instead, so it covers facts nobody thought to anchor.
async function checkFactRetention(manifest, skill, scope, docsBuildDir, errors) {
	if (!docsBuildDir) return; // needs the current source to avoid false positives

	const rulesDir = path.join(process.cwd(), skill.dir, skill.rulesDir);
	for (const entry of manifest.rules) {
		if (entry.mode !== 'generate') continue;

		const slug = entry.rule;
		const where = `[${scope}] ${slug}`;
		const relPath = path.posix.join(skill.dir, skill.rulesDir, `${slug}.md`);

		const previousBody = bodyAtHead(relPath);
		if (previousBody === null) continue; // no committed baseline to compare against

		let currentBody;
		try {
			currentBody = matter(await fs.readFile(path.join(rulesDir, `${slug}.md`), 'utf-8')).content;
		} catch {
			continue; // missing-file case is already reported by checkRules
		}

		let source;
		try {
			source = await resolveSources(docsBuildDir, entry.sources);
		} catch {
			continue; // unresolvable sources are already reported by checkRules
		}

		const waived = new Set(entry.allow_dropped ?? []);
		const dropped = [];
		for (const fact of inlineCodeSpans(previousBody)) {
			if (waived.has(fact)) continue;
			if (!source.includes(fact)) continue; // no longer documented upstream
			if (currentBody.includes(fact)) continue; // still covered
			dropped.push(fact);
		}

		if (dropped.length > 0) {
			dropped.sort();
			const shown = dropped.slice(0, MAX_REPORTED_FACTS);
			const more = dropped.length - shown.length;
			errors.push(
				`${where}: regeneration dropped ${dropped.length} fact${dropped.length === 1 ? '' : 's'} ` +
					`still documented in its sources: ${shown.map((f) => JSON.stringify(f)).join(', ')}` +
					`${more > 0 ? ` (+${more} more)` : ''}. ` +
					`Restore them, or record the removal in ${skill.manifestFile} under ` +
					`rules[${slug}].allow_dropped if it is intentional.`,
			);
		}
	}
}

// ===========================================================================
// AGENTS.md round-trip equality
// ===========================================================================

function oxfmtString(content) {
	const tmp = path.join(os.tmpdir(), `validate-roundtrip-${process.pid}-${Date.now()}.md`);
	fsSync.writeFileSync(tmp, content);
	try {
		execFileSync('npx', ['oxfmt', '--config', path.join(process.cwd(), '.oxfmtrc.json'), tmp], {
			stdio: 'ignore',
		});
		return fsSync.readFileSync(tmp, 'utf-8');
	} finally {
		try {
			fsSync.unlinkSync(tmp);
		} catch {
			/* ignore */
		}
	}
}

async function checkAgentsRoundTrip(manifest, skill, scope, errors) {
	const rulesDir = path.join(process.cwd(), skill.dir, skill.rulesDir);
	const agentsPath = path.join(process.cwd(), skill.dir, skill.agentsFile);

	let committed;
	try {
		committed = await fs.readFile(agentsPath, 'utf-8');
	} catch {
		errors.push(`[${scope}] ${skill.agentsFile} is missing`);
		return;
	}

	const bodies = new Map();
	for (const entry of manifest.rules) {
		try {
			const raw = await fs.readFile(path.join(rulesDir, `${entry.rule}.md`), 'utf-8');
			bodies.set(entry.rule, bodyOf(raw));
		} catch {
			return; // missing rule file already reported in checkRules
		}
	}

	const assembled = assembleAgentsMd(manifest, (slug) => bodies.get(slug), {
		title: skill.agentsTitle,
		lead: skill.agentsLead,
	});
	let expected;
	try {
		expected = oxfmtString(assembled);
	} catch (err) {
		errors.push(`[${scope}] could not run oxfmt for AGENTS.md round-trip: ${err.message}`);
		return;
	}

	if (expected.trim() !== committed.trim()) {
		errors.push(
			`[${scope}] ${skill.agentsFile} is not in sync with the rules (run \`npm run generate\` to regenerate; do not hand-edit ${skill.agentsFile})`,
		);
	}
}

// ===========================================================================
// SKILL.md generated index round-trip equality
// ===========================================================================

async function checkSkillIndexRoundTrip(manifest, skill, scope, errors) {
	const skillPath = path.join(process.cwd(), skill.dir, skill.skillFile);

	let committed;
	try {
		committed = await fs.readFile(skillPath, 'utf-8');
	} catch {
		errors.push(`[${scope}] ${skill.skillFile} is missing`);
		return;
	}

	const startIdx = committed.indexOf(SKILL_INDEX_BEGIN);
	const endIdx = committed.indexOf(SKILL_INDEX_END);

	if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
		errors.push(
			`[${scope}] ${skill.skillFile} is missing sentinel comments ` +
				`(${SKILL_INDEX_BEGIN} / ${SKILL_INDEX_END}) — run \`npm run generate\` to add them`,
		);
		return;
	}

	// Extract what is currently committed between the sentinels.
	const committedBlock = committed.slice(startIdx + SKILL_INDEX_BEGIN.length, endIdx).trim();

	// Produce what the block should look like (formatted).
	const assembled = assembleSkillIndex(manifest);
	let expected;
	try {
		expected = oxfmtString(assembled).trim();
	} catch (err) {
		errors.push(`[${scope}] could not run oxfmt for ${skill.skillFile} round-trip: ${err.message}`);
		return;
	}

	if (expected !== committedBlock) {
		errors.push(
			`[${scope}] ${skill.skillFile} generated index is not in sync with the manifest ` +
				`(run \`npm run generate\` to regenerate; do not hand-edit between the sentinel comments)`,
		);
	}
}

// ===========================================================================
// Main
// ===========================================================================

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const docsBuildDir = args.docsPath ? path.join(path.resolve(args.docsPath), 'build') : null;
	if (docsBuildDir && !fsSync.existsSync(docsBuildDir)) {
		console.error(`--docs-path given but ${docsBuildDir} does not exist`);
		process.exit(1);
	}

	const errors = [];
	for (const skill of SKILLS) {
		const scope = skill.dir;
		let manifest;
		try {
			manifest = await loadManifest(skill);
		} catch (err) {
			errors.push(`[${scope}] cannot load manifest: ${err.message}`);
			continue;
		}

		if (!lintManifest(manifest, scope, errors)) continue; // can't reconcile a broken manifest
		await checkRules(manifest, skill, scope, docsBuildDir, errors);
		await checkFactRetention(manifest, skill, scope, docsBuildDir, errors);
		await checkAgentsRoundTrip(manifest, skill, scope, errors);
		await checkSkillIndexRoundTrip(manifest, skill, scope, errors);
	}

	if (errors.length > 0) {
		for (const e of errors) console.error(e);
		console.error(
			`\n✗ validate-generated: ${errors.length} error${errors.length === 1 ? '' : 's'}`,
		);
		process.exit(1);
	}
	const docsNote = docsBuildDir
		? ''
		: ' (source-exists / byte-identical / fact-retention checks skipped — no --docs-path)';
	console.log(
		`✓ validate-generated: manifest, frontmatter, AGENTS.md, and SKILL.md checks passed${docsNote}`,
	);
}

main().catch((err) => {
	console.error('validate-generated crashed:', err);
	process.exit(2);
});
