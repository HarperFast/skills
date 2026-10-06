// Regenerate one `mode: generate` rule body, repairing what the model drops,
// and decide whether the result may replace the committed body.
//
// The model compresses each regeneration differently, so a one-shot rewrite
// routinely loses facts that the committed body carries and the docs still
// state. The validator rightly refuses such a body — and before this existed,
// one lossy rule failed the whole sync: from 2026-09-14 no sync passed, and no
// docs change reached the published skills (#118).
//
// So each attempt is checked here with the same rules the validator gates on
// (lib/retention.mjs, plus must_cover). A failing attempt goes back to the
// model with exactly what is missing; after `maxRepairs` repairs the rule is
// reported as not ok, and the caller keeps the committed body (holds the rule
// back) so the rest of the sync can proceed.
//
// Pure orchestration: the model sits behind `conversation` (see
// lib/llm.mjs `ruleConversation`), so this is testable without the network.

import { droppedFacts, missingAnchors } from './retention.mjs';

export const DEFAULT_MAX_REPAIRS = 2;

// Returns:
//   ok: true  → { ok, body, repairs, restored, usage }
//               `restored` lists what the repairs put back (empty when the
//               first body passed), for the sync PR's reviewers.
//   ok: false → { ok, repairs, dropped, missingAnchors, error, usage }
//               `dropped`/`missingAnchors` are what the last body still lacked;
//               `error` is set instead when a model call failed.
export async function regenerateFaithfully({
	conversation,
	previousBody,
	source,
	mustCover = [],
	allowDropped = [],
	maxRepairs = DEFAULT_MAX_REPAIRS,
}) {
	const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
	const addUsage = (u = {}) => {
		for (const k of Object.keys(usage)) usage[k] += u[k] ?? 0;
	};

	let repairs = 0;
	let firstProblems = null;
	let result;
	try {
		result = await conversation.generate();
		addUsage(result.usage);
		for (;;) {
			const problems = {
				dropped: droppedFacts({ previousBody, body: result.body, source, allowDropped }),
				missingAnchors: missingAnchors(result.body, mustCover),
			};
			firstProblems ??= problems;
			if (problems.dropped.length === 0 && problems.missingAnchors.length === 0) {
				// A string can be both a dropped fact and a missing anchor.
				const restored = [...new Set([...firstProblems.dropped, ...firstProblems.missingAnchors])];
				return { ok: true, body: result.body, repairs, restored, usage };
			}
			if (repairs >= maxRepairs) return { ok: false, repairs, ...problems, usage };
			repairs++;
			result = await conversation.repair({ ...problems, previousBody });
			addUsage(result.usage);
		}
	} catch (err) {
		return { ok: false, repairs, dropped: [], missingAnchors: [], error: err.message, usage };
	}
}
