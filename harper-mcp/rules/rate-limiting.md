---
name: rate-limiting
description: MCP tools/call rate limiting - per-tool, per-session, and per-client-identity token buckets, and the identityHeader trust model.
metadata:
  mode: synthesized
---

# Rate Limiting

In-memory token buckets that bound `tools/call` throughput per profile.

## When to Use

Use this skill when tuning MCP throughput, and **always** when a tool is exposed on a public or anonymous-accessible instance — the default limits alone do not stop session-cycling abuse.

## How It Works

Four session-scoped limits ship with sensible defaults (per profile, configurable under `mcp.<profile>.rateLimit.*`):

- `perToolPerSecond` / `perToolBurst` — sustained rate and burst per (session, tool).
- `sessionConcurrency` — max in-flight calls per session.
- `sessionPerSecond` — sustained rate per session across all tools.

Limit hits return an `isError` tool result with `kind: 'rate_limited'` and a `scope` field (not a JSON-RPC error), so the calling LLM can see and back off.

**Session buckets are evadable by anonymous clients**: `initialize → call → drop session → repeat` gets fresh buckets every loop. Two additions close that (5.2.0+):

- `perClientPerSecond` / `perClientBurst` (default off) — a bucket keyed on **client identity** rather than session, surviving the cycling loop. Burst defaults to the sustained rate, floored at one whole token (a fractional rate like `0.1` = "6/minute" still admits its first call). Denials report `scope: 'per_client'`.
- `identityHeader` — identity defaults to the client socket IP; deployments behind a reverse proxy can name a trusted header (typically `x-forwarded-for`, first value wins). **Only set this when the proxy strips or replaces the header on untrusted traffic** — a client-controlled identity header lets callers mint fresh identities per request and bypass the limit; Harper logs a startup warning when it is configured.

All bucket state is in-memory per worker: it resets on restart and is not shared across workers. For durable, restart-surviving limits, see the [Durable Quotas](durable-quotas.md) skill.

On Harper versions before 5.2.0 the `perClient*`/`identityHeader` keys are **accepted and silently ignored** — verify `serverInfo.version` and prove a denial once before trusting the limit (see [Enabling MCP](enabling-mcp.md)).

## Examples

Public docs server with a cost-bearing `answer` tool — bound instantaneous abuse:

```yaml
mcp:
  application:
    mountPath: /mcp
    rateLimit:
      perClientPerSecond: 0.5 # 30/minute sustained per client
      perClientBurst: 5
```

Behind a proxy that manages `X-Forwarded-For` correctly:

```yaml
mcp:
  application:
    rateLimit:
      identityHeader: x-forwarded-for
      perClientPerSecond: 0.5
```
