// Tests for the fence-aware scanner. Run with `npm test` (node --test).
//
// These cover the cases a ```-only regex gets wrong, because the fact-retention
// check in validate-generated.mjs depends on fence stripping being exact: a
// backtick expression that leaks out of a fence becomes a retained "fact", and
// deleting that example later would falsely block generation.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stripFencedBlocks } from './sources.mjs';

// Convenience: the scanner is line-based, so build inputs from lines.
const md = (...lines) => lines.join('\n');

test('strips a triple-backtick fence', () => {
	const out = stripFencedBlocks(md('before', '```js', 'const a = `x`;', '```', 'after'));
	assert.equal(out, md('before', 'after'));
});

test('strips a tilde fence', () => {
	const out = stripFencedBlocks(md('before', '~~~js', 'const a = `x`;', '~~~', 'after'));
	assert.equal(out, md('before', 'after'));
});

test('a backtick run inside a tilde fence is content, not a boundary', () => {
	// The regression this guards: `inside` must not survive as an inline span.
	const out = stripFencedBlocks(
		md('before', '~~~', '```', 'const a = `inside`;', '```', '~~~', 'after'),
	);
	assert.equal(out, md('before', 'after'));
	assert.ok(!out.includes('inside'));
});

test('a tilde run inside a backtick fence is content, not a boundary', () => {
	const out = stripFencedBlocks(
		md('before', '```', '~~~', 'const a = `inside`;', '~~~', '```', 'after'),
	);
	assert.equal(out, md('before', 'after'));
});

test('a longer delimiter run opens and closes correctly', () => {
	const out = stripFencedBlocks(md('before', '````md', '```', 'nested', '```', '````', 'after'));
	assert.equal(out, md('before', 'after'));
});

test('a shorter run does not close a longer opening fence', () => {
	// ``` cannot close ````, so everything to EOF is fence content.
	const out = stripFencedBlocks(md('before', '````', 'a', '```', 'b', 'after'));
	assert.equal(out, 'before');
});

test('a longer run does close a shorter opening fence', () => {
	const out = stripFencedBlocks(md('before', '```', 'a', '`````', 'after'));
	assert.equal(out, md('before', 'after'));
});

test('an unterminated fence runs to end of document', () => {
	const out = stripFencedBlocks(md('before', '```', 'a', 'b'));
	assert.equal(out, 'before');
});

test('a fence indented up to three spaces is a fence', () => {
	const out = stripFencedBlocks(md('before', '   ```', 'a', '   ```', 'after'));
	assert.equal(out, md('before', 'after'));
});

test('four spaces is an indented code block, not a fence', () => {
	// Not a fence, so the lines pass through untouched rather than the rest of
	// the document being swallowed as fence content.
	const input = md('before', '    ```', 'a', 'after');
	assert.equal(stripFencedBlocks(input), input);
});

test('a closing fence may carry trailing whitespace but not other text', () => {
	assert.equal(stripFencedBlocks(md('a', '```', 'x', '```   ', 'b')), md('a', 'b'));
	// `” ```js “` is an info string, only valid on an opener — so this does not
	// close, and the remainder is fence content.
	assert.equal(stripFencedBlocks(md('a', '```', 'x', '```js', 'b')), 'a');
});

test('inline code outside a fence is preserved', () => {
	const input = md('keep `Sec-WebSocket-Protocol: mqtt` here');
	assert.equal(stripFencedBlocks(input), input);
});

test('content with no fences is returned unchanged', () => {
	const input = md('# Title', '', 'Some `code` and prose.', '');
	assert.equal(stripFencedBlocks(input), input);
});
