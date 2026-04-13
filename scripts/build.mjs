import fs from 'node:fs/promises';
import path from 'node:path';

async function build() {
	const rulesDir = path.join(process.cwd(), 'harper-best-practices', 'rules');
	const outputDir = path.join(process.cwd(), 'dist');

	try {
		await fs.mkdir(outputDir, { recursive: true });

		const ruleFiles = await fs.readdir(rulesDir);
		const mdFiles = ruleFiles.filter((file) => file.endsWith('.md')).sort();

		const rules = [];
		const ruleContents = {};

		for (const file of mdFiles) {
			const ruleName = path.parse(file).name;
			const content = await fs.readFile(path.join(rulesDir, file), 'utf-8');
			rules.push(ruleName);
			ruleContents[ruleName] = content;
		}

		const skillSummary = await fs.readFile(
			path.join(process.cwd(), 'harper-best-practices', 'SKILL.md'),
			'utf-8',
		);

		await fs.writeFile(
			path.join(outputDir, 'index.js'),
			`/**
 * An array of all available rule names.
 */
export const ruleNames = ${JSON.stringify(rules, null, '\t')};

/**
 * A map from rule names to their markdown content.
 */
export const rules = ${JSON.stringify(ruleContents, null, '\t')};

/**
 * The content of the Harper Best Practices SKILL.md.
 */
export const skillSummary = ${JSON.stringify(skillSummary, null, '\t')};
`,
		);

		await fs.writeFile(
			path.join(outputDir, 'index.d.ts'),
			`/**
 * An array of all available rule names.
 */
export declare const ruleNames: readonly [
\t${rules.map((r) => `"${r}",`).join('\n\t')}
];

/**
 * A type representing all available rule names.
 */
export type RuleName = (typeof ruleNames)[number];

/**
 * A map from rule names to their markdown content.
 */
export declare const rules: Record<RuleName, string>;

/**
 * The content of the Harper Best Practices SKILL.md.
 */
export declare const skillSummary: string;
`,
		);

		try {
			const { execSync } = await import('node:child_process');
			execSync('npm run format', { stdio: 'inherit' });
		} catch (error) {
			console.warn('Could not run format after build:', error.message);
		}

		console.log('Build completed successfully.');
	} catch (error) {
		console.error('Build failed:', error);
		process.exit(1);
	}
}

build();
