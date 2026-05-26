// Validator for the docs-driven skill generation system.
//
// Implements Layers 2 and 3 of the validation taxonomy defined in
// docs/plans/docs-driven-skills.md:
//
//   - Layer 2 (manifest lint): the manifest itself conforms to the schema.
//   - Layer 3 (manifest ↔ frontmatter reconciliation): each rule file's
//     frontmatter matches what the manifest declares for that rule. This is
//     the gate that makes the manifest causally authoritative — any
//     divergence here means either the rule needs regenerating or the
//     manifest needs fixing.
//
// Layer 4 (per-mode body checks) is added in Phase 2 when generation lands.
//
// This script is run via `npm run validate` after the existing
// validate-skills.mjs. It exits non-zero on any failure with a precise error
// pointing at the offending field or file.

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import yaml from 'js-yaml';
import matter from 'gray-matter';

// Each entry describes a skill directory containing SKILL.md, rules/, and
// rules.manifest.yaml. Add new skills here as they are introduced (Story 5
// in the plan describes the multi-skill case).
const SKILLS = [
	{
		dir: 'harper-best-practices',
		manifestFile: 'rules.manifest.yaml',
		rulesDir: 'rules',
	},
];

const VALID_MODES = new Set(['generate', 'direct', 'synthesized']);
const VALID_CATEGORIES = new Set(['schema', 'api', 'logic', 'ops']);
const VALID_SOURCE_ROLES = new Set(['primary', 'supplemental']);

class ValidationError extends Error {
	constructor(scope, message) {
		super(`[${scope}] ${message}`);
		this.scope = scope;
	}
}

function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value) {
	return Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value) {
	return typeof value === 'string' && value.length > 0;
}

// Normalize a manifest source entry to a `path[#section]` string for
// comparison against frontmatter metadata.sources entries.
function normalizeManifestSource(source) {
	if (typeof source === 'string') return source;
	if (!isPlainObject(source) || !isNonEmptyString(source.path)) return null;
	return source.section ? `${source.path}#${source.section}` : source.path;
}

// ===========================================================================
// Layer 2 — Manifest lint
// ===========================================================================

function lintManifest(manifest, scope) {
	const errors = [];

	if (!isPlainObject(manifest)) {
		errors.push('Manifest root must be an object');
		return errors;
	}

	if (!Array.isArray(manifest.rules)) {
		errors.push('Manifest must have a `rules` array at the root');
		return errors;
	}

	const seenSlugs = new Set();
	const allSlugs = new Set(manifest.rules.map((r) => r?.rule).filter(isNonEmptyString));

	manifest.rules.forEach((entry, index) => {
		const where = `rules[${index}]${entry?.rule ? ` (${entry.rule})` : ''}`;

		if (!isPlainObject(entry)) {
			errors.push(`${where}: must be an object`);
			return;
		}

		// Required string fields.
		for (const field of ['rule', 'description']) {
			if (!isNonEmptyString(entry[field])) {
				errors.push(`${where}: missing or non-string field "${field}"`);
			}
		}

		// Rule slug shape.
		if (isNonEmptyString(entry.rule)) {
			if (!/^[a-z0-9-]+$/.test(entry.rule)) {
				errors.push(`${where}: "rule" must be lowercase letters, digits, and hyphens only`);
			}
			if (seenSlugs.has(entry.rule)) {
				errors.push(`${where}: duplicate "rule" slug`);
			} else {
				seenSlugs.add(entry.rule);
			}
		}

		// Category enum.
		if (!VALID_CATEGORIES.has(entry.category)) {
			errors.push(
				`${where}: "category" must be one of ${[...VALID_CATEGORIES].join(' / ')} (got ${JSON.stringify(entry.category)})`,
			);
		}

		// Positive integer ordering fields.
		for (const field of ['priority', 'order']) {
			if (!isPositiveInteger(entry[field])) {
				errors.push(`${where}: "${field}" must be a positive integer`);
			}
		}

		// Mode enum.
		if (!VALID_MODES.has(entry.mode)) {
			errors.push(
				`${where}: "mode" must be one of ${[...VALID_MODES].join(' / ')} (got ${JSON.stringify(entry.mode)})`,
			);
		}

		// Sources rules: required for generate/direct, must be a non-empty
		// array of well-formed entries.
		const needsSources = entry.mode === 'generate' || entry.mode === 'direct';
		if (needsSources) {
			if (!Array.isArray(entry.sources) || entry.sources.length === 0) {
				errors.push(
					`${where}: "sources" is required and must be non-empty for mode "${entry.mode}"`,
				);
			} else {
				entry.sources.forEach((src, srcIndex) => {
					const srcWhere = `${where}.sources[${srcIndex}]`;
					if (!isPlainObject(src)) {
						errors.push(`${srcWhere}: must be an object`);
						return;
					}
					if (!isNonEmptyString(src.path)) {
						errors.push(`${srcWhere}: missing or non-string "path"`);
					} else if (src.path.startsWith('/') || src.path.includes('..')) {
						errors.push(
							`${srcWhere}: "path" must be relative and not contain "..": got ${JSON.stringify(src.path)}`,
						);
					}
					if (src.section !== undefined && !isNonEmptyString(src.section)) {
						errors.push(`${srcWhere}: "section" must be a non-empty string when present`);
					}
					if (src.role !== undefined && !VALID_SOURCE_ROLES.has(src.role)) {
						errors.push(
							`${srcWhere}: "role" must be one of ${[...VALID_SOURCE_ROLES].join(' / ')} (got ${JSON.stringify(src.role)})`,
						);
					}
				});
			}
		} else if (entry.sources !== undefined) {
			errors.push(`${where}: "sources" must be omitted for mode "${entry.mode}"`);
		}

		// must_cover: required non-empty array for generate mode.
		if (entry.mode === 'generate') {
			if (entry.must_cover !== undefined) {
				if (!Array.isArray(entry.must_cover)) {
					errors.push(`${where}: "must_cover" must be an array`);
				} else {
					entry.must_cover.forEach((item, i) => {
						if (!isNonEmptyString(item)) {
							errors.push(`${where}.must_cover[${i}]: must be a non-empty string`);
						}
					});
				}
			}
		} else if (entry.must_cover !== undefined) {
			errors.push(`${where}: "must_cover" only applies to mode "generate"`);
		}

		// cross_links: optional array of slugs that must reference real rules.
		if (entry.cross_links !== undefined) {
			if (!Array.isArray(entry.cross_links)) {
				errors.push(`${where}: "cross_links" must be an array of slugs`);
			} else {
				entry.cross_links.forEach((slug, i) => {
					if (!isNonEmptyString(slug)) {
						errors.push(`${where}.cross_links[${i}]: must be a non-empty string`);
					} else if (!allSlugs.has(slug)) {
						errors.push(`${where}.cross_links[${i}]: references unknown rule "${slug}"`);
					}
				});
			}
		}
	});

	return errors.map((msg) => new ValidationError(scope, msg));
}

