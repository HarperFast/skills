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
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

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

// Generate a rule body from resolved source documentation.
// Returns { body, usage }.
export async function generateRuleBody({
	rule,
	description,
	sourceContent,
	mustCover,
	crossLinks,
}) {
	const system = await systemPrompt();

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

	const response = await client().messages.create({
		model: MODEL,
		max_tokens: MAX_TOKENS,
		temperature: 0,
		// Stable across every rule in a run → cache it. Volatile per-rule
		// content lives in the user message, after the cached prefix.
		system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
		messages: [{ role: 'user', content: sections.join('\n') }],
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

	return { body, usage: response.usage };
}
