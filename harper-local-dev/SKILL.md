---
name: harper-local-dev
description: Guidelines for running Harper on a developer machine, covering isolated
  dev instances, parallel instances across git worktrees, loopback address
  allocation, and per-instance data roots. Triggers on tasks involving local
  Harper dev servers, running several Harper instances at once, git worktrees,
  port conflicts (EADDRINUSE), or dev-mode reload loops.
license: Apache-2.0
metadata:
  author: harper
  version: '1.0.0'
---

# Harper Local Development

Guidelines for running and managing Harper on a developer machine. Where `harper-best-practices` covers how to build a Harper application, this skill covers the environment you build it in: how dev instances are started, isolated from one another, and cleaned up.

## When to Use

Reference these guidelines when:

- Running more than one Harper dev instance on the same machine (one per git worktree, branch, or agent session)
- Diagnosing `EADDRINUSE` on Harper's default ports, or a dev server that reloads in a loop
- Setting up a project's `npm run dev` so that it is safe to run in parallel
- Pointing tooling (agents, browsers, test scripts) at the right dev instance for the current worktree

## How It Works

1. Identify the shared state two Harper processes would contend for (ports, data root, file watcher).
2. Consult the relevant rule under "Quick Reference" below and read its rule file.
3. Prefer the ready-to-copy scripts under `scripts/` over writing your own wrapper.

## Examples

See the concrete examples embedded in each rule (wrapper scripts, `package.json` wiring, and debugging commands), plus the reference implementations in `scripts/`.

<!-- BEGIN GENERATED INDEX -->

## Rule Categories by Priority

| Priority | Category      | Impact | Prefix |
| -------- | ------------- | ------ | ------ |
| 1        | Dev Instances | HIGH   | `dev-` |

## Quick Reference

### 1. Dev Instances (HIGH)

- `running-dev-instances-in-worktrees` — Run multiple Harper dev instances in parallel from git worktrees with isolated data roots and loopback addresses.

<!-- END GENERATED INDEX -->

## How to Use

Read individual rule files for detailed explanations and code examples:

```
rules/running-dev-instances-in-worktrees.md
```

## Full Compiled Document

For the complete guide with all rules expanded: `AGENTS.md`
