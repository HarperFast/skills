# Contributing to Harper Skills

Thank you for your interest in contributing! This document explains how the repo works, what each piece does, and how to make changes confidently.

## Prerequisites

- Node.js (see `.nvmrc`)
- npm (use the version pinned in `.nvmrc`)
- Git

After cloning, install dependencies:

```bash
npm install
```

## Environment variables

Running the rule generator (`npm run generate`) requires an Anthropic API key. Copy the example file and fill in your key:

```bash
cp .env.example .env
# then edit .env and set ANTHROPIC_API_KEY
```

The `.env` file is gitignored and only needed locally. CI reads the key from repository secrets (`ANTHROPIC_API_KEY`).

## Repo anatomy

Every file and directory at a glance — nothing is skipped because "it's obvious."

```
/
├── harper-best-practices/       # The harper-best-practices skill
│   ├── SKILL.md                 # Skill metadata + generated rule index
│   ├── AGENTS.md                # Compiled flat view of all rules (derived)
│   ├── rules.manifest.yaml      # Source of truth for rule taxonomy (human-owned)
│   └── rules/                   # One .md file per rule
│       └── <slug>.md
├── scripts/
│   ├── build.mjs                # Builds the npm package (dist/)
│   ├── validate-skills.mjs      # Layer 1 validator: basic SKILL.md / rule schema
│   └── generation/
│       ├── generate-rules.mjs   # Rule generator (entry point for npm run generate)
│       ├── sync-report.mjs      # Baseline-freshness report + sync PR body composer
│       ├── validate-generated.mjs  # Layers 2–4 validator: manifest lint,
│       │                           # frontmatter reconciliation, body checks
│       ├── lib/
│       │   ├── llm.mjs          # Anthropic API call + retry logic
│       │   ├── manifest.mjs     # Manifest loading + normalisation helpers
│       │   ├── render.mjs       # AGENTS.md + SKILL.md index assembly
│       │   └── sources.mjs      # Source resolution, section slicing, hashing
│       └── templates/
│           ├── system-prompt.md # LLM system prompt for mode:generate rules
│           └── rule-template.md # Output template the LLM fills in
├── docs/
│   └── plans/                   # Planning documents (not steady-state docs)
├── dist/                        # Built output (gitignored, produced by npm run build)
│   ├── index.js
│   └── index.d.ts
├── .github/
│   ├── CONTRIBUTING.MD          # This file
│   └── workflows/
│       ├── generate.yaml        # Auto-sync: regenerates rules when docs change
│       ├── release.yaml         # semantic-release on merge to main
│       ├── validate-skills.yml  # PR gate: runs npm run validate
│       └── verify-commits.yaml  # PR gate: runs commitlint
├── .env.example                 # Template for local environment variables
├── .nvmrc                       # Node.js version pin
├── .oxfmtrc.json                # oxfmt formatter config
├── commitlint.config.cjs        # Conventional Commits enforcement
├── package.json                 # npm package manifest + scripts
├── release.config.js            # semantic-release configuration
├── renovate.json                # Automated dependency update config
└── AGENTS.md                    # Repo-level onboarding for agents/humans
                                 # (top-level — distinct from the per-skill one)
```

### Key files in detail

**`harper-best-practices/rules.manifest.yaml`** is the declarative source of truth for the entire skill. It lists every rule, what docs feed it, how the body is generated, and what the output must contain. Humans edit this file; the generator reads it. If the manifest and a rule file disagree, validation fails and tells you to regenerate.

**`harper-best-practices/rules/<slug>.md`** is a single rule file. It begins with YAML frontmatter:

```yaml
---
name: vector-indexing
description: How to enable and query vector indexes for similarity search in Harper.
metadata:
  mode: generate            # generate | direct | synthesized
  sources:
    - reference/v5/database/schema.md#Vector Indexing
  sourceCommit: a1b2c3d4   # docs SHA at last generation
  inputHash: 9f8e7d6c      # hash of resolved source content at last generation
---
```

