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
  sourceCommit: 2cfb81318f17e0aca2d600109e6ad813d2d0443e
  inputHash: 53ecfa7dd46bed75
---

# Enabling and Configuring Harper MCP Server Profiles

Instructions for the agent to enable and configure Harper's MCP server profiles (`operations` and `application`) using the `mcp:` block in `harper-config.yaml`.

## When to Use

Apply this rule when adding MCP support to a Harper deployment so that LLM hosts (Claude Desktop, Cursor, Zed, custom agents) can discover and invoke Harper operations and resources. Use it when configuring rate limits, session lifecycle, allow/deny lists, or durable quota policies for either MCP profile. See [connecting-clients.md](connecting-clients.md) for wiring an MCP client to a running Harper instance.

## How It Works

1. **Enable profiles via presence of their sub-block.** A profile is enabled by the **presence** of its sub-block under `mcp:` — there is no separate `enabled` flag. Add an empty map to enable a profile with all defaults:

   ```yaml
   mcp:
     operations: {}
     application: {}
   ```

   - The `operations` profile mounts at `/mcp` on the **operations server** (default port `9925`).
   - The `application` profile mounts at `/mcp` on the **application HTTP server** (default port `9926`).

2. **Configure the operations profile (`mcp.operations`).** This profile wraps Harper's operation catalog.

   | Key         | Type              | Default   | Purpose                                                                          |
   | ----------- | ----------------- | --------- | -------------------------------------------------------------------------------- |
   | `mountPath` | `string`          | `/mcp`    | URL path the endpoint mounts on                                                  |
   | `allow`     | `array<string>`   | See below | Operations exposed as MCP tools (glob or literal); **replaces** the default list |
   | `deny`      | `array<string>`   | `[]`      | Operations filtered out after `allow` is applied                                 |
   | `maxTools`  | `integer` (min 1) | `200`     | Max tools per `tools/list` response page                                         |

   Default `allow` list:

   ```yaml
   allow:
     - describe_*
     - list_*
     - search_*
     - get_job
     - get_status
     - get_analytics
     - get_metrics
     - system_information
     - read_log
     - read_audit_log
   ```

   Setting `allow` **replaces** the default — it does not merge. To expose destructive operations (e.g. `set_configuration`, `drop_table`), add them explicitly.

3. **Configure the application profile (`mcp.application`).** This profile walks your exported `Resource` classes and generates one MCP tool per implemented REST verb. It accepts all `mcp.operations.*` keys plus:

   | Key                | Type              | Default | Purpose                                                            |
   | ------------------ | ----------------- | ------- | ------------------------------------------------------------------ |
   | `searchMaxResults` | `integer` (min 1) | `1000`  | Hard cap on records a `search_<resource>` tool can return per call |

4. **Set rate limits for each profile (`mcp.<profile>.rateLimit.*`).** Token-bucket limits apply per `(session, tool)` pair and per session overall. Exhausted buckets return `result.isError = true` with `kind: "rate_limited"` — not a JSON-RPC error. See [rate-limiting.md](rate-limiting.md) for broader context.

   | Key                  | Type              | Default (operations)                | Default (application) | Purpose                                                           |
   | -------------------- | ----------------- | ----------------------------------- | --------------------- | ----------------------------------------------------------------- |
   | `perToolPerSecond`   | `number` (min 0)  | `10`                                | `25`                  | Sustained per-tool refill rate; `0` disables                      |
   | `perToolBurst`       | `number` (min 0)  | `20`                                | `50`                  | Burst capacity of the per-tool bucket                             |
   | `sessionConcurrency` | `integer` (min 0) | `25`                                | `50`                  | Max concurrent `tools/call` per session                           |
   | `sessionPerSecond`   | `number` (min 0)  | `100`                               | `200`                 | Sustained per-session rate across all tools                       |
   | `perClientPerSecond` | `number` (min 0)  | `0` (disabled)                      | `0` (disabled)        | Sustained rate keyed on client identity (5.2.0+)                  |
   | `perClientBurst`     | `number` (min 0)  | `perClientPerSecond` floored at `1` | same                  | Burst capacity of the per-client bucket                           |
   | `identityHeader`     | `string`          | unset (socket IP)                   | unset                 | Trusted header supplying client identity (e.g. `x-forwarded-for`) |

   `perClientPerSecond` (5.2.0+) survives session cycling. Only set `identityHeader` when a trusted proxy strips or replaces it on untrusted traffic — a client-controlled header bypasses per-client limits entirely.

