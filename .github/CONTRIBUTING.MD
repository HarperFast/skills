# Contributing to Harper Skills

Thank you for your interest in contributing! This document explains how to set up your environment, make changes safely, and submit high‑quality pull requests.

## Prerequisites

- Node.js (see .nvmrc file)
- npm (use the version pinned in `.nvmrc`)
- Git

After cloning, install dependencies and (optionally) set up git hooks:

```bash
npm install
```

## Development workflow

- Format source files: `npm run format` — formats in place using oxfmt. Run this before committing if you've edited markdown, JSON, or other formatter-managed files.
- Check formatting without writing: `npm run format:check` — exits non-zero if any file would be changed by `npm run format`. This is the gate enforced by CI.
- Validate everything: `npm run validate` — runs `format:check`, then `build`, then both skill validators (`validate-skills.mjs` for the legacy schema checks, `validate-generated.mjs` for manifest ↔ frontmatter reconciliation defined under `scripts/generation/`).

The pipeline is intentionally ordered so `format:check` runs first. CI will fail loudly on formatting drift rather than silently auto-fixing it.

## Creating Skills

Skills are directories containing a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: my-skill
description: What this skill does and when to use it
---

# My Skill

Instructions for the agent to follow when this skill is activated.

## When to Use

Describe the scenarios where this skill should be used.

## Steps

1. First, do this
2. Then, do that
```

### Required Fields

- `name`: Unique identifier (lowercase, hyphens allowed)
- `description`: Brief explanation of what the skill does

### Required Sections

- `## When to Use`: Scenarios where the skill applies.
- `## Steps`: A numbered list of actions for the agent.

### Optional Fields

- `metadata.internal`: Set to `true` to hide the skill from normal discovery.

## Commit conventions

We use Conventional Commits and commitlint to keep history clean and meaningful.

Examples:

```
feat: add database browser filters
fix: normalize column widths in table view
chore(ci): update workflow names
```

- Lint your commit: `npm run commitlint --edit`
- If you want a commit-msg hook locally, you can add one (optional):
  ```bash
  # if a .husky directory is present in your clone
  npx husky add .husky/commit-msg 'npm commitlint --edit "$1"'
  ```

Useful types include: feat, fix, perf, refactor, chore, docs, style, test, build, ci, revert.

## Branching and pull requests

- Create feature branches from the main development branch.
- Keep PRs focused and reasonably small.
- Ensure `npm run validate` passes before requesting review.
- Use descriptive PR titles that align with Conventional Commits when possible.

Releases are automated from the `main` branch via semantic-release.

## Code review guidelines

- Prefer clear, readable code over “clever” code.
- Add comments where intent isn’t obvious.
- Avoid introducing unused dependencies.
- Keep changes backward compatible when feasible.

## Questions

If you’re unsure about anything, open a draft PR early or start a discussion. We’re happy to help get you unblocked quickly.
