// Render the generator's --report JSON (see generate-rules.mjs) as Markdown
// for the sync PR body and the auto-sync failure issue.
//
// A held-back rule is only useful to a reviewer if it is named with what it
// lost: that list is what they pin with `must_cover`, waive with
// `allow_dropped`, or take as evidence the rule needs splitting.

import fs from 'node:fs/promises';

// Read a report file, or return an empty report when no path is given.
export async function loadGenerationReport(file) {
	if (!file) return emptyReport();
	return { ...emptyReport(), ...JSON.parse(await fs.readFile(file, 'utf-8')) };
}

function emptyReport() {
	return { regenerated: [], repaired: [], heldBack: [] };
}

// `skill/rule` key, so rules are matched across the report and the
// provenance snapshot even if two skills ever share a slug.
export const ruleKey = (r) => `${r.skill}/${r.rule}`;

// An inline code span for arbitrary text. must_cover anchors may contain
// backticks (e.g. '`Accept`'), so the delimiter must be a longer backtick run
// than any inside, padded with spaces when the text starts or ends with one.
export function code(text) {
	const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
	const fence = '`'.repeat(longest + 1);
	const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
	return `${fence}${pad}${text}${pad}${fence}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The "Held back" section, or '' when nothing was held back.
export function heldBackMarkdown(report) {
	if (!report.heldBack.length) return '';
	const lines = [
		'### Held back',
		'',
		'These rules have docs changes that were **not** synced. Regeneration kept dropping ' +
			'facts that the committed rule carries and the docs still state, so each keeps its ' +
			'committed body, and every sync retries it. To unblock one, pin the facts it keeps ' +
			'losing with `must_cover`, split the rule if its sources are more than the model ' +
			'reliably keeps, or record an intended removal under `allow_dropped` in the manifest.',
		'',
	];
	for (const h of report.heldBack) {
		const what = h.error
			? `model call failed: ${h.error}`
			: [
					h.dropped.length && `still dropped ${h.dropped.map(code).join(', ')}`,
					h.missingAnchors.length &&
						`still missing \`must_cover\` ${h.missingAnchors.map(code).join(', ')}`,
				]
					.filter(Boolean)
					.join('; ');
		lines.push(`- ${code(h.rule)} (${h.skill}) — after ${plural(h.repairs, 'repair')}, ${what}`);
	}
	return lines.join('\n');
}

// The "Repaired" section, or '' when no rule needed a repair.
export function repairedMarkdown(report) {
	if (!report.repaired.length) return '';
	const lines = [
		'### Repaired during generation',
		'',
		'The first regeneration of these rules dropped the facts below, and a repair pass ' +
			'restored them. Check that each one landed where it belongs.',
		'',
	];
	for (const r of report.repaired) {
		lines.push(
			`- ${code(r.rule)} — ${plural(r.repairs, 'repair')}: ${r.restored.map(code).join(', ')}`,
		);
	}
	return lines.join('\n');
}
