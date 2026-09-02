---
name: automatic-apis
description: How to use Harper's automatically generated REST and WebSocket APIs.
metadata:
  mode: generate
  sources:
    - reference/v5/rest/overview.md#How the REST Interface Works
    - reference/v5/rest/overview.md#Configuration
    - reference/v5/rest/overview.md#Tables and Their Automatic Endpoints
    - reference/v5/rest/overview.md#URL Structure
    - reference/v5/rest/overview.md#HTTP Methods
    - reference/v5/rest/overview.md#Content Types
    - reference/v5/rest/overview.md#OpenAPI
    - reference/v5/rest/websockets.md
  sourceCommit: 0d151a2c1f8d3988aef4dc6fc7deaa3e13f13589
  inputHash: 332ac95b82a25006
---

# Automatic REST and WebSocket APIs

Instructions for the agent to enable and use Harper's automatically generated REST and WebSocket APIs for exported tables and resources.

## When to Use

Apply this rule when adding REST or WebSocket access to a Harper table or custom resource. Use it whenever you need to configure endpoints, handle HTTP methods, implement real-time subscriptions, or understand caching behavior for Harper-served resources.

## How It Works

### 1. Enable REST in `config.yaml`

Add `rest: true` to the application's `config.yaml`. Without this line, no REST endpoints are registered for the application (unless the component directory has no config file at all, in which case Harper's built-in default enables REST automatically).

```yaml
rest: true
```

Optional settings:

```yaml
rest:
  lastModified: true # enables Last-Modified response header support
  webSocket: false # disables automatic WebSocket support (enabled by default)
```

### 2. Export the Table with `@export`

Mark the table type with `@export` in the schema. Harper registers no REST route without it — callers receive `404`.

```graphql
type Product @table @export {
	id: Long @primaryKey
	name: String
	price: Float
}
```

Both `@export` in the schema **and** `rest: true` in config are required. Neither is sufficient alone.

### 3. Reference the Auto-Generated Endpoints

With both in place, Harper serves the following endpoints on the application HTTP server port (default `9926`). No route definitions or handler code are required.

| Endpoint                     | Description                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `GET /Product`               | Resource description — table name, database, declared attributes                     |
| `GET /Product/`              | Record collection; append query parameters to search, filter, sort, page             |
| `GET /Product/{id}`          | Single record by primary key; `404` if not found                                     |
| `GET /Product/{id}.property` | Single declared property of one record                                               |
| `POST /Product/`             | Creates a record; responds `201`; primary key returned in `Location` header          |
| `PUT /Product/{id}`          | Creates or replaces record at `{id}` (upsert); omitted properties are removed        |
| `PATCH /Product/{id}`        | Shallow-merges body into existing record; unspecified top-level properties preserved |
| `DELETE /Product/{id}`       | Deletes the record at `{id}`                                                         |
| `DELETE /Product/?query`     | Deletes every record matching the query                                              |

### 4. Understand URL Structure

The trailing slash is significant:

| Path                      | Addresses                                      |
| ------------------------- | ---------------------------------------------- |
| `/my-resource`            | The resource itself (metadata)                 |
| `/my-resource/`           | The collection of all records                  |
| `/my-resource/record-id`  | A specific record by primary key               |
| `/my-resource/record-id/` | Collection of records with the given id prefix |

### 5. Use Conditional Requests for Caching

GET responses include an `ETag` header encoding the record's version/last-modification time. Send `If-None-Match` on subsequent requests with the cached `ETag` value. If the record is unchanged, Harper returns `304 Not Modified` with no body, avoiding serialization and transfer overhead.

### 6. Handle `POST` Location and `@updatedTime`

On a successful `POST`, the new record's primary key is returned in the `Location` response header (the bare key value, not a URL). On `PUT`, Harper always re-stamps any `@updatedTime` attribute with the time of the write, preserves any `@createdTime` value from the original record, and forces the primary key to match the `{id}` in the URL.

### 7. Select Content Types

Use the `Accept` header to request a specific response format. Harper supports formats including JSON, CBOR, and `.msgpack`. The suffixes `.json`, `.cbor`, `.msgpack`, and `.csv` on a property path are reserved as content-type selectors and take precedence over property names.

See [querying-rest-apis.md](querying-rest-apis.md) for the full query syntax used with collection endpoints.

### 8. Connect via WebSocket

WebSocket support is enabled automatically with `rest: true`. Disable it explicitly with `webSocket: false`. Connect to a resource URL to subscribe to change events:

```javascript
let ws = new WebSocket('wss://server/my-resource/341');
ws.onmessage = (event) => {
	let data = JSON.parse(event.data);
};
```

Connecting subscribes to the resource at that path. When the record changes or a message is published to it, the WebSocket connection receives the update.

See [real-time-apps.md](real-time-apps.md) for implementing custom `connect()` handlers and advanced real-time patterns.

## Examples

### Schema and config for a REST-enabled table

```graphql
# schema.graphql
type Product @table @export {
	id: Long @primaryKey
	name: String
	price: Float
}
```

```yaml
# config.yaml
graphqlSchema:
  files: schema.graphql
rest: true
```

### Conditional GET with ETag caching

```
GET /Product/123
# Response includes:
# ETag: "abc123"

GET /Product/123
If-None-Match: "abc123"
# Response: 304 Not Modified
```

### POST and read the Location header

```
POST /Product/
Content-Type: application/json

{ "name": "Widget", "price": 9.99 }

# Response:
# 201 Created
# Location: <generated-primary-key>
```

### PATCH — shallow merge only

```
PATCH /Product/123
Content-Type: application/json

{ "price": 12.99 }
```

Only `price` is updated; `name` and other top-level properties are preserved. Nested objects in the body replace the stored sub-object entirely — deep merge does not occur.

### WebSocket subscription

```javascript
let ws = new WebSocket('wss://server/Product/123');
ws.onmessage = (event) => {
	let data = JSON.parse(event.data);
};
```

### Disable WebSocket while keeping REST

```yaml
rest:
  webSocket: false
```

### OpenAPI specification endpoint

```
GET /openapi
```

Returns the auto-generated OpenAPI spec for all non-hidden exported resources.

## Notes

- `HEAD` is served as `GET` with the body omitted. `QUERY` is accepted on the collection path and reads its search from the request body.
- A `POST` to a key that already exists fails with `409` — it does not overwrite.
- `POST /Product` (no trailing slash) returns `404`; the trailing slash is required for collection operations.
- Server-Sent Events subscriptions are served on the same paths, negotiated via `Accept: text/event-stream`. They are included with `rest` and are unaffected by the `webSocket` option.
- A component directory with **no** `config.yaml` inherits Harper's built-in default, which enables `rest` and loads `*.graphql` automatically. Once any `config.yaml` exists, it is used verbatim — add `rest: true` explicitly.
- Types marked `@hidden` or programmatic resources with `static hidden = true` are excluded from the generated OpenAPI document.
- Leaving `@export` on a schema type while also exporting a same-named subclass produces conflicting endpoints — omit `@export` from the schema when a subclass should own the route.
