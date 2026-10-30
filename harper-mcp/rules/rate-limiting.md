---
name: rate-limiting
description: >-
  MCP tools/call rate limiting - per-tool, per-session, and per-client-identity
  token buckets, and the identityHeader trust model.
metadata:
  mode: generate
  sources:
    - reference/v5/mcp/configuration.md#`mcp.<profile>.rateLimit.*`
  sourceCommit: d999e45c73736c9e96d91eb839b6176db0bf1f51
  inputHash: e25db2f26820723f
---

# Rate Limiting MCP Tool Calls

Instructions for the agent to follow when configuring per-tool, per-session, and per-client-identity token-bucket rate limits on Harper MCP profiles.

## When to Use

Apply this rule when configuring `mcp.<profile>.rateLimit.*` keys to throttle `tools/call` invocations. Use it when you need to protect a worker from runaway sessions, prevent session-cycling abuse via per-client buckets, or control the rate of session creation via `initialize` limits.

## How It Works

1. **Understand the bucket model**: Harper maintains two token buckets per `tools/call` invocation — one per `(session, tool)` pair and one per session across all tools. When either bucket is exhausted, `tools/call` returns `result.isError = true` with `kind: "rate_limited"` (not a JSON-RPC error), so the LLM can read the message and back off without tearing down the transport.

2. **Set per-tool sustained rate and burst**: Configure how fast the per-tool bucket refills and how many back-to-back calls a single tool can absorb.

   ```yaml
   mcp.<profile>.rateLimit.perToolPerSecond: 10
   mcp.<profile>.rateLimit.perToolBurst: 20
   ```

   Set `perToolPerSecond` to `0` to disable per-tool throttling. Every numeric key accepts a quoted number (`"0.5"`) or a plain number.

3. **Set per-session concurrency and sustained rate**: Limit how many `tools/call` invocations a session may have in flight at once, and cap the aggregate rate across all tools in that session.

   ```yaml
   mcp.<profile>.rateLimit.sessionConcurrency: 25
   mcp.<profile>.rateLimit.sessionPerSecond: 100
   ```

   Exceeding `sessionConcurrency` returns `kind: "rate_limited"` with `scope: "concurrency"`. `sessionPerSecond` catches sessions that spread calls across many distinct tools to dodge `perTool*` limits.

4. **Enable per-client identity buckets with `perClientPerSecond`**: Session-scoped buckets can be evaded by a client that cycles sessions (`initialize` → call → drop → repeat). The client bucket survives that loop.

   ```yaml
   mcp.<profile>.rateLimit.perClientPerSecond: 10
   mcp.<profile>.rateLimit.perClientBurst: 10
   ```

   Denials surface as an `isError` tool result with `kind: 'rate_limited'`, `scope: 'per_client'`. `perClientPerSecond` defaults to `0` (disabled). `perClientBurst` defaults to the `perClientPerSecond` value floored at `1` — a fractional rate like `0.1` (6 per minute) still yields `perClientBurst: 1` so the bucket can admit at least one call.

5. **Control session creation rate with `initializePerSecond`**: Unlike `perClientPerSecond`, this limit is **on by default** (`10`). A denied `initialize` returns HTTP `429` with a `Retry-After` header — not a tool result with `kind: "rate_limited"`.

   ```yaml
   mcp.<profile>.rateLimit.initializePerSecond: 10
   mcp.<profile>.rateLimit.initializeBurst: 50
   ```

   `Retry-After` is `ceil(1 / initializePerSecond)` seconds. Set `initializePerSecond` to `0` to disable. The denied response body is:

   ```json
   {
   	"jsonrpc": "2.0",
   	"id": 1,
   	"error": {
   		"code": -32600,
   		"message": "MCP initialize rate limit reached; back off and try again"
   	}
   }
   ```

6. **Configure `identityHeader` for reverse-proxy deployments**: When every socket IP is the proxy's IP, set `identityHeader` to the name of a trusted header whose first (client-most) value supplies the real client identity. Typically `x-forwarded-for`.

   ```yaml
   mcp.<profile>.rateLimit.identityHeader: 'x-forwarded-for'
   ```

   **Only set this when the fronting proxy strips or replaces the header on untrusted traffic.** A client-controlled identity header lets callers mint fresh identities per request and bypass per-client limits entirely. Harper logs a startup warning when this key is configured.

   Harper canonicalizes the identity before counting:
   - An IPv4 address with a port, and an IPv4-mapped IPv6 address (`::ffff:192.0.2.1`), count as the plain IPv4 address.
   - Any other IPv6 address counts as its `/64`.
   - A request with no identity shares one bucket per profile instead of going unthrottled.
   - Past 100,000 tracked identities per profile and worker, new identities also share that bucket.

7. **Understand in-memory state limits**: All bucket state is in-memory per worker. It does not survive a restart and is not shared across workers. For durable quotas that persist across restarts and workers, see [durable-quotas.md](durable-quotas.md).

## Examples

Full rate-limit configuration for a profile:

```yaml
mcp.operations.rateLimit.perToolPerSecond: 10
mcp.operations.rateLimit.perToolBurst: 20
mcp.operations.rateLimit.sessionConcurrency: 25
mcp.operations.rateLimit.sessionPerSecond: 100
mcp.operations.rateLimit.perClientPerSecond: 5
mcp.operations.rateLimit.perClientBurst: 10
mcp.operations.rateLimit.initializePerSecond: 10
mcp.operations.rateLimit.initializeBurst: 50
mcp.operations.rateLimit.identityHeader: 'x-forwarded-for'
```

Fractional per-client rate (6 calls per minute) with default burst:

```yaml
mcp.application.rateLimit.perClientPerSecond: '0.1'
# perClientBurst defaults to 1 (floored from 0.1)
```

## Notes

| Key                   | Type            | Default (operations / application)  |
| --------------------- | --------------- | ----------------------------------- |
| `perToolPerSecond`    | number (min 0)  | `10` / `25`                         |
| `perToolBurst`        | number (min 0)  | `20` / `50`                         |
| `sessionConcurrency`  | integer (min 0) | `25` / `50`                         |
| `sessionPerSecond`    | number (min 0)  | `100` / `200`                       |
| `perClientPerSecond`  | number (min 0)  | `0` (disabled)                      |
| `perClientBurst`      | number (min 0)  | `perClientPerSecond` floored at `1` |
| `initializePerSecond` | number (min 0)  | `10`                                |
| `initializeBurst`     | number (min 1)  | `50`                                |
| `identityHeader`      | string          | unset (socket IP)                   |

- The `initialize` limit is the only one that rejects with HTTP `429`; all other exhausted buckets return an `isError` tool result with `kind: "rate_limited"`.
- On the application profile, a client spreading connections across HTTP worker threads gets the configured rate and burst once per worker; a client reusing one connection stays on one worker.
- The operations profile is served by the main thread only, so it admits exactly the configured figure.
- For quotas that survive restarts and are shared across workers, see [durable-quotas.md](durable-quotas.md).
