---
name: using-blob-datatype
description: How to use the Blob data type for efficient binary storage in Harper.
metadata:
  mode: generate
  sources:
    - reference/v5/database/schema.md#Blob Type
    - reference/v5/database/api.md#Streaming
    - reference/v5/database/api.md#`BlobOptions`
    - reference/v5/database/api.md#Blob Coercion
  sourceCommit: 2cfb81318f17e0aca2d600109e6ad813d2d0443e
  inputHash: 753b85cbdcef9188
---

# Using the Blob Data Type

Instructions for the agent to follow when storing and retrieving large binary content using the `Blob` data type in Harper.

## When to Use

Apply this rule when a schema field needs to store large binary content such as images, video, audio, or large HTML — typically content larger than 20KB. Use `Blob` instead of `Bytes` when streaming support and out-of-record storage are required. See [handling-binary-data](handling-binary-data.md) for broader binary data guidance.

## How It Works

1. **Declare a `Blob` field in your schema**: Add a field typed as `Blob` to your table definition.

   ```graphql
   type MyTable @table {
   	id: Any! @primaryKey
   	data: Blob
   }
   ```

2. **Create and store a blob with `createBlob()`**: Pass a buffer, string, or stream to `createBlob()`, then `put` the record.

   ```javascript
   let blob = createBlob(largeBuffer);
   await MyTable.put({ id: 'my-record', data: blob });
   ```

3. **Retrieve blob data using standard Web API methods**: Use `.bytes()`, `.text()`, or `.stream()` on the retrieved field.

   ```javascript
   let record = await MyTable.get('my-record');
   let buffer = await record.data.bytes(); // ArrayBuffer
   let text = await record.data.text(); // string
   let stream = record.data.stream(); // ReadableStream
   ```

4. **Use `saveBeforeCommit` when full write must complete before commit**: By default, blobs are not ACID-compliant — a record can reference a blob before it is fully written. Set `saveBeforeCommit: true` to block the transaction until the blob is fully saved.

   ```javascript
   let blob = createBlob(stream, { saveBeforeCommit: true });
   await MyTable.put({ id: 'my-record', data: blob });
   // put() resolves only after blob is fully written and record is committed
   ```

5. **Register an error handler when returning a blob via REST**: Handle interrupted streams to avoid stale references.

   ```javascript
   export class MyEndpoint extends MyTable {
   	static async get(target) {
   		const record = await super.get(target);
   		let blob = record?.data;
   		if (!blob) return record;
   		blob.on('error', () => {
   			MyTable.invalidate(target);
   		});
   		return { status: 200, headers: {}, body: blob };
   	}
   }
   ```

6. **Pass `BlobOptions` to control storage behavior**: `createBlob()` accepts an options object as its second argument.

   | Option             | Type      | Default     | Description                                                                         |
   | ------------------ | --------- | ----------- | ----------------------------------------------------------------------------------- |
   | `type`             | `string`  | `undefined` | MIME type (e.g., `image/jpeg`). Used when serving HTTP and readable via `blob.type` |
   | `size`             | `number`  | `undefined` | Size in bytes if known ahead of time; otherwise inferred                            |
   | `saveBeforeCommit` | `boolean` | `false`     | Wait until blob is fully written before the transaction commits                     |
   | `compress`         | `boolean` | `false`     | Compress stored data with deflate                                                   |
   | `flush`            | `boolean` | `false`     | Flush file to disk after writing, before the `createBlob` promise chain resolves    |

## Examples

**Store an image with a MIME type:**

```javascript
let blob = createBlob(imageBuffer, { type: 'image/jpeg' });
await Photo.put({ id, data: blob });
```

**Stream a blob in as it streams out (low-latency passthrough):**

```javascript
let blob = createBlob(incomingStream);
await MyTable.put({ id: 'my-record', data: blob });

let record = await MyTable.get('my-record');
let outgoingStream = record.data.stream();
```

**Wait for full write before commit:**

```javascript
let blob = createBlob(stream, { saveBeforeCommit: true });
await MyTable.put({ id: 'my-record', data: blob });
```

## Notes

- `Blob` implements the Web API `Blob` interface. All standard methods — `.text()`, `.arrayBuffer()`, `.stream()`, `.slice()`, and `.bytes()` — are available on retrieved blob fields.
- Blobs are stored **separately from the record**, not within it. If you need the binary data to be a true ACID-committed part of the record, use a `Bytes` field instead.
- Any string or buffer assigned to a `Blob`-typed field in a `put`, `patch`, or `publish` is automatically coerced to a `Blob` — manual `createBlob()` calls are not required in those cases.
- Use `saveBeforeCommit: true` whenever downstream consumers must not read a partially written blob.