- `name` and `description` are written by the generator from the manifest — do not edit them directly; edit the manifest instead.
- `metadata.mode` records how the body was produced.
- `metadata.sourceCommit` / `metadata.inputHash` provide inspectable provenance and let the generator skip no-op regenerations.

**`harper-best-practices/SKILL.md`** contains human-authored prose (trigger description, examples, how-it-works) plus a generated rule-index table between two sentinel comments (`<!-- BEGIN GENERATED INDEX -->` / `<!-- END GENERATED INDEX -->`). Do not hand-edit between the sentinels — the generator owns that region and will overwrite it.

**`harper-best-practices/AGENTS.md`** is assembled by the generator by concatenating all rule bodies under category headers, in manifest order. Do not hand-edit it; run `npm run generate` to rebuild it.

**Top-level `AGENTS.md`** is a separate, hand-authored file — it is repo-level onboarding for any agent (or human) opening this repository. It is not managed by the generator.

**`dist/`** is produced by `npm run build`. It exports a map of skills keyed by name for npm consumers. It is gitignored; CI builds and publishes it via semantic-release.

---

## Concepts

### Rule

An atomic instruction file covering one topic (e.g., `vector-indexing`, `caching`). Each rule answers: "what should the agent do for this specific subtask?" Rules live in `<skill-dir>/rules/<slug>.md` and are loaded on demand.

### Skill

A coherent bundle of rules plus trigger metadata and navigation guidance for a domain. The skill answers: "what is this bundle for, and how does the agent navigate it?" Today there is one skill (`harper-best-practices`); future skills would be sibling directories (`harper-fabric-ops/`, etc.).

### Manifest

`rules.manifest.yaml` — the human-owned map from rules to their docs sources, generation mode, and output assertions. The single source of truth for rule taxonomy. Validation enforces that every rule file matches it exactly.

### Generation modes

Each manifest entry declares a `mode` that controls how the rule body is produced:

| Mode | What it means | LLM call? |
|---|---|---|
| `generate` | Body is rewritten by an LLM from the declared `sources[]` under a fixed template. Use when the source is long, spans multiple files, or benefits from agent-tuned prose. | Yes |
| `direct` | Body is the verbatim flat-markdown of `sources[]`. Use when the source is already concise and byte-level auditability matters. | No |
| `synthesized` | Body is hand-authored. Use when there is no canonical docs source. The generator never touches it. | No |

Switching between `generate` and `direct` is a one-line manifest edit plus a regenerate. Neither mode is universally better — the right choice is per-rule based on what serves the agent.

### AGENTS.md (compiled)

The per-skill `AGENTS.md` is a flat concatenation of all rule bodies in manifest order under category headers. It exists for consumers that want one file instead of many individual rule files. The generator rebuilds it on every full run.

---

## The generation pipeline

When docs change (or on a weekly safety-net cron), `.github/workflows/generate.yaml` runs:

1. **Checks out `HarperFast/documentation`** at the triggering SHA and runs `npm ci && npm run build` in it. This produces per-route flat-markdown files under `documentation/build/` via the `@signalwire/docusaurus-plugin-llms-txt` Docusaurus plugin.

2. **Captures pre-sync provenance** — `sync-report.mjs` snapshots each rule's recorded baseline and which rules are stale, before generation overwrites the frontmatter. The sync PR body is composed from this snapshot.

3. **Reads `rules.manifest.yaml`** and iterates over every non-synthesized rule.

3. **Resolves sources** — for each `sources[].path`, reads the corresponding file from `documentation/build/`. If `sources[].section` is set, slices out that heading's content subtree. Concatenates sources in manifest order.

4. **Computes an input hash** (SHA-256 of resolved content). Compares against `metadata.inputHash` in the existing rule file. If they match, the rule is already current — skip.

5. **Produces the body** — `mode: generate` calls Claude under the rule template; `mode: direct` copies the resolved content verbatim.

6. **Writes the rule file** with updated frontmatter (`sourceCommit`, `inputHash`, `sources` snapshot).

7. **Reassembles `AGENTS.md`** from the formatted rule bodies.

8. **Splices the generated index** into `SKILL.md` between the sentinel comments.

