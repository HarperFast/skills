// Markdown for the generator's --report JSON, in the sync PR body and the
// failure issue. Held-back rules are listed with exactly what they still lack:
// that list is what a reviewer pins with `must_cover`, waives with
// `allow_dropped`, or takes as evidence the rule needs splitting.

import fs from 'node:fs/promises';

export async function loadGenerationReport(file) {
	if (!file) return emptyReport();
	return { ...emptyReport(), ...JSON.parse(await fs.readFile(file, 'utf-8')) };
}

function emptyReport() {
	return { regenerated: [], repaired: [], heldBack: [] };
}

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

// Each sync commit records the rules its run repaired as trailers, so the
// record travels with the push and the PR body can be rebuilt from the branch
// alone. The value is the report entry as JSON.
const REPAIRED_TRAILER = 'Sync-Repaired: ';

const isStringList = (value) =>
	Array.isArray(value) && value.every((item) => typeof item === 'string');

export function repairTrailers(report) {
	return report.repaired.map((entry) => REPAIRED_TRAILER + JSON.stringify(entry));
}

export function parseRepairTrailers(message) {
	const entries = [];
	for (const line of message.split('\n')) {
		if (!line.startsWith(REPAIRED_TRAILER)) continue;
		let entry;
		try {
			entry = JSON.parse(line.slice(REPAIRED_TRAILER.length));
		} catch {
			continue;
		}
		if (
			typeof entry?.skill === 'string' &&
			typeof entry.rule === 'string' &&
			Number.isInteger(entry.repairs) &&
			isStringList(entry.restored) &&
			isStringList(entry.fixed)
		) {
			entries.push(entry);
		}
	}
	return entries;
}
