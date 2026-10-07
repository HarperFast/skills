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
  sourceCommit: 2cfb81318f17e0aca2d600109e6ad813d2d0443e
  inputHash: fc3e7ae596f475b2
---

# Automatic APIs

Instructions for the agent to follow when using Harper's automatically generated REST and WebSocket APIs for exported tables and resources.

## When to Use

Apply this rule when enabling HTTP REST endpoints or WebSocket subscriptions for Harper tables and custom resources. Use it whenever you need to configure the REST plugin, understand the auto-generated endpoint surface, or wire up real-time WebSocket connections. See [querying-rest-apis.md](querying-rest-apis.md) for query syntax and [real-time-apps.md](real-time-apps.md) for real-time patterns.

## How It Works

1. **Enable the REST plugin** by adding `rest: true` to your application's `config.yaml`:

   ```yaml
   rest: true
   ```

   Extended options:

   ```yaml
   rest:
     lastModified: true # enables Last-Modified response header support
     webSocket: false # disables automatic WebSocket support (enabled by default)
     exactCount: true # opt in to Prefer: count=exact scans (off by default)
   ```

2. **Export the table in your schema** using `@export`. Tables are not exposed by default — `@export` is required for Harper to register a REST route:

   ```graphql
   type Product @table @export {
   	id: Long @primaryKey
   	name: String
   	price: Float
   }
   ```

   Without `@export`, the table has no REST route and callers receive `404`. Without `rest: true` in `config.yaml`, even an exported table does not respond to HTTP requests.

3. **Understand the auto-generated endpoints**. With both `@export` and `rest: true` in place, Harper registers the following on the application HTTP server port (default `9926`):

   | Endpoint                     | Description                                                                          |
   | ---------------------------- | ------------------------------------------------------------------------------------ |
   | `GET /Product`               | Resource description — table name, database, declared attributes                     |
   | `GET /Product/`              | Record collection; append query parameters to filter, sort, page                     |
   | `GET /Product/{id}`          | Single record by primary key; `404` if not found                                     |
   | `GET /Product/{id}.property` | Single declared property of one record                                               |
   | `POST /Product/`             | Creates a record; responds `201`; primary key returned in `Location` header          |
   | `PUT /Product/{id}`          | Creates or replaces the record at `{id}` (upsert); omitted properties are removed    |
   | `PATCH /Product/{id}`        | Shallow-merges body into existing record; unspecified top-level properties preserved |
   | `DELETE /Product/{id}`       | Deletes the record at `{id}`                                                         |
   | `DELETE /Product/?query`     | Deletes every record matching the query                                              |
   - `HEAD` is served exactly as `GET` with the response body omitted. `QUERY` is accepted on the collection path (`QUERY /Product/`) and runs a search taken from the request body rather than the URL.

4. **Use the correct URL structure**. The trailing slash is significant:

   | Path                      | Addresses                                      |
   | ------------------------- | ---------------------------------------------- |
   | `/my-resource`            | The resource itself (metadata)                 |
   | `/my-resource/`           | The record collection                          |
   | `/my-resource/record-id`  | A specific record by primary key               |
   | `/my-resource/record-id/` | Collection of records with the given id prefix |

5. **Handle `POST` primary keys via `Location`**. On a successful `POST`, the new record's primary key is returned in the `Location` response header — the value supplied by the body, or a Harper-assigned key if the body omitted the primary-key property.

6. **Use conditional GET requests for caching**. GET responses include an `ETag` header. Send `If-None-Match` on subsequent requests; if the record is unchanged, Harper returns `304 Not Modified` with no body.

7. **Apply `@updatedTime` for write timestamps**. On `PUT`, Harper re-stamps any `@updatedTime` attribute with the time of the write, preserves any `@createdTime` value from the original record, and forces the primary key to match the `{id}` in the URL.

8. **Control OpenAPI visibility**. Every non-hidden exported resource appears in the generated OpenAPI document at `GET /openapi`. To exclude a type, mark it `@hidden` in the schema, or set `static hidden = true` on a programmatic resource class.

9. **Implement a custom `connect()` handler** when default subscription behavior is insufficient. The method must return an async iterable that produces messages to send to the client:

   ```javascript
   export class Echo extends Resource {
   	async *connect(incomingMessages) {
   		for await (let message of incomingMessages) {
   			yield message; // echo each message back
   		}
   	}
   }
   ```

10. **Connect via WebSocket**. WebSocket support is enabled automatically with `rest: true`. Connect to a resource URL to subscribe to change events:

    ```javascript
    let ws = new WebSocket('wss://server/my-resource/341');
    ws.onmessage = (event) => {
    	let data = JSON.parse(event.data);
    };
    ```

    Disable WebSocket support independently with `webSocket: false` under `rest`.

11. **Use MQTT over WebSockets** by setting the sub-protocol header:

    ```
    Sec-WebSocket-Protocol: mqtt
    ```

12. **Specify response format** using the `Accept` header. The suffixes `.json`, `.cbor`, `.msgpack`, and `.csv` are reserved as content-type selectors on property paths and take precedence over property names.

## Examples

**Schema and config for a REST-enabled table:**

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

**Conditional GET with ETag caching:**

```http
GET /Product/123
If-None-Match: "abc123"
```

Response when unchanged:

```
HTTP/1.1 304 Not Modified
ETag: "abc123"
```

**POST and read the Location header:**

```http
POST /Product/
Content-Type: application/json

{ "name": "Widget" }
```

```
HTTP/1.1 201 Created
Location: 7f3a9c
```

**PATCH (shallow merge only):**

```http
PATCH /Product/123
Content-Type: application/json

{ "status": "active" }
```

**Custom WebSocket connect handler:**

```javascript
export class Echo extends Resource {
	async *connect(incomingMessages) {
		for await (let message of incomingMessages) {
			yield message; // echo each message back
		}
	}
}
```

**Hide a resource from OpenAPI — schema directive:**

```graphql
type InternalLog @table @export @hidden {
	id: Long @primaryKey
}
```

**Hide a resource from OpenAPI — programmatic class:**

```javascript
export class InternalLog extends Resource {
	static hidden = true;
}
```

## Notes

- A component directory with **no** `config.yaml` inherits Harper's built-in default, which enables `rest` automatically. As soon as a `config.yaml` exists, it is used verbatim — omitting `rest` from it disables REST even if the directory previously had it without a config file. Always add `rest: true` when adding a config file.
- `POST /Product` (no trailing slash) returns `404`. The trailing slash is required for collection operations.
- A `POST` to a primary key that already exists fails with `409` rather than overwriting.
- PATCH merge is **shallow** — a nested object in the body replaces the stored nested object wholesale; nested properties not included in the body are dropped.
- The `.msgpack` suffix (along with `.json`, `.cbor`, `.csv`) is reserved as a content-type selector and cannot be used as a property name in dot-path access.
- Server-Sent Events subscriptions are served on the same paths, negotiated via `Accept: text/event-stream`; they are not affected by the `webSocket` option.
- See [querying-rest-apis.md](querying-rest-apis.md) for full query syntax on collection endpoints and [real-time-apps.md](real-time-apps.md) for real-time subscription patterns.
