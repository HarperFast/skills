// Markdown for the generator's --report JSON, in the sync PR body and the
// failure issue. Held-back rules are listed with exactly what they still lack:
// that list is what a reviewer pins with `must_cover`, waives with
// `allow_dropped`, or takes as evidence the rule needs splitting.

import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';

export async function loadGenerationReport(file) {
	if (!file) return emptyReport();
	return { ...emptyReport(), ...JSON.parse(await fs.readFile(file, 'utf-8')) };
}

function emptyReport() {
	return { regenerated: [], repaired: [], heldBack: [] };
}

// Keyed by skill as well, in case two skills ever share a slug.
export const ruleKey = (entry) => `${entry.skill}/${entry.rule}`;

// An inline code span for arbitrary text. must_cover anchors may contain
// backticks (e.g. '`Accept`'), so the delimiter must be a longer backtick run
// than any inside, padded with spaces when the text starts or ends with one.
export function code(text) {
	const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
	const fence = '`'.repeat(longest + 1);
	const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
	return `${fence}${pad}${text}${pad}${fence}`;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function heldBackMarkdown(report) {
	if (!report.heldBack.length) return '';
	const lines = [
		'### Held back',
		'',
		'These rules have docs changes that were **not** synced. Regeneration kept failing ' +
			'its checks — usually by dropping facts that the committed rule carries and the docs ' +
			'still state — so each keeps its committed body, and every sync retries it. To ' +
			'unblock one, pin the facts it keeps losing with `must_cover`, split the rule if its ' +
			'sources are more than the model reliably keeps, or record an intended removal under ' +
			'`allow_dropped` in the manifest.',
		'',
	];
	for (const held of report.heldBack) {
		const what = [
			held.dropped.length && `still dropped ${held.dropped.map(code).join(', ')}`,
			held.missingAnchors.length &&
				`still missing \`must_cover\` ${held.missingAnchors.map(code).join(', ')}`,
			...held.invalid.map((problem) => `body still ${problem}`),
		]
			.filter(Boolean)
			.join('; ');
		lines.push(
			`- ${code(held.rule)} (${held.skill}) — after ${plural(held.repairs, 'repair')}, ${what}`,
		);
	}
	return lines.join('\n');
}

// For the failure issue: the rule the run stopped on, if it stopped on one,
// and the rules held back before it.
export function failureDetailsMarkdown(report) {
	const parts = [];
	const stop = report.stoppedOn;
	if (stop) {
		const on = stop.rule ? ` on ${code(stop.rule)} (${stop.skill})` : '';
		parts.push(`**Generation stopped${on}:** ${code(stop.reason)}`);
	}
	const heldBack = heldBackMarkdown(report);
	if (heldBack) parts.push(heldBack);
	return parts.join('\n\n');
}

export function repairedMarkdown(report) {
	if (!report.repaired.length) return '';
	const lines = [
		'### Repaired during generation',
		'',
		'The first regeneration of these rules failed its checks, and a repair pass fixed it. ' +
			'Check that each restored fact landed where it belongs.',
		'',
	];
	for (const repaired of report.repaired) {
		const what = [
			repaired.restored.length && `restored ${repaired.restored.map(code).join(', ')}`,
			...repaired.fixed.map((problem) => `fixed: body ${problem}`),
		]
			.filter(Boolean)
			.join('; ');
		lines.push(`- ${code(repaired.rule)} — ${plural(repaired.repairs, 'repair')}: ${what}`);
	}
	return lines.join('\n');
}

// The sync PR body is recomposed on every run, and a run only knows what it
// repaired itself. Earlier runs' repairs ride along in a hidden comment in the
// body and are merged forward. Base64, so no fact can end the comment early.
const SYNC_STATE = /<!-- sync-state:v1 ([A-Za-z0-9+/=]*) -->/;

const isRepairedEntry = (entry) =>
	typeof entry?.skill === 'string' &&
	typeof entry.rule === 'string' &&
	Number.isInteger(entry.repairs) &&
	Array.isArray(entry.restored) &&
	Array.isArray(entry.fixed);

export function readSyncState(body) {
	const match = body?.match(SYNC_STATE);
	if (!match) return { repaired: [] };
	try {
		const state = JSON.parse(Buffer.from(match[1], 'base64').toString('utf-8'));
		return { repaired: (state.repaired ?? []).filter(isRepairedEntry) };
	} catch {
		return { repaired: [] }; // hand-edited or truncated: start over
	}
}

export function syncStateComment(state) {
	return `<!-- sync-state:v1 ${Buffer.from(JSON.stringify(state)).toString('base64')} -->`;
}

// The repairs to list for a PR that changes `changed` rules: earlier runs'
// repairs, minus rules this run regenerated (its own outcome replaces theirs),
// plus this run's, limited to rules the PR still changes.
export function mergeRepaired(previous, generation, changed) {
	const regenerated = new Set(generation.regenerated.map(ruleKey));
	const stillChanged = new Set(changed.map(ruleKey));
	return [...previous.filter((entry) => !regenerated.has(ruleKey(entry))), ...generation.repaired]
		.filter((entry) => stillChanged.has(ruleKey(entry)))
		.sort((a, b) => ruleKey(a).localeCompare(ruleKey(b)));
}
