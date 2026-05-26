// Source resolution against the docs build output. Shared by the generator
// (to feed the LLM / produce direct bodies) and the validator (source-exists
// and byte-identical checks). The docs build dir is the `build/` tree produced
// by @signalwire/docusaurus-plugin-llms-txt — see Phase 1 in
// docs/plans/docs-driven-skills.md. No network access: everything reads from
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