// ===========================================================================
// Layer 3 — Manifest ↔ frontmatter reconciliation
// ===========================================================================

async function reconcileManifestAndFrontmatter(manifest, skill, scope) {
	const errors = [];
	const rulesDir = path.join(process.cwd(), skill.dir, skill.rulesDir);

	// Build the set of manifest slugs for quick lookup.
	const manifestSlugs = new Set();
	for (const entry of manifest.rules) {
		if (isNonEmptyString(entry?.rule)) manifestSlugs.add(entry.rule);
	}

	// Check that every rule file on disk has a manifest entry.
	let onDiskFiles;
	try {
		onDiskFiles = await fs.readdir(rulesDir);
	} catch (err) {
		errors.push(
			new ValidationError(scope, `Cannot read rules directory ${rulesDir}: ${err.message}`),
		);
		return errors;
	}
	const onDiskSlugs = new Set();
	for (const file of onDiskFiles) {
		if (file.endsWith('.md')) {
			onDiskSlugs.add(path.basename(file, '.md'));
		}
	}
	for (const slug of onDiskSlugs) {
		if (!manifestSlugs.has(slug)) {
			errors.push(
				new ValidationError(
					scope,
					`Rule file "${slug}.md" exists on disk but has no manifest entry`,
				),
			);
		}
	}

	// For each manifest entry, validate its rule file.
	for (let i = 0; i < manifest.rules.length; i++) {
		const entry = manifest.rules[i];
		if (!isPlainObject(entry) || !isNonEmptyString(entry.rule)) continue;

		const slug = entry.rule;
		const filePath = path.join(rulesDir, `${slug}.md`);
		const where = `rules[${slug}]`;

		let raw;
		try {
			raw = await fs.readFile(filePath, 'utf-8');
		} catch (err) {
			errors.push(
				new ValidationError(
					scope,
					`${where}: manifest declares rule but file "${path.relative(process.cwd(), filePath)}" is missing (${err.code || err.message})`,
				),
			);
			continue;
		}

		let parsed;
		try {
			parsed = matter(raw);
		} catch (err) {
			errors.push(
				new ValidationError(scope, `${where}: failed to parse frontmatter: ${err.message}`),
			);
			continue;
		}
		const fm = parsed.data;

		// name must match the slug.
		if (fm.name !== slug) {
			errors.push(
				new ValidationError(
					scope,
					`${where}: frontmatter "name" (${JSON.stringify(fm.name)}) must match slug "${slug}"`,
				),
			);
		}

		// description must match the manifest declaration.
		if (fm.description !== entry.description) {
			errors.push(
				new ValidationError(
					scope,
					`${where}: frontmatter "description" diverges from manifest (regenerate or sync the manifest)`,
				),
			);
		}

		// metadata block presence + mode reconciliation.
		const meta = fm.metadata;
		if (!isPlainObject(meta)) {
			errors.push(
				new ValidationError(scope, `${where}: frontmatter must have a "metadata" object`),
			);
			continue;
		}
		if (meta.mode !== entry.mode) {
			errors.push(
				new ValidationError(
					scope,
					`${where}: frontmatter metadata.mode (${JSON.stringify(meta.mode)}) does not match manifest mode (${JSON.stringify(entry.mode)})`,
				),
			);
		}

		// For generate/direct: sources, sourceCommit, inputHash must be present
		// and metadata.sources must match the manifest sources (normalized).
		if (entry.mode === 'generate' || entry.mode === 'direct') {
			if (!isNonEmptyString(meta.sourceCommit)) {
				errors.push(
					new ValidationError(
						scope,
						`${where}: frontmatter metadata.sourceCommit is required for mode "${entry.mode}"`,
					),
				);
			}
			if (!isNonEmptyString(meta.inputHash)) {
				errors.push(
					new ValidationError(
						scope,
						`${where}: frontmatter metadata.inputHash is required for mode "${entry.mode}"`,
					),
				);
			}

			if (!Array.isArray(meta.sources)) {
				errors.push(
					new ValidationError(
						scope,
						`${where}: frontmatter metadata.sources must be an array for mode "${entry.mode}"`,
					),
				);
			} else {
				const manifestNormalized = entry.sources
					.map(normalizeManifestSource)
					.filter((s) => s !== null);
				const frontmatterNormalized = meta.sources.filter(isNonEmptyString);
				const same =
					manifestNormalized.length === frontmatterNormalized.length &&
					manifestNormalized.every((s, idx) => s === frontmatterNormalized[idx]);
				if (!same) {
					errors.push(
						new ValidationError(
							scope,
							`${where}: frontmatter metadata.sources does not match manifest sources (regenerate this rule)`,
						),
					);
				}
			}
		} else {
			// synthesized: no source-related metadata expected.
			if (meta.sources !== undefined) {
				errors.push(
					new ValidationError(
						scope,
						`${where}: frontmatter metadata.sources must be omitted for mode "synthesized"`,
					),
				);
			}
			if (meta.sourceCommit !== undefined) {
				errors.push(
					new ValidationError(
						scope,
						`${where}: frontmatter metadata.sourceCommit must be omitted for mode "synthesized"`,
					),
				);
			}
			if (meta.inputHash !== undefined) {
				errors.push(
					new ValidationError(
						scope,
						`${where}: frontmatter metadata.inputHash must be omitted for mode "synthesized"`,
					),
				);
			}
		}
	}

	return errors;
}

