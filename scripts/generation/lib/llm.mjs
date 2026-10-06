// LLM-backed rule body generation (the `generate` mode body producer).
// `direct` mode does not use this module — it imports the flat-markdown
// verbatim. Uses the Anthropic SDK with a cached, stable system prompt.
//
// Model choice: defaults to claude-sonnet-4-6 with temperature 0. This is a
// mechanical structured-rewrite task where deterministic, low-variance output
// matters (reviewable diffs, the input-hash skip) and cost adds up across a
// recurring multi-rule job — Sonnet 4.6 is the right fit and supports the
// temperature knob. Override with GENERATE_MODEL if you want a different
// model; note that claude-opus-4-7 removed `temperature` (it 400s), so if you
// switch to it you must also drop the temperature field and use `effort`.

import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs/promises';
import path from 'node:path';

import { stripFencedBlocks } from './sources.mjs';

const TEMPLATES_DIR = path.join(import.meta.dirname, '..', 'templates');

const MODEL = process.env.GENERATE_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = 8192;

let _client;
function client() {
	if (!_client) {
		// Reads ANTHROPIC_API_KEY from the environment.
		_client = new Anthropic();
	}
	return _client;
}

let _systemPrompt;
async function systemPrompt() {
	if (_systemPrompt) return _systemPrompt;
	const [sys, tmpl] = await Promise.all([
		fs.readFile(path.join(TEMPLATES_DIR, 'system-prompt.md'), 'utf-8'),
		fs.readFile(path.join(TEMPLATES_DIR, 'rule-template.md'), 'utf-8'),
	]);
	_systemPrompt = sys.replace('{{RULE_TEMPLATE}}', tmpl.trim());
	return _systemPrompt;
}

export function generationModel() {
	return MODEL;
}

// How much of the committed rule line to quote beside each dropped fact. Enough
// to show where the fact lived (a table row, a step) without pasting the body.
const MAX_CONTEXT_CHARS = 240;

// A rule-generation conversation. `generate()` produces the first body;
// `repair(problems)` replies to the model's last body with what it lost and
// asks for the whole body back, so the model edits its own draft against the
// same source instead of rewriting from scratch. Each returns { body, usage }.
//
// Both throw on an API error, an empty body, or a body cut off at MAX_TOKENS —
// a truncated body would otherwise pass for a rule that dropped its tail.
export function ruleConversation({ rule, description, sourceContent, mustCover, crossLinks }) {
	const messages = [
		{
			role: 'user',
			content: ruleRequest({ rule, description, sourceContent, mustCover, crossLinks }),
		},
	];

	async function send() {
		const response = await client().messages.create({
			model: MODEL,
			max_tokens: MAX_TOKENS,
			temperature: 0,
			// Stable across every rule in a run → cache it. Volatile per-rule
			// content lives in the user message, after the cached prefix.
			system: [{ type: 'text', text: await systemPrompt(), cache_control: { type: 'ephemeral' } }],
			messages,
		});

		const body = response.content
			.filter((b) => b.type === 'text')
			.map((b) => b.text)
			.join('')
			.trim();

		if (!body) {
			throw new Error(
				`LLM returned empty body for rule "${rule}" (stop_reason: ${response.stop_reason})`,
			);
		}
		if (response.stop_reason === 'max_tokens') {
			throw new Error(`LLM body for rule "${rule}" was cut off at max_tokens (${MAX_TOKENS})`);
		}

		messages.push({ role: 'assistant', content: body });
		return { body, usage: response.usage };
	}

	return {
		generate: send,
		repair(problems) {
			messages.push({ role: 'user', content: repairRequest(problems) });
			return send();
		},
	};
}

// The first user message: the rule to write, its anchors and links, and the
// resolved source documentation.
export function ruleRequest({ rule, description, sourceContent, mustCover, crossLinks }) {
	const sections = [
		`# Rule to generate: ${rule}`,
		``,
		`Agent-facing purpose of this rule: ${description}`,
	];

	if (mustCover?.length) {
		sections.push(
			``,
			`## Must cover`,
			`The rule body MUST include each of the following (verbatim for code/identifiers):`,
			...mustCover.map((s) => `- ${s}`),
		);
	}

	if (crossLinks?.length) {
		sections.push(
			``,
			`## Related rules`,
			`Where natural, link to these rules using the \`<slug>.md\` form:`,
			...crossLinks.map((s) => `- ${s}.md`),
		);
	}

	sections.push(
		``,
		`## Source documentation`,
		`Rewrite the following into the rule body. Use only what is present here.`,
		``,
		`----`,
		sourceContent,
		`----`,
	);
	return sections.join('\n');
}

// The reply to a body that failed the retention or must_cover check. Each
// dropped fact is quoted with the committed line it came from: the bare token
// says what to restore, the line says where it belonged and what it meant.
// Every listed fact is still in the source (that is how it was selected), so
// restoring it never requires inventing anything.
export function repairRequest({ dropped = [], missingAnchors = [], previousBody }) {
	const sections = [
		`Your rule body is missing content it has to keep. Return the complete rule body again, ` +
			`with every item below restored and everything else left as it is.`,
	];

	if (dropped.length) {
		sections.push(
			``,
			`## Facts the current rule states that your body dropped`,
			`The committed version of this rule states each of these, and the source documentation ` +
				`still does. Restore each one verbatim, as inline code, where it belongs:`,
			...dropped.map((fact) => {
				const line = contextLine(previousBody ?? '', fact);
				return line ? `- \`${fact}\` — the current rule has: ${line}` : `- \`${fact}\``;
			}),
		);
	}

	// A pinned fact is both dropped and a missing anchor; ask for it once.
	const anchorsOnly = missingAnchors.filter((s) => !dropped.includes(s));
	if (anchorsOnly.length) {
		sections.push(
			``,
			`## Required strings your body is missing`,
			`Each must appear verbatim (see "Must cover" above):`,
			...anchorsOnly.map((s) => `- ${s}`),
		);
	}

	sections.push(
		``,
		`Use only the source documentation — do not invent. Output only the rule body, ` +
			`starting with the H1 title.`,
	);
	return sections.join('\n');
}

// The first prose line of `body` that carries `fact` as inline code (falling
// back to any mention), with whitespace runs (table padding) collapsed, and
// capped. Fenced blocks are skipped: facts come from inline code, so a fence
// hit would be a different use of the token.
function contextLine(body, fact) {
	const lines = stripFencedBlocks(body).split('\n');
	const hit = lines.find((l) => l.includes(`\`${fact}\``)) ?? lines.find((l) => l.includes(fact));
	if (!hit) return null;
	const line = hit.replace(/\s+/g, ' ').trim();
	return line.length > MAX_CONTEXT_CHARS ? `${line.slice(0, MAX_CONTEXT_CHARS)}…` : line;
}
