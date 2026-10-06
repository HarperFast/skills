// Regenerate one `mode: generate` rule body, repairing what the model gets
// wrong, and decide whether the result may replace the committed body.
//
// The model compresses each regeneration differently, so a one-shot rewrite
// routinely loses facts that the committed body carries and the docs still
// state, and the validator refuses such a body. Each attempt is therefore
// checked here with the same rules the validators gate on (checkBody). A
// failing attempt goes back to the model with exactly what is wrong; after
// `maxRepairs` repairs the rule is reported as not ok, and the caller keeps the
// committed body (holds the rule back) so one bad rule cannot fail the whole
// sync (#118).
//
// Pure orchestration: the model sits behind `conversation` (see
// lib/llm.mjs `ruleConversation`), so this is testable without the network.

import { structuralProblems } from './body-checks.mjs';
import { anchorsBeyondFacts, droppedFacts, missingAnchors } from './retention.mjs';

const DEFAULT_MAX_REPAIRS = 2;

export function parseMaxRepairs(raw) {
	if (raw === undefined || raw === '') return DEFAULT_MAX_REPAIRS;
	const budget = Number(raw);
	if (!Number.isInteger(budget) || budget < 0) {
		throw new Error(`GENERATE_MAX_REPAIRS must be a non-negative integer (got ${raw})`);
	}
	return budget;
}

// Everything the validators would reject in a generated body: retained facts
// it dropped, must_cover strings it lacks, and structural problems.
export function checkBody({ body, previousBody, source, mustCover = [], allowDropped = [] }) {
	return {
		dropped: droppedFacts({ previousBody, body, source, allowDropped }),
		missingAnchors: missingAnchors(body, mustCover),
		invalid: structuralProblems(body),
	};
}

export function hasProblems(problems) {
	return Object.values(problems).some((list) => list.length > 0);
}

// Returns:
//   ok: true  → { ok, body, repairs, restored, fixed, usage }
//               `restored` lists the facts and anchors the repairs put back and
//               `fixed` the structural problems they fixed (both empty when the
//               first body passed), for the sync PR's reviewers.
//   ok: false → { ok, repairs, dropped, missingAnchors, invalid, error, usage }
//               the lists are what the last body still got wrong; `error` is
//               set instead when a model call failed.
export async function regenerateFaithfully({
	conversation,
	previousBody,
	source,
	mustCover = [],
	allowDropped = [],
	maxRepairs = DEFAULT_MAX_REPAIRS,
}) {
	const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
	const addUsage = (callUsage = {}) => {
		for (const field of Object.keys(usage)) usage[field] += callUsage[field] ?? 0;
	};

	let repairs = 0;
	let firstProblems = null;
	let result;
	try {
		result = await conversation.generate();
		addUsage(result.usage);
		for (;;) {
			const problems = checkBody({
				body: result.body,
				previousBody,
				source,
				mustCover,
				allowDropped,
			});
			firstProblems ??= problems;
			if (!hasProblems(problems)) {
				const restored = [
					...firstProblems.dropped,
					...anchorsBeyondFacts(firstProblems.missingAnchors, firstProblems.dropped),
				];
				return {
					ok: true,
					body: result.body,
					repairs,
					restored,
					fixed: firstProblems.invalid,
					usage,
				};
			}
			if (repairs >= maxRepairs) return { ok: false, repairs, ...problems, usage };
			repairs++;
			result = await conversation.repair({ ...problems, previousBody });
			addUsage(result.usage);
		}
	} catch (err) {
		return {
			ok: false,
			repairs,
			dropped: [],
			missingAnchors: [],
			invalid: [],
			error: err.message,
			usage,
		};
	}
}