// ===========================================================================
// Main
// ===========================================================================

async function main() {
	let totalErrors = 0;

	for (const skill of SKILLS) {
		const scope = skill.dir;
		const manifestPath = path.join(process.cwd(), skill.dir, skill.manifestFile);

		let rawManifest;
		try {
			rawManifest = await fs.readFile(manifestPath, 'utf-8');
		} catch (err) {
			console.error(`[${scope}] Cannot read manifest at ${manifestPath}: ${err.message}`);
			totalErrors++;
			continue;
		}

		let manifest;
		try {
			manifest = yaml.load(rawManifest);
		} catch (err) {
			console.error(`[${scope}] Failed to parse manifest YAML: ${err.message}`);
			totalErrors++;
			continue;
		}

		// Layer 2.
		const lintErrors = lintManifest(manifest, scope);
		for (const err of lintErrors) {
			console.error(err.message);
		}
		totalErrors += lintErrors.length;

		// If the manifest itself is malformed at the root we can't reconcile.
		if (lintErrors.length > 0 && !Array.isArray(manifest?.rules)) {
			continue;
		}

		// Layer 3.
		const reconcileErrors = await reconcileManifestAndFrontmatter(manifest, skill, scope);
		for (const err of reconcileErrors) {
			console.error(err.message);
		}
		totalErrors += reconcileErrors.length;
	}

	if (totalErrors > 0) {
		console.error(`\n✗ validate-generated: ${totalErrors} error${totalErrors === 1 ? '' : 's'}`);
		process.exit(1);
	} else {
		console.log('✓ validate-generated: manifest and frontmatter reconciliation passed');
	}
}

main().catch((err) => {
	console.error('validate-generated crashed:', err);
	process.exit(2);
});
