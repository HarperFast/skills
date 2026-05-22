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
| **Lock file** | Per-rule input hash + last-generated docs SHA. Used to skip no-op regenerations. | `harper-best-practices/rules.manifest.lock.json` |

### Rule vs. Skill

- A **rule** answers "what should the agent do for this specific subtask?"
- A **skill** answers "what is this bundle for, and how does an agent navigate it?"

A skill is the right unit when you want a distinct *trigger* — a different description of work an agent is doing — to load a different set of rules. Today there's one skill (`harper-best-practices`); plausible future siblings: `harper-fabric-ops`, `harper-v4`, `harper-migrations`.

### Generation modes

Each manifest entry declares a `mode`:

- **`generate`** — body is auto-produced from `sources[]`. The default once a rule has canonical docs.
- **`synthesized`** — body is hand-authored. Used for rules whose content has no canonical docs source, or where a human voice is required. Generator never touches it.

## Architecture

```
┌─────────────────────┐                          ┌────────────────────────────────────┐
│ HarperFast/         │  repository_dispatch     │ HarperFast/skills                  │
│ documentation       │ ───────────────────────► │                                    │
│                     │  (on push to main)       │  generate.yaml workflow:           │
│  learn/             │                          │   1. read manifest                 │
│  reference/         │  + weekly cron safety    │   2. fetch docs sources            │
│  fabric/            │    net                   │   3. compute input hashes          │
└─────────────────────┘                          │   4. for changed rules:            │
                                                 │       LLM regen under template     │
                                                 │   5. validate                      │
                                                 │   6. open PR if diff               │
                                                 └────────────────┬───────────────────┘
                                                                  │
                                                                  ▼
                                                    Human reviews → merge →
                                                    semantic-release publishes
```

## Workflows (User Stories)

### Story 1 — Docs author updates reference prose _(automated)_

A docs author adds a clarifying note to `reference/rest/overview.md` explaining a new edge case in pagination. On merge to `documentation/main`:

1. Docs deploy workflow fires `repository_dispatch: docs-updated` at the skills repo with the docs commit SHA.
2. Skills `generate.yaml` runs: reads `rules.manifest.yaml`, fetches docs at that SHA, detects that the input hash for `querying-rest-apis` changed.
3. The generator calls Claude under the rule template, produces a new `rules/querying-rest-apis.md`, refreshes `AGENTS.md`, and updates the lock file.
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
2. Runs `npm run generate` locally. The script produces `rules/streaming-uploads.md`, rebuilds `AGENTS.md`, updates the lock file.
3. Opens a PR titled `feat: add streaming-uploads rule`. PR includes the manifest change _and_ the generated body so reviewers can see what the agent will read.
4. After review and merge, semantic-release publishes a minor version (because `feat:`).
5. The next dispatch-triggered regen is a no-op — the input hash matches the lock file.

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

## Migration

The repo today has 20 hand-authored rules and one skill. We migrate without disrupting that.

### Phase 0 — Plumbing only, no behavior change

Land the manifest and the lightweight validator. Every existing rule is mapped as `mode: synthesized` (which is accurate — they are hand-authored today). The build, validate, and release flows continue to work exactly as they do now.

- Add `harper-best-practices/rules.manifest.yaml` listing all 20 rules with category/priority/order, no `sources[]` yet.
- Add `scripts/generation/validate-generated.mjs` enforcing manifest completeness and cross-link integrity.
- Wire `validate-generated.mjs` into `npm run validate`.

This phase is reviewable as one PR. Nothing else changes.

### Phase 1 — Single rule end-to-end

Pick one clean rule (`vector-indexing`) and prove the full pipeline.

- Add `scripts/generation/generate-rules.mjs` (extractor + LLM rewriter + AGENTS.md assembler).
- Add `scripts/generation/templates/` (system prompt + rule template + AGENTS.md template).
- Add `.github/workflows/generate.yaml` (triggered by `repository_dispatch` and weekly cron).
- Modify `documentation/.github/workflows/deploy.yaml` to post the dispatch after successful deploys.
- Flip `vector-indexing` from `mode: synthesized` to `mode: generate` and populate `sources[]` + `must_cover`.
- Run manually a few times against synthetic docs edits to tune the prompt.

