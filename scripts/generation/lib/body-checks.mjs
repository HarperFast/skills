// The checks validate-generated.mjs (length, MDX) and validate-skills.mjs (H1)
// gate on, so the generator can repair or hold back a broken body instead of
// failing the whole sync.

import { stripFencedBlocks } from './sources.mjs';

export const MIN_GENERATED_BODY_CHARS = 200;

// Code examples legitimately contain `import ... from` and `<Generic>`.
function stripCode(md) {
	return stripFencedBlocks(md).replace(/`[^`]*`/g, '');
}

export function hasLeakedMdx(body) {
	const prose = stripCode(body);
	return /^import\s.+\sfrom\s/m.test(prose) || /<[A-Z][A-Za-z0-9]*[\s/>]/.test(prose);
}

// Each problem reads as a predicate on "the body"; callers prefix it.
export function structuralProblems(body) {
	const trimmed = body.trim();
	const problems = [];
	if (!trimmed.startsWith('# ')) problems.push('does not start with an H1 title');
	if (trimmed.length < MIN_GENERATED_BODY_CHARS) {
		problems.push(`is suspiciously short (${trimmed.length} < ${MIN_GENERATED_BODY_CHARS} chars)`);
	}
	if (hasLeakedMdx(trimmed)) {
		problems.push('contains leaked MDX (a JSX component or import outside a code block)');
	}
	return problems;
}
