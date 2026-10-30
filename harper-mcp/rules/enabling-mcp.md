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
  sourceCommit: d999e45c73736c9e96d91eb839b6176db0bf1f51
  inputHash: 56a913dbaf1d109e
---

# Enabling and Configuring Harper MCP Server Profiles

Instructions for the agent to enable and configure Harper's MCP server profiles (`operations` and `application`) in `harper-config.yaml`.

## When to Use

Apply this rule when adding MCP support to a Harper deployment so that LLM hosts (Claude Desktop, Cursor, Zed, custom agents) can discover and invoke Harper operations and resources. Use it when configuring rate limits, session lifecycle, allow/deny lists, or durable quota policies for either MCP profile. See [connecting-clients.md](connecting-clients.md) for wiring an MCP host to a running Harper instance.

## How It Works

1. **Enable profiles via `presence`**: A profile is enabled by the **presence** of its sub-block under `mcp:` in `harper-config.yaml` — there is no separate `enabled` flag. Add an empty block for each profile you want active:

   ```yaml
   mcp:
     operations: {}
     application: {}
   ```

   - `mcp.operations` mounts at `/mcp` on the **operations server** (default port `9925`).
   - `mcp.application` mounts at `/mcp` on the **application HTTP server** (default port `9926`).

2. **Configure the operations profile** (`mcp.operations.*`):

   | Key         | Type              | Default   | Purpose                                            |
   | ----------- | ----------------- | --------- | -------------------------------------------------- |
   | `mountPath` | `string`          | `/mcp`    | URL path for the endpoint                          |
   | `allow`     | `array<string>`   | See below | Operations exposed as tools (replaces, not merges) |
   | `deny`      | `array<string>`   | `[]`      | Operations filtered out after `allow` is applied   |
   | `maxTools`  | `integer` (min 1) | `200`     | Max tools per `tools/list` page                    |

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

   Setting `mcp.operations.allow` **replaces** the default list entirely — it does not merge. To expose destructive operations (e.g. `set_configuration`, `drop_table`), add them explicitly. Do not add `get_*` as a glob — it exposes `get_configuration` (which can return TLS/S3/auth secrets) and other sensitive operations.

3. **Configure the application profile** (`mcp.application.*`): Accepts all `mcp.operations.*` keys plus:

   | Key                | Type              | Default | Purpose                                                   |
   | ------------------ | ----------------- | ------- | --------------------------------------------------------- |
   | `searchMaxResults` | `integer` (min 1) | `1000`  | Hard cap on records returned by `search_<resource>` tools |

4. **Set rate limits** (`mcp.<profile>.rateLimit.*`): Both profiles share the same rate-limit schema. Token-bucket limits apply per `(session, tool)` pair and per session overall. Exhausted buckets return `result.isError = true` with `kind: "rate_limited"` — not a JSON-RPC transport error. See [rate-limiting.md](rate-limiting.md) for broader context.

   | Key                   | Type              | Default (operations / application)  | Purpose                                                           |
   | --------------------- | ----------------- | ----------------------------------- | ----------------------------------------------------------------- |
   | `perToolPerSecond`    | `number` (min 0)  | `10` / `25`                         | Sustained per-tool refill rate; `0` disables                      |
   | `perToolBurst`        | `number` (min 0)  | `20` / `50`                         | Burst capacity per tool                                           |
   | `sessionConcurrency`  | `integer` (min 0) | `25` / `50`                         | Max concurrent `tools/call` per session                           |
   | `sessionPerSecond`    | `number` (min 0)  | `100` / `200`                       | Sustained per-session rate across all tools                       |
   | `perClientPerSecond`  | `number` (min 0)  | `0` (disabled)                      | Sustained rate keyed on client identity (`5.2.0+`)                |
   | `perClientBurst`      | `number` (min 0)  | `perClientPerSecond` floored at `1` | Burst capacity for per-client bucket                              |
   | `initializePerSecond` | `number` (min 0)  | `10`                                | Sustained session-creation rate per client identity; `0` disables |
   | `initializeBurst`     | `number` (min 1)  | `50`                                | Burst capacity for `initialize`                                   |
   | `identityHeader`      | `string`          | unset (socket IP)                   | Trusted header supplying client identity (e.g. `x-forwarded-for`) |
   - A denied `initialize` returns HTTP `429` with a `Retry-After` header and a JSON-RPC error body; no session is created.
   - Only set `identityHeader` when the fronting proxy strips or replaces it on untrusted traffic.

5. **Configure session lifecycle** (`mcp.session.*`):

   | Key                  | Type              | Default | Purpose                                                          |
   | -------------------- | ----------------- | ------- | ---------------------------------------------------------------- |
   | `idleTimeoutSeconds` | `integer` (min 1) | `1800`  | TTL for idle sessions in `system.mcp_session`                    |
   | `allowClientDelete`  | `boolean`         | `false` | When `true`, accepts client `DELETE /mcp` to terminate a session |

6. **Register a durable quota handler** (optional, `5.2.0+`): Call `server.setMcpQuotaHandler(handler)` in a component to enforce durable per-identity quotas that survive rate-limit bypasses (e.g. session cycling). The handler runs **after** in-memory buckets admit the call. Return `true` to allow or `{ allowed: false, message?, retryAfterSeconds? }` to deny. A handler that throws **denies** the call (fail-closed). Pass `undefined` to `server.setMcpQuotaHandler` to clear a registered handler. The latest registration wins on component reload. Keep any backing table unexported (no `@export`) so it stays off every transport. Components can also publish their own content under author-chosen URIs with a static `mcpResources` array.

7. **Configure Origin validation for browser clients**: MCP validates the `Origin` header to prevent DNS-rebinding. Validation reuses each profile's existing CORS config:
   - CORS disabled or `*` allow-list → any `Origin` accepted.
   - CORS enabled with an explicit allow-list → `Origin` not in the list returns `403 Forbidden`.
   - No `Origin` header (e.g. `curl`) → always accepted.

## Examples

**Minimal — both profiles on with defaults:**

```yaml
mcp:
  operations: {}
  application: {}
```

**Full deployment example** — locked-down operations allow list, custom rate limits, raised application throughput, lower session-creation rate, extended session TTL, and client-initiated session deletion:

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
      initializePerSecond: 2
      initializeBurst: 20
  session:
    idleTimeoutSeconds: 3600
    allowClientDelete: true
```

**Durable quota handler with an internal counter table:**

```graphql
# schema.graphql — INTERNAL counter, no @export
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

- Port defaults: operations profile → `9925`; application profile → `9926`.
- `perClientPerSecond` is available in `5.2.0+`. In-memory buckets are per-worker and do not survive restarts or sync across workers.
- The `mcp.operations.allow` list also governs the built-in agent's available tools when `agent.enabled` is set — widening it affects agent behavior, not just MCP clients.
- Denials from `setMcpQuotaHandler` surface as `kind: 'quota_exceeded'` in the tool result. The raw handler error is written to the server log only; clients receive a sanitized message.
- To exclude a Resource from the MCP surface entirely, set `exportTypes.mcp = false` in its registration.
- Any deployment exposing MCP to browsers beyond loopback should enable CORS with an explicit (non-`*`) allow-list to activate DNS-rebinding protection.
