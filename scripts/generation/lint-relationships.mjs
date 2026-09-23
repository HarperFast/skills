// Check `@relationship` examples in skill Markdown for attributes that do not
// exist, field types Harper will not resolve, and cardinality prose that
// contradicts the example. See lib/relationship-lint.mjs for the rules.
//
// Usage:
//   node scripts/generation/lint-relationships.mjs            # every registered skill
//   node scripts/generation/lint-relationships.mjs <file.md>…  # any Markdown, e.g. docs sources
//
// Lints each skill's rule files and SKILL.md. AGENTS.md is skipped: it is
// assembled from the rule bodies, and validate-generated.mjs proves it equal.
//
// A deliberate counter-example can be exempted by putting
// `<!-- lint-relationships: ignore -->` on the line before its fence.

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { SKILLS } from './lib/manifest.mjs';
import { lintMarkdown } from './lib/relationship-lint.mjs';

async function skillMarkdownFiles() {
	const files = [];
	for (const skill of SKILLS) {
		const rulesDir = path.join(skill.dir, skill.rulesDir);
		const rules = (await fs.readdir(rulesDir)).filter((f) => f.endsWith('.md')).sort();
		files.push(...rules.map((f) => path.join(rulesDir, f)));
		files.push(path.join(skill.dir, skill.skillFile));
	}
	return files;
}

async function main() {
	const args = process.argv.slice(2);
	const files = args.length > 0 ? args : await skillMarkdownFiles();

	const problems = [];
	let checked = 0;
	for (const file of files) {
		let markdown;
		try {
			markdown = await fs.readFile(file, 'utf-8');
		} catch (err) {
			problems.push(`${file}: cannot read — ${err.message}`);
			continue;
		}
		const result = lintMarkdown(markdown);
		checked += result.checked;
		for (const f of result.findings) problems.push(`${file}:${f.line}: [${f.rule}] ${f.message}`);
	}

	if (problems.length > 0) {
		for (const p of problems) console.error(p);
		console.error(
			`\n✗ lint-relationships: ${problems.length} problem${problems.length === 1 ? '' : 's'}. ` +
				'If a skill rule is generated, the same example is usually in its docs source — fix it there and regenerate.',
		);
		process.exit(1);
	}
	console.log(
		`✓ lint-relationships: ${checked} @relationship example${checked === 1 ? '' : 's'} in ${files.length} file${files.length === 1 ? '' : 's'} consistent`,
	);
}

main().catch((err) => {
	console.error('lint-relationships crashed:', err);
	process.exit(2);
});
