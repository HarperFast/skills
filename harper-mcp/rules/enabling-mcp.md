---
name: enabling-mcp
description: >-
  How to enable and configure Harper's MCP server profiles (application and
  operations).
metadata:
  mode: generate
  sources:
    - reference/v5/mcp/overview.md
    - reference/v5/mcp/configuration.md
  sourceCommit: d7d2ddb120ce5f2ad39dc425f628f5a4f220c151
  inputHash: 236b335c4fc56602
---

# Enabling MCP

Instructions for exposing a Harper instance as a Model Context Protocol (MCP) server.

## When to Use

Use this skill when an AI client (Claude, an agent framework, or any MCP-capable tool) should talk to Harper directly — calling tools backed by your tables and Resources, reading data as MCP resources, or driving Harper operations.

## How It Works

Harper ships two independent MCP **profiles**, each a Streamable HTTP endpoint (MCP spec rev 2025-06-18):

1. **`application` profile** — the profile most apps want. Exposes your application's surface: auto-generated CRUD verb tools for `@export`ed tables, plus anything components opt in via `static mcpTools` / `static mcpPrompts` / `static mcpResources`. Mounts on the application HTTP port (default `9926`).
2. **`operations` profile** — exposes Harper's operations API as tools (user-filtered by operation permissions). Mounts on the operations port (default `9925`). Intended for administrative agents, not application clients.

Enable them in `harper-config.yaml` (or the equivalent `HARPER_SET_CONFIG` process env var):

```yaml
mcp:
  application:
    mountPath: /mcp # path on the application HTTP port
  operations:
    mountPath: /mcp # path on the operations port
```

A profile is enabled by the **presence** of its config sub-block — there is no separate `enabled` flag, so `mcp: { application: {} }` alone turns the application profile on with defaults. Each profile is independent; enable only what you need. Key per-profile options:

- `mountPath` — path the endpoint mounts on (default `/mcp`).
- `allow` / `deny` (operations profile only) — glob patterns or literal operation names selecting which operations become tools. The default is a deliberately read-only list; setting `allow` **replaces** it (no merge), so destructive operations like `set_configuration` must be opted in explicitly.
- `maxTools` — page size for `tools/list` responses (default 200); overflow pages via the MCP cursor.
- `rateLimit.*` — see the [Rate Limiting](rate-limiting.md) skill.
- durable quotas — registered in code with `server.setMcpQuotaHandler`, not a config key; see the [Durable Quotas](durable-quotas.md) skill.

Version notes: the transport and tool surface shipped across 5.1.x (complete protocol surface — prompts, resources, subscriptions, completions, cancellation, progress — in 5.1.10+). Custom content resources (`mcpResources`) are 5.1.18+. Per-client rate limiting and durable quotas are 5.2.0+.

**Verify the version before relying on gated features.** Unsupported config keys (such as the `rateLimit.perClient*` security controls) are **accepted and silently ignored** by older versions — nothing errors, the feature just doesn't run. Check `serverInfo.version` in the `initialize` response (or read `harper://about`) first, and after configuring a limit, prove it denies at least once before trusting it.

## Examples

Minimal application-profile setup for a project with `@export`ed tables:

```yaml
# harper-config.yaml
mcp:
  application:
    mountPath: /mcp
```

An MCP client pointed at `http://<host>:9926/mcp` then sees `get_*` / `search_*` / `create_*` / `update_*` / `delete_*` tools for every exported table, RBAC-filtered per authenticated user. See the [Connecting Clients](connecting-clients.md) skill for the handshake.
