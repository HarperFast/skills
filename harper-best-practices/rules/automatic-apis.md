---
name: automatic-apis
description: How to use Harper's automatically generated REST and WebSocket APIs.
metadata:
  mode: generate
  sources:
    - reference/v5/rest/overview.md
    - reference/v5/rest/websockets.md
  sourceCommit: 677ad213d67822e109c83619e181ca23a59823db
  inputHash: 2550ad5c3361b452
---

# Automatic REST and WebSocket APIs

Instructions for the agent to follow when enabling and using Harper's automatically generated REST and WebSocket APIs for exported tables and resources.

## When to Use

Apply this rule when adding REST endpoints or real-time WebSocket subscriptions to a Harper application. Use it whenever a table needs to be exposed over HTTP without writing custom handler code, or when a resource needs to stream change events to connected clients.

## How It Works

1. **Enable REST in `config.yaml`**: Add `rest: true` to your application's configuration file. Without this, no REST or WebSocket endpoints are registered, even for exported tables.

   ```yaml
   rest: true
   ```

   Optional settings:

   ```yaml
   rest:
     lastModified: true # enables Last-Modified response header support
     webSocket: false # disables automatic WebSocket support (enabled by default)
   ```

2. **Export the table in your schema**: Add `@export` to the type definition. Without `@export`, Harper registers no route for the table and callers receive `404`. Both `@export` and `rest: true` are required — neither is sufficient alone.

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

3. **Use the automatically registered endpoints**: With both conditions met, Harper serves the following endpoints on the application HTTP server port (default `9926`) with no route definitions or handler code required.

   | Endpoint                     | Description                                                              |
   | ---------------------------- | ------------------------------------------------------------------------ |
   | `GET /Product`               | Resource description (table name, database, attributes)                  |
   | `GET /Product/`              | Record collection; append query parameters to search, filter, sort, page |
   | `GET /Product/{id}`          | Single record by primary key; `404` if not found                         |
   | `GET /Product/{id}.property` | Single declared property of one record                                   |
   | `POST /Product/`             | Creates a record; responds `201`; trailing slash required                |
   | `PUT /Product/{id}`          | Creates or replaces the record at `{id}` (upsert)                        |
   | `PATCH /Product/{id}`        | Shallow-merges body into existing record                                 |
   | `DELETE /Product/{id}`       | Deletes the record at `{id}`                                             |
   | `DELETE /Product/?query`     | Deletes every record matching the query                                  |

4. **Understand the URL structure**: The trailing slash is significant.

   | Path                     | Addresses                        |
   | ------------------------ | -------------------------------- |
   | `/my-resource`           | The resource itself (metadata)   |
   | `/my-resource/`          | The collection of all records    |
   | `/my-resource/record-id` | A specific record by primary key |

5. **Use WebSocket subscriptions**: Enabling `rest` also registers WebSocket subscriptions on the same resource paths by default. Connect to a resource URL to subscribe to change events.

   ```javascript
   let ws = new WebSocket('wss://server/my-resource/341');
   ws.onmessage = (event) => {
   	let data = JSON.parse(event.data);
   };
   ```

   Disable WebSocket support without disabling REST by setting `webSocket: false` under `rest` in `config.yaml`.

6. **Implement a custom `connect()` handler** (optional): Override WebSocket behavior on a resource class using the `connect(incomingMessages)` method. The method must return an async iterable that produces messages to send to the client.

## Examples

**Minimal setup — schema and config:**

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

**HTTP method examples:**

```
GET /Product/123
GET /Product/?name=Harper
PUT /Product/123
PATCH /Product/123
DELETE /Product/123
DELETE /Product/?status=archived
POST /Product/
```

**Custom WebSocket echo handler:**

```javascript
export class Echo extends Resource {
	async *connect(incomingMessages) {
		for await (let message of incomingMessages) {
			yield message; // echo each message back
		}
	}
}
```

**Custom WebSocket handler using `super.connect()` with timer:**

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

**OpenAPI spec endpoint:**

```
GET /openapi
```

## Notes

- A component directory with **no configuration file at all** gets REST enabled by Harper's built-in default. As soon as a `config.yaml` exists, it is used verbatim — a config file that omits `rest` turns REST off. Always add `rest: true` when adding a config file.
- Do not add `@export` to a schema type and also export a same-named JavaScript subclass of that table — this produces conflicting endpoints. Use one or the other to claim the route.
- `PATCH` merges are **shallow** (top-level only). A nested object in the body replaces the stored nested object wholesale; omitted nested properties are dropped.
- `POST /Product/` requires the trailing slash — `POST /Product` returns `404`.
- On a successful `POST`, the new record's primary key is returned in the `Location` response header as a bare key value, not a URL.
- `PUT` always forces the primary key to match the `{id}` in the URL, re-stamps `@updatedTime`, and preserves the original `@createdTime`.
- WebSocket connections deliver messages immediately in distributed environments. Retained messages (PUT/updated records) use the latest timestamp as the winning record for eventual consistency. Non-retained messages deliver every message in order received.
- MQTT over WebSocket is supported by setting the sub-protocol header `Sec-WebSocket-Protocol: mqtt`.
- Server-Sent Events subscriptions are served on the same paths, negotiated with `Accept: text/event-stream`. They are not affected by the `webSocket` option.

See [querying-rest-apis.md](querying-rest-apis.md) for the full URL query syntax, operators, and examples. See [real-time-apps.md](real-time-apps.md) for patterns around building real-time features with WebSocket and SSE.
