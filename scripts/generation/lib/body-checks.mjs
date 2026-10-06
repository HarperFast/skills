// Structural checks a generated rule body must pass to be publishable,
// whatever facts it carries. validate-generated.mjs gates on the length and
// MDX checks, validate-skills.mjs on the H1; the generator applies all three
// before accepting a body, so a structurally broken body is repaired or held
// back like a lossy one instead of failing the whole sync.

import { stripFencedBlocks } from './sources.mjs';

export const MIN_GENERATED_BODY_CHARS = 200;

// Remove fenced and inline code so leaked-MDX heuristics don't false-positive
// on legitimate `import`/JSX-like syntax inside code examples. Fences are
// stripped by the shared scanner so tilde fences and long delimiter runs are
// handled the same way sliceSection handles them.
function stripCode(md) {
	return stripFencedBlocks(md).replace(/`[^`]*`/g, '');
}

// JSX components or MDX `import` statements outside fenced/inline code. Code
// examples legitimately contain `import ... from` and `<Generic>` type params,
// so code is stripped first.
export function hasLeakedMdx(body) {
	const prose = stripCode(body);
	return /^import\s.+\sfrom\s/m.test(prose) || /<[A-Z][A-Za-z0-9]*[\s/>]/.test(prose);
}

// What is wrong with a generated body's structure, each as a predicate on
// "the body", or [] when nothing is.
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
