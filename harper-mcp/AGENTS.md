# Harper MCP

Guidelines for exposing a Harper instance as a Model Context Protocol (MCP) server and for building the tools, prompts, and resources AI clients consume. Harper implements MCP Streamable HTTP (spec rev 2025-06-18) with two independent profiles: `application` (your app's surface) and `operations` (Harper administration).

## 1. Setup & Connection

### 1.1 Enabling and Configuring Harper MCP Server Profiles

Instructions for the agent to enable and configure Harper's MCP server profiles (`operations` and `application`) in `harper-config.yaml`.

#### When to Use

Apply this rule when adding MCP support to a Harper deployment so that LLM hosts (Claude Desktop, Cursor, Zed, custom agents) can discover and invoke Harper operations and resources. Use it when configuring rate limits, session lifecycle, allow/deny lists, or durable quota policies for either MCP profile. See [connecting-clients.md](connecting-clients.md) for wiring an MCP host to a running Harper instance.

#### How It Works

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

#### Examples

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

#### Notes

- Port defaults: operations profile → `9925`; application profile → `9926`.
- `perClientPerSecond` is available in `5.2.0+`. In-memory buckets are per-worker and do not survive restarts or sync across workers.
- The `mcp.operations.allow` list also governs the built-in agent's available tools when `agent.enabled` is set — widening it affects agent behavior, not just MCP clients.
- Denials from `setMcpQuotaHandler` surface as `kind: 'quota_exceeded'` in the tool result. The raw handler error is written to the server log only; clients receive a sanitized message.
- To exclude a Resource from the MCP surface entirely, set `exportTypes.mcp = false` in its registration.
- Any deployment exposing MCP to browsers beyond loopback should enable CORS with an explicit (non-`*`) allow-list to activate DNS-rebinding protection.

### 1.2 Connecting Clients

The wire-level contract an MCP client (or your own HTTP code) must follow against a Harper MCP endpoint.

#### When to Use

Use this skill when configuring an MCP client against Harper, writing integration tests that drive `/mcp` directly, or debugging 400/404 responses from the endpoint.

#### How It Works

Harper implements MCP **Streamable HTTP** (spec rev 2025-06-18; rev 2025-03-26 also accepted):

1. **Initialize.** POST a JSON-RPC `initialize` to the mount path with `Accept: application/json, text/event-stream`. The response carries the negotiated `protocolVersion`, the server's capabilities, and — critically — an `Mcp-Session-Id` response header.
2. **Session header.** Every subsequent request MUST send that `Mcp-Session-Id` back. Missing/unknown ids get 400/404 (a 404 means re-initialize — sessions idle out after `mcp.session.idleTimeoutSeconds`, default 30 minutes).
3. **Protocol-version header.** Requests after initialize should send `MCP-Protocol-Version: <negotiated version>`. A header naming a _different_ supported version than the session negotiated is rejected (400). A **missing** header is accepted as the session's own negotiated version (5.2.0+, patched into 5.1.x; older 5.1 releases treated a missing header as `2025-03-26` and rejected it as a mismatch on `2025-06-18` sessions).
4. **Server-push SSE.** A GET on the mount path (with `Accept: text/event-stream`) opens the server→client stream used for `notifications/*/list_changed`, resource-update notifications, progress, and server-initiated requests. Some flows require it: `resources/subscribe` is rejected until the session has an open SSE stream.
5. **Authentication.** Standard Harper authentication applies (Basic auth, tokens, mTLS — whatever the instance is configured with). Anonymous sessions are accepted when the deployment allows them; see the [Security Posture](security-posture.md) skill for what anonymous callers can reach.

#### Examples

Full curl handshake:

```bash
# 1. initialize — capture the session id from the response headers
curl -si http://localhost:9926/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -u admin:password \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-06-18","capabilities":{},
        "clientInfo":{"name":"my-client","version":"1.0"}}}'
# → 200, header: Mcp-Session-Id: <uuid>

# 2. subsequent calls carry the session + protocol headers
curl -s http://localhost:9926/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'mcp-session-id: <uuid>' \
  -H 'mcp-protocol-version: 2025-06-18' \
  -u admin:password \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

Claude Desktop / MCP-client configuration is just the URL (plus auth): point a Streamable HTTP transport at `http://<host>:9926/mcp`.

Debugging cheat sheet:

- `400 missing Mcp-Session-Id header` — you skipped step 2.
- `404` on a previously working session — idle timeout; re-initialize.
- `400 MCP-Protocol-Version mismatch` — you sent a header naming a different version than the session negotiated.
- `406` — missing the required `Accept` media type (JSON for POST, `text/event-stream` for GET).
- `403 origin_not_allowed` — browser-origin request rejected by CORS-tied origin validation; see [Security Posture](security-posture.md).

## 2. Tools & Prompts

### 2.1 Automatic Verb Tools

The zero-code tool surface: every `@export`ed table becomes a family of CRUD tools on the application profile.

#### When to Use

Use this skill when deciding what an MCP client will see for a given schema, when tools are unexpectedly missing from `tools/list`, or when trimming a large generated surface.

#### How It Works

1. **Generation.** For each exported table `Widget`, the application profile registers `get_Widget`, `search_Widget`, `create_Widget`, `update_Widget`, and `delete_Widget` tools. Names preserve the Resource path's case (`/` and `.` become `_`, other non-identifier characters are dropped); path collisions get a deterministic database-name prefix. Input/output schemas are derived from the table's typed attributes, so clients get real parameter validation and result shapes.
2. **RBAC is enforced, twice.** `tools/list` is filtered per authenticated user (a user with no read permission on a table does not see its `get_`/`search_` tools), and calls run through the same permission enforcement as REST — including per-record `allow*` predicates on Resource subclasses. This is the key contrast with [custom tools](custom-mcp-tools.md), which are visible to everyone.
3. **`exportTypes` gating.** A Resource registered with `exportTypes: { mcp: false }` is excluded from MCP enumeration entirely, independent of its REST exposure.
4. **Surface controls.** On the application profile, trim per Resource with `exportTypes: { mcp: false }`; `maxTools` sets the `tools/list` page size (default 200, cursor pages overflow). The `allow`/`deny` glob filters belong to the **operations** profile's tool generation, not this one. Prefer trimming to what the AI actually needs — every tool costs client context.
5. **Live registration (5.1.18+).** The tool registry rebuilds lazily when the underlying Resource registry changes (schema changes, deploys, components that finish loading after boot), so tools stay in sync without restarts; connected sessions receive `notifications/tools/list_changed` when their visible set actually changes. On earlier 5.1.x, registration depends on schema-creation events — a restart on an existing data root can come up with an **empty custom-tool registry** (the tables already exist, so no event fires); upgrading is the fix.
6. **Plain `Resource` classes get partial tool families.** An exported non-table `Resource` subclass surfaces verb tools only for the REST verbs it actually has (typically a lone `create_*` from the base `post`). To host `mcpTools`/`mcpResources` without any verb surface, register the class via `server.resources.set(name, Class, { mcp: false })`-style exportTypes at registration — note a `static exportTypes` field on the class is NOT read.

#### Examples

```graphql
# schema.graphql
type Widget @table @export {
	id: ID @primaryKey
	name: String @indexed
	price: Float
}
```

With `mcp.application.mountPath` set, `tools/list` (as a user with read/write on Widget) includes:

```json
{ "name": "search_Widget", "inputSchema": { "properties": { "conditions": { "...": "..." } } } }
{ "name": "get_Widget", "inputSchema": { "properties": { "id": { "type": "string" } } } }
{ "name": "create_Widget", "...": "..." }
```

Excluding an exported Resource from MCP while keeping its REST surface — set the `mcp` exportType at registration (a `static exportTypes` field on the class is NOT read):

```javascript
server.resources.set('internal-thing', InternalThing, { mcp: false });
```

To expose read-only _data_, rely on RBAC: a role without write permissions never sees `create_`/`update_`/`delete_` tools for the table.

### 2.2 Custom MCP Tools

Instructions for the agent to follow when exposing custom instance methods as MCP tools via a static `mcpTools` array on a Resource class.

#### When to Use

Apply this rule when a component needs to expose non-verb instance methods as callable MCP tools. Use it whenever you need to add custom business logic (e.g., reconciliation, aggregation, side-effecting operations) to the MCP tool surface beyond the auto-generated verb tools.

#### How It Works

1. **Declare `mcpTools` on the Resource class**: Add a static `mcpTools` array to your Resource subclass. Each entry names the tool, maps it to an instance method, provides a description, and defines an `inputSchema`.

   ```javascript
   class Orders extends Tables.orders {
   	static mcpTools = [
   		{
   			name: 'reconcile_unsettled',
   			method: 'reconcileUnsettled',
   			description: 'Reconcile all orders flagged as unsettled and emit a summary',
   			inputSchema: {
   				type: 'object',
   				properties: { since: { type: 'string', description: 'ISO 8601 timestamp' } },
   			},
   		},
   	];

   	async reconcileUnsettled({ since }) {
   		/* ... */
   	}
   }
   ```

2. **Understand the security model — no automatic auth**: The MCP transport audits the `tools/call` but invokes the custom instance method directly. It does **not** open a Resource transaction or run an `allow*` gate automatically. Custom tools are exposed to any MCP session — including `anonymous`, unauthenticated ones. The tool is listed to every session and its method executes even when no user is logged in (`context.user` may be empty).

3. **Enforce access control inside the method**: Because no `allow*` gate runs automatically, access control is entirely the method's responsibility. Check `context.user` inside the method and throw when the caller doesn't qualify.

   ```javascript
   async reconcileUnsettled({ since }) {
     if (!context.user?.id) throw new Error('Authentication required');
     // role check example:
     if (!context.user.roles?.includes('finance')) throw new Error('Forbidden');
     /* ... */
   }
   ```

4. **Pass an armed context when delegating to static Resource operations**: The MCP-created instance context carries the authenticated user and a one-shot `authorize` flag. Use `this.getContext()` for the first delegated call:

   ```javascript
   const result = await Orders.get(target, this.getContext());
   ```

   For every subsequent delegated operation, set `target.checkPermission = true` on a `RequestTarget` so authorization derives from `context.user`, and pass `this.getContext()`:

   ```javascript
   target.checkPermission = true;
   const next = await Orders.get(target, this.getContext());
   ```

5. **Never accept `checkPermission` from tool arguments or client input**: Always set `target.checkPermission` in server-side code only. Do not read it from the tool's input arguments or any other client-supplied data.

#### Examples

Full class with a custom MCP tool that enforces authentication and delegates with proper context:

```javascript
class Orders extends Tables.orders {
	static mcpTools = [
		{
			name: 'reconcile_unsettled',
			method: 'reconcileUnsettled',
			description: 'Reconcile all orders flagged as unsettled and emit a summary',
			inputSchema: {
				type: 'object',
				properties: { since: { type: 'string', description: 'ISO 8601 timestamp' } },
			},
		},
	];

	async reconcileUnsettled({ since }) {
		// Enforce auth — context.user may be empty for anonymous sessions
		if (!context.user?.id) throw new Error('Authentication required');

		// First delegated operation uses the one-shot authorize flag
		const target = { checkPermission: true, since };
		const unsettled = await Orders.get(target, this.getContext());

		// Subsequent delegated operations set checkPermission server-side
		target.checkPermission = true;
		// ... further operations
	}
}
```

#### Notes

- Unlike auto-generated verb tools, which are RBAC-filtered per user at `tools/list` time and enforce table permissions on call, custom `mcpTools` entries bypass all of that — the method runs for any caller, including `anonymous` sessions.
- The `allow*` gates that protect standard verb operations do not apply to custom tools. All authorization logic must live inside the method itself, using `context.user`.
- The one-shot `authorize` flag on the MCP-created context is consumed by the first static Resource operation. Set `target.checkPermission = true` for every subsequent call.
- Consider applying [rate-limiting](rate-limiting.md) and [durable-quotas](durable-quotas.md) to custom tools that perform expensive or side-effecting operations, since no built-in throttling is applied automatically.

### 2.3 Custom MCP Prompts

Publish parameterized prompt templates that MCP clients surface to their users (slash-command style).

#### When to Use

Use this skill when your application wants to hand well-crafted, data-aware prompts to any connected AI client — "summarize this account", "draft a reply about order X" — instead of hoping each client writes a good one.

#### How It Works

1. **Declare `static mcpPrompts`** on a Resource class. Each entry carries a `render` **function** (not a method name):

```javascript
export class Support extends tables.Ticket {
	static mcpPrompts = [
		{
			name: 'draft_reply',
			title: 'Draft support reply',
			description: 'Draft a support reply for a ticket',
			arguments: [{ name: 'ticketId', description: 'Ticket to reply to', required: true }],
			async render(args) {
				const ticket = await Support.get(args.ticketId);
				if (!ticket) throw new Error(`ticket not found: ${args.ticketId}`);
				return {
					messages: [
						{
							role: 'user',
							content: { type: 'text', text: `Draft a courteous reply to: ${ticket.body}` },
						},
					],
				};
			},
		},
	];
}
```

2. **Entry shape.** `name` and `render` are required (invalid entries are skipped with a warning); `title`, `description`, and `arguments` (`{ name, description?, required? }`) are optional metadata surfaced to clients.
3. **Render contract.** `render(args)` receives the client-supplied argument values (strings) and returns the MCP prompt result shape — a `messages` array of `{ role, content }` entries (`content.type`: `text`, `image`, `audio`, or `resource`). It runs server-side and can read tables, so prompts can embed live data.
4. **Surface.** Prompts appear in `prompts/list` and render via `prompts/get`; declared arguments are served through `completion/complete`. Connected sessions get `notifications/prompts/list_changed` when the set changes (reload/deploy).
5. **Exposure.** Like custom tools, prompts are listed to every session on the profile, including anonymous ones — keep secrets out of prompt text and gate inside `render` if needed.

#### Examples

A data-aware prompt beats a static template: fetch current state (ticket, order, account) inside the render method so the client's LLM starts from live facts rather than asking for them turn by turn.

## 3. Resources

### 3.1 Resources Surface

What `resources/list`, `resources/read`, `resources/templates/list`, and `resources/subscribe` expose from a Harper instance.

#### When to Use

Use this skill when an MCP client should _read_ from Harper (schemas, API descriptions, data descriptors) rather than call tools, or when wiring change notifications.

#### How It Works

Three URI families appear on the application profile:

1. **`harper://` metadata resources** (no HTTP equivalent):
   - `harper://about` — server version, profile, protocol versions, capabilities (both profiles).
   - `harper://schema/{database}/{table}` — per-table attribute definitions, RBAC-filtered at read time (also offered as a URI template).
   - `harper://openapi` — the OpenAPI 3.0.3 document for the REST surface.
   - `harper://operations` — operations profile only; the caller's allowed operation names.
2. **`harper+rest://<host>:<port>/<path>` descriptors** — one per exported Resource passing the `exportTypes.mcp` gate. Reading one returns a small JSON descriptor (path, database, table, and a hint to use the corresponding verb tools for records) — it is a pointer, not a data dump. The scheme is `harper+rest` (5.1.18+) because the MCP spec reserves `https://` for resources a client can fetch from the web; legacy `http(s)://` URIs from older listings still read and subscribe.
3. **Author-defined custom resources** — arbitrary URIs/templates served by component code; see the [Custom MCP Resources](custom-mcp-resources.md) skill. Custom URIs take precedence over the discovered surfaces on `resources/read`.

Other behaviors:

- **Subscriptions.** Row-backed application resources support `resources/subscribe` (change notifications delivered on the SSE stream). The session must have its GET SSE stream open first — subscribe calls before that are rejected with an instructive error. Subscriptions are restored on session resume.
- **`notifications/resources/list_changed`.** Sessions are notified when their _visible_ resource set (including templates) actually changes — per-session diffing keeps no-op rebuilds silent.
- **Pagination.** All list endpoints use opaque cursors per the MCP spec; treat `nextCursor` as a black box.

#### Examples

Reading a table's schema as an AI-consumable resource:

```json
→ {"method":"resources/read","params":{"uri":"harper://schema/data/widget"}}
← {"result":{"contents":[{"uri":"harper://schema/data/widget","mimeType":"application/json",
    "text":"{\"attributes\":[{\"name\":\"id\",\"type\":\"ID\"},...]}"}]}}
```

Point a client at `harper://openapi` when it needs the whole REST contract in one read.

### 3.2 Custom MCP Resources

Serve author-defined content — documentation pages, rendered reports, binary assets — under your own URIs (5.1.18+).

#### When to Use

Use this skill to build a content surface for AI clients: a public docs server over MCP, per-entity report resources, or any read-oriented content the auto-generated descriptors can't express.

#### How It Works

1. **Declare `static mcpResources`** on a Resource class. Each entry has exactly one of `uri` (fixed) or `uriTemplate`, plus a `method` naming the instance method that serves reads:

```javascript
export class DocsPages extends Resource {
	static mcpResources = [
		{
			uri: 'docs:///index',
			name: 'docs index',
			description: 'List of all documentation pages',
			mimeType: 'text/markdown',
			method: 'readIndex',
		},
		{
			uriTemplate: 'docs:///{+path}',
			name: 'docs page',
			mimeType: 'text/markdown',
			method: 'readPage',
			completions: { path: ['guides/install.md', 'guides/deploy.md'] },
		},
	];

	async readIndex() {
		return { text: '- docs:///guides/install.md\n…', mimeType: 'text/markdown' };
	}

	async readPage(params /* { path } */, context /* { user, profile, sessionId } */) {
		// {+path} spans segments BY DESIGN (it can contain `/` and `..`), so never
		// hand it to filesystem path construction unvalidated. A keyed lookup like
		// this is inherently safe; if you must touch the filesystem, resolve and
		// verify containment first.
		const page = PAGES.get(params.path);
		if (!page) throw new Error(`no such page: ${params.path}`);
		return { text: page, mimeType: 'text/markdown' };
	}
}
```

2. **Templates.** `{name}` matches exactly one path segment; `{+name}` matches across segments (RFC-6570-style reserved expansion — how MCP clients expand templates). The single-segment contract is enforced through percent-decoding: a URI smuggling an encoded separator (`%2F`/`%5C`) into a `{name}` slot simply fails to match, so `{name}` is safe to use in path construction. Duplicate parameter names are rejected at registration.
3. **Schemes.** Pick a custom scheme (`docs:///…` above). The reserved schemes — `harper:`, `harper+rest:`, `http:`, `https:` — are rejected at registration (and a template cannot parameterize the scheme position), so custom entries can never shadow the built-in surfaces.
4. **Content shapes.** The read method returns a string (text), `{ text, mimeType? }`, `{ blob, mimeType? }` (base64 binary), or any other object (serialized as JSON). Read errors surface to the client as a sanitized JSON-RPC error; the raw error goes to the server log only.
5. **Listing and completion.** Fixed URIs appear in `resources/list`, templates in `resources/templates/list`; declared `completions` values serve `completion/complete` per template parameter. Custom URIs win over the discovered surfaces on `resources/read`.
6. **Anonymous by design.** Custom resources are served to any session — including unauthenticated ones (the public-docs case this feature targets). The MCP layer performs no auth check for them; gate inside the read method (`context.user`) if content is restricted.
7. **No tables required.** A tableless component's resources register reliably — the registry rebuilds lazily per request when component loading completes after boot.

#### Examples

Public docs server: the two-entry declaration above plus `mcp.application.mountPath` is the whole server — clients browse `resources/list`, complete paths, and read pages, all anonymous. Pair with [Rate Limiting](rate-limiting.md) and [Durable Quotas](durable-quotas.md) if any companion tools bear cost.

## 4. Operations & Security

### 4.1 Rate Limiting MCP Tool Calls

Instructions for the agent to follow when configuring per-tool, per-session, and per-client-identity token-bucket rate limits on Harper MCP profiles.

#### When to Use

Apply this rule when configuring `mcp.<profile>.rateLimit.*` keys to throttle `tools/call` invocations. Use it when you need to protect a worker from runaway sessions, prevent session-cycling abuse via per-client buckets, or control the rate of session creation via `initialize` limits.

#### How It Works

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

#### Examples

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

#### Notes

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

### 4.2 Durable Quotas

Persisted, restart-surviving cost controls for `tools/call`, registered as a plain function in your component code (5.2.0+).

#### When to Use

Use this skill when in-memory [rate limiting](rate-limiting.md) is not enough as a cost control — typically a public, unauthenticated, cost-bearing tool (an LLM-backed `answer`) where you need "N calls per identity per day" semantics that survive restarts and span workers.

#### How It Works

1. **Register a handler function** with `server.setMcpQuotaHandler` at component load — the policy is a **function**, never an exposed Resource. It is opt-in: no handler registered means calls are allowed. The latest registration wins, so a reloaded component replaces the previous handler; pass `undefined` to clear it.
2. **The handler is called before each admitted `tools/call`** with `{ identity, tool, user, profile, sessionId }` (`identity` is the client identity from the rate-limit layer — socket IP or trusted-header value — and may be `undefined`). Return `true` (or any truthy non-object) to allow, or `{ allowed: false, message?, retryAfterSeconds? }` to deny; denials surface as `isError` tool results with `kind: 'quota_exceeded'` plus your `message`/`retryAfterSeconds`.
3. **Gate per profile in code.** The single handler receives `profile`, so branch on it (e.g. `if (profile !== 'application') return true`) rather than configuring per-profile hooks.
4. **Ordering.** The handler runs _after_ the in-memory buckets admit the call, so rate-limited clients cannot spam a table-backed handler.
5. **Fail-closed.** A handler that throws **denies** the call — the raw error goes to the server log only; the client sees a sanitized message. Cost protection that silently disables itself on a bug is worse than a hard failure. Harper calls the handler once per attempted tool call; whether you count on check or on success is your business.
6. **Race-safety is your handler's business.** It can run concurrently for the same identity — within a worker (interleavings across your own `await`s) and across workers. A naive `get` → `put used+1` counter undercounts under concurrency and admits calls past the limit; make the read-modify-write atomic (a transaction that serializes conflicting writers, a compare-and-set retry loop, or a store with native atomic increments).

#### Examples

Persisted per-identity counter backed by an **internal** table (schema + registration):

```graphql
# schema.graphql — INTERNAL counter. No @export, so no client can read or reset it.
type QuotaCounter @table {
	id: ID @primaryKey
	used: Int
}
```

```javascript
// resources.js
const DAILY_LIMIT = 100;

// The cost-bearing tool clients call (exported — this is the public surface).
export class Answerer extends Resource {
	static mcpTools = [{ name: 'answer', description: 'Answer a question', method: 'doAnswer' }];
	async doAnswer(args) {
		return { answered: args?.q ?? '' };
	}
}

// Register the durable quota policy as a function, backed by the internal counter table.
server.setMcpQuotaHandler(async ({ identity, tool, user, profile, sessionId }) => {
	if (profile !== 'application') return true; // gate per profile in code
	const id = identity ?? 'unknown';
	// NOTE: naive get-then-put shown for shape; production code must make this
	// read-modify-write atomic (see Race-safety above).
	const existing = await tables.QuotaCounter.get(id);
	const used = (existing?.used ?? 0) + 1;
	await tables.QuotaCounter.put({ id, used });
	if (used > DAILY_LIMIT) {
		return { allowed: false, message: 'daily quota reached', retryAfterSeconds: 3600 };
	}
	return true;
});
```

Because the policy is a plain function and not a Resource, it exposes no `update_/delete_` MCP tools or REST surface — unlike an exported class, whose inherited CRUD would let a permitted client reset its own counter. Keep the storage table **unexported** (no `@export`) so it stays off every transport.

Also verify the handler actually runs (call the tool past the limit once): on Harper versions before 5.2.0 `server.setMcpQuotaHandler` is unavailable — see [Enabling MCP](enabling-mcp.md).

### 4.3 Security Posture

What is and is not protected on a Harper MCP endpoint, and the checklist for exposing one publicly.

#### When to Use

Read this skill before exposing any MCP profile beyond localhost, and when reasoning about what an anonymous or low-privilege caller can reach.

#### How It Works

1. **Authentication is Harper's, not MCP's.** The MCP layer adds no login gate. Sessions bind to whatever user Harper's auth pipeline resolves — which can be nobody: anonymous sessions initialize, list, and call successfully where the deployment allows unauthenticated requests.
2. **Two different tool trust models.** Auto-generated verb tools are RBAC-filtered per user and enforce table permissions (including per-record `allow*` predicates) on every call. Custom `mcpTools` / `mcpPrompts` / `mcpResources` are exposed to **every** session — access control is entirely the author's method's responsibility. Never assume a custom tool is login-gated.
3. **Origin validation (DNS-rebinding defense).** Browser-origin requests are validated against Harper's CORS configuration; a disallowed `Origin` gets 403. The secure default for anything browser-reachable beyond loopback: enable CORS with an explicit allow-list (`http.cors` + `http.corsAccessList` for the application profile; `operationsApi.network.*` for operations). CORS off means origin checks are off — appropriate only for localhost/non-browser clients.
4. **Error hygiene.** Tool and resource errors cross the wire as sanitized messages; stack traces and raw author errors stay in the server log.
5. **Audit.** Every `tools/call` (including rate-limited, quota-denied, and protocol-error outcomes) emits an audit entry — profile, session, tool, user, duration, status, with sensitive-looking argument keys redacted.
6. **Template safety.** Custom resource URI templates enforce their single-segment contract against encoded-separator smuggling, and custom URIs cannot claim reserved schemes — see [Custom MCP Resources](custom-mcp-resources.md).

#### Examples

Hardening checklist for a public application-profile endpoint:

- [ ] Every custom tool/prompt/resource either tolerates anonymous callers or checks `context.user` and throws.
- [ ] `rateLimit.perClientPerSecond` set (session limits alone are cycle-evadable); `identityHeader` only if the proxy strips it.
- [ ] A durable `quota` hook backs any cost-bearing tool ([Durable Quotas](durable-quotas.md)), with an atomic counter.
- [ ] CORS allow-list configured if browsers will reach the endpoint.
- [ ] The tool surface is trimmed to what the AI needs: `exportTypes: { mcp: false }` on internal Resources (application), a deliberate `allow` list (operations — remember it replaces the read-only default).
- [ ] Audit log shipping somewhere you actually read.
- [ ] Version verified (`serverInfo.version` ≥ the feature gates you rely on) and each protection **proven to deny once** — older versions accept and silently ignore `rateLimit.perClient*` / `quota.*` keys.
- [ ] The quota hook's table is not itself exposed — register it via `server.resources.set('McpQuota', McpQuota, { mcp: false, rest: false })` instead of module-exporting it (a `static exportTypes` field is not read); otherwise clients can reset their own counters.
