---
name: harper-mcp
description: Comprehensive guide to Harper's Model Context Protocol (MCP) interface,
  covering server setup, client connection, automatic and custom tools, prompts,
  resources, rate limiting, durable quotas, and the security model.
  Triggers on tasks involving MCP servers on Harper, AI-client integration,
  and exposing Harper data or behavior to LLM agents.
license: Apache-2.0
metadata:
  author: harper
  version: '1.0.0'
---

# Harper MCP

Guidelines for exposing a Harper instance as a Model Context Protocol (MCP) server and for building the tools, prompts, and resources AI clients consume. Harper implements MCP Streamable HTTP (spec rev 2025-06-18) with two independent profiles: `application` (your app's surface) and `operations` (Harper administration).

## When to Use

Reference these guidelines when:

- Enabling or configuring the MCP endpoint on a Harper instance
- Connecting an MCP client (Claude, agent frameworks, custom HTTP code) to Harper
- Deciding what tools an AI should see for a schema, or trimming that surface
- Exposing custom behavior (`mcpTools`), prompt templates (`mcpPrompts`), or content (`mcpResources`) to AI clients
- Protecting a public or anonymous-accessible MCP endpoint (rate limits, durable quotas, hardening)
- Debugging MCP wire errors (session/protocol headers, 400s, SSE)

## How It Works

1. Start with `enabling-mcp` to mount a profile, then `connecting-clients` for the handshake contract.
2. For the tool surface, consult `automatic-verb-tools` first — most CRUD needs are covered with zero code — and reach for `custom-mcp-tools` only for real behavior.
3. For content and templates, use `custom-mcp-resources` and `custom-mcp-prompts`; `resources-surface` explains what exists without any code.
4. Before any public exposure, work through `security-posture`'s checklist and configure `rate-limiting` (+ `durable-quotas` for cost-bearing tools).

## Examples

See the concrete examples embedded in each rule (curl handshakes, `static mcpTools`/`mcpResources` declarations, quota-hook implementations, and hardening configs).

<!-- BEGIN GENERATED INDEX -->

## Rule Categories by Priority

| Priority | Category              | Impact | Prefix       |
| -------- | --------------------- | ------ | ------------ |
| 1        | Setup & Connection    | HIGH   | `setup-`     |
| 2        | Tools & Prompts       | HIGH   | `tools-`     |
| 3        | Resources             | MEDIUM | `resources-` |
| 4        | Operations & Security | HIGH   | `ops-`       |

## Quick Reference

### 1. Setup & Connection (HIGH)

- `enabling-mcp` — How to enable and configure Harper's MCP server profiles (application and operations).
- `connecting-clients` — How MCP clients connect to Harper - the initialize handshake, session and protocol-version headers, and authentication.

### 2. Tools & Prompts (HIGH)

- `automatic-verb-tools` — How Harper auto-generates CRUD MCP tools from exported tables, with RBAC filtering and allow/deny/maxTools controls.
- `custom-mcp-tools` — How to expose custom instance methods as MCP tools via static mcpTools, including the anonymous-exposure security model.
- `custom-mcp-prompts` — How to publish reusable prompt templates to MCP clients via static mcpPrompts.

### 3. Resources (MEDIUM)

- `resources-surface` — The MCP resources surface - harper:// metadata URIs, harper+rest:// table descriptors, templates, subscriptions, and list_changed notifications.
- `custom-mcp-resources` — How to serve custom content (docs pages, reports, binaries) as MCP resources via static mcpResources with URI templates and completions.

### 4. Operations & Security (HIGH)

- `rate-limiting` — MCP tools/call rate limiting - per-tool, per-session, and per-client-identity token buckets, and the identityHeader trust model.
- `durable-quotas` — Operator-pluggable durable quotas for MCP tools/call via the server.setMcpQuotaHandler registration hook, with a race-safe counter pattern.
- `security-posture` — The MCP security model - anonymous access, RBAC boundaries, origin validation, audit logging, and the hardening checklist for public instances.

<!-- END GENERATED INDEX -->

## How to Use

Read individual rule files for detailed explanations and code examples:

```
rules/enabling-mcp.md
rules/connecting-clients.md
rules/custom-mcp-tools.md
rules/custom-mcp-resources.md
rules/security-posture.md
```

## Full Compiled Document

For the complete guide with all rules expanded: `AGENTS.md`
