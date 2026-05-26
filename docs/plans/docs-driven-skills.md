# Docs-Driven Skill Generation

## Goal

Eliminate drift between `@harperfast/skills` and `HarperFast/documentation`. Today rule bodies are maintained by hand — sometimes with agent assistance, but a human still has to notice a docs change, prompt the rewrite, and open a PR. As the docs evolve, skills silently fall behind. We're moving to a model where rule bodies are **generated from docs automatically** and humans only intervene to shape the *taxonomy* — which rules exist, what docs feed them, and what each rule must assert.

## Guiding Principle

> **Humans own the rule taxonomy. Automation owns keeping rule bodies in sync with their declared sources.**

Anything that decides _what rules exist or what they map to_ flows through a human PR (agent-assisted drafting is fine). Anything that re-renders prose when docs change is automated.

## Concepts

| Term | What it is | Where it lives |
|---|---|---|
| **Rule** | Atomic instruction file for one topic (e.g., `vector-indexing`). Loaded on demand by the agent. | `harper-best-practices/rules/*.md` |
| **Skill** | A coherent bundle of rules + trigger metadata + navigation guidance for a domain. | `harper-best-practices/SKILL.md` |
| **AGENTS.md** | Derived flat-file view of an entire skill (all rules concatenated). For consumers that want one file rather than many. | `harper-best-practices/AGENTS.md` |
| **Manifest** | Source-of-truth mapping from rules to docs files, with `must_cover` invariants and generation `mode`. Owned by humans. | `harper-best-practices/rules.manifest.yaml` |
| **Rule frontmatter `metadata`** | Per-rule snapshot of what the body was last generated from (`mode`, `sources`, `sourceCommit`, `inputHash`). Used to skip no-op regenerations and to make provenance inspectable from the rule file. | YAML frontmatter of each `rules/*.md` |

### Rule vs. Skill

- A **rule** answers "what should the agent do for this specific subtask?"
- A **skill** answers "what is this bundle for, and how does an agent navigate it?"

A skill is the right unit when you want a distinct *trigger* — a different description of work an agent is doing — to load a different set of rules. Today there's one skill (`harper-best-practices`); plausible future siblings: `harper-fabric-ops`, `harper-v4`, `harper-migrations`.

### Generation modes

Two separable benefits flow from the docs-driven model: **deterministic sync** (rule bodies stay tethered to docs content) and **LLM-driven concision** (longer reference prose rewritten into shorter, action-oriented rules). Those are independently valuable, so we expose three modes per rule and pick the right tool for each.

Each manifest entry declares a `mode`:

- **`generate`** — body is auto-produced by an LLM rewrite of `sources[]` under a fixed template. Use when the source is long, spans multiple files, or benefits from rephrasing for the agent.
- **`direct`** — body is the verbatim flat-markdown of `sources[]`, imported as-is with no LLM call. Use when the docs section is already concise and reads well to an agent, when verbatim auditability matters most, or when you want to avoid LLM cost and variance.
- **`synthesized`** — body is hand-authored. Use when there's no canonical docs source, or when the content needs a distinctly human voice. Generator never touches it.

`direct` and `generate` are interchangeable on a per-rule basis — flipping between them is a manifest edit plus a regenerate. The hypothesis that LLM summarization always wins isn't pre-assumed; we expect to iterate per rule and pick what serves the agent best.

## Architecture

```
┌─────────────────────┐                          ┌─────────────────────────────────────┐
│ HarperFast/         │  repository_dispatch     │ HarperFast/skills                   │
│ documentation       │ ───────────────────────► │                                     │
│                     │  (on push to main)       │  generate.yaml workflow:            │
│  learn/             │                          │   1. checkout docs @ SHA            │
│  reference/         │  + weekly cron safety    │   2. cd docs && npm ci && build     │
│  fabric/            │    net                   │      (produces build/ with plugin's │
│                     │                          │       flat-markdown)                │
│  + @signalwire/     │                          │   3. read manifest                  │
│    docusaurus-      │                          │   4. resolve sources from local     │
│    plugin-llms-txt  │                          │      build/, compute input hashes   │
└─────────────────────┘                          │   5. for changed rules:             │
                                                 │      produce body per mode          │
                                                 │      (LLM rewrite or verbatim)      │
                                                 │   6. validate                       │
                                                 │   7. open PR if diff                │
                                                 └────────────────┬────────────────────┘
                                                                  │
                                                                  ▼
                                                    Human reviews → merge →
                                                    semantic-release publishes
```

