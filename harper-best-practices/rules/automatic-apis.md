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
  sourceCommit: 677ad213d67822e109c83619e181ca23a59823db
  inputHash: a9356e92dd3dc106
---

# Automatic APIs

Instructions for the agent to follow when using Harper's automatically generated REST and WebSocket APIs for exported tables and resources.

## When to Use

Apply this rule when enabling HTTP REST endpoints or WebSocket subscriptions for Harper tables without writing custom handler code. Use it whenever a schema type needs to be served over HTTP, when configuring real-time subscriptions, or when setting up conditional caching behavior for REST responses.

## How It Works

1. **Enable REST in `config.yaml`**: Add `rest: true` to the application configuration file. This registers REST endpoints and, by default, WebSocket subscriptions for all exported resources.

   ```yaml
   rest: true
   ```

   To configure options explicitly:

   ```yaml
   rest:
     lastModified: true # enables Last-Modified response header support
     webSocket: false # disables automatic WebSocket support (enabled by default)
   ```

2. **Export the table in the schema**: Add `@export` to the type definition. Without `@export`, Harper registers no REST route and callers receive `404`. Without `rest: true`, even an exported table does not respond to HTTP requests. Both are required.

   ```graphql
   type Product @table @export {
   	id: Long @primaryKey
   	name: String
   	price: Float
   }
   ```

   Reference the schema file in `config.yaml`:

   ```yaml
   graphqlSchema:
     files: schema.graphql
   rest: true
   ```

3. **Use the automatically registered endpoints**: Harper serves the following endpoints on the application HTTP server port (default `9926`) with no route definitions or handler code required.

   | Endpoint                     | Description                                                                 |
   | ---------------------------- | --------------------------------------------------------------------------- |
   | `GET /Product`               | Returns resource description (table name, database, attributes)             |
   | `GET /Product/`              | Returns the record collection; append query parameters to filter            |
   | `GET /Product/{id}`          | Returns a single record by primary key; `404` if not found                  |
   | `GET /Product/{id}.property` | Returns a single declared property of one record                            |
   | `POST /Product/`             | Creates a record; responds `201`; primary key returned in `Location` header |
   | `PUT /Product/{id}`          | Creates or replaces the record at `{id}` (upsert)                           |
   | `PATCH /Product/{id}`        | Merges body into existing record (shallow, top-level only)                  |
   | `DELETE /Product/{id}`       | Deletes the record at `{id}`                                                |
   | `DELETE /Product/?query`     | Deletes every record matching the query                                     |

4. **Handle `POST` primary key and `Location`**: On a successful `POST`, the new record's primary key is returned in the `Location` response header — the value the body supplied if it carried the primary-key property, otherwise a Harper-assigned key. The header carries the bare key value, not a URL.

5. **Understand `PUT` write behavior**: `PUT` replaces the stored record exactly. Three exceptions always apply: a `@createdTime` attribute keeps the original value, an `@updatedTime` attribute is re-stamped with the time of the write, and the primary key is forced to match the `{id}` in the URL.

6. **Use conditional requests for caching**: GET responses include an `ETag` header encoding the record's version/last-modification time. Send `If-None-Match` on subsequent requests with the cached `ETag` value. If the record has not changed, Harper returns `304 Not Modified` with no body.

7. **Select content type with `Accept`**: Use the `Accept` header to request a specific response format. The suffixes `.json`, `.cbor`, `.msgpack`, and `.csv` are reserved as content-type selectors on property paths and take precedence over property names. See [querying-rest-apis.md](querying-rest-apis.md) for query syntax details.

8. **Connect via WebSocket**: WebSocket support is enabled automatically when `rest` is enabled. Connecting to a resource URL subscribes to changes for that resource. See [real-time-apps.md](real-time-apps.md) for real-time patterns.

   ```javascript
   let ws = new WebSocket('wss://server/my-resource/341');
   ws.onmessage = (event) => {
   	let data = JSON.parse(event.data);
   };
   ```

9. **Implement a custom `connect()` handler** when default subscription behavior is insufficient. The method must return an async iterable that produces messages to send to the client.

   ```javascript
   export class Echo extends Resource {
   	async *connect(incomingMessages) {
   		for await (let message of incomingMessages) {
   			yield message; // echo each message back
   		}
   	}
   }
   ```

## Examples

### Full schema and config setup

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
# Response: 304 Not Modified (no body transferred)
```

### POST and read the Location header

```
POST /Product/
Content-Type: application/json

{ "name": "Widget", "price": 9.99 }

# Response:
# 201 Created
# Location: 7f3a9c
```

### PATCH (shallow merge only)

```
PATCH /Product/123
Content-Type: application/json

{ "price": 12.99 }
```

Only `price` is updated; other top-level properties are preserved. Nested objects in the body replace the stored sub-object wholesale — deep merge does not occur.

### Request MessagePack response

```
GET /Product/123
Accept: application/msgpack
```

Alternatively, use the `.msgpack` suffix on the URL path where supported.

### WebSocket with custom outgoing messages

```javascript
export class Example extends Resource {
	connect(incomingMessages) {
		let outgoingMessages = super.connect();

		let timer = setInterval(() => {
			outgoingMessages.send({ greeting: 'hi again!' });
		}, 1000);

		incomingMessages.on('data', (message) => {
			outgoingMessages.send(message);
		});

		outgoingMessages.on('close', () => {
			clearInterval(timer);
		});

		return outgoingMessages;
	}
}
```

### Disable WebSocket while keeping REST

```yaml
rest:
  webSocket: false
```

## Notes

- The trailing slash is significant: `/Product` addresses the resource itself; `/Product/` addresses its record collection. `POST /Product` (no trailing slash) returns `404`.
- `HEAD` is served as `GET` with the body omitted. `QUERY` is accepted on the collection path and reads its search from the request body.
- A `POST` to an existing primary key fails with `409` — it does not overwrite.
- A component directory with **no configuration file** gets REST enabled by Harper's built-in default. As soon as a `config.yaml` exists it is used verbatim — add `rest: true` explicitly or REST is off.
- Do not apply `@export` to a schema type and also export a same-named JavaScript subclass of that table — this produces conflicting endpoints.
- Server-Sent Events subscriptions are served on the same paths, negotiated via `Accept: text/event-stream`. They are not affected by the `webSocket` option.
- Every non-hidden exported resource is included in the generated OpenAPI document at `GET /openapi`. Mark a type `@hidden` or set `static hidden = true` on a programmatic Resource to omit it.
- MQTT over WebSockets requires the sub-protocol header `Sec-WebSocket-Protocol: mqtt`.
