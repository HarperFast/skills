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
  sourceCommit: f37a8c4021e20d5c74c1d339a6b6c8c196b5603e
  inputHash: 92e03eb0b830f335
---

# Using the Blob Data Type

Instructions for the agent to follow when storing and retrieving large binary content using the `Blob` data type in Harper.

## When to Use

Apply this rule when a schema field needs to store large binary content such as images, video, audio, or large HTML — typically content larger than 20KB. Use `Blob` instead of `Bytes` when streaming support and out-of-record storage are required. See [handling-binary-data.md](handling-binary-data.md) for broader binary data guidance.

## How It Works

1. **Declare a `Blob` field in your schema**: Add a field typed as `Blob` to your `@table` type.

   ```graphql
   type MyTable @table {
   	id: Any! @primaryKey
   	data: Blob
   }
   ```

2. **Create and store a blob with `createBlob()`**: Pass a buffer or stream to `createBlob()`, then `put` the record.

   ```javascript
   let blob = createBlob(largeBuffer);
   await MyTable.put({ id: 'my-record', data: blob });
   ```

3. **Retrieve blob data using standard Web API methods**: The `Blob` type implements the Web API `Blob` interface. Use `.bytes()`, `.text()`, `.arrayBuffer()`, `.stream()`, or `.slice()` as needed.

   ```javascript
   let record = await MyTable.get('my-record');
   let buffer = await record.data.bytes(); // ArrayBuffer
   let text = await record.data.text(); // string
   let stream = record.data.stream(); // ReadableStream
   ```

4. **Use `saveBeforeCommit` when full write must precede commit**: By default, `Blob` is not ACID-compliant — a record can reference a blob before it is fully written. Set `saveBeforeCommit: true` to block the transaction until the blob is fully saved.

   ```javascript
   let blob = createBlob(stream, { saveBeforeCommit: true });
   await MyTable.put({ id: 'my-record', data: blob });
   // put() resolves only after blob is fully written and record is committed
   ```

5. **Register an error handler when returning a blob via REST**: Interrupted streams must be handled explicitly.

   ```javascript
   export class MyEndpoint extends MyTable {
   	static async get(target) {
   		const record = super.get(target);
   		let blob = record.data;
   		blob.on('error', () => {
   			MyTable.invalidate(target);
   		});
   		return { status: 200, headers: {}, body: blob };
   	}
   }
   ```

6. **Rely on automatic coercion where applicable**: When a field is typed as `Blob` in the schema, any string or buffer assigned via `put`, `patch`, or `publish` is automatically coerced to a `Blob` — no manual `createBlob()` call is needed in those cases.

### `BlobOptions` reference

Pass an options object as the second argument to `createBlob()`.

| Option             | Type      | Default     | Description                                                                                                              |
| ------------------ | --------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| `type`             | `string`  | `undefined` | MIME type to associate with the blob (e.g., `image/jpeg`). Readable via `blob.type` and used when serving HTTP.          |
| `size`             | `number`  | `undefined` | Size of the data in bytes, if known ahead of time. Otherwise inferred from a buffer or determined as a stream completes. |
| `saveBeforeCommit` | `boolean` | `false`     | Wait until the blob is fully written before the transaction commits.                                                     |
| `compress`         | `boolean` | `false`     | Compress the stored data with deflate.                                                                                   |
| `flush`            | `boolean` | `false`     | Flush the file to disk after writing, before the `createBlob` promise chain resolves.                                    |

## Examples

**Store an image with a MIME type:**

```javascript
let blob = createBlob(imageBuffer, { type: 'image/jpeg' });
await Photo.put({ id, data: blob });
```

**Stream a blob in as it streams out (low-latency passthrough):**

```javascript
let blob = createBlob(incomingStream);
// blob exists, but data is still streaming to storage
await MyTable.put({ id: 'my-record', data: blob });

let record = await MyTable.get('my-record');
// blob data is accessible as it arrives
let outgoingStream = record.data.stream();
```

**Guarantee full write before commit using `saveBeforeCommit`:**

```javascript
let blob = createBlob(stream, { saveBeforeCommit: true });
await MyTable.put({ id: 'my-record', data: blob });
```

## Notes

- `Blob` stores data separately from the record. If you need the binary data to be a true, ACID-committed part of the record, use a `Bytes` field instead.
- All standard Web API `Blob` methods — `.text()`, `.arrayBuffer()`, `.stream()`, `.slice()`, and `.bytes()` — are available on retrieved blob fields.
- Without `saveBeforeCommit: true`, blobs are **not** ACID-compliant by default; a record can reference a blob before it is fully written to storage.
