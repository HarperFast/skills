---
name: handling-binary-data
description: How to store and serve binary data like images or audio in Harper.
metadata:
  mode: generate
  sources:
    - reference/v5/database/api.md#Accepting Binary in JSON Requests
    - reference/v5/database/api.md#Serving Binary from a Resource
    - reference/v5/rest/content-types.md#Storing Arbitrary Content Types
  sourceCommit: 2cfb81318f17e0aca2d600109e6ad813d2d0443e
  inputHash: 8be9e31f009e2d27
---

# Handling Binary Data

Instructions for the agent to follow when storing and serving binary data (images, audio, arbitrary content types) in Harper.

## When to Use

Apply this rule when a Harper resource needs to accept, store, or serve binary payloads such as images, audio files, or calendar data. Use it when clients send raw binary via `PUT`/`POST`, or when they send `base64`-encoded data inside a JSON body.

## How It Works

1. **Accept base64-encoded binary from JSON clients**: REST clients that cannot post raw binary send `base64` inside a JSON body. In the resource override, `await` the `record` promise before reading any fields — reading fields off the unresolved promise silently yields `undefined` and stores the raw base64 string. Decode the field with `Buffer.from` and wrap it with `createBlob`, recording the MIME type.

   ```typescript
   import { type RequestTargetOrId, tables, createBlob } from 'harper';

   export class Photo extends tables.Photo {
   	static async post(target: RequestTargetOrId, record: any) {
   		const body = await record;
   		if (!body) return new Response('A JSON body is required', { status: 400 });
   		if (body.data) {
   			body.data = createBlob(Buffer.from(body.data, body.encoding || 'base64'), {
   				type: body.contentType || 'application/octet-stream',
   			});
   		}
   		return super.post(target, body);
   	}
   }
   ```

2. **Serve binary from a resource**: Override `get` to return a response object with the blob's MIME type in the `Content-Type` header and the blob as the body. Harper streams it to the client.

   ```typescript
   export class Photo extends tables.Photo {
   	static async get(target: RequestTargetOrId) {
   		const record = await super.get(target);
   		if (record?.data) {
   			return {
   				status: 200,
   				headers: { 'Content-Type': record.data.type || 'application/octet-stream' },
   				body: record.data,
   			};
   		}
   		return record;
   	}
   }
   ```

3. **Store arbitrary content types via raw PUT/POST**: When a `PUT` or `POST` arrives with a non-standard `Content-Type` (e.g., `text/calendar`, `image/gif`), Harper automatically stores the content as a record with `contentType` and `data` properties. Retrieving that record returns the response with the original `Content-Type` and body. If the content type is not from the `text` family, the data is treated as binary (a Node.js `Buffer`).

   Use `application/octet-stream` for generic binary data, or target a specific property:

   ```
   PUT /my-resource/33/image
   Content-Type: image/gif

   ...image data...
   ```

## Examples

**Storing a calendar entry with a raw PUT:**

```
PUT /my-resource/33
Content-Type: text/calendar

BEGIN:VCALENDAR
VERSION:2.0
...
```

Harper stores this as:

```json
{ "contentType": "text/calendar", "data": "BEGIN:VCALENDAR\nVERSION:2.0\n..." }
```

**Full resource class handling base64 JSON upload and binary serving:**

```typescript
import { type RequestTargetOrId, tables, createBlob } from 'harper';

export class Photo extends tables.Photo {
	static async post(target: RequestTargetOrId, record: any) {
		const body = await record;
		if (!body) return new Response('A JSON body is required', { status: 400 });
		if (body.data) {
			body.data = createBlob(Buffer.from(body.data, body.encoding || 'base64'), {
				type: body.contentType || 'application/octet-stream',
			});
		}
		return super.post(target, body);
	}

	static async get(target: RequestTargetOrId) {
		const record = await super.get(target);
		if (record?.data) {
			return {
				status: 200,
				headers: { 'Content-Type': record.data.type || 'application/octet-stream' },
				body: record.data,
			};
		}
		return record;
	}
}
```

## Notes

- Always `await` the `record` parameter before accessing its properties; accessing fields on the unresolved promise yields `undefined`.
- `createBlob` accepts a `Buffer` and an options object with a `type` property for the MIME type. Fall back to `application/octet-stream` when no MIME type is provided.
- For schema-level blob field definitions, see [using-blob-datatype.md](using-blob-datatype.md).