The data flow is **offline-first**: docs are checked out and built locally in CI (and on contributor machines for local `npm run generate`). Skills CI never makes a network call to fetch docs content. The plugin's deployed `.md` and `llms.txt` files remain available at the public docs URL for third-party consumers.

## Manifest Schema

The manifest at `harper-best-practices/rules.manifest.yaml` is the declarative source of truth for the skill. It defines every rule, its docs sources, its generation mode, and the assertions that hold for `generate` mode rules. Humans edit this file directly; the generator reads it and writes derived artifacts (rule files, AGENTS.md). Future skills (e.g. `harper-fabric-ops/`) get their own manifest at the same relative path.

```yaml
rules:
  - rule: vector-indexing
    description: Use vector indexes for similarity search on numeric array fields.
    category: schema
    priority: 1
    order: 4
    mode: generate
    sources:
      - path: reference/database/schema.md
        section: 'Vector Indexing'
        role: primary
    must_cover:
      - '@indexed(type: "HNSW")'
      - 'vector similarity search via REST'
    cross_links:
      - caching
      - automatic-apis
```

| Field | Required | Type | Description |
|---|---|---|---|
| `rule` | yes | string | Slug. Matches `rules/<slug>.md`. Lowercase letters, digits, and hyphens only. Must be unique within the manifest. |
| `description` | yes | string | Agent-facing trigger description. Written into the rule's frontmatter `description` verbatim. |
| `category` | yes | enum | One of `schema` / `api` / `logic` / `ops`. Determines AGENTS.md grouping. |
| `priority` | yes | int | 1–4. Category-level priority used for AGENTS.md ordering. |
| `order` | yes | int | Position within the category. Determines AGENTS.md sequencing. |
| `mode` | yes | enum | One of `generate` / `direct` / `synthesized`. |
| `sources` | conditional | array | Required for `generate` and `direct`. Omitted for `synthesized`. |
| `sources[].path` | yes | string | Path within the docs build output (`<docs>/build/<path>`), matching the route URL + `.md`. Often identical to the source filename for `.md` sources, but `.mdx` sources produce `.md` outputs and Docusaurus drops `index` from path segments. E.g. `reference/database/schema.md` (rendered from the same path) or `learn/getting-started.md` (rendered from `learn/getting-started/index.mdx`). |
| `sources[].section` | no | string | H2/H3 heading text. If present, the extractor slices that section out of the source rather than importing the whole page. |
| `sources[].role` | no | enum | `primary` (default) or `supplemental`. Hint to the generator; supplemental sources provide context but aren't required to be summarized. |
| `must_cover` | no | array | Strings that must appear in the rule body after generation. Applies only to `mode: generate` — guards against LLM regressions. |
| `cross_links` | no | array | Slugs of related rules. Used by the rule template to produce "See also" links. |

## Rule Frontmatter Schema

Each `rules/<slug>.md` file begins with YAML frontmatter. The frontmatter is **fully derived** from the manifest plus generator bookkeeping — humans should not edit it directly. Any divergence between manifest and frontmatter is treated as drift and surfaced by validation.

```yaml
---
name: vector-indexing
description: Use vector indexes for similarity search on numeric array fields.
metadata:
  mode: generate
  sources:
    - reference/database/schema.md#vector-indexing
  sourceCommit: a1b2c3d4e5f6
  inputHash: 9f8e7d6c5b4a
---
```