### Phase 2 — Expand to obvious 1:1 rules

Migrate rules that map cleanly to a single primary doc source. Each migration is its own small PR, allowing prompt tuning between flips. All Phase 2 candidates source from `.md` files in `reference/` and `fabric/`, so MDX handling is not yet required.

Candidates: `automatic-apis`, `querying-rest-apis`, `real-time-apps`, `checking-authentication`, `logging`, `deploying-to-harper-fabric`, `caching`.

### Phase 3 — Flat-markdown export from the docs repo

Before any rule can source from MDX (the `/learn` section in particular), the docs repo needs to produce a clean, machine-readable view of every page. Static MDX parsing from the skills side would be a treadmill of chasing JSX components; instead, we make the docs build emit flat markdown alongside HTML as a one-time piece of infrastructure that any future consumer (skills, search, LLM corpora) can reuse.

Work in `HarperFast/documentation`:

- Add a Docusaurus plugin (or remark/rehype pass in the existing build pipeline) that, for each MDX page, walks the AST and emits a flat-markdown rendering at `build/flat/<source-path>.md`. Component handling:
  - `<Tabs>` / `<TabItem>` → sequential subsections with each tab as an H3 under the parent.
  - Admonitions (`:::note`, `<Admonition>`) → blockquotes prefixed with the type.
  - Custom components → case-by-case (start with the components actually in use; add handlers as they appear).
  - Frontmatter preserved at the top of each flat file.
  - Internal links rewritten to relative paths against the flat tree.
- Bundle `build/flat/` into the deployed Pages output so every page has a parallel raw-markdown URL (e.g. `https://docs.harperdb.io/flat/reference/rest/overview.md`).
- Add a verification step to `deploy.yaml` that fails the build if the flat-markdown output is missing or empty for known pages.
- Document the export contract in a README next to the plugin — what gets flattened, what doesn't, how to add a handler for a new component.

Work in `HarperFast/skills`:

- Update `generate-rules.mjs` to fetch from the flat-markdown URLs rather than reading raw source files. The manifest's `sources[].path` stays unchanged — only the resolution layer differs.
- Update the source-exists check to validate against the flat-markdown URLs.

This phase ships nothing user-visible to skills consumers but unblocks Phase 4. It can be developed in parallel with Phase 2 if convenient.

### Phase 4 — Awkward and MDX-sourced rules + observability

With flat-markdown available, take on the remaining rules — including those that source from `/learn` MDX content — and stand up the observability layer that catches automation failures.

Rule candidates: `typescript-type-stripping`, `creating-harper-apps`, `schema-design-tooling`, plus any others that source from MDX. Some will migrate with multi-source bundles; some will stay `synthesized` permanently if no canonical docs exist.

Observability work:

- Stale-PR Slack notifier (auto-PRs open >7 days).
- Generation-failure auto-issue (idempotent by docs SHA).
- Weekly drift report (commits to docs main since last successful sync).

### Phase 5 — Steady state

All rules are either `generate` or intentionally `synthesized`. The team's only recurring contact with skills is reviewing auto-PRs and adding new rules when new features ship.

## Developer Documentation

Alongside the implementation, substantially expand the existing `.github/CONTRIBUTING.MD` to explain how the repo actually works under the new model. The current file covers prerequisites, commit conventions, and a thin sketch of skill structure — it predates the docs-driven approach and the rule/manifest split, so most of what follows is net-new content. The reader audience is: a teammate (or future agent) opening this repo for the first time and wanting to contribute.

Required sections:

- **Repo anatomy.** Walk every top-level file and directory and state what it is and why it exists. `SKILL.md`, `AGENTS.md` (both the top-level repo-onboarding one and the per-skill compiled one), `rules/`, `rules.manifest.yaml`, `rules.manifest.lock.json`, `scripts/`, `dist/`, `.github/workflows/`. No skipping "obvious" files — the point is to be explicit.
- **Concepts** (lifted from this plan): rule, skill, AGENTS.md, manifest, modes.
- **The generation pipeline** explained at a level a reviewer of an auto-PR can understand without reading code.
- **Common tasks.** "How do I add a new rule?" "How do I change which docs feed a rule?" "How do I add a new skill?" "An auto-PR looks wrong — what do I do?" — each with concrete commands.
- **What's automated vs. what's manual.** Reproduce the guiding principle and a condensed version of the user stories above.

The plan document you are reading lives at `docs/plans/docs-driven-skills.md`. It is a planning artifact, not steady-state documentation — once Phase 5 lands, this file can be archived. `.github/CONTRIBUTING.MD` is the long-lived companion.

## Validation Layer

Beyond the existing `validate-skills.mjs` (frontmatter + required sections), `validate-generated.mjs` adds:

- **Manifest completeness.** Every rule file has a manifest entry; every manifest entry has a rule file.
- **Provenance comment.** Every `mode: generate` rule body starts with `<!-- generated-from: <docs-sha> sources=[...] hash=<input-hash> -->`.
- **Source-exists check.** Every `sources[].path` in the manifest resolves in the docs repo (CI only, when docs are available).
- **Must-cover assertions.** Each `must_cover` string from the manifest appears in the rule body. Catches LLM regressions where a previously-covered concept disappears.
- **No leaked MDX.** Body contains no stray JSX components from MDX sources.
- **Cross-link integrity.** All `rules/<slug>.md` links resolve to a real rule file.
- **AGENTS.md round-trip.** Rebuilding `AGENTS.md` from `rules/*.md` + manifest order is byte-identical to the committed file. Catches hand-edits to derived content.
- **Minimum body length.** Sanity floor to catch degenerate LLM outputs.

## Open Questions

These should be resolved before Phase 1 begins:

- Anthropic API key provisioning for the skills repo's Actions runner — who owns it.
- Slack channel + webhook for stale-PR and failure notifications.
- Confirm `reference_versioned_docs/version-v4/` is excluded from source resolution by default.
- Component-handler scope for the flat-markdown export (Phase 3). We need to decide which custom Docusaurus components to support at launch versus add later. Suggest: enumerate the components actually used in the pages cited by Phase 4 rules, implement handlers for those, and add new handlers on demand.
- Confirm `SKILL.md` is "authored top + generated index at the bottom" — i.e., the rule list table is regenerated, the upper prose is not.

## Alternative: Pointer Strategy

This section documents a secondary strategy we may pivot to in the future. **It is not part of the implementation scope of this plan** — we are not building for it, designing flags around it, or constraining the generation work to accommodate it. It exists in this document so the team has a known fallback if the generation approach disappoints.

If after Phase 2 or 3 the team decides generation isn't pulling its weight — auto-PRs are too noisy, prompt tuning never converges, or reviewer fatigue sets in — we pivot to **pointer mode**: embed the docs source directly into the skills repo (git submodule, subtree, or sparse checkout of `HarperFast/documentation`), and have each rule become a thin pointer file (frontmatter + "when to use" + a link into the embedded docs).

The natural conceptual overlap with what we're building means a pivot would likely reuse much of the same plumbing — the manifest's `sources[]` declarations describe what a pointer rule would reference, the sync trigger and PR flow are content-agnostic, and the release pipeline is unchanged. The body-generation step is what would change: an LLM-driven rewriter becomes a deterministic pointer renderer, and the Anthropic dependency drops away. The net-new design work would be deciding how to embed the docs source (submodule vs. subtree vs. release-asset fetch).

If we ever reach that decision point, it becomes its own planning exercise. Until then, nothing in the implementation needs to anticipate it.