5. **Configure session lifecycle (`mcp.session.*`).** These settings apply to both profiles. A dropped session causes the next request bearing that session id to receive HTTP 404; the client is expected to re-`initialize`.

   | Key                  | Type              | Default | Purpose                                                                 |
   | -------------------- | ----------------- | ------- | ----------------------------------------------------------------------- |
   | `idleTimeoutSeconds` | `integer` (min 1) | `1800`  | Idle window before a session is TTL-evicted from `system.mcp_session`   |
   | `allowClientDelete`  | `boolean`         | `false` | When `true`, accepts client-issued `DELETE /mcp` to terminate a session |

6. **Register a durable quota handler (optional, 5.2.0+).** For cost control that survives restarts and session cycling, register a handler with `server.setMcpQuotaHandler`. The handler runs **after** in-memory buckets admit the call. Keep any backing table unexported (no `@export`). A handler that throws **denies** the call (fail-closed). The handler receives `{ identity, tool, user, profile, sessionId }` and must return `true` to allow or `{ allowed: false, message?, retryAfterSeconds? }` to deny.

7. **Configure Origin validation for browser clients.** MCP validates the `Origin` header to defend against DNS-rebinding attacks. Validation reuses each profile's existing CORS config:
   - No `Origin` header (e.g. `curl`) → always accepted.
   - CORS disabled or `*` allow-list → any `Origin` accepted.
   - CORS enabled with an explicit allow-list → `Origin` not in the list returns `403 Forbidden`.

   For browser-exposed deployments, enable CORS with an explicit (non-`*`) allow-list on the relevant profile.

## Examples

**Minimal — both profiles on with all defaults:**

```yaml
mcp:
  operations: {}
  application: {}
```

**Production deployment — locked-down operations profile, raised application throughput, graceful logout:**

```yaml
mcp:
  operations:
    allow:
      - describe_all
      - describe_database
      - system_information
      - get_job
    rateLimit:
      perToolPerSecond: 5
      perToolBurst: 10
  application:
    searchMaxResults: 500
    rateLimit:
      perToolPerSecond: 50
      perToolBurst: 100
  session:
    idleTimeoutSeconds: 3600
    allowClientDelete: true
```

**Durable quota handler backed by an internal table:**

```graphql
# schema.graphql — internal counter, no @export
type QuotaCounter @table {
	id: ID @primaryKey
	used: Int
}
```

```javascript
// resources.js
const DAILY_LIMIT = 100;

export class Answerer extends Resource {
	static mcpTools = [{ name: 'answer', description: 'Answer a question', method: 'doAnswer' }];
	async doAnswer(args) {
		return { answered: args?.q ?? '' };
	}
}

server.setMcpQuotaHandler(async ({ identity, tool, user, profile, sessionId }) => {
	if (profile !== 'application') return true;
	const id = identity ?? 'unknown';
	const existing = await tables.QuotaCounter.get(id);
	const used = (existing?.used ?? 0) + 1;
	await tables.QuotaCounter.put({ id, used });
	if (used > DAILY_LIMIT) {
		return { allowed: false, message: 'daily quota reached', retryAfterSeconds: 3600 };
	}
	return true;
});
```

## Notes

- The `operations` profile mounts on port `9925`; the `application` profile mounts on port `9926`. These are the default ports — change `mountPath` only if `/mcp` collides with another route.
- Setting `mcp.operations.allow` **replaces** the default list entirely. Do not add `get_*` as a glob — it exposes `get_configuration` (which can return TLS/S3/auth secrets) and other sensitive operations.
- `perClientPerSecond` (5.2.0+) is disabled by default (`0`). Enable it to prevent session-cycling abuse.
- The durable quota handler (5.2.0+) is fail-closed: a thrown error denies the call. Race-safety under concurrent workers is the handler's responsibility — use atomic read-modify-write for production counters.
- Pass `undefined` to `server.setMcpQuotaHandler` to clear a registered handler. The latest registration wins on component reload.
- Version notes: the transport and tool surface shipped across 5.1.x (complete protocol surface — prompts, resources, subscriptions, completions, cancellation, progress — in 5.1.10+). Custom content resources (`mcpResources`) are 5.1.18+. Per-client rate limiting (`perClientPerSecond`, `perClientBurst`, `identityHeader`) and the durable quota handler (`server.setMcpQuotaHandler`) are 5.2.0+. **Verify the version before relying on gated features.** Unsupported config keys (such as the `rateLimit.perClient*` security controls) are **accepted and silently ignored** by older versions — nothing errors, the feature just doesn't run. After a session is evicted, the client must re-`initialize` to establish a new session.
- See [connecting-clients.md](connecting-clients.md) for how to connect MCP clients to these endpoints.
- See [rate-limiting.md](rate-limiting.md) for broader rate-limiting context.
