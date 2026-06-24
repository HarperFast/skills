# Comprehensive v5 Rule Coverage

> **Status: meta plan / open.** This document frames the next development cycle for `@harperfast/skills`. It records goals, an honest map of where the ruleset stands today, and the open questions that must be answered before committing to phased execution. It deliberately does **not** answer those questions yet — it scopes the cycle and surfaces the decisions. Phased detail is added once the open questions below are resolved.

## Context

The [docs-driven generation pipeline](../plans-archive/docs-driven-skills.md) is built and live. Docs merges in `HarperFast/documentation` fire a `repository_dispatch` at this repo, which regenerates `mode: generate` rule bodies from the docs build output and opens a PR. That was the _initial lift_: prove the machinery end-to-end and migrate the rules that mapped cleanly.

This cycle is about **content, not machinery**. The pipeline works; the question now is whether the ruleset it maintains actually covers Harper v5 well, and what it would take to get there.

## Guiding Principle (carried forward)

> **Humans own the rule taxonomy. Automation owns keeping rule bodies in sync with their declared sources.**

The same principle applies. This cycle expands the taxonomy (which rules exist, what they map to) — all human-owned PRs — while leaning on the existing automation to keep bodies fresh.

## Primary Objective

**Build a comprehensive ruleset covering all of Harper v5 documentation.** "Comprehensive" means an agent working in a Harper v5 codebase can find a rule for any documented capability it might reasonably need, and that rule is sourced from (and stays in sync with) the canonical docs.

## Current Rule Map

21 rules across 4 categories. 11 are `mode: generate` (docs-driven, auto-synced); 10 are `mode: synthesized` (hand-authored, untracked against docs); **0 are `mode: direct`** — the verbatim-import mode is built and validated but has never been used by a real rule.

| Category | Rule                                    | Mode        | Notes                                                                                   |
| -------- | --------------------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| schema   | `adding-tables-with-schemas`            | synthesized | Candidate to migrate — schema docs exist                                                |
| schema   | `schema-design-tooling`                 | generate    | ✅ migrated (Phase 4)                                                                   |
| schema   | `defining-relationships`                | synthesized | Candidate to migrate                                                                    |
| schema   | `vector-indexing`                       | generate    | ✅ migrated (Phase 2)                                                                   |
| schema   | `using-blob-datatype`                   | synthesized | Candidate to migrate                                                                    |
| schema   | `handling-binary-data`                  | synthesized | Candidate to migrate                                                                    |
| api      | `automatic-apis`                        | generate    | ✅ migrated (Phase 3)                                                                   |
| api      | `querying-rest-apis`                    | generate    | ✅ migrated (Phase 3)                                                                   |
| api      | `real-time-apps`                        | generate    | ✅ migrated (Phase 3)                                                                   |
| api      | `checking-authentication`               | generate    | ✅ migrated (Phase 3)                                                                   |
| logic    | `custom-resources`                      | synthesized | Candidate to migrate                                                                    |
| logic    | `extending-tables`                      | synthesized | Candidate to migrate                                                                    |
| logic    | `programmatic-table-requests`           | synthesized | Candidate to migrate                                                                    |
| logic    | `typescript-type-stripping`             | generate    | ✅ migrated (Phase 4)                                                                   |
| logic    | `caching`                               | generate    | ✅ migrated (Phase 3)                                                                   |
| ops      | `deploying-to-harper-fabric`            | generate    | ✅ migrated (Phase 3)                                                                   |
| ops      | `creating-a-fabric-account-and-cluster` | synthesized | Candidate to migrate                                                                    |
| ops      | `creating-harper-apps`                  | synthesized | **Intentionally synthesized** — `create-harper` CLI lacks a clean canonical docs source |
| ops      | `serving-web-content`                   | synthesized | Candidate to migrate                                                                    |
| ops      | `logging`                               | generate    | ✅ migrated (Phase 3)                                                                   |
| ops      | `load-env`                              | generate    | ✅ migrated (Phase 3)                                                                   |

So the migration backlog is **9 synthesized rules that are candidates to move to `generate` or `direct`**, plus **1 (`creating-harper-apps`) intentionally held back** pending docs. (Note: an earlier informal count said "11 generate / 9 synthesized" — the accurate split is 11 / 10; `load-env` was the rule not counted.)

## Goals & Open Questions

These are the questions this cycle must answer. They are recorded here as design considerations, not yet resolved. Each will get a worked answer (and likely its own phase) as the plan matures.

