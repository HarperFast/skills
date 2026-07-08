# Harper Best Practices

Guidelines for exposing a Harper instance as a Model Context Protocol (MCP) server and for building the tools, prompts, and resources AI clients consume. Harper implements MCP Streamable HTTP (spec rev 2025-06-18) with two independent profiles: `application` (your app's surface) and `operations` (Harper administration).

## 1. Setup & Connection

### 1.1 Enabling MCP

Instructions for exposing a Harper instance as a Model Context Protocol (MCP) server.

#### When to Use

Use this skill when an AI client (Claude, an agent framework, or any MCP-capable tool) should talk to Harper directly — calling tools backed by your tables and Resources, reading data as MCP resources, or driving Harper operations.

#### How It Works

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

Each profile is independent — enable only what you need. Key per-profile options:

- `mountPath` — where the endpoint mounts. Required to enable the profile.
- `allow` / `deny` (operations profile only) — glob patterns or literal operation names selecting which operations become tools. The default is a deliberately read-only list; setting `allow` **replaces** it (no merge), so destructive operations like `set_configuration` must be opted in explicitly.
- `maxTools` — page size for `tools/list` responses (default 200); overflow pages via the MCP cursor.
- `rateLimit.*` — see the [Rate Limiting](rate-limiting.md) skill.
- `quota.*` — durable, operator-defined quotas; see the [Durable Quotas](durable-quotas.md) skill.

Version notes: the transport and tool surface shipped across 5.1.x (complete protocol surface — prompts, resources, subscriptions, completions, cancellation, progress — in 5.1.10+). Custom content resources (`mcpResources`) are 5.1.18+. Per-client rate limiting and durable quotas are 5.2.0+.

**Verify the version before relying on gated features.** Unsupported config keys (including the `rateLimit.perClient*` and `quota.*` security controls) are **accepted and silently ignored** by older versions — nothing errors, the feature just doesn't run. Check `serverInfo.version` in the `initialize` response (or read `harper://about`) first, and after configuring a limit, prove it denies at least once before trusting it.

#### Examples

Minimal application-profile setup for a project with `@export`ed tables:

```yaml
# harper-config.yaml
mcp:
  application:
    mountPath: /mcp
```

An MCP client pointed at `http://<host>:9926/mcp` then sees `get_*` / `search_*` / `create_*` / `update_*` / `delete_*` tools for every exported table, RBAC-filtered per authenticated user. See the [Connecting Clients](connecting-clients.md) skill for the handshake.

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
6. **Plain `Resource` classes get partial tool families.** An exported non-table `Resource` subclass surfaces verb tools only for the REST verbs it actually has (typically a lone `create_*` from the base `post`) — if you export a class purely to host `mcpTools`/`mcpResources`, consider `exportTypes: { mcp: false }`-gating its verb surface or not exporting REST verbs at all.

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

Excluding an exported Resource from MCP while keeping its REST surface:

```javascript
server.http(InternalThing, { name: 'internal-thing', exportTypes: { mcp: false } });
```

To expose read-only _data_, rely on RBAC: a role without write permissions never sees `create_`/`update_`/`delete_` tools for the table.

### 2.2 Custom MCP Tools

Expose non-CRUD operations — an LLM-backed `answer`, a domain action, a report generator — as first-class MCP tools.

#### When to Use

Use this skill when the auto-generated verb tools aren't enough: the AI should invoke _behavior_, not just CRUD. Also read it before shipping any custom tool on a publicly reachable instance — the security model differs from verb tools.

#### How It Works

1. **Declare `static mcpTools`** on a Resource class (typically in `resources.js`/`resources.ts`):

```javascript
export class Orders extends tables.Orders {
	static mcpTools = [
		{
			name: 'reconcile_unsettled',
			description: 'Reconcile all unsettled orders and return a summary',
			method: 'reconcileUnsettled',
			inputSchema: {
				type: 'object',
				properties: { since: { type: 'string', description: 'ISO 8601 timestamp' } },
			},
		},
	];

	async reconcileUnsettled(args, context) {
		// context: { user, profile, sessionId, signal, progress?, serverRequest? }
		return { reconciled: 12 };
	}
}
```

2. **Dispatch is live-class.** Calls construct an instance of the class currently in the Resource registry, so an exported subclass (and its access-control overrides) always wins after a reload/deploy.
3. **Per-call context.** The second argument carries `user`, `profile`, `sessionId`, an `AbortSignal` (`signal`) wired to MCP cancellation, and — on streaming calls — `progress()` and `serverRequest()`. Guard optional members (`context.progress?.(…)`).
4. **Results and errors.** Return values are wrapped into MCP tool results (objects become structured content). Thrown errors surface as `isError: true` tool results with the message only — stack traces stay in the server log.
5. **Security: custom tools are exposed to ANY session, including anonymous ones.** Unlike verb tools (RBAC-filtered per user), a custom tool is listed to every session and its method executes even with no logged-in user (`context.user` may be empty). The method runs inside the normal `transactional()` envelope, so data access it performs still hits per-record `allow*` predicates — but the _tool itself_ has no gate. To restrict one:

```javascript
async reconcileUnsettled(args, context) {
	if (!context.user?.username) {
		throw new Error('authentication required');
	}
	// ...
}
```

6. **Cost control for public tools.** A cost-bearing anonymous tool needs more than auth checks — see [Rate Limiting](rate-limiting.md) (per-client buckets survive session cycling) and [Durable Quotas](durable-quotas.md) (persisted per-identity limits).

#### Examples

Warn-worthy anti-pattern — a public instance with an expensive tool and no gating:

```javascript
static mcpTools = [{ name: 'answer', method: 'llmAnswer', ... }];
async llmAnswer(args) { return await callExpensiveModel(args.q); } // anonymous callers burn your budget
```

Fixed: check `context.user` (or accept anonymity deliberately) _and_ configure `rateLimit.perClientPerSecond` + a `quota` hook.

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
		return { text: loadPage(params.path), mimeType: 'text/markdown' };
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

### 4.1 Rate Limiting

In-memory token buckets that bound `tools/call` throughput per profile.

#### When to Use

Use this skill when tuning MCP throughput, and **always** when a tool is exposed on a public or anonymous-accessible instance — the default limits alone do not stop session-cycling abuse.

#### How It Works

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

#### Examples

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

### 4.2 Durable Quotas

Persisted, restart-surviving cost controls for `tools/call`, implemented by your code behind a config hook (5.2.0+).

#### When to Use

Use this skill when in-memory [rate limiting](rate-limiting.md) is not enough as a cost control — typically a public, unauthenticated, cost-bearing tool (an LLM-backed `answer`) where you need "N calls per identity per day" semantics that survive restarts and span workers.

#### How It Works

1. **Name a quota Resource in config:**

```yaml
mcp:
  application:
    quota:
      resource: McpQuota # exported Resource path
      # method: allowMcpCall   # optional; this is the default
```

2. **Implement the static method.** Before each admitted `tools/call`, Harper calls it with `{ identity, tool, user, profile, sessionId }` (`identity` is the client identity from the rate-limit layer — socket IP or trusted-header value — and may be `undefined`). Return `true` to allow, or `{ allowed: false, message?, retryAfterSeconds? }` to deny; denials surface as `isError` tool results with `kind: 'quota_exceeded'` plus your message.
3. **Ordering.** The hook runs _after_ the in-memory buckets admit the call, so rate-limited clients cannot spam a table-backed hook.
4. **Fail-closed.** A hook that throws — or a configured `resource`/`method` that doesn't resolve — **denies** the call (sanitized `quota policy unavailable` / `quota check failed`; raw error in the server log). Cost protection that silently disables itself on a bug is worse than a hard failure. The blast radius is `tools/call` only; list/read surfaces stay up.
5. **Race-safety is your hook's business.** It can run concurrently for the same identity — within a worker (interleavings across your own `await`s) and across workers. A naive `get` → `put used+1` counter undercounts under concurrency; make the read-modify-write atomic (a transaction that serializes conflicting writers, a compare-and-set retry loop, or a store with native atomic increments).

#### Examples

Persisted per-identity daily counter (schema + hook):

```graphql
type QuotaCounter @table {
	id: ID @primaryKey # identity
	used: Int
	day: String
}
```

```javascript
const DAILY_LIMIT = 100;

export class McpQuota extends tables.QuotaCounter {
	// The hook class must be exported to be config-addressable — which would
	// also surface update_/delete_McpQuota verb tools and a REST endpoint,
	// letting a permitted client RESET ITS OWN COUNTER. Keep the quota table
	// off the MCP surface and lock down its REST permissions.
	static exportTypes = { mcp: false };
	static async allowMcpCall({ identity, tool }) {
		const id = identity ?? 'unknown';
		const today = new Date().toISOString().slice(0, 10);
		// NOTE: naive get-then-put shown for shape; production code must make
		// this read-modify-write atomic (see Race-safety above).
		const existing = await McpQuota.get(id);
		const used = existing?.day === today ? existing.used + 1 : 1;
		await McpQuota.put({ id, used, day: today });
		if (used > DAILY_LIMIT) {
			return { allowed: false, message: 'daily quota reached', retryAfterSeconds: 3600 };
		}
		return true;
	}
}
```

The counter is a real table: operators can inspect or reset it over REST (subject to the permissions you set), and it survives restarts — an attacker who exhausted their quota stays exhausted after the process bounces.

Also verify the hook actually runs (call the tool past the limit once): on Harper versions before 5.2.0 the `quota.*` config keys are accepted and silently ignored — see [Enabling MCP](enabling-mcp.md).

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
- [ ] The quota hook's table is not itself exposed (`exportTypes: { mcp: false }` + restrictive REST permissions) — otherwise clients can reset their own counters.
