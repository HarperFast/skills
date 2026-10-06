// Fact retention: the one definition of "a fact this rule must keep".
//
// validate-generated.mjs gates on it, and generate-rules.mjs runs the same
// check on each regenerated body so it can repair or hold back a lossy one
// before the gate sees it. The two must agree exactly: if the generator
// accepted a body the validator then rejected, one lossy rule would fail the
// whole sync.

import { execFileSync } from 'node:child_process';
import process from 'node:process';
import matter from 'gray-matter';

import { stripFencedBlocks } from './sources.mjs';

// Minimum length of a code span to treat as a retainable fact. Below this the
// tokens are things like `id`, `or`, `{}` — too generic to carry meaning and
// too noisy to gate on. `409` (3 chars) is the shortest real one observed.
const MIN_FACT_CHARS = 3;

// Inline code spans, which is where this corpus keeps its facts: identifiers,
// config keys, status codes, header names, enum values, error strings. Prose
// is deliberately excluded — rewording prose is expected and legitimate;
// dropping `Sec-WebSocket-Protocol: mqtt` is not.
//
// Fenced blocks are excluded too: a body may legitimately move an example into
// a cross-linked rule, and fence contents would otherwise pin whole snippets
// in place. Stripping them needs the fence-aware scanner rather than a
// ```-only regex — a backtick expression inside a ~~~ fence would otherwise
// register as a fact, so deleting that example later would falsely block
// generation for as long as the token survived anywhere in the docs source.
export function inlineCodeSpans(md) {
	const withoutFences = stripFencedBlocks(md);
	const spans = new Set();
	for (const m of withoutFences.matchAll(/`([^`\n]+)`/g)) {
		const token = m[1].trim();
		if (token.length >= MIN_FACT_CHARS) spans.add(token);
	}
	return spans;
}

// The rule body as committed at HEAD, or null when HEAD has no such file (a
// new rule): absence of a baseline is not a retention violation. Any other
// failure to read it throws — no repository, no git, or no HEAD commit yet.
// Treating an unreadable baseline as absent would switch retention off
// silently, and the generator and validator would then both accept a lossy
// body.
//
// HEAD rather than the working tree, in both the generator and the validator,
// so a local re-run cannot launder a fact an earlier uncommitted run dropped.
// Working directories whose HEAD commit has been verified: HEAD does not move
// during a run, so once per repository is enough.
const verifiedHeads = new Set();

export function bodyAtHead(relPath) {
	const spec = `HEAD:${relPath}`;
	const fail = (err) =>
		new Error(
			`Cannot read the committed baseline ${spec}: ${err.stderr?.toString().trim() || err.message}`,
		);
	if (!verifiedHeads.has(process.cwd())) {
		try {
			// `HEAD:<path>` alone exits 1 for an unborn HEAD as well as a missing
			// path, so the commit is verified first.
			git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
		} catch (err) {
			if (err.status === 1) {
				throw new Error(`Cannot read the committed baseline ${spec}: HEAD has no commit yet`);
			}
			throw fail(err);
		}
		verifiedHeads.add(process.cwd());
	}
	try {
		git(['rev-parse', '--verify', '--quiet', spec]);
	} catch (err) {
		if (err.status === 1) return null;
		throw fail(err);
	}
	try {
		return matter(git(['show', spec])).content.trim();
	} catch (err) {
		throw fail(err);
	}
}

function git(args) {
	return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// Facts present in BOTH the previously committed body AND the current docs
// source that are missing from the new body, sorted. Empty when there is no
// previous body.
//
// Requiring presence in the current source is what makes this safe to gate on:
// a fact deleted upstream is correctly dropped and never reported. Only facts
// the docs still assert, and that this rule used to carry, are enforced.
//
// This is the retention check `must_cover` cannot be: must_cover requires a
// human to have predicted each fact in advance, and a substring assertion
// passes as long as the word appears somewhere — it cannot tell "the term is
// still here" from "the fact is still intact". This check is derived from the
// diff instead, so it covers facts nobody thought to anchor.
export function droppedFacts({ previousBody, body, source, allowDropped = [] }) {
	if (previousBody == null) return [];
	const waived = new Set(allowDropped);
	const dropped = [];
	for (const fact of inlineCodeSpans(previousBody)) {
		if (waived.has(fact)) continue;
		if (!source.includes(fact)) continue; // no longer documented upstream
		if (body.includes(fact)) continue; // still covered
		dropped.push(fact);
	}
	return dropped.sort();
}

export function missingAnchors(body, mustCover = []) {
	return mustCover.filter((must) => !body.includes(must));
}

// The anchors that are not just a dropped fact again, for listing both without
// repeats. An anchor may carry its code-span backticks (`` `Accept` ``) where
// the fact is the bare token.
export function anchorsBeyondFacts(anchors, facts) {
	return anchors.filter((anchor) => !facts.includes(anchor.replace(/^`+|`+$/g, '')));
}
