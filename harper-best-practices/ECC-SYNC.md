# Syncing to everything-claude-code (ECC)

This document describes how to keep the [everything-claude-code](https://github.com/anthropics/everything-claude-code) Harper skill and rules up to date when changes are made here.

## Repository Layout

```
harperfast/skills/harper-best-practices/
├── SKILL.md       # High-level skill description + quick reference
├── AGENTS.md      # Full compiled guide (all rules expanded inline)
└── rules/         # Individual rule files
    ├── adding-tables-with-schemas.md
    ├── automatic-apis.md
    └── ...

everything-claude-code/
├── skills/harper-best-practices/
│   └── SKILL.md   # Combined SKILL.md + AGENTS.md content (see below)
└── rules/harper/
    ├── adding-tables-with-schemas.md
    ├── automatic-apis.md
    └── ...
```

## Syncing the Rules

The individual rule files map directly. To sync all rules:

```bash
cp -r harperfast/skills/harper-best-practices/rules/ everything-claude-code/rules/harper/
```

After copying, verify that the rules referenced in the ECC SKILL.md still match the updated content.

## Syncing the Skill File

ECC does not use a separate AGENTS.md. Instead, the full content from `AGENTS.md` is merged inline into `skills/harper-best-practices/SKILL.md`. The harperfast `SKILL.md` (high-level overview + quick reference) acts as the structure, and the harperfast `AGENTS.md` (expanded rule details) fills in the body.

### Structure of the ECC SKILL.md

| Section                                       | Source                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| Frontmatter (`name`, `description`, `origin`) | harperfast `SKILL.md` frontmatter, with `origin: ECC` instead of `license`/`metadata` |
| `## When to Use`                              | harperfast `SKILL.md`                                                                 |
| `## Steps`                                    | harperfast `SKILL.md` (`## How It Works` renamed to `## Steps`)                       |
| `## Rule Categories by Priority` table        | harperfast `SKILL.md`                                                                 |
| `## Rule Details` — all expanded sections     | harperfast `AGENTS.md` content, with heading levels adjusted (see below)              |

### Heading Level Adjustments

The ECC SKILL.md uses different heading levels than AGENTS.md because the content is nested under `## Rule Details`:

| AGENTS.md                            | ECC SKILL.md                                          |
| ------------------------------------ | ----------------------------------------------------- |
| `## 1. Schema & Data Design`         | `### 1. Schema & Data Design`                         |
| `### 1.1 Adding Tables with Schemas` | `#### 1.1 [Adding Tables...](../../rules/harper/...)` |
| `#### When to Use`                   | `##### When to Use`                                   |
| `#### How It Works`                  | `##### How It Works`                                  |
| `#### Example`                       | `##### Example`                                       |

Rule section headings in ECC also include a markdown link to the corresponding rule file, e.g.:

```markdown
#### 1.1 [Adding Tables with Schemas](../../rules/harper/adding-tables-with-schemas.md)
```

### Syncing Process

When `AGENTS.md` is updated:

1. **Identify changed sections** by diffing `AGENTS.md` against the expanded rule content in the ECC SKILL.md (sections `### 1.` through `### 4.`).
2. **Apply content changes** to the corresponding section in the ECC SKILL.md, respecting the heading level and naming conventions above.
3. **Do not copy structure verbatim** — the ECC file omits the Table of Contents, the `---` separators between top-level sections map to the ECC structure, and section headings include rule file links.

When `SKILL.md` (the overview/quick reference) is updated:

1. Update the `## When to Use`, `## Steps`, and `## Rule Categories by Priority` sections in the ECC SKILL.md to match.
2. The `## Quick Reference` and `## How to Use` sections in harperfast `SKILL.md` have **no equivalent** in the ECC file — they are replaced by the full inline content.
