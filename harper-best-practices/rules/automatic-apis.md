---
name: automatic-apis
description: How to use Harper's automatically generated REST and WebSocket APIs.
metadata:
  mode: generate
  sources:
    - reference/v5/rest/overview.md
    - reference/v5/rest/websockets.md
  sourceCommit: 3749d0c54be457a2a65d9a63c738a5dc88989ecd
  inputHash: 6c7013b1307d9f7b
---

# Automatic APIs

Instructions for the agent to follow when enabling and using Harper's automatically generated REST and WebSocket APIs.

## When to Use

Apply this rule when adding REST or WebSocket API access to Harper tables or custom resources. Use it when configuring `config.yaml` to expose endpoints, mapping HTTP methods to resource operations, or implementing real-time WebSocket connections on a resource class.

## How It Works

1. **Enable the REST plugin**: Add `rest: true` to your application's `config.yaml`. This activates the HTTP REST interface on the application server port (default `9926`) and enables WebSocket support automatically.

   ```yaml
   rest: true
   ```

   To configure options explicitly:

   ```yaml
   rest:
     lastModified: true # enables Last-Modified response header support
     webSocket: false # disables automatic WebSocket support (enabled by default)
   ```

2. **Export your resource in the schema**: Tables are not exposed by default. Use the `@export` directive in your schema definition to expose a table as a REST endpoint. The exported name defines the base URL path.

3. **Use the correct URL structure**: Target resources using these path conventions:

   | Path                                         | Description                                                 |
   | -------------------------------------------- | ----------------------------------------------------------- |
   | `/my-resource`                               | Returns resource metadata                                   |
   | `/my-resource/`                              | Collection — all records; append query parameters to search |
   | `/my-resource/record-id`                     | Specific record by primary key                              |
   | `/my-resource/record-id/`                    | Collection of records with the given id prefix              |
   | `/my-resource/record-id/with/multiple/parts` | Record id with multiple path segments                       |

4. **Map operations to HTTP methods**: Each HTTP method maps to a resource method:
   - **GET** — Retrieve a record or search. Calls `get()`. Responses include an `ETag` header; send `If-None-Match` on subsequent requests to receive `304 Not Modified` when unchanged.
   - **PUT** — Create or replace a record (upsert). Calls `put(record)`. The stored record exactly matches the submitted body; omitted properties are removed.
   - **POST** — Create a record without specifying a primary key. Calls `post(data)`. The assigned key is returned in the `Location` response header.
   - **PATCH** — Partially update a record, merging only provided top-level properties. Calls the resource's patch handler. Merge is **shallow** — nested objects are replaced entirely, not deep-merged.
   - **DELETE** — Delete a record by id or all records matching a query.

5. **Connect via WebSocket**: A WebSocket connection to a resource URL subscribes to that resource and streams change events. See [real-time-apps.md](real-time-apps.md) for full real-time patterns.

   ```javascript
   let ws = new WebSocket('wss://server/my-resource/341');
   ws.onmessage = (event) => {
   	let data = JSON.parse(event.data);
   };
   ```

6. **Implement a custom `connect()` handler** on a resource class to control WebSocket behavior. The method receives `incomingMessages` and must return an async iterable producing messages to send to the client.

7. **Retrieve the OpenAPI spec**: Harper auto-generates an OpenAPI specification for all exported resources, available at:

   ```
   GET /openapi
   ```

## Examples

**Simple echo WebSocket server**:

```javascript
export class Echo extends Resource {
	async *connect(incomingMessages) {
		for await (let message of incomingMessages) {
			yield message; // echo each message back
		}
	}
}
```

**Custom `connect()` using the default iterable with `send()` and `close` event**:

```javascript
export class Example extends Resource {
	connect(incomingMessages) {
		let outgoingMessages = super.connect();

		let timer = setInterval(() => {
			outgoingMessages.send({ greeting: 'hi again!' });
		}, 1000);

		incomingMessages.on('data', (message) => {
			outgoingMessages.send(message); // echo incoming messages
		});

		outgoingMessages.on('close', () => {
			clearInterval(timer);
		});

		return outgoingMessages;
	}
}
```

**Common REST operations**:

```
GET /MyTable/123
GET /MyTable/?name=Harper
PUT /MyTable/123
PATCH /MyTable/123
DELETE /MyTable/?status=archived
```

```json
{ "name": "some data" }
```

## Notes

- `rest: true` is the minimal config to enable both REST and WebSocket support. Set `webSocket: false` under the `rest` key to disable WebSocket only.
- The `@export` directive in the schema is required for any table to appear as a REST endpoint — tables are not exported by default.
- PATCH merges are shallow (top-level only). Nested objects in the request body replace the entire existing sub-object. Dot-path keys (e.g., `"settings.theme"`) are stored as literal keys, not interpreted as paths.
- For MQTT over WebSocket, set the sub-protocol header `Sec-WebSocket-Protocol: mqtt`.
- In distributed environments, non-retained messages are delivered in arrival order; retained messages (PUT/updated records) keep only the latest timestamp as the winning record.
- For full query syntax on GET and DELETE, see [querying-rest-apis.md](querying-rest-apis.md).
- For building real-time features with WebSocket subscriptions, see [real-time-apps.md](real-time-apps.md).