| Field | Required | Origin | Description |
|---|---|---|---|
| `name` | yes | manifest `rule` | Slug. Must match the file basename. |
| `description` | yes | manifest `description` | Agent-facing trigger description. |
| `metadata.mode` | yes | manifest `mode` | The mode used to produce this body. |
| `metadata.sources` | for generate/direct | manifest `sources[]` | Array of `path[#section]` strings. Snapshot of resolved sources at last generation. |
| `metadata.sourceCommit` | for generate/direct | generator | Docs commit SHA at last generation. Inspectable provenance. |
| `metadata.inputHash` | for generate/direct | generator | Hash of resolved source content at last generation. Drives the no-op skip. |

The generator writes the full frontmatter on every successful regen, so manual edits to `metadata.*` will be overwritten. The `name` and `description` fields are also overwritten from the manifest — to change those, edit the manifest.

## Generation Lifecycle

A regen run (cron-triggered or `repository_dispatch`-triggered) executes in this order:

1. **Manifest lint.** Parse `rules.manifest.yaml`. Validate against the schema (required fields, enums, no duplicate slugs, `cross_links` resolve, `sources` present for non-synthesized rules). A malformed manifest fails the run before any source fetching happens.
2. **Per-rule iteration.** For each manifest entry:
   1. **`synthesized` → skip.** No source fetching, no body production. The hand-authored body remains untouched.
   2. **Resolve sources.** For each `sources[].path`, read the corresponding file from the docs build output (`<docsPath>/build/<path>`). Apply `section` slicing by parsing markdown headings if specified. Concatenate sources in manifest order. No network access — the docs build is local (checked out + built by the workflow in CI, or pointed at via `--docs-path` for local dev).
   3. **Compute input hash.** SHA-256 of the resolved source content. Same input → same hash, regardless of mode.
   4. **Skip check.** Read existing `rules/<slug>.md` frontmatter. If `metadata.inputHash` matches the computed hash, skip — body is already current.
   5. **Produce body.**
      - `mode: generate` — call Claude with the system prompt, rule template, resolved sources, and manifest `must_cover` assertions. Body comes back as agent-tuned prose.
      - `mode: direct` — body is the resolved source content verbatim. No LLM call.
   6. **Write rule file.** Compose frontmatter (`name`, `description` from manifest; full `metadata` block from generator) plus body. Run through oxfmt.
