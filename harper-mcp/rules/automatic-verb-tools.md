---
name: automatic-verb-tools
description: How Harper auto-generates CRUD MCP tools from exported tables, with RBAC filtering and allow/deny/maxTools controls.
metadata:
  mode: synthesized
---

# Automatic Verb Tools

The zero-code tool surface: every `@export`ed table becomes a family of CRUD tools on the application profile.

## When to Use

Use this skill when deciding what an MCP client will see for a given schema, when tools are unexpectedly missing from `tools/list`, or when trimming a large generated surface.

## How It Works

1. **Generation.** For each exported table `Widget`, the application profile registers `get_Widget`, `search_Widget`, `create_Widget`, `update_Widget`, and `delete_Widget` tools. Names preserve the Resource path's case (`/` and `.` become `_`, other non-identifier characters are dropped); path collisions get a deterministic database-name prefix. Input/output schemas are derived from the table's typed attributes, so clients get real parameter validation and result shapes.
2. **RBAC is enforced, twice.** `tools/list` is filtered per authenticated user (a user with no read permission on a table does not see its `get_`/`search_` tools), and calls run through the same permission enforcement as REST — including per-record `allow*` predicates on Resource subclasses. This is the key contrast with [custom tools](custom-mcp-tools.md), which are visible to everyone.
3. **`exportTypes` gating.** A Resource registered with `exportTypes: { mcp: false }` is excluded from MCP enumeration entirely, independent of its REST exposure.
4. **Surface controls.** On the application profile, trim per Resource with `exportTypes: { mcp: false }`; `maxTools` sets the `tools/list` page size (default 200, cursor pages overflow). The `allow`/`deny` glob filters belong to the **operations** profile's tool generation, not this one. Prefer trimming to what the AI actually needs — every tool costs client context.
5. **Live registration.** The tool registry rebuilds lazily when the underlying Resource registry changes (schema changes, deploys, components that finish loading after boot), so tools stay in sync without restarts; connected sessions receive `notifications/tools/list_changed` when their visible set actually changes.

## Examples

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
