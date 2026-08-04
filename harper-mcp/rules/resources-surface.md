---
name: resources-surface
description: The MCP resources surface - harper:// metadata URIs, harper+rest:// table descriptors, templates, subscriptions, and list_changed notifications.
metadata:
  mode: synthesized
---

# Resources Surface

What `resources/list`, `resources/read`, `resources/templates/list`, and `resources/subscribe` expose from a Harper instance.

## When to Use

Use this skill when an MCP client should _read_ from Harper (schemas, API descriptions, data descriptors) rather than call tools, or when wiring change notifications.

## How It Works

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

## Examples

Reading a table's schema as an AI-consumable resource:

```json
→ {"method":"resources/read","params":{"uri":"harper://schema/data/widget"}}
← {"result":{"contents":[{"uri":"harper://schema/data/widget","mimeType":"application/json",
    "text":"{\"attributes\":[{\"name\":\"id\",\"type\":\"ID\"},...]}"}]}}
```

Point a client at `harper://openapi` when it needs the whole REST contract in one read.
