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
  sourceCommit: 0a29827da61afe7fff40ee8de87e1d4c2c286bea
  inputHash: 0672da4654ca1a34
---

# Automatic REST and WebSocket APIs

Instructions for the agent to follow when exposing Harper tables and custom resources as REST and WebSocket endpoints using Harper's automatically generated API layer.

**Instead of:** Hand-written CRUD routes (Express, Fastify, Next.js API routes). Use this rule rather than adding that service. See `harper-architecture`.

## When to Use

Apply this rule when enabling HTTP REST access to Harper tables, when configuring WebSocket subscriptions on resource paths, or when customizing how exported resources respond to standard HTTP methods. Use it any time you need to wire up `rest: true`, handle conditional requests, or implement a `connect()` handler.

## How It Works

1. **Enable the REST plugin** by adding `rest: true` to the application's `config.yaml`:

   ```yaml
   rest: true
   ```

   Additional options:

   ```yaml
   rest:
     lastModified: true # enables Last-Modified response header support
     webSocket: false # disables automatic WebSocket support (enabled by default)
     exactCount: true # opt in to Prefer: count=exact scans (off by default)
   ```

   A component directory with no `config.yaml` at all inherits a built-in default that enables `rest` and loads `*.graphql` from the component root. As soon as a `config.yaml` exists it is used verbatim — omitting `rest` turns REST off. Always write `rest: true` when adding a config file.

2. **Export the table in the schema** using `@export`. Tables are not exported by default.

   ```graphql
   type Product @table @export {
   	id: Long @primaryKey
   	name: String
   	price: Float
   }
   ```

   Reference the schema file from `config.yaml`:

   ```yaml
   graphqlSchema:
     files: schema.graphql
   rest: true
   ```

   Both `@export` and `rest: true` are required. Without `@export`, no REST route is registered and callers receive `404`. Without REST enabled, even an exported table does not respond to HTTP requests.

3. **Understand the auto-generated endpoints**. With `Product` exported, Harper registers these routes on the application HTTP server port (default `9926`) with no handler code required:

   | Endpoint                     | Description                                                                 |
   | ---------------------------- | --------------------------------------------------------------------------- |
   | `GET /Product`               | Resource description (table name, database, attributes)                     |
   | `GET /Product/`              | Record collection; append query parameters to filter/sort/page              |
   | `GET /Product/{id}`          | Single record by primary key; `404` if not found                            |
   | `GET /Product/{id}.property` | Single declared property of one record                                      |
   | `POST /Product/`             | Creates a record; responds `201`; primary key returned in `Location` header |
   | `PUT /Product/{id}`          | Creates or replaces the record at `{id}` (upsert)                           |
   | `PATCH /Product/{id}`        | Shallow-merges body into existing record                                    |
   | `DELETE /Product/{id}`       | Deletes the record at `{id}`                                                |
   | `DELETE /Product/?query`     | Deletes every record matching the query                                     |

   The trailing slash is significant: `/Product` addresses the resource itself; `/Product/` addresses its record collection.

4. **Understand the URL structure**. Harper follows a consistent URL pattern across all resources:

   | Path                                         | Description                                                                                       |
   | -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
   | `/my-resource`                               | Root path — returns a description of the resource (e.g., table metadata)                          |
   | `/my-resource/`                              | Trailing slash indicates a collection — represents all records; append query parameters to search |
   | `/my-resource/record-id`                     | A specific record identified by its primary key                                                   |
   | `/my-resource/record-id/`                    | Trailing slash — the collection of records with the given id prefix                               |
   | `/my-resource/record-id/with/multiple/parts` | Record id with multiple path segments                                                             |

