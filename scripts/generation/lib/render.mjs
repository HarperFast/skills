// Rendering helpers: compose individual rule files (frontmatter + body) and
// assemble the flat AGENTS.md from all rule bodies. Both the generator and the
// validator use assembleAgentsMd (the validator for the round-trip equality
// check). Keeping assembly here means there is exactly one definition of "what
// AGENTS.md should look like".

import matter from 'gray-matter';
import { CATEGORY_LABELS, normalizeSource, sortedRules } from './manifest.mjs';

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

// Compose a complete rule file (frontmatter + body). The body is expected to
// start with its H1. Output is later run through oxfmt by the generator.
export function composeRuleFile(frontmatter, body) {
	return matter.stringify(`\n${body.trim()}\n`, frontmatter);
}

// Shift every Markdown ATX heading in `body` down by `delta` levels, capping at
// h6. Used to nest rule bodies under category/rule headings in AGENTS.md.
function shiftHeadings(body, delta) {
	return body
		.split('\n')
		.map((line) => {
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
export function assembleAgentsMd(manifest, readBody, { lead } = {}) {
	const rules = sortedRules(manifest);

	const out = ['# Harper Best Practices', ''];
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
