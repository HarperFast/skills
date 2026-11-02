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
  sourceCommit: 179def6d5df976cf0a6b2bec24908ecfde993c22
  inputHash: 0268d6ede5741225
---

# Enabling and Configuring Harper MCP Server Profiles

Instructions for the agent to enable and configure Harper's MCP server profiles (`operations` and `application`) in `harper-config.yaml`.

## When to Use

Apply this rule when adding MCP support to a Harper deployment so that LLM hosts (Claude Desktop, Cursor, Zed, custom agents) can discover and invoke Harper operations and resources. Use it when configuring rate limits, session lifecycle, allow/deny lists, or durable quota policies for either MCP profile. See [connecting-clients.md](connecting-clients.md) for wiring an MCP host to a running Harper instance.

## How It Works

1. **Enable profiles via `presence`**: A profile is enabled by the **presence** of its sub-block under `mcp:` — there is no separate `enabled` flag. Add an empty block for each profile you want active:

   ```yaml
   mcp:
     operations: {}
     application: {}
   ```

   - `operations` mounts at `/mcp` on the **operations server** (default port `9925`).
   - `application` mounts at `/mcp` on the **application HTTP server** (default port `9926`).

2. **Configure the operations profile** (`mcp.operations.*`): Control which operations are exposed as MCP tools.

   | Key         | Type            | Default                                                                                                                                             | Purpose                                                    |
   | ----------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
   | `mountPath` | `string`        | `/mcp`                                                                                                                                              | URL path for the endpoint                                  |
   | `allow`     | `array<string>` | `['describe_*', 'list_*', 'search_*', 'get_job', 'get_status', 'get_analytics', 'get_metrics', 'system_information', 'read_log', 'read_audit_log']` | Operations exposed as tools; **replaces** the default list |
   | `deny`      | `array<string>` | `[]`                                                                                                                                                | Operations filtered out after `allow` is applied           |
   | `maxTools`  | `integer`       | `200`                                                                                                                                               | Max tools per `tools/list` page                            |

   Setting `mcp.operations.allow` **replaces** the default list entirely — it does not merge. To expose destructive operations (e.g. `set_configuration`, `drop_table`), add them explicitly. Do not add `get_*` as a glob — it exposes `get_configuration` (which can return TLS / S3 / authentication secrets) and other sensitive operations. Opt them in deliberately.

3. **Configure the application profile** (`mcp.application.*`): Controls the endpoint that walks your exported `Resource` classes.

   | Key                | Type      | Default | Purpose                                                            |
   | ------------------ | --------- | ------- | ------------------------------------------------------------------ |
   | `searchMaxResults` | `integer` | `1000`  | Hard cap on records a `search_<resource>` tool can return per call |

   All `mcp.operations.*` keys (`mountPath`, `allow`, `deny`, `maxTools`, `rateLimit.*`) also apply to `mcp.application`. Components can publish their own content under author-chosen URIs with a static `mcpResources` array.

