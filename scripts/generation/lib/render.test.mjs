import { test } from 'node:test';
import assert from 'node:assert/strict';
import matter from 'gray-matter';

import {
	assembleAgentsMd,
	assembleSkillIndex,
	bodyOf,
	buildFrontmatter,
	composeRuleFile,
	insteadOfLine,
	stripInsteadOf,
	withInsteadOf,
} from './render.mjs';

const BODY = [
	'# Caching',
	'',
	'Instructions for caching.',
	'',
	'## When to Use',
	'',
	'When you cache.',
	'',
	'## How It Works',
	'',
	'1. Do it.',
].join('\n');

const ENTRY = {
	rule: 'caching',
	description: 'Caching.',
	category: 'logic',
	priority: 3,
	order: 5,
	mode: 'synthesized',
};

const LINE =
	'**Instead of:** Redis or Memcached cache-aside layers. Use this rule rather than adding that service. See `harper-architecture`.';

test('composeRuleFile puts the Instead-of line after the summary and before ## When to Use', () => {
	const file = composeRuleFile(buildFrontmatter(ENTRY), BODY, {
		replaces: ['Redis or Memcached cache-aside layers'],
	});
	assert.equal(
		bodyOf(file),
		[
			'# Caching',
			'',
			'Instructions for caching.',
			'',
			LINE,
			'',
			'## When to Use',
			'',
			'When you cache.',
			'',
			'## How It Works',
			'',
			'1. Do it.',
		].join('\n'),
	);
});

test('composeRuleFile adds no line to a rule without replaces', () => {
	for (const options of [undefined, {}, { replaces: [] }]) {
		const file = composeRuleFile(buildFrontmatter(ENTRY), BODY, options);
		assert.equal(bodyOf(file), BODY);
		assert.ok(!file.includes('Instead of'));
	}
});

test('replaces is never written into frontmatter', () => {
	const file = composeRuleFile(buildFrontmatter({ ...ENTRY, replaces: ['x'] }), BODY, {
		replaces: ['x'],
	});
	assert.deepEqual(Object.keys(matter(file).data), ['name', 'description', 'metadata']);
});

test('multiple items are joined with "; "', () => {
	assert.ok(insteadOfLine(['a, b', 'c']).startsWith('**Instead of:** a, b; c. Use this rule'));
});

test('withInsteadOf is idempotent and stripInsteadOf undoes it', () => {
	const once = withInsteadOf(BODY, ['x']);
	assert.equal(withInsteadOf(once, ['x']), once);
	assert.equal(stripInsteadOf(once), BODY);
	assert.equal(withInsteadOf(once, undefined), BODY);
	assert.equal(withInsteadOf(once, ['y']).match(/\*\*Instead of:\*\*/g).length, 1);
});

test('a line inside a code fence is not treated as the Instead-of line', () => {
	const body = `${BODY}\n\n\`\`\`md\n**Instead of:** example\n\`\`\``;
	assert.equal(stripInsteadOf(body), body);
});

test('AGENTS.md assembled from composed rule bodies carries the line', () => {
	const manifest = { rules: [{ ...ENTRY, replaces: ['x'] }] };
	const file = composeRuleFile(buildFrontmatter(ENTRY), BODY, { replaces: ['x'] });
	const agents = assembleAgentsMd(manifest, () => bodyOf(file), { title: 'T' });
	assert.match(agents, /\*\*Instead of:\*\* x\./);
});

test('assembleSkillIndex appends (instead of: ...) only for rules with replaces', () => {
	const manifest = {
		rules: [
			{ ...ENTRY, replaces: ['Redis', 'Memcached'] },
			{ ...ENTRY, rule: 'plain', description: 'Plain.', order: 6 },
		],
	};
	const index = assembleSkillIndex(manifest);
	assert.match(index, /- `caching` — Caching\. \(instead of: Redis; Memcached\)/);
	assert.match(index, /- `plain` — Plain\.$/m);
});
