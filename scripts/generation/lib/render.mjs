// Rendering helpers: compose individual rule files (frontmatter + body) and
// assemble the flat AGENTS.md from all rule bodies. Both the generator and the
// validator use assembleAgentsMd (the validator for the round-trip equality
// check). Keeping assembly here means there is exactly one definition of "what
// AGENTS.md should look like".
//
// assembleSkillIndex builds the generated block inside SKILL.md (rule
// categories table + Quick Reference list). It is spliced between sentinel
// comments by the generator and re-validated for round-trip equality by the
// validator — the same pattern as AGENTS.md.

import matter from 'gray-matter';
import { CATEGORY_LABELS, normalizeSource, sortedRules } from './manifest.mjs';

// Sentinel strings that delimit the generated block inside SKILL.md.
// The generator replaces content between them; the validator checks it.
export const SKILL_INDEX_BEGIN = '<!-- BEGIN GENERATED INDEX -->';
export const SKILL_INDEX_END = '<!-- END GENERATED INDEX -->';

// Impact label per category. Kept here (not in the manifest) because it is
// presentation metadata that belongs to the renderer, not the rule taxonomy.
const CATEGORY_IMPACT = {
	schema: 'HIGH',
	api: 'HIGH',
	logic: 'MEDIUM',
	ops: 'MEDIUM',
	// harper-mcp categories
	setup: 'HIGH',
	tools: 'HIGH',
	resources: 'MEDIUM',
	security: 'HIGH',
	// harper-local-dev categories
	instances: 'HIGH',
};

// URL-path prefix convention for each category.
const CATEGORY_PREFIX = {
	schema: 'schema-',
	api: 'api-',
	logic: 'logic-',
	ops: 'ops-',
	// harper-mcp categories
	setup: 'setup-',
	tools: 'tools-',
	resources: 'resources-',
	security: 'ops-',
	// harper-local-dev categories
	instances: 'dev-',
};

// Produce the "Rule Categories by Priority" table + "Quick Reference" grouped
// list from the manifest. This is the content that lives between the sentinel
// comments in SKILL.md. Deterministic: same manifest always produces
// byte-identical output.
export function assembleSkillIndex(manifest) {
	const rules = sortedRules(manifest);

	// Group rules by category, preserving first-seen (priority-sorted) order.
	const categories = [];
	const byCategory = new Map();
	for (const rule of rules) {
		if (!byCategory.has(rule.category)) {
			byCategory.set(rule.category, []);
			categories.push(rule.category);
		}
		byCategory.get(rule.category).push(rule);
	}

	const out = [];

	// Rule Categories by Priority table.
	out.push('## Rule Categories by Priority', '');
	out.push('| Priority | Category | Impact | Prefix |');
	out.push('| -------- | -------- | ------ | ------ |');
	categories.forEach((cat, i) => {
		const label = CATEGORY_LABELS[cat] || cat;
		const impact = CATEGORY_IMPACT[cat] || '';
		const prefix = CATEGORY_PREFIX[cat] ? `\`${CATEGORY_PREFIX[cat]}\`` : '';
		out.push(`| ${i + 1} | ${label} | ${impact} | ${prefix} |`);
	});
	out.push('');

	// Quick Reference — one sub-section per category.
	out.push('## Quick Reference', '');
	categories.forEach((cat, i) => {
		const label = CATEGORY_LABELS[cat] || cat;
		const impact = CATEGORY_IMPACT[cat] || '';
		out.push(`### ${i + 1}. ${label} (${impact})`, '');
		for (const rule of byCategory.get(cat)) {
			const insteadOf = rule.replaces?.length ? ` (instead of: ${rule.replaces.join('; ')})` : '';
			out.push(`- \`${rule.rule}\` — ${rule.description}${insteadOf}`);
		}
		out.push('');
	});

	return out
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

// Build the frontmatter object for a rule file from its manifest entry plus
// generator-written provenance. synthesized rules carry only mode.
export function buildFrontmatter(entry, { sourceCommit, inputHash } = {}) {
	const metadata = { mode: entry.mode };
	if (entry.mode === 'generate' || entry.mode === 'direct') {
		metadata.sources = entry.sources.map(normalizeSource);
		metadata.sourceCommit = sourceCommit;
		metadata.inputHash = inputHash;
	}
	return { name: entry.rule, description: entry.description, metadata };
}

// Where a rule file's frontmatter disagrees with its manifest entry, one
// message per problem, or [] when it reconciles. validate-generated gates on
// it; the generator checks it before keeping a file it could not regenerate.
export function frontmatterProblems(entry, fm) {
	const problems = [];
	if (fm.name !== entry.rule) problems.push(`frontmatter "name" must equal "${entry.rule}"`);
	if (fm.description !== entry.description) {
		problems.push('frontmatter "description" diverges from manifest');
	}
	const meta = fm.metadata;
	if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
		problems.push('frontmatter must have a "metadata" object');
		return problems;
	}
	if (meta.mode !== entry.mode) {
		problems.push(
			`metadata.mode (${JSON.stringify(meta.mode)}) != manifest mode (${JSON.stringify(entry.mode)})`,
		);
	}
	if (entry.mode === 'generate' || entry.mode === 'direct') {
		for (const field of ['sourceCommit', 'inputHash']) {
			if (typeof meta[field] !== 'string' || meta[field].length === 0) {
				problems.push(`metadata.${field} required`);
			}
		}
		const manifestSources = entry.sources.map(normalizeSource);
		const recordedSources = Array.isArray(meta.sources) ? meta.sources : [];
		if (
			manifestSources.length !== recordedSources.length ||
			!manifestSources.every((source, i) => source === recordedSources[i])
		) {
			problems.push('metadata.sources does not match manifest sources (regenerate)');
		}
	} else {
		for (const field of ['sources', 'sourceCommit', 'inputHash']) {
			if (meta[field] !== undefined)
				problems.push(`metadata.${field} must be omitted for synthesized`);
		}
	}
	return problems;
}