4. **Set rate limits** (`mcp.<profile>.rateLimit.*`): Token-bucket limits apply per `(session, tool)` pair and per session across all tools. Exhausted buckets return `result.isError = true` with `kind: "rate_limited"` — not a JSON-RPC transport error — so the LLM can back off gracefully. See [rate-limiting.md](rate-limiting.md) for broader context.

   | Key                   | Type      | Default (operations / application)  | Purpose                                                           |
   | --------------------- | --------- | ----------------------------------- | ----------------------------------------------------------------- |
   | `perToolPerSecond`    | `number`  | `10` / `25`                         | Sustained per-tool refill rate; `0` disables                      |
   | `perToolBurst`        | `number`  | `20` / `50`                         | Burst capacity of the per-tool bucket                             |
   | `sessionConcurrency`  | `integer` | `25` / `50`                         | Max concurrent `tools/call` per session                           |
   | `sessionPerSecond`    | `number`  | `100` / `200`                       | Sustained per-session rate across all tools                       |
   | `perClientPerSecond`  | `number`  | `0` (disabled)                      | Sustained rate keyed on client identity (5.2.0+)                  |
   | `perClientBurst`      | `number`  | `perClientPerSecond` floored at `1` | Burst capacity of the per-client bucket                           |
   | `initializePerSecond` | `number`  | `10`                                | Sustained session-creation rate per client identity; `0` disables |
   | `initializeBurst`     | `number`  | `50`                                | Burst capacity of the `initialize` bucket                         |
   | `identityHeader`      | `string`  | unset (socket IP)                   | Trusted header supplying client identity (e.g. `x-forwarded-for`) |
   - `perClientPerSecond` survives session cycling — it is keyed on client identity, not session (5.2.0+).
   - `initializePerSecond` is **on by default**; a denied `initialize` returns HTTP `429` with a `Retry-After` header and a JSON-RPC error body; no session is created.
   - Only set `identityHeader` when the fronting proxy strips or replaces it on untrusted traffic.

5. **Configure session lifecycle** (`mcp.session.*`):

   | Key                  | Type      | Default | Purpose                                                                 |
   | -------------------- | --------- | ------- | ----------------------------------------------------------------------- |
   | `idleTimeoutSeconds` | `integer` | `1800`  | TTL for idle session records in `system.mcp_session`                    |
   | `allowClientDelete`  | `boolean` | `false` | When `true`, accepts client-issued `DELETE /mcp` to terminate a session |

6. **Register a durable quota handler** (optional, `5.2.0+`): Call `server.setMcpQuotaHandler(handler)` in a component to enforce durable per-identity quotas that survive rate-limit bypasses (e.g. session cycling). The handler runs **after** in-memory buckets admit the call. Keep any backing table unexported (no `@export`) so it is invisible to all transports.

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

   - Return `true` to allow; return `{ allowed: false, message?, retryAfterSeconds? }` to deny.
   - Denials surface as `isError` tool result with `kind: 'quota_exceeded'`.
   - **Fail-closed**: a handler that throws **denies** the call.
   - Pass `undefined` to clear the handler. The latest registration wins.
   - Race-safety (concurrent calls for the same identity) is the handler's responsibility.

7. **Secure Origin validation**: The MCP endpoint validates the `Origin` header to defend against DNS-rebinding attacks. Rules:
   - CORS disabled or `*` allow-list → any `Origin` is accepted.
   - CORS enabled with an explicit allow-list → `Origin` not in the list returns `403 Forbidden`.
   - No `Origin` header (e.g. `curl` or server-to-server traffic) → always accepted.

   Configure CORS on each profile's existing settings:
   - Application profile: `http.cors` + `http.corsAccessList`
   - Operations profile: `operationsApi.network.cors` + `operationsApi.network.corsAccessList`

   Any deployment exposing MCP to browsers beyond loopback must enable CORS with an explicit (non-`*`) allow-list to activate Origin-based protection.

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

**Denied `initialize` response (HTTP 429):**

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

## Notes

- Both profiles accept any `Origin` out of the box; tighten CORS before exposing MCP endpoints to browsers.
- `mcp.operations` serves on port `9925`; `mcp.application` serves on port `9926`.
- Numeric rate-limit values accept quoted strings (`"0.5"`) as well as plain numbers in `harper-config.yaml`.
- In-memory rate-limit state is per-worker and does not survive restarts; use `server.setMcpQuotaHandler(handler)` for durable quotas.
- The `allow` list for `mcp.operations` is shared with the built-in agent when `agent.enabled` is on — widening it also widens what the agent can call autonomously.
- To exclude a Resource from the MCP surface entirely, set `exportTypes.mcp = false` in its registration.
- See [connecting-clients.md](connecting-clients.md) for configuring MCP host clients to connect to these endpoints.
- See [rate-limiting.md](rate-limiting.md) for broader rate-limiting context.
