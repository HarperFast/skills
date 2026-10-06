// Tests for the structural body checks. Run with `npm test` (node --test).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hasLeakedMdx, structuralProblems } from './body-checks.mjs';

const md = (...lines) => lines.join('\n');
const long = 'Enough prose to clear the minimum body length. '.repeat(6);

test('a titled body over the minimum length has no problems', () => {
	assert.deepEqual(structuralProblems(md('# Title', '', long)), []);
});

test('a missing H1 and a short body are both reported', () => {
	assert.deepEqual(structuralProblems('Short.'), [
		'does not start with an H1 title',
		'is suspiciously short (6 < 200 chars)',
	]);
});

test('JSX or an MDX import in prose is leaked MDX; inside code it is not', () => {
	assert.equal(hasLeakedMdx('See <Tabs> below.'), true);
	assert.equal(hasLeakedMdx("import Tabs from '@theme/Tabs';"), true);
	assert.equal(hasLeakedMdx('Use `<Generic>` here.'), false);
	assert.equal(hasLeakedMdx(md('~~~tsx', '<Tabs />', "import x from 'y';", '~~~')), false);
	assert.match(structuralProblems(md('# Title', '', long, '<Tabs>'))[0], /leaked MDX/);
});