// The "Instead of" line a rule carries when its manifest entry has a
// `replaces` list. Deterministic: it is rendered from the manifest, never
// written by the model, and applies to every mode.
export const INSTEAD_OF_PREFIX = '**Instead of:**';

export function insteadOfLine(replaces) {
	return `${INSTEAD_OF_PREFIX} ${replaces.join('; ')}. Use this rule rather than adding that service. See \`harper-architecture\`.`;
}

// Remove any existing Instead-of line (and the blank line after it) from a
// rule body. Lines inside fenced code blocks are left alone.
export function stripInsteadOf(body) {
	let inFence = false;
	const lines = body.split('\n');
	const out = [];
	for (let i = 0; i < lines.length; i++) {
		if (/^\s*(`{3,}|~{3,})/.test(lines[i])) inFence = !inFence;
		if (!inFence && lines[i].startsWith(INSTEAD_OF_PREFIX)) {
			if (lines[i + 1] === '') i++;
			continue;
		}
		out.push(lines[i]);
	}
	return out.join('\n');
}

// Return `body` with the Instead-of line for `replaces` placed after the H1 and
// its summary paragraph, directly before the first H2 (`## When to Use`). With
// no `replaces` the line is removed, so the result is the single canonical form
// for a rule and the function is idempotent.
export function withInsteadOf(body, replaces) {
	const stripped = stripInsteadOf(body.trim());
	if (!Array.isArray(replaces) || replaces.length === 0) return stripped;

	const lines = stripped.split('\n');
	let inFence = false;
	let at = lines.length;
	for (let i = 0; i < lines.length; i++) {
		if (/^\s*(`{3,}|~{3,})/.test(lines[i])) inFence = !inFence;
		if (!inFence && /^## /.test(lines[i])) {
			at = i;
			break;
		}
	}
	const before = lines.slice(0, at).join('\n').trimEnd();
	const after = lines.slice(at).join('\n');
	return [before, insteadOfLine(replaces), after].filter((part) => part !== '').join('\n\n');
}

// Compose a complete rule file (frontmatter + body). The body is expected to
// start with its H1. `replaces` is the manifest entry's optional list; when
// present the Instead-of line is inserted into the body. Output is later run
// through oxfmt by the generator.
export function composeRuleFile(frontmatter, body, { replaces } = {}) {
	return matter.stringify(`\n${withInsteadOf(body, replaces)}\n`, frontmatter);
}

// Shift every Markdown ATX heading in `body` down by `delta` levels, capping at
// h6. Used to nest rule bodies under category/rule headings in AGENTS.md.
// Skips lines inside fenced code blocks so that `#`-leading code (YAML/bash/
// GraphQL comments) is never mistaken for a heading.
function shiftHeadings(body, delta) {
	let inFence = false;
	return body
		.split('\n')
		.map((line) => {
			if (/^\s*(`{3,}|~{3,})/.test(line)) {
				inFence = !inFence;
				return line;
			}
			if (inFence) return line;
			const m = line.match(/^(#{1,6})(\s+.*)$/);
			if (!m) return line;
			const level = Math.min(6, m[1].length + delta);
			return '#'.repeat(level) + m[2];
		})
		.join('\n');
}

// Strip the leading H1 line from a rule body, returning { title, rest }.
function splitTitle(body) {
	const lines = body.trim().split('\n');
	const m = lines[0].match(/^#\s+(.*)$/);
	if (!m) return { title: null, rest: body.trim() };
	return { title: m[1].trim(), rest: lines.slice(1).join('\n').trim() };
}

// Assemble the flat AGENTS.md document from all rule bodies, grouped by
// category in manifest order. Deterministic: same manifest + same rule bodies
// always produce byte-identical output. `readBody(slug)` returns the rule's
// body (frontmatter already stripped).
export function assembleAgentsMd(manifest, readBody, { title, lead } = {}) {
	const rules = sortedRules(manifest);

	const out = [`# ${title ?? 'Harper Best Practices'}`, ''];
	if (lead) out.push(lead.trim(), '');

	// Group rules by category, preserving first-seen category order.
	const categories = [];
	const byCategory = new Map();
	for (const rule of rules) {
		if (!byCategory.has(rule.category)) {
			byCategory.set(rule.category, []);
			categories.push(rule.category);
		}
		byCategory.get(rule.category).push(rule);
	}

	categories.forEach((category, ci) => {
		const categoryNum = ci + 1;
		out.push(`## ${categoryNum}. ${CATEGORY_LABELS[category] || category}`, '');
		byCategory.get(category).forEach((rule, ri) => {
			const { title, rest } = splitTitle(readBody(rule.rule));
			const heading = `### ${categoryNum}.${ri + 1} ${title || rule.rule}`;
			// The rule's H1 title becomes this H3; body sub-headings shift down by
			// 2 so the top-level ones (## When to Use) land at H4, nested under it.
			out.push(heading, '', shiftHeadings(rest, 2), '');
		});
	});

	return (
		out
			.join('\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim() + '\n'
	);
}

// Read a rule body (strip frontmatter) from raw file content.
export function bodyOf(rawRuleFile) {
	return matter(rawRuleFile).content.trim();
}
