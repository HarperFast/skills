// Shared manifest loading and skill metadata, used by both the generator
// (generate-rules.mjs) and the validator (validate-generated.mjs).

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import yaml from 'js-yaml';

// Each entry describes a skill directory. Add new skills here as they are
// introduced (Story 5 in docs/plans-archive/docs-driven-skills.md describes the
// multi-skill case).
export const SKILLS = [
	{
		dir: 'harper-best-practices',
		manifestFile: 'rules.manifest.yaml',
		rulesDir: 'rules',
		skillFile: 'SKILL.md',
		agentsFile: 'AGENTS.md',
	},
];

// Display labels for categories, used when assembling AGENTS.md. The manifest
// stores the short enum (schema/api/logic/ops); these are the human headings.
export const CATEGORY_LABELS = {
	schema: 'Schema & Data Design',
	api: 'API & Communication',
	logic: 'Logic & Extension',
	ops: 'Infrastructure & Ops',
};

export const VALID_MODES = new Set(['generate', 'direct', 'synthesized']);
export const VALID_CATEGORIES = new Set(Object.keys(CATEGORY_LABELS));
export const VALID_SOURCE_ROLES = new Set(['primary', 'supplemental']);

// Load and parse a skill's manifest YAML. Throws on read/parse failure.
export async function loadManifest(skill) {
	const manifestPath = path.join(process.cwd(), skill.dir, skill.manifestFile);
	const raw = await fs.readFile(manifestPath, 'utf-8');
	return yaml.load(raw);
}

// Manifest rules in display order: by category priority, then order within
// the category. Returns a new array; does not mutate the manifest.
export function sortedRules(manifest) {
	return [...manifest.rules].sort((a, b) => {
		if (a.priority !== b.priority) return a.priority - b.priority;
		return a.order - b.order;
	});
}

// Normalize a manifest source entry to a `path[#section]` string. Used both
// for writing frontmatter metadata.sources and for reconciling it.
export function normalizeSource(source) {
	if (typeof source === 'string') return source;
	if (!source || typeof source.path !== 'string') return null;
	return source.section ? `${source.path}#${source.section}` : source.path;
}