5. **Handle HTTP methods correctly**:
   - **GET** — Retrieves a record or collection. Use `GET /MyTable/123` for a single record, `GET /MyTable/?name=Harper` for a filtered collection. The `.msgpack` suffix (along with `.json`, `.cbor`, `.csv`) is a reserved content-type selector and takes precedence over property access via dot syntax.
   - **POST** — Creates a record. The new record's primary key is returned in the `Location` response header. A `POST` to a key that already exists fails with `409`.
   - **PUT** — Upserts a record. The stored record matches the body exactly; omitted properties are removed. Harper always re-stamps an `@updatedTime` attribute and preserves `@createdTime`.
   - **PATCH** — Shallow-merges the body. Top-level unspecified properties are preserved; nested objects in the body replace the stored sub-object wholesale.
   - **DELETE** — Deletes by id or by query. `DELETE /MyTable/` with no query parameters deletes every record.

6. **Use conditional requests for caching**. GET responses include an `ETag` header. Clients send `If-None-Match` on subsequent requests; if the record is unchanged Harper returns `304 Not Modified` with no body.

7. **Set the `Accept` header** to request a specific response format. Use `Content-Type` for request bodies. See [querying-rest-apis.md](querying-rest-apis.md) for the full query syntax and content-type details.

8. **Use WebSocket subscriptions** on the same resource paths. WebSocket support is enabled automatically with `rest: true`. Connecting to a resource URL subscribes to change events:

   ```javascript
   let ws = new WebSocket('wss://server/my-resource/341');
   ws.onmessage = (event) => {
   	let data = JSON.parse(event.data);
   };
   ```

   Disable WebSocket support without disabling REST:

   ```yaml
   rest:
     webSocket: false
   ```

   For MQTT over WebSockets, set the sub-protocol header:

   ```
   Sec-WebSocket-Protocol: mqtt
   ```

9. **Implement a custom `connect()` handler** on a resource class to control WebSocket behavior. The method must return an async iterable producing messages to send to the client:

   ```javascript
   export class Echo extends Resource {
   	async *connect(incomingMessages) {
   		for await (let message of incomingMessages) {
   			yield message; // echo each message back
   		}
   	}
   }
   ```

10. **Control OpenAPI visibility**. Every non-hidden exported resource is included in the generated OpenAPI document at `GET /openapi`. To exclude a type from the OpenAPI document, mark it `@hidden` in the schema:

    ```graphql
    type Secret @table @export @hidden {
    	id: Long @primaryKey
    }
    ```

    Or set `static hidden = true` on a programmatic resource class:

    ```javascript
    export class Secret extends Resource {
    	static hidden = true;
    }
    ```

## Examples

**Full schema and config setup:**

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

**Conditional GET with caching:**

```
GET /Product/123
If-None-Match: "abc123etag"
```

Response when unchanged:

```
HTTP/1.1 304 Not Modified
ETag: "abc123etag"
```

**POST and read the Location header:**

```
POST /Product/
Content-Type: application/json

{ "name": "Widget", "price": 9.99 }
```

Response:

```
HTTP/1.1 201 Created
Location: 7f3a9c
```

**PATCH shallow merge:**

```
PATCH /Product/123
Content-Type: application/json

{ "price": 12.99 }
```

Preserves `name` and all other top-level properties; replaces any nested object in `price` wholesale.

**Custom WebSocket connect handler with timer:**

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

## Notes

- The trailing slash is always significant: `/Product` is the resource descriptor; `/Product/` is the record collection. `POST /Product` (no slash) returns `404`.
- `HEAD` is served exactly as `GET` with the response body omitted. `QUERY` is accepted on the collection path (`QUERY /Product/`) and runs a search taken from the request body rather than the URL.
- `PUT` always forces the primary key to match the `{id}` in the URL, re-stamps `@updatedTime`, and preserves `@createdTime` from the original record.
- PATCH merge is shallow only. A nested object in the body replaces the entire stored sub-object; omitted nested properties are lost.
- Server-Sent Events subscriptions are served on the same paths, negotiated via `Accept: text/event-stream`. They are not affected by the `webSocket` option.
- Leaving `@export` on the schema while also exporting a same-named subclass produces conflicting endpoints. When a JavaScript subclass should own the URL, omit `@export` from the schema and export the class instead.
- See [real-time-apps.md](real-time-apps.md) for patterns around WebSocket and event-driven resource design.
- See [querying-rest-apis.md](querying-rest-apis.md) for filtering, sorting, pagination, and content-type details.