3. **Refresh AGENTS.md.** Concatenate all `rules/*.md` bodies under category headers, ordered by manifest `priority` then `order`. Write to `harper-best-practices/AGENTS.md`.
4. **Validate.** Run `validate-generated.mjs` (see [Validation Layer](#validation-layer)). If anything fails, abort the run; the workflow opens (or updates) a failure issue.
5. **Diff check.** If `git status` shows no changes (every rule's input hash matched), exit silently — no PR.
6. **Open PR.** Create branch `auto/docs-sync-<docs-sha-short>`, commit, push, `gh pr create` with a `docs:` conventional commit title and a body listing changed rules.

The lifecycle is identical whether triggered by docs `repository_dispatch` or the weekly safety-net cron — the only difference is which docs SHA gets used as the pin (dispatch passes one explicitly; cron uses docs main HEAD).

## Workflows (User Stories)

### Story 1 — Docs author updates reference prose _(automated)_

A docs author adds a clarifying note to `reference/rest/overview.md` explaining a new edge case in pagination. On merge to `documentation/main`:

1. Docs deploy workflow fires `repository_dispatch: docs-updated` at the skills repo with the docs commit SHA.
2. Skills `generate.yaml` runs: checks out `HarperFast/documentation` at that SHA, runs `npm ci && npm run build` in the docs checkout (producing the plugin's flat-markdown under `build/`), then invokes the generator pointing at that build directory. The generator reads `rules.manifest.yaml`, resolves each rule's sources from the local build output, computes the current input hash for each, and compares against `metadata.inputHash` in each rule's frontmatter. `querying-rest-apis` shows a hash change.
3. The generator (under `mode: generate` for this rule) calls Claude under the rule template, produces a new `rules/querying-rest-apis.md` with updated `metadata.sourceCommit` and `metadata.inputHash` in frontmatter, and refreshes `AGENTS.md`.
4. Workflow opens a PR: `docs: regenerate rules from documentation@a1b2c3d`. The PR body lists which rules changed and links the upstream docs commit.
5. A maintainer reviews the diff — agent-facing prose still reads cleanly, the new edge case is mentioned. Merge.
6. Semantic-release publishes a patch version of `@harperfast/skills`.

No human action required until the review step.

### Story 2 — Engineer adds a new rule _(manual)_

Harper ships a new feature, _streaming bulk uploads_. An engineer wants agents to know about it.

1. Engineer edits `rules.manifest.yaml`:
   ```yaml
   - rule: streaming-uploads
     category: api
     priority: 2
     sources:
       - path: reference/database/api.md
         section: "Bulk Streaming"
         role: primary
     must_cover:
       - "PUT with chunked transfer encoding"
       - "back-pressure handling"
     mode: generate
   ```
2. With a local checkout of `HarperFast/documentation` (built once via `npm run build`), runs `npm run generate` against it (`--docs-path=../documentation` or via `DOCS_PATH`). The script produces `rules/streaming-uploads.md` with `metadata.mode`, `metadata.sources`, `metadata.sourceCommit`, and `metadata.inputHash` filled in by the generator, and rebuilds `AGENTS.md`. No network needed.
3. Opens a PR titled `feat: add streaming-uploads rule`. PR includes the manifest change _and_ the generated body so reviewers can see what the agent will read.
4. After review and merge, semantic-release publishes a minor version (because `feat:`).
5. The next dispatch-triggered regen is a no-op — the input hash matches the value stored in the rule's frontmatter.

### Story 3 — Authoring a rule with no docs source _(synthesized)_

An engineer wants to author a manual rule that isn't based on any documentation source — for example, agent-specific guidance, internal conventions, or cross-cutting advice that doesn't naturally belong in user-facing docs.

1. Engineer adds a manifest entry with `mode: synthesized` and no `sources[]`.
2. Writes the rule body at `rules/<rule-name>.md` by hand.
3. Opens a PR. The generator skips synthesized entries; validation still enforces frontmatter and section structure.

### Story 4 — Docs structure changes _(manual fix to automation)_

Different kinds of structural change in docs surface through different validation gates, but the human fix is the same shape: update the manifest, regenerate locally, open a PR.

**Scenario A — File renamed or moved.** The docs team renames `reference/rest/overview.md` to `reference/rest/introduction.md` as part of a reorganization. The next auto-regen fails the `source-exists` check because the manifest still points to the old path.

**Scenario B — Section removed or renamed.** The docs team renames `## Vector Indexing` to `## Vector Similarity Search` in `reference/database/schema.md`, or removes the section entirely. The file still exists so source-exists passes, but the extractor can't find the heading the manifest targets — generation fails loud rather than producing a degraded rule.

In both cases:

1. The failing workflow opens (or updates) an issue: `Auto-sync generation failure (a1b2c3d)`.
2. An engineer updates `sources[]` in the manifest for the affected rules — pointing at the new path, the new heading, or both.
3. Runs `npm run generate` locally to confirm the new mapping resolves and produces sensible output.
4. Opens a PR fixing the mapping. After merge, the next auto-regen runs cleanly.

Subtler structural changes — e.g., content silently moved out of a tracked section while the heading is left behind as a stub — don't trip source-exists or the extractor, but get caught downstream by `must_cover` assertions. See [Validation Layer](#validation-layer) for the full set.

### Story 5 — New skill added

Harper Fabric ops grows enough that a separate skill is warranted (different audience, different triggers, different rules).

1. Engineer creates a new top-level directory `harper-fabric-ops/` with its own `SKILL.md` and `rules.manifest.yaml`.
2. Adds rules under `harper-fabric-ops/rules/`.
3. The same `generate.yaml` workflow handles every skill directory it finds — no per-skill plumbing needed.
4. `dist/index.js` exports a map keyed by skill name.

### Story 6 — Importing a concise docs section verbatim _(direct)_

An engineer is migrating the `automatic-apis` rule from `synthesized` to a docs-driven mode. Reading the source section in `reference/rest/overview.md`, they notice it's already a tight reference list — endpoints, query parameters, the `rest: true` config knob. An LLM rewrite would add variance without value.

1. Engineer edits the manifest entry to use `mode: direct`:
   ```yaml
   - rule: automatic-apis
     category: api
     priority: 2
     sources:
       - path: reference/rest/overview.md
         section: "How the REST Interface Works"
     mode: direct
   ```
2. Runs `npm run generate` locally against a built docs checkout. The generator reads the flat-markdown for that section from the docs build output, writes `rules/automatic-apis.md` with the manifest-declared frontmatter (plus `metadata.mode: direct`, `metadata.sourceCommit`, `metadata.inputHash`), and inlines the flat-markdown verbatim as the body. No LLM call, no network call. Refreshes `AGENTS.md`.
3. Opens a PR `feat: import automatic-apis from docs`. The reviewer can verify the body is byte-identical to the source (modulo slicing).
4. On future docs updates, the auto-regen pipeline detects the input hash changed, re-imports verbatim, and opens a PR whose diff perfectly mirrors the upstream docs change.

If experience later shows the rule would benefit from rephrasing, flipping back to `mode: generate` is a one-line manifest edit followed by a regenerate.

## Migration

The repo today has 20 hand-authored rules and one skill. We migrate without disrupting that. Phase 0 (skills-side schema plumbing) and Phase 1 (docs-side plugin adoption) touch different repos and can run in parallel; everything from Phase 2 onward depends on Phase 1 producing the flat-markdown build output.

### Phase 0 — Plumbing only, no behavior change

Land the manifest, the manifest linter, and the manifest↔frontmatter reconciliation validator. Every existing rule is mapped as `mode: synthesized` (which is accurate — they are hand-authored today). The build and release flows continue to work exactly as they do now.

- Add `harper-best-practices/rules.manifest.yaml` listing all 20 rules with `rule`/`description`/`category`/`priority`/`order`/`mode: synthesized`. No `sources[]` populated yet.
- Add `scripts/generation/validate-generated.mjs` implementing Layers 2 and 3 from the [Validation Layer](#validation-layer) (manifest lint + manifest↔frontmatter reconciliation). Per-mode body checks (Layer 4) come in Phase 2 when generation lands.
- For each existing rule file, add the `metadata.mode: synthesized` block to frontmatter so reconciliation passes. No body changes.
- Wire `validate-generated.mjs` into `npm run validate`.

This phase is reviewable as one PR. Nothing in the generated content changes; we're just declaring the schema and proving the linter accepts the current state. Can run in parallel with Phase 1 (different repos).

### Phase 1 — Adopt `@signalwire/docusaurus-plugin-llms-txt`

All source resolution from Phase 2 onward depends on the docs build producing flat-markdown alongside HTML. This phase makes that happen by adopting the de facto community plugin rather than building our own pipeline.

`@signalwire/docusaurus-plugin-llms-txt` is MIT-licensed, actively maintained (SignalWire ships a companion `@signalwire/docusaurus-theme-llms-txt` package and pushes regular releases), and architecturally well-fit for Harper's multi-instance docs setup. It operates on Docusaurus's `postBuild` route data, which surfaces routes from every registered docs plugin instance — `learn`, `reference`, `fabric`, `release-notes` — and uses `unified` to convert each route's rendered HTML back to markdown. Because the conversion happens after the Docusaurus build, MDX partials, custom React components, theme components, and build-time data are all already resolved. No module shims, no per-component handlers, no MDX AST walking required on our side. The Docusaurus core team has acknowledged this plugin pattern as the mainstream solution (see [facebook/docusaurus#10899](https://github.com/facebook/docusaurus/issues/10899)).

Work in `HarperFast/documentation`:

- Install `@signalwire/docusaurus-plugin-llms-txt` and add it to `docusaurus.config.ts`.
- Configure `contentSelectors` to extract just the article body from rendered pages (avoid pulling in nav, sidebar, footer).
- Run `npm run build` and verify `.md` files appear under `build/` for every route across all four docs plugin instances. Spot-check a v5 reference page, a learn MDX page, a fabric page, and a release-notes page.
- Configure any necessary `excludeRoutes` (e.g. `reference_versioned_docs/version-v4/**` if v4 should be excluded; see [Open Questions](#open-questions)).
- Add a verification step to `deploy.yaml` that fails the build if expected `.md` artifacts are missing under `build/`.
- Optionally adopt `@signalwire/docusaurus-theme-llms-txt` for the user-facing "Copy Page" button. Independent of the skills work, but a nice UX bonus for docs visitors.

This phase ships nothing skills-side. It produces the artifact (per-route `.md` files in `build/`) that every later phase consumes. The plugin's deployed `.md` files (at `https://docs.harperdb.io/<path>.md`) and `llms.txt` index also become available at the docs site for *third-party* consumers — anyone outside Harper who wants to feed our docs into their own LLM tooling can use them. The skills repo doesn't consume those URLs; it reads the same files from a local docs build instead (see Phase 2).

**Fallback if the plugin can't be made to fit.** If a Harper-specific edge case turns up that the plugin's `remarkPlugins` / `rehypePlugins` / `RouteRule` hooks can't address, the fallback is to build our own pipeline using the same architectural pattern (postBuild route iteration + HTML→MD via `unified`). The two-layer override-handler design we sketched in earlier discussion remains the documented fallback approach. This is unlikely to be needed but is recorded here so the team isn't blocked if it is.

### Phase 2 — Single rule end-to-end

With the plugin installed (Phase 1) and the manifest schema in place (Phase 0), pick one clean rule (`vector-indexing`) and prove the full skills-side pipeline with both `mode: generate` and `mode: direct` wired in. The two modes share the same source resolution and frontmatter-metadata writing; they only differ in whether the body is LLM-rewritten or copied verbatim.

- Add `scripts/generation/generate-rules.mjs` supporting both `generate` (LLM rewrite under template) and `direct` (verbatim flat-markdown import). Shared concerns: source resolution (reading from `<docsPath>/build/<sources[].path>`), input-hash computation, frontmatter `metadata` population, AGENTS.md assembly. Accepts the docs build directory via a `--docs-path` flag (or `DOCS_PATH` env var) so the same script runs in CI and locally.
- Add `scripts/generation/templates/` (system prompt + rule template + AGENTS.md template) — used by `generate` only.
- Add `.github/workflows/generate.yaml` (triggered by `repository_dispatch` and weekly cron). Workflow steps: check out skills repo, check out `HarperFast/documentation` at the requested SHA (dispatch payload) or `main` HEAD (cron), run `npm ci && npm run build` in the docs checkout, then invoke the generator pointing at `<docs-checkout>/build/`. The generator never makes network calls to fetch docs — it reads from the local `build/` tree the plugin produced in Phase 1.
- Modify `documentation/.github/workflows/deploy.yaml` to post the `repository_dispatch` after successful deploys.
- Add Layer 4 per-mode body checks to `validate-generated.mjs` (must-cover assertions for `generate`, byte-identical check for `direct`, etc. — see [Validation Layer](#validation-layer)). Source-exists check now validates paths against the local `build/` directory.
- The manifest's `sources[].path` is now a path into the docs build output (matching the plugin's output filename and the rendered route structure). For most cases this looks identical to the source filename; the difference is visible for MDX (`.mdx` → `.md`) and for routes that diverge from source paths (e.g. Docusaurus drops `index` from `learn/getting-started/index.mdx` → `learn/getting-started.md`).
- Flip `vector-indexing` from `mode: synthesized` to `mode: generate` and populate `sources[]` + `must_cover`. Smoke-test `mode: direct` separately against a small synthetic rule to confirm both code paths work end-to-end.
- Run manually a few times against synthetic docs edits to tune the prompt and confirm the verbatim path is byte-stable.

This flow is **offline-first**. A contributor running `npm run generate` locally needs the docs repo checked out and built somewhere on their machine; the generator finds it via `--docs-path` or `DOCS_PATH`. Default discovery: a sibling `../documentation/build` directory. No network access is required at any step. CI gets the same behavior — it just does the checkout + build itself as workflow steps before invoking the generator.

CI cost: a full Docusaurus build runs on every skills sync (minutes, not seconds). Acceptable as a starting point. Optimizations available later if needed: cache `node_modules`, cache `build/` keyed by docs SHA, shallow checkout.

### Phase 3 — Expand to obvious 1:1 rules

Migrate rules that map cleanly to a single primary doc source. Each migration is its own small PR, allowing prompt tuning between flips. With the plugin handling all source types uniformly (Phase 1), source format isn't a phase-gating concern — these candidates are simply the rules with the cleanest 1:1 manifest mapping.

Candidates: `automatic-apis`, `querying-rest-apis`, `real-time-apps`, `checking-authentication`, `logging`, `deploying-to-harper-fabric`, `caching`.

### Phase 4 — Awkward rules + observability

Take on the rules that have multi-source bundles or no clean canonical doc, and stand up the observability layer that catches automation failures.

Rule candidates: `typescript-type-stripping`, `creating-harper-apps`, `schema-design-tooling`. Some will migrate with multi-source bundles; some will stay `synthesized` permanently if no canonical docs exist.

Observability work:

- Stale-PR Slack notifier (auto-PRs open >7 days).
- Generation-failure auto-issue (idempotent by docs SHA).
- Weekly drift report (commits to docs main since last successful sync).

### Phase 5 — Steady state

Every rule is in one of the three modes — `generate`, `direct`, or intentionally `synthesized` — based on what serves the agent best for that rule's content. The team's only recurring contact with skills is reviewing auto-PRs and adding new rules when new features ship. Per-rule mode is reversible at any time via a manifest edit.

## Developer Documentation

Alongside the implementation, substantially expand the existing `.github/CONTRIBUTING.MD` to explain how the repo actually works under the new model. The current file covers prerequisites, commit conventions, and a thin sketch of skill structure — it predates the docs-driven approach and the rule/manifest split, so most of what follows is net-new content. The reader audience is: a teammate (or future agent) opening this repo for the first time and wanting to contribute.

Required sections:

- **Repo anatomy.** Walk every top-level file and directory and state what it is and why it exists. `SKILL.md`, `AGENTS.md` (both the top-level repo-onboarding one and the per-skill compiled one), `rules/`, `rules.manifest.yaml`, `scripts/`, `dist/`, `.github/workflows/`. No skipping "obvious" files — the point is to be explicit. Explain the frontmatter `metadata` block on each rule and what each field signals.
- **Concepts** (lifted from this plan): rule, skill, AGENTS.md, manifest, modes.
- **The generation pipeline** explained at a level a reviewer of an auto-PR can understand without reading code.
- **Common tasks.** "How do I add a new rule?" "How do I change which docs feed a rule?" "How do I add a new skill?" "An auto-PR looks wrong — what do I do?" — each with concrete commands.
- **What's automated vs. what's manual.** Reproduce the guiding principle and a condensed version of the user stories above.

The plan document you are reading lives at `docs/plans/docs-driven-skills.md`. It is a planning artifact, not steady-state documentation — once Phase 5 lands, this file can be archived. `.github/CONTRIBUTING.MD` is the long-lived companion.

## Validation Layer

Validation runs in three concentric layers. Each catches a different class of failure; together they ensure the manifest is causally authoritative and the rule files faithfully reflect it.

### Layer 1 — Skill schema (existing)

`validate-skills.mjs` (already in the repo) enforces basic structural requirements on SKILL.md, rule files, and AGENTS.md: frontmatter has required `name` and `description`, files start with an H1, SKILL.md has the required `## When to Use` / `## How It Works` / `## Examples` sections. Unchanged by this plan.

### Layer 2 — Manifest lint

`validate-generated.mjs` parses `rules.manifest.yaml` and checks schema conformance. This runs before any source resolution so a malformed manifest fails fast.

- Every required field is present with the correct type.
- `mode` is one of `generate` / `direct` / `synthesized`.
- `category` is a recognized category.
- `priority` and `order` are positive integers.
- No duplicate `rule` slugs.
- For non-synthesized rules, `sources[]` is present and non-empty.
- For `generate` rules, `must_cover` strings are non-empty.
- `cross_links` slugs all reference existing rules in the manifest.
- `sources[].path` strings are well-formed paths (no leading `/`, no `..`).

### Layer 3 — Manifest ↔ frontmatter reconciliation

For each manifest entry, the validator opens `rules/<slug>.md` and verifies the frontmatter matches what the manifest declares. This is the gate that makes the manifest authoritative — any divergence means either the rule needs regenerating or the manifest needs fixing.

- `rules/<slug>.md` exists.
- `name` matches `<slug>`.
- Frontmatter `description` matches manifest `description`.
- Frontmatter `metadata.mode` matches manifest `mode`.
- For `generate` / `direct`: frontmatter `metadata.sources` (normalized) equals manifest `sources[]` (normalized to `path[#section]` strings).
- For `generate` / `direct`: frontmatter `metadata.sourceCommit` and `metadata.inputHash` are present and non-empty.

When this layer fails, the error message names the specific divergent field and points the engineer at either the manifest or the regenerate command.

### Layer 4 — Per-mode body checks

Once the manifest and frontmatter agree, body content is checked according to mode:

| Check | `generate` | `direct` | `synthesized` |
|---|:---:|:---:|:---:|
| AGENTS.md round-trip equality | ✓ | ✓ | ✓ |
| Cross-link integrity (`rules/<slug>.md` body links resolve) | ✓ | ✓ | ✓ |
| Source-exists (every manifest source resolves in docs) | ✓ | ✓ | — |
| Must-cover assertions (every manifest string appears in body) | ✓ | — | — |
| Minimum body length (sanity floor against degenerate LLM output) | ✓ | — | — |
| No leaked MDX (no stray JSX in body) | ✓ | ✓ | — |
| Body byte-identical to fetched flat-markdown | — | ✓ | — |

Notes:

- `direct` skips `must_cover` and min-length because the verbatim contract makes them redundant — if the wrong content was imported, the byte-identical check catches it.
- `synthesized` skips all source-related checks because there is no source.
- The "no leaked MDX" check exists for both `generate` and `direct` as defense in depth, even though Phase 1's flat-markdown export should prevent leakage at the source.
- AGENTS.md round-trip equality catches hand-edits to derived content. AGENTS.md is regenerated from `rules/*.md` + manifest order; if the committed version doesn't match, validation fails and the engineer is pointed at the rules.

## Open Questions

Each question is annotated with the earliest phase it blocks; resolve before that phase begins.

- **(Phase 1)** `contentSelectors` config for `@signalwire/docusaurus-plugin-llms-txt` — confirm the right CSS selector for extracting just the article body across all four docs plugin instances. Each instance may use a slightly different theme wrapper.
- **(Phase 1)** Whether to pin to the v1 stable release or adopt v2-alpha (which adds sections, attached files, and the theme-side "Copy Page" button). Default: ship Phase 1 on v1 stable; revisit v2 once it leaves alpha.
- **(Phase 1)** Confirm `reference_versioned_docs/version-v4/` is excluded from source resolution by default (handled via the plugin's `excludeRoutes` config).
- **(Phase 2)** Anthropic API key provisioning for the skills repo's Actions runner — who owns it.
- **(Phase 2)** Confirm `SKILL.md` is "authored top + generated index at the bottom" — i.e., the rule list table is regenerated, the upper prose is not.
- **(Phase 4)** Slack channel + webhook for stale-PR and failure notifications.

