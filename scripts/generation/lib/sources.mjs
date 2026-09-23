// Source resolution against the docs build output. Shared by the generator
// (to feed the LLM / produce direct bodies) and the validator (source-exists
// and byte-identical checks). The docs build dir is the `build/` tree produced
// by @signalwire/docusaurus-plugin-llms-txt — see Phase 1 in
// docs/plans-archive/docs-driven-skills.md. No network access: everything reads from
// the local checked-out-and-built docs tree.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Resolve the absolute path of a manifest source within the docs build dir.
export function sourceFilePath(docsBuildDir, source) {
	return path.join(docsBuildDir, source.path);
}

// Read one manifest source, slicing to a section if `source.section` is set.
export async function readSource(docsBuildDir, source) {
	const filePath = sourceFilePath(docsBuildDir, source);
	const content = await fs.readFile(filePath, 'utf-8');
	if (source.section) {
		return sliceSection(content, source.section, source.path);
	}
	return content.trim();
}

// Resolve and concatenate all sources for a rule, in manifest order.
export async function resolveSources(docsBuildDir, sources) {
	const parts = [];
	for (const source of sources) {
		parts.push(await readSource(docsBuildDir, source));
	}
	return parts.join('\n\n');
}

// Fence indentation: at most 3 spaces at top level (more than that is an
// indented code block, not a fence). Inside a list item CommonMark measures
// from the item's content column, so `nested` accepts any indentation.
const TOP_LEVEL_INDENT = ' {0,3}';
const NESTED_INDENT = '[ \\t]*';

// Split Markdown into alternating prose and fenced-code segments, starting and
// ending with a (possibly empty) prose segment. Each segment has the 0-based
// line of its first content line; delimiter lines belong to neither side, and
// a fence segment also carries the opener's info string.
//
// Handles both delimiter characters and delimiter runs longer than three, per
// CommonMark: a fence closes only on the same character, with a run at least
// as long as the opener, and nothing but whitespace after it. That matters
// because a shorter run of the *other* character — or a ``` inside a ~~~
// block — is content, not a boundary.
//
// An unterminated fence runs to the end of the document, which is also what
// CommonMark specifies. Callers rely on that: it means a malformed body can
// never leak fence contents into prose-level analysis.
export function splitFencedBlocks(markdown, { nested = false } = {}) {
	const indent = nested ? NESTED_INDENT : TOP_LEVEL_INDENT;
	const openRe = new RegExp(`^${indent}(([\`~])\\2{2,})`);
	const segments = [];
	let current = { fenced: false, startLine: 0, lines: [] };
	let closeRe = null; // non-null while inside a fence
	const lines = markdown.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (closeRe === null) {
			const open = openRe.exec(line);
			if (open) {
				const delim = open[1];
				closeRe = new RegExp(`^${indent}${delim[0]}{${delim.length},}\\s*$`);
				segments.push(current);
				const info = line.slice(open[0].length).trim();
				current = { fenced: true, info, startLine: i + 1, lines: [] };
				continue;
			}
			current.lines.push(line);
		} else if (closeRe.test(line)) {
			closeRe = null;
			segments.push(current);
			current = { fenced: false, startLine: i + 1, lines: [] };
		} else {
			current.lines.push(line);
		}
	}
	segments.push(current);
	return segments;
}

// Remove fenced code blocks, returning the remaining Markdown.
export function stripFencedBlocks(markdown) {
	return splitFencedBlocks(markdown)
		.filter((segment) => !segment.fenced)
		.flatMap((segment) => segment.lines)
		.join('\n');
}

// Extract the Markdown subtree under the heading whose text matches `section`.
// The slice runs from the matching heading up to (but not including) the next
// heading at the same or shallower level. Lines inside fenced code blocks are
// not considered headings (a `## foo` inside a ``` block is code, not a
// boundary). Throws if the heading isn't found.
export function sliceSection(markdown, section, sourcePathForError = '') {
	const lines = markdown.split('\n');
	const headingRe = /^(#{1,6})\s+(.*?)\s*$/;
	const fenceRe = /^\s*(`{3,}|~{3,})/;
	const target = normalizeHeading(section);

	let inFence = false;
	let start = -1;
	let startLevel = 0;
	for (let i = 0; i < lines.length; i++) {
		if (fenceRe.test(lines[i])) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const m = lines[i].match(headingRe);
		if (m && normalizeHeading(m[2]) === target) {
			start = i;
			startLevel = m[1].length;
			break;
		}
	}
	if (start === -1) {
		const where = sourcePathForError ? ` in ${sourcePathForError}` : '';
		throw new Error(`Section heading "${section}" not found${where}`);
	}

	// The start line is a heading (never inside a fence), so fence state at
	// start+1 is closed.
	inFence = false;
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (fenceRe.test(lines[i])) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const m = lines[i].match(headingRe);
		if (m && m[1].length <= startLevel) {
			end = i;
			break;
		}
	}
	return lines.slice(start, end).join('\n').trim();
}

function normalizeHeading(s) {
	return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Deterministic short hash of resolved source content. Drives the no-op skip:
// if a rule's stored metadata.inputHash matches, the source is unchanged and
// the body does not need regenerating. Mode-independent — both generate and
// direct hash the same resolved input.
export function computeInputHash(content) {
	return crypto.createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16);
}
