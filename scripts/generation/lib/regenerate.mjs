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

// `restored` and `fixed` report what the first body got wrong, which is what
// a reviewer of the repaired rule needs to check.
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