### 1. How do we ensure we cover "everything"?

The objective is comprehensive coverage, which means we need a definition of "covered" that is **mechanically checkable**, not aspirational. Candidate approach:

- Treat the set of Harper v5 reference pages (the `reference/v5/**` routes in the docs build output) as the coverage universe.
- Assert that every reference page is referenced by at least one rule's `sources[]`. This becomes a new validation check — a _coverage report_ that lists reference pages with no owning rule.
- Decide what to do about partial coverage: a rule may source one `section` of a page while other sections go uncovered. Section-level coverage tracking may be needed, not just page-level.

Open: is page-level coverage the right granularity, or do we need section-level? Should `learn/` and `fabric/` count toward the coverage universe, or only `reference/v5/`? (See Question 5 on Learn content.)

### 2. What documentation is _not_ covered by rules today?

Before planning new rules, produce a **gap analysis**: enumerate the docs build output, subtract everything currently referenced by a `sources[]` entry in the manifest, and list the remainder. That list — the uncovered docs — is the raw backlog of candidate new rules. This is a prerequisite deliverable for the whole cycle; we can't scope "comprehensive" without knowing the denominator.

### 3. Migrate the synthesized rules

Nine synthesized rules are candidates to move to `generate` or `direct`. For each, the work is: find the canonical docs source, decide the mode (`generate` if the source benefits from rephrasing/multi-source bundling; `direct` if it's already concise and verbatim auditability is preferable), populate `sources[]` + `must_cover`, regenerate, and open a PR. This is also the natural opportunity to **put the `direct` mode into real use for the first time** — at least one of these rules is likely a better fit for verbatim import than LLM rewrite.

`creating-harper-apps` stays synthesized until the `create-harper` CLI has canonical docs (tied to Question 5).

### 4. How should Learn content be incorporated into rules?

The `creating-harper-apps` rule surfaced a real tension: it should _not_ have referenced the "Getting Started" Learn guide, because that guide is a **manual, narrative walkthrough** while the rule describes the **automated `create-harper` flow**. The Learn guide and the rule are answering different questions, and stapling them together produced a worse rule.

The general lesson: **`learn/` content is narrative/tutorial, `reference/` content is canonical/atomic.** Rules want atomic, action-oriented source material. Learn guides may be the wrong shape to source rules from directly — or may need a different template/treatment than reference pages.

Open questions:

- Should rules source from `learn/` at all, or only from `reference/v5/`? If Learn content is sourced, does `mode: generate` need Learn-specific prompt guidance to extract the actionable core from narrative prose?
- This points at a **docs-readiness problem**: where reference docs are thin or missing (e.g. `create-harper`), no amount of skill tooling produces a good rule. **Should skill development lightly pause on rules whose canonical docs aren't yet ironed out**, and instead feed a list of "docs gaps blocking good rules" back to the docs team?
- How does docs-readiness factor into sequencing? Likely: do the gap analysis (Q2) first, split the uncovered backlog into "docs are ready, write the rule" vs. "docs need work first, file a docs issue," and only schedule the former into this cycle.

## Proposed Shape (provisional)

Not committed — sketched so the cycle has a spine once the questions above are answered.

- **Phase A — Coverage instrumentation.** Build the coverage report (Q1) and the gap analysis (Q2) as a script/validation check. Output: a concrete, regenerable list of covered vs. uncovered docs.
- **Phase B — Synthesized migration sweep.** Work through the 9 candidate synthesized rules (Q3), one small PR each, including the first real `direct`-mode rule. Hold `creating-harper-apps`.
- **Phase C — Fill the gaps.** Using Phase A's uncovered list, author new rules for documented-but-unruled capabilities — but only where docs are ready (Q4/Q5). File docs issues for the rest.
- **Phase D — Coverage gate.** Once coverage is high, consider promoting the coverage report from informational to a CI gate (new reference pages must be claimed by a rule, or explicitly waived).

## Out of Scope (carried over as future follow-ups)

The observability extras deferred from the prior cycle remain deferred and are **not** part of this cycle unless a need emerges:

- Stale-PR Slack notifier (auto-PRs open >7 days).
- Weekly drift report (commits to docs main since last successful sync).

The generation-failure auto-issue already shipped and covers the highest-value failure signal. See the [archived plan's Phase 4](../plans-archive/docs-driven-skills.md#phase-4--awkward-rules--observability) for context.