9. **Validates** — runs `validate-generated.mjs` (manifest lint, frontmatter reconciliation, must-cover assertions, AGENTS.md round-trip). Failures open a GitHub issue pointing at the failing run.

10. **Opens a sync PR** if anything changed — branch `auto/docs-sync`, title `docs: regenerate rules from documentation@<sha>`. One rolling branch; re-triggering before merge force-updates the same PR.

This flow is **offline-first**: no network calls to `docs.harperdb.io`. Everything reads from the local docs build.

---

## Common tasks

### How do I add a new rule?

1. Add an entry to `harper-best-practices/rules.manifest.yaml`:

   ```yaml
   - rule: my-new-rule
     description: One sentence the agent uses to decide when to load this rule.
     category: api          # schema | api | logic | ops
     priority: 2            # 1–4 (determines AGENTS.md category ordering)
     order: 5               # position within the category
     mode: generate
     sources:
       - path: reference/v5/rest/my-page.md
         section: 'Relevant Section Heading'
         role: primary
     must_cover:
       - 'key term that must appear in the generated body'
   ```

2. Run the generator locally. You need the docs repo checked out **and built at `main` HEAD** — see [Keeping rule baselines fresh](#keeping-rule-baselines-fresh) for why this matters:

   ```bash
   git -C ../documentation switch main && git -C ../documentation pull
   npm --prefix ../documentation ci && npm --prefix ../documentation run build
   npm run generate -- --docs-path ../documentation --rule my-new-rule
   ```

   Omit `--rule` to regenerate all changed rules. Use `--force` to regenerate even when the input hash is unchanged.

3. Review the generated `harper-best-practices/rules/my-new-rule.md`, then open a PR with a `feat:` commit.

   Before opening, confirm the recorded baseline matches current docs main (catches a rule that was generated against a stale docs checkout):

   ```bash
   npm run sync:report -- --docs-path ../documentation --strict
   ```

For `mode: synthesized` (no docs source), omit `sources[]` and `must_cover`, write the rule body by hand, and open the PR.

### How do I change which docs feed a rule?

1. Edit `sources[]` in the manifest entry — update `path`, `section`, or add/remove entries.

2. Regenerate:

   ```bash
   npm run generate -- --docs-path ../documentation --rule <slug>
   ```

3. Review the diff and open a PR.

### How do I switch a rule's mode?

Change `mode` in the manifest, add or remove `sources[]` and `must_cover` as required by the new mode, then regenerate. The generator overwrites the body and frontmatter.

### How do I add a new skill?

1. Create a new top-level directory, e.g. `harper-fabric-ops/`, with:
   - `SKILL.md` — skill metadata + sentinel comments for the generated index
   - `AGENTS.md` — initially empty; the generator fills it
   - `rules.manifest.yaml` — the new skill's manifest
   - `rules/` — rule files

2. The existing `generate.yaml` workflow processes every skill directory automatically — no per-skill workflow changes needed.

3. `dist/index.js` will export the new skill after `npm run build`.

### An auto-sync PR looks wrong — what do I do?

Check what changed in the docs at the linked commit SHA. Common cases:

- **Wrong content**: a source section may have changed. Update `sources[].section` or `sources[].path` in the manifest and regenerate.
- **Missing key term**: add it to `must_cover` if it should always be present, then regenerate.
- **Good content, but needs stable wording**: switch the rule to `mode: synthesized` and hand-author the body. The generator will never touch it again.

Close the auto-PR without merging, fix the manifest on a new branch, and open a corrective PR against `main`. The next auto-sync will be a no-op once your fix merges.

### Keeping rule baselines fresh

Every `generate` / `direct` rule records the docs commit and content hash it was last produced from (`metadata.sourceCommit` / `metadata.inputHash`). That recorded baseline reflects **whatever local docs checkout you had** when you ran `npm run generate`.

If your docs checkout lags `main`, the rule is "born stale": its body reflects old docs, and the recorded hash points at an old commit. Nothing is lost — the next auto-sync regenerates it against current docs — but the resulting sync PR looks confusing, because a docs commit about feature X appears to regenerate an unrelated rule (the rule's *real* source changed in an earlier, never-synced commit).

To avoid this:

- **Build docs at `main` HEAD before generating** (see the commands in [How do I add a new rule?](#how-do-i-add-a-new-rule)).
- **Run the freshness check before opening a rule PR:**

  ```bash
  npm run sync:report -- --docs-path ../documentation --strict
  ```

  It compares every rule's recorded hash against the current docs build and exits non-zero (under `--strict`) if any rule is stale. A clean run means your baselines match the docs you built against. Drop `--strict` for an informational report.

The auto-sync workflow runs the same report before regenerating and uses it to explain each sync PR — listing which rules changed, the docs commit each was last synced from, and the full docs commit range since that baseline.

---

## What's automated vs. what's manual

> **Humans own the rule taxonomy. Automation owns keeping rule bodies in sync with their declared sources.**

| What | Who does it |
|---|---|
| Decide which rules exist | Human PR |
| Decide what docs feed each rule | Human PR (manifest edit) |
| Decide the generation mode per rule | Human PR (manifest edit) |
| Write `synthesized` rule bodies | Human |
| Regenerate `generate` / `direct` bodies when docs change | Automated (dispatch + cron) |
| Reassemble AGENTS.md and SKILL.md index | Automated (every generation run) |
| Open sync PRs (with per-rule change provenance) | Automated (`generate.yaml` + `sync-report.mjs`) |
| Keep recorded baselines current with docs main | Human (build docs at HEAD; `npm run sync:report --strict`) |
| Open failure issues when generation breaks | Automated (`generate.yaml`) |
| Review and merge sync PRs | Human |
| Publish new npm versions | Automated (semantic-release on merge to main) |

When a docs structural change breaks automation (renamed file, renamed heading), the workflow opens a GitHub issue. The fix is always the same shape: update the manifest, regenerate locally, open a PR.

---

## Development workflow

- **Format**: `npm run format` — formats files in place using oxfmt.
- **Format check**: `npm run format:check` — exits non-zero if any file would be reformatted. CI gate.
- **Build**: `npm run build` — compiles `dist/`.
- **Validate**: `npm run validate` — runs `format:check` + `build` + both validators. Run this before pushing.
- **Validate with docs**: add `&& node scripts/generation/validate-generated.mjs --docs-path ../documentation` for the full suite including source-exists and byte-identical checks.
- **Freshness report**: `npm run sync:report -- --docs-path ../documentation` — shows which rules are stale vs. the current docs build. Add `--strict` to fail on staleness (use before opening a rule PR).

The pipeline is ordered so `format:check` runs first. CI fails loudly on formatting drift rather than silently auto-fixing it.

---

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint.

```
feat: add streaming-uploads rule
fix: correct must_cover assertion for querying-rest-apis
chore(ci): pin generate.yaml action SHAs
docs: update CONTRIBUTING with generation pipeline
```

Useful types: `feat`, `fix`, `perf`, `refactor`, `chore`, `docs`, `style`, `test`, `build`, `ci`, `revert`.

Semantic-release maps `feat` → minor version bump and `fix` / `perf` → patch.

---

## Branching and pull requests

- Create feature branches from `main`.
- Keep PRs focused — one rule migration, one workflow change, etc.
- `npm run validate` must pass before requesting review.
- Auto-sync PRs (`auto/docs-sync`) are reviewed like any rule change — read the generated diff, check that the agent-facing prose is clean and accurate, and verify `must_cover` terms are present.

Releases are automated from the `main` branch via semantic-release.

---

## Code review guidelines

- For generated rule bodies: verify the prose reflects the source intent, not just that it satisfies `must_cover`.
- Prefer concise, action-oriented agent instructions over comprehensive coverage. Rules are loaded on demand; brevity helps.
- Add comments in manifest entries or scripts where intent isn't obvious.
- Avoid introducing unused dependencies.
- Keep changes backward compatible when feasible.

---

## Questions

If you're unsure about anything, open a draft PR early or start a discussion. We're happy to help get you unblocked quickly.
