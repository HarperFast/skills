# Harper Best Practices

Guidelines for building scalable, secure, and performant applications on Harper. These practices cover everything from initial schema design to advanced deployment strategies.

## 1. Schema & Data Design

### 1.1 Adding Tables with Schemas

Instructions for the agent to follow when adding tables to a Harper database.

#### When to Use

Use this skill when you need to define new data structures or modify existing ones in a Harper database.

#### How It Works

1. **Create Dedicated Schema Files**: Prefer having a dedicated schema `.graphql` file for each table. Check the `config.yaml` file under `graphqlSchema.files` to see how it's configured. It typically accepts wildcards (e.g., `schemas/*.graphql`), but may be configured to point at a single file.
2. **Use Directives**: All available directives for defining your schema are defined in `node_modules/harper/schema.graphql`. Common directives include `@table`, `@export`, `@primaryKey`, `@indexed`, and `@relationship`.
3. **Define Relationships**: Link tables together using the `@relationship` directive. For more details, see the [Defining Relationships](defining-relationships.md) skill.
4. **Enable Automatic APIs**: If you add `@table @export` to a schema type, Harper automatically sets up REST and WebSocket APIs for basic CRUD operations against that table. **Important**: REST endpoints also require `rest: true` in `config.yaml` — without it, `@export`ed tables will not respond to HTTP requests. For a detailed list of available endpoints and how to use them, see the [Automatic REST APIs](automatic-apis.md) skill.
   - `GET /{TableName}`: Describes the resource itself — table, database, and declared attributes. No trailing slash.
   - `GET /{TableName}/`: Lists all records (supports filtering, sorting, and pagination via query parameters). See the [Querying REST APIs](querying-rest-apis.md) skill for details.
   - `GET /{TableName}/{id}`: Retrieves a single record by its primary key.
   - `POST /{TableName}/`: Creates a record and returns `201` with the Harper-assigned primary key in the `Location` response header (the bare key, not a URL). **The trailing slash is required** — `POST /{TableName}` returns `404`, and `POST /{TableName}/{id}` returns `405`.
   - `PUT /{TableName}/{id}`: Creates **or replaces** the record at `{id}` (upsert). **Properties omitted from the body are removed** — send the complete record, or use `PATCH` to change a subset. Three exceptions survive the replacement: an `@updatedTime` attribute is re-stamped with the time of the write, a `@createdTime` attribute keeps its original value, and the primary key is forced to match the `{id}` in the URL, so a mismatched key in the body cannot create a second record.
   - `PATCH /{TableName}/{id}`: Merges the request body into the existing record, preserving unspecified properties. The merge is **shallow** — a nested object in the body replaces the stored one wholesale rather than being deep-merged.
   - `DELETE /{TableName}/{id}`: Deletes a single record by its primary key.
   - `DELETE /{TableName}/`: Deletes every record matching the query parameters. **With no query parameters it matches — and deletes — every record in the table.** Always pass a filter unless emptying the table is the intent.
5. **Consider Table Extensions**: If you are going to [extend the table](./extending-tables.md) in your resources, then do not `@export` the table from the schema.

#### Examples

In a hypothetical `schemas/ExamplePerson.graphql`:

```graphql
type ExamplePerson @table @export {
	id: ID @primaryKey
	name: String
	tag: String @indexed
}
```

### 1.2 Schema Design Tooling

Instructions for the agent to follow when designing Harper schemas, applying core directives, and configuring GraphQL tooling.

#### When to Use

Apply this rule when creating or modifying Harper schema files (`.graphql`), configuring `graphqlSchema` in `config.yaml`, or deciding which directives to apply to tables and fields. Use it whenever a task involves defining tables, primary keys, indexes, or export behavior.

#### How It Works

1. **Register the schema file** in the component's `config.yaml` using the `graphqlSchema` plugin key:

   ```yaml
   graphqlSchema:
     files: 'schema.graphql'
   ```

   Both plugins and applications can specify schemas.

2. **Mark types as tables** using `@table`. The type name becomes the table name by default:

   ```graphql
   type Dog @table {
   	id: Long @primaryKey
   	name: String
   	breed: String
   	age: Int
   }
   ```

3. **Designate a primary key** on every table using `@primaryKey`. Primary keys must be unique; duplicate inserts are rejected. If no primary key is provided on insert, Harper auto-generates one:
   - `String` or `ID` → UUID string
   - `Int`, `Long`, or `Any` → auto-incrementing integer

   Use `Long` or `Any` for auto-generated numeric keys; `Int` is 32-bit and may be insufficient for large tables.

4. **Index fields for querying** using `@indexed`. Required for filtering by an attribute in REST queries, SQL, or NoSQL operations:

   ```graphql
   type Breed @table {
   	id: Long @primaryKey
   	name: String @indexed
   }
   ```

   If the field value is an array, each element is individually indexed. Null values are indexed by default.

5. **Expose tables as REST/MQTT endpoints** using `@export`. The optional `name` parameter sets the URL path segment; without it, the type name is used:

   ```graphql
   type MyTable @table @export(name: "my-table") {
   	id: Long @primaryKey
   }
   ```

   `@export` alone does not serve HTTP traffic — REST must also be enabled for the application via `rest: true` in `config.yaml` or Harper's built-in default. `@export` is a routing directive, not access control; omitting it returns 404 but does not protect the data.

6. **Configure `@table` arguments** to control database placement, expiration, replication, and caching behavior. Key arguments:

   | Argument             | Type      | Default                       | Description                                                    |
   | -------------------- | --------- | ----------------------------- | -------------------------------------------------------------- |
   | `table`              | `String`  | type name                     | Override the table name                                        |
   | `database`           | `String`  | `"data"`                      | Database to place the table in                                 |
   | `expiration`         | `Int`     | —                             | Seconds until a record goes stale                              |
   | `eviction`           | `Int`     | `0`                           | Additional seconds after `expiration` before physical removal  |
   | `scanInterval`       | `Int`     | `(expiration + eviction) / 4` | Seconds between eviction scans                                 |
   | `replicate`          | `Boolean` | `true`                        | Enable replication of this table                               |
   | `cacheControl`       | `String`  | —                             | `Cache-Control` header on anonymous GET/HEAD 200/304 responses |
   | `randomAccessFields` | `Boolean` | `storage.randomAccessFields`  | Pin this table's record encoding                               |

7. **Seal a type** with `@sealed` to prevent records from including properties beyond those declared:

   ```graphql
   type StrictRecord @table @sealed {
   	id: Long @primaryKey
   	name: String
   }
   ```

8. **Use timestamp directives** for automatic record lifecycle tracking:
   - `@createdTime` — assigns Unix epoch milliseconds on record creation
   - `@updatedTime` — assigns Unix epoch milliseconds on each update
   - `@expiresAt` — marks a field as the record's absolute expiration time (Unix epoch milliseconds); authoritative over the table-level `expiration` default

9. **Use `@embed`** to automatically compute an embedding vector for an attribute whenever the source field is written (requires `source` and `model` arguments; field type must be `[Float]`):

   ```graphql
   type Document @table {
   	id: Long @primaryKey
   	text: String
   	embedding: [Float] @embed(source: "text", model: "default")
   }
   ```

10. **Use `@hidden`** on types or fields to suppress them from MCP tool descriptors and the OpenAPI document. This is a metadata-visibility directive only — it does not restrict data access. Use `attribute_permissions` on roles for field-level access control.

#### Examples

**Minimal two-table schema:**

```graphql
type Dog @table {
	id: Long @primaryKey
	name: String
	breed: String
	age: Int
}

type Breed @table {
	id: Long @primaryKey
	name: String @indexed
}
```

**Table with expiration, eviction, and scan tuning:**

```graphql
# Expire after 5 minutes, evict after 1 hour, scan every 10 minutes
type WeatherCache @table(expiration: 300, eviction: 3300, scanInterval: 600) {
	id: ID @primaryKey
	temperature: Float
}
```

**Exported table with public cache control:**

```graphql
type Product @table(cacheControl: "public, max-age=60") @export {
	id: Long @primaryKey
	name: String
	price: Float
}
```

**Table with multiple `@table` arguments combined:**

```graphql
type Event @table(database: "analytics", expiration: 86400) {
	id: Long @primaryKey
	name: String @indexed
}
```

**Session table with per-record expiration:**

```graphql
type Session @table {
	id: ID @primaryKey
	token: String
	expiresAt: Long @expiresAt
}
```

**Table with timestamp tracking and indexed fields:**

```graphql
type Order @table(database: "commerce") @export {
	id: Long @primaryKey
	userId: String @indexed
	status: String @indexed
	createdAt: Long @createdTime
	updatedAt: Long @updatedTime
}
```

**`config.yaml` schema registration:**

```yaml
graphqlSchema:
  files: 'schema.graphql'
```

#### Notes

- Use unique `database` names in plugins and applications to avoid table naming collisions, since all tables default to the `"data"` database.
- Disabling replication (`replicate: false`) and re-enabling it later will not catch up on writes made while replication was disabled.
- `cacheControl` emits the header only on anonymous (unauthenticated) GET/HEAD `200`/`304` responses. Authenticated responses receive `Cache-Control: private, no-cache` regardless of the declaration. The header is never emitted on `401` responses.
- `@expiresAt` requires an absolute Unix epoch millisecond timestamp, not a duration. Negative values are ignored and fall back to the table default. A full-record `put` that omits the field clears it; a `patch` preserves it.
- Eviction removes non-indexed record data but does not remove a record from its secondary indexes; indexes remain functional for evicted records, with full records fetched on demand.
- `scanInterval` is clock-aligned to the server's local timezone, not startup-aligned — the server's startup time does not affect when eviction runs.
- `randomAccessFields` pins the table's encoding at creation time. Editing the argument later does not repin an existing table. Omit it to follow the global `storage.randomAccessFields` setting.

### 1.3 Defining Relationships Between Tables in Harper

Instructions for the agent to follow when defining and querying relationships between tables in Harper using the `@relationship` directive.

#### When to Use

Apply this rule when adding foreign key relationships between schema tables, enabling join queries, or returning nested related records in query results. Use it any time a schema type needs to reference records in another table via a foreign key attribute.

#### How It Works

1. **Use `@relationship(from: attribute)` for many-to-one or many-to-many**: Place this on the field in the table that holds the foreign key. The `from` parameter names the attribute on this table that stores the foreign key referencing the target table's primary key.

   ```graphql
   type RealityShow @table @export {
   	id: Long @primaryKey
   	networkId: Long @indexed
   	network: Network @relationship(from: networkId) # many-to-one
   	title: String @indexed
   }

   type Network @table @export {
   	id: Long @primaryKey
   	name: String @indexed
   }
   ```

   If the foreign key attribute is an array, the relationship becomes many-to-many:

   ```graphql
   type RealityShow @table @export {
   	id: Long @primaryKey
   	networkIds: [Long] @indexed
   	networks: [Network] @relationship(from: networkIds)
   }
   ```

2. **Use `@relationship(to: attribute)` for one-to-many or many-to-many**: Place this on the table whose primary key is referenced by the foreign key in the target table. The `to` parameter names the attribute on the target table that holds the foreign key. The result type **must** be an array.

   ```graphql
   type Network @table @export {
   	id: Long @primaryKey
   	name: String @indexed
   	shows: [RealityShow] @relationship(to: networkId) # one-to-many
   }
   ```

3. **Use `@relationship(from: attribute, to: attribute)` for foreign key to foreign key joins**: Specify both `from` and `to` when neither side uses the primary key. Harper resolves the relationship by searching the target table's `to` attribute for matches using this record's `from` attribute value. The result type must be an array.

   ```graphql
   type OrderItem @table @export {
   	id: Long @primaryKey
   	orderId: Long @indexed
   	productSku: Long @indexed
   	products: [Product] @relationship(from: productSku, to: sku)
   }

   type Product @table @export {
   	id: Long @primaryKey
   	sku: Long @indexed
   	name: String
   }
   ```

4. **Query across relationships using dot-syntax**: Filter records by related table attributes using chained dot notation. This behaves as an INNER JOIN — only records with a matching related record are returned.

   ```
   GET /Product/?brand.name=Microsoft
   GET /Brand/?products.name=Keyboard
   ```

5. **Include relationship fields in results using `select()`**: Relationship attributes are not returned by default. Use `select()` to include them, optionally specifying nested fields with `{}`.

   ```
   GET /Product/?brand.name=Microsoft&select(name,brand)
   GET /Product/?brand.name=Microsoft&select(name,brand{name})
   GET /Product/?name=Keyboard&select(name,brand{name,id})
   ```

   When selecting a relationship without filtering on it, Harper performs a LEFT JOIN — the relationship property is omitted if the foreign key is null or references a non-existent record.

6. **Model many-to-many without a junction table**: Store an array of foreign key values and use `@relationship(from: ...)` pointing to that array attribute. The array order of the foreign key values is preserved when resolving the relationship.

   ```graphql
   type Product @table @export {
   	id: Long @primaryKey
   	name: String
   	resellerIds: [Long] @indexed
   	resellers: [Reseller] @relationship(from: "resellerIds")
   }
   ```

7. **Define self-referential relationships** for parent-child hierarchies by pointing `@relationship` back at the same table type.

#### Examples

**Full schema with bidirectional relationships:**

```graphql
type Product @table @export {
	id: Long @primaryKey
	name: String
	brandId: Long @indexed
	brand: Brand @relationship(from: "brandId")
}

type Brand @table @export {
	id: Long @primaryKey
	name: String
	products: [Product] @relationship(to: "brandId")
}
```

**Querying with joins and nested select:**

```
GET /Product/?brand.name=Microsoft&select(name,brand{name,id})
GET /Brand/?products.name=Keyboard
```

**Many-to-many query with nested select:**

```
GET /Product/?resellers.name=Cool Shop&select(id,name,resellers{name,id})
```

#### Notes

- Every attribute named in `from` or `to` must exist on the respective table and be annotated with `@indexed` to support join queries.
- The `to`-only and `from`+`to` forms both require the result field type to be an array (e.g., `[RealityShow]`).
- The `from`-only form on a non-array attribute produces a many-to-one relationship; on an array attribute it produces many-to-many.
- Self-referential relationships are supported for hierarchical data within a single table.

### 1.4 Vector Indexing

Instructions for the agent to enable HNSW vector indexes on table fields and query them for similarity search in Harper.

#### When to Use

Apply this rule when adding a vector similarity search capability to a Harper table — for example, storing text embeddings and querying for nearest neighbors, filtering by distance threshold, or combining vector search with record-level access control. See [adding-tables-with-schemas.md](adding-tables-with-schemas.md) for how to define the surrounding table schema.

#### How It Works

1. **Declare the vector index** on a `[Float]` field using `@indexed(type: "HNSW")`:

   ```graphql
   type Document @table {
   	id: Long @primaryKey
   	textEmbeddings: [Float] @indexed(type: "HNSW")
   }
   ```

2. **Query nearest neighbors** using `Document.search()` with the `sort` parameter. Set `attribute` to the indexed field and `target` to the query vector:

   ```javascript
   let results = Document.search({
   	sort: { attribute: 'textEmbeddings', target: searchVector },
   	limit: 5,
   });
   ```

3. **Combine with filter conditions** to narrow results before or during graph traversal. Selective conditions are automatically diverted to an exact-scan strategy:

   ```javascript
   let results = Document.search({
   	conditions: [{ attribute: 'price', comparator: 'lt', value: 50 }],
   	sort: { attribute: 'textEmbeddings', target: searchVector },
   	limit: 5,
   });
   ```

4. **Apply a function predicate during traversal** using `vectorFilter` (JavaScript API only). The function receives each candidate record and must return a synchronous boolean. It must be side-effect free and fast:

   ```javascript
   let results = Document.search(
   	{
   		sort: { attribute: 'textEmbeddings', target: searchVector },
   		vectorFilter: (record) =>
   			record.tenantId === context.user.tenantId && record.status === 'published',
   		limit: 10,
   	},
   	context,
   );
   ```

5. **Filter by distance threshold** using `target` directly on a condition alongside `comparator` and `value`. This returns matches within the threshold without using `sort`:

   ```javascript
   let results = Document.search({
   	conditions: {
   		attribute: 'textEmbeddings',
   		comparator: 'lt',
   		value: 0.1,
   		target: searchVector,
   	},
   });
   ```

6. **Include computed distance in results** by adding `$distance` to `select`. Works with both `sort`-based and threshold queries:

   ```javascript
   let results = Document.search({
   	select: ['name', '$distance'],
   	sort: { attribute: 'textEmbeddings', target: searchVector },
   	limit: 5,
   });
   ```

7. **Tune per-query search options** on the `sort` descriptor using `distance` and `ef`:

   ```javascript
   let results = Document.search({
   	sort: { attribute: 'textEmbeddings', target: searchVector, distance: 'dotProduct', ef: 200 },
   	limit: 5,
   });
   ```

8. **Tune filtered traversal** with `ef` and `filterExpansion` when a `vectorFilter` is very selective. The visit budget is `ef * filterExpansion` nodes (`filterExpansion` defaults to `24`):

   ```javascript
   let results = Document.search(
   	{
   		sort: { attribute: 'textEmbeddings', target: searchVector, ef: 200, filterExpansion: 40 },
   		vectorFilter: (record) => record.category === 'rare',
   		limit: 10,
   	},
   	context,
   );
   ```

9. **Enforce row-level access control** using `rowFilter` on search and subscription targets (JavaScript API only). Attach it in an operation override. For vector queries, `rowFilter` participates in HNSW traversal so callers receive the k nearest _matching_ records:

   ```javascript
   function canReadReport(record, context) {
   	const user = context.user;
   	if (user?.role?.permission?.super_user) return true;
   	return user?.username != null && record.ownerId != null && record.ownerId === user.username;
   }

   export class Reports extends tables.Reports {
   	search(target) {
   		target.rowFilter = canReadReport;
   		return super.search(target);
   	}
   }
   ```

##### HNSW Index Parameters

Configure parameters directly on `@indexed(type: "HNSW", ...)`:

| Parameter              | Default           | Description                                                                                      |
| ---------------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| `distance`             | `"cosine"`        | Distance function: `"cosine"`, `"euclidean"`, or `"dotProduct"`                                  |
| `efConstruction`       | `100`             | Max nodes explored during index construction. Higher = better recall, lower = better performance |
| `M`                    | `16`              | Preferred connections per graph layer                                                            |
| `optimizeRouting`      | `0.5`             | Heuristic aggressiveness for omitting redundant connections (0 = off, 1 = most aggressive)       |
| `mL`                   | computed from `M` | Normalization factor for level generation                                                        |
| `efConstructionSearch` | auto-scaled       | Max nodes explored during search. When unset, auto-scales with index size                        |
| `quantization`         | —                 | `"int8"` stores vectors quantized to int8                                                        |
| `filterExpansion`      | `24`              | Visit-budget multiplier for filtered search: visits at most `ef * filterExpansion` nodes         |

Per-query `sort` descriptor options:

| Option     | Values                                    | Description                                            |
| ---------- | ----------------------------------------- | ------------------------------------------------------ |
| `distance` | `"cosine"`, `"euclidean"`, `"dotProduct"` | Overrides the index's distance function for this query |
| `ef`       | integer                                   | Overrides the search exploration budget for this query |

#### Examples

**Index with custom HNSW parameters:**

```graphql
type Document @table {
	id: Long @primaryKey
	textEmbeddings: [Float]
		@indexed(type: "HNSW", distance: "euclidean", optimizeRouting: 0, efConstructionSearch: 100)
}
```

**Index with int8 quantization:**

```graphql
type Document @table {
	id: Long @primaryKey
	textEmbeddings: [Float] @indexed(type: "HNSW", quantization: "int8")
}
```

**Nearest-neighbor search with distance included:**

```javascript
let results = Document.search({
	select: ['name', '$distance'],
	sort: { attribute: 'textEmbeddings', target: searchVector },
	limit: 5,
});
```

**Filtered traversal with tuned budget:**

```javascript
let results = Document.search(
	{
		sort: { attribute: 'textEmbeddings', target: searchVector, ef: 200, filterExpansion: 40 },
		vectorFilter: (record) => record.category === 'rare',
		limit: 10,
	},
	context,
);
```

#### Notes

- `vectorFilter` and `rowFilter` are available from the JavaScript API only; they cannot be set through REST or QUERY request data.
- `vectorFilter` functions must be synchronous, side-effect free, and fast — they can run once per candidate record visited during traversal; verdicts are memoized per query. Records passed to them are frozen.
- `rowFilter` does not apply to a direct primary-key `get`.
- Changing `efConstructionSearch` on an existing index does not trigger a rebuild. Structural parameters (`distance`, `M`, `efConstruction`, `quantization`) do rebuild the index when changed.
- With `quantization: "int8"`, nearest-neighbor `sort` queries re-rank results against full-precision vectors, restoring exact ordering and exact `$distance` values. Distance-threshold (`lt`/`le`) queries filter on the approximate distance.
- The correct parameter name is `efConstruction` (seeds the construction budget) and `efConstructionSearch` (controls search budget). The name `efSearchConstruction` is a previous documentation error.
- When no `ef` is passed and `efConstructionSearch` (or `efConstruction`) is not explicitly set, the search budget auto-scales with index size.
- `cosine` is the default distance function when `distance` is not specified.

### 1.5 Using the Blob Data Type

Instructions for the agent to follow when storing and retrieving large binary content using the `Blob` data type in Harper.

#### When to Use

Apply this rule when a schema field needs to store large binary content such as images, video, audio, or large HTML — typically content larger than 20KB. Use `Blob` instead of `Bytes` when streaming support and out-of-record storage are required. See [handling-binary-data](handling-binary-data.md) for broader binary data guidance.

#### How It Works

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

#### Examples

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

#### Notes

- `Blob` implements the Web API `Blob` interface. All standard methods — `.text()`, `.arrayBuffer()`, `.stream()`, `.slice()`, and `.bytes()` — are available on retrieved blob fields.
- Blobs are stored **separately from the record**, not within it. If you need the binary data to be a true ACID-committed part of the record, use a `Bytes` field instead.
- Any string or buffer assigned to a `Blob`-typed field in a `put`, `patch`, or `publish` is automatically coerced to a `Blob` — manual `createBlob()` calls are not required in those cases.
- Use `saveBeforeCommit: true` whenever downstream consumers must not read a partially written blob.

### 1.6 Handling Binary Data

Instructions for the agent to follow when storing and serving binary data (images, audio, arbitrary content types) in Harper.

#### When to Use

Apply this rule when a Harper resource needs to accept, store, or serve binary payloads such as images, audio files, or calendar data. Use it when clients send raw binary via `PUT`/`POST`, or when they send `base64`-encoded data inside a JSON body.

#### How It Works

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

#### Examples

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

#### Notes

- Always `await` the `record` parameter before accessing its properties; accessing fields on the unresolved promise yields `undefined`.
- `createBlob` accepts a `Buffer` and an options object with a `type` property for the MIME type. Fall back to `application/octet-stream` when no MIME type is provided.
- For schema-level blob field definitions, see [using-blob-datatype.md](using-blob-datatype.md).

## 2. API & Communication

### 2.1 Automatic APIs

Instructions for the agent to follow when using Harper's automatically generated REST and WebSocket APIs for exported tables and resources.

#### When to Use

Apply this rule when enabling HTTP REST endpoints or WebSocket subscriptions for Harper tables and custom resources. Use it whenever you need to configure the REST plugin, understand the auto-generated endpoint surface, or wire up real-time WebSocket connections. See [querying-rest-apis.md](querying-rest-apis.md) for query syntax and [real-time-apps.md](real-time-apps.md) for real-time patterns.

#### How It Works

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

#### Examples

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

#### Notes

- A component directory with **no** `config.yaml` inherits Harper's built-in default, which enables `rest` automatically. As soon as a `config.yaml` exists, it is used verbatim — omitting `rest` from it disables REST even if the directory previously had it without a config file. Always add `rest: true` when adding a config file.
- `POST /Product` (no trailing slash) returns `404`. The trailing slash is required for collection operations.
- A `POST` to a primary key that already exists fails with `409` rather than overwriting.
- PATCH merge is **shallow** — a nested object in the body replaces the stored nested object wholesale; nested properties not included in the body are dropped.
- The `.msgpack` suffix (along with `.json`, `.cbor`, `.csv`) is reserved as a content-type selector and cannot be used as a property name in dot-path access.
- Server-Sent Events subscriptions are served on the same paths, negotiated via `Accept: text/event-stream`; they are not affected by the `webSocket` option.
- See [querying-rest-apis.md](querying-rest-apis.md) for full query syntax on collection endpoints and [real-time-apps.md](real-time-apps.md) for real-time subscription patterns.

### 2.2 Querying REST APIs

Instructions for the agent to filter, sort, select, and paginate records through Harper's URL-based REST query language.

#### When to Use

Apply this rule whenever you need to construct or handle GET requests against Harper collection endpoints that require filtering by attribute value, comparison operators, sorting, field selection, or paginated results. This rule also covers type coercion syntax and relationship joins via dot notation. See [automatic-apis.md](automatic-apis.md) for how REST endpoints are generated from schemas.

#### How It Works

1. **Filter by attribute**: Add query parameters matching attribute names and values. The queried attribute must be indexed.

   ```
   GET /Product/?category=software
   GET /Product/?category=software&inStock=true
   ```

   To filter for null values:

   ```
   GET /Product/?discount=null
   ```

2. **Apply comparison operators (FIQL syntax)**: Use FIQL operators in the query string for range and pattern matching.

   | Operator             | Meaning                                |
   | -------------------- | -------------------------------------- |
   | `==`                 | Equal                                  |
   | `=lt=`               | Less than                              |
   | `=le=`               | Less than or equal                     |
   | `=gt=`               | Greater than                           |
   | `=ge=`               | Greater than or equal                  |
   | `=ne=`, `!=`         | Not equal                              |
   | `=ct=`               | Contains (strings)                     |
   | `=sw=`, `==<value>*` | Starts with (strings)                  |
   | `=ew=`               | Ends with (strings)                    |
   | `=`, `===`           | Strict equality (no type conversion)   |
   | `!==`                | Strict inequality (no type conversion) |

   ```
   GET /Product/?price=gt=100
   GET /Product/?price=le=20
   GET /Product/?name==Keyboard*
   GET /Product/?category=software&price=gt=100&price=lt=200
   ```

   For date fields, URL-encode colons as `%3A`:

   ```
   GET /Product/?listDate=gt=2017-03-08T09%3A30%3A00.000Z
   ```

3. **Chain conditions for range queries**: Omit the attribute name on the second condition to apply it to the same attribute. Only `gt`/`ge` combined with `lt`/`le` is supported.

   ```
   GET /Product/?price=gt=100&lt=200
   ```

4. **Apply type conversion**: For FIQL comparators (`==`, `!=`, `=gt=`, etc.), Harper converts values automatically. Use explicit type prefixes to force a specific type.

   | Syntax                                    | Behavior                                    |
   | ----------------------------------------- | ------------------------------------------- |
   | `name==null`                              | Converts to `null`                          |
   | `name==123`                               | Converts to number if attribute is untyped  |
   | `name==true`                              | Converts to boolean if attribute is untyped |
   | `name==number:123`                        | Explicit number conversion                  |
   | `name==boolean:true`                      | Explicit boolean conversion                 |
   | `name==string:some%20text`                | Keep as string with URL decode              |
   | `name==date:2024-01-05T20%3A07%3A27.955Z` | Explicit Date conversion                    |

   For strict operators (`=`, `===`, `!==`), no automatic type conversion is applied.

5. **Combine conditions with OR logic**: Use `|` instead of `&`.

   ```
   GET /Product/?rating=5|featured=true
   ```

6. **Group conditions**: Use parentheses or square brackets to control evaluation order. Prefer square brackets when building queries from user input, since standard URI encoding safely encodes `[` and `]`.

   ```
   GET /Product/?rating=5|(price=gt=100&price=lt=200)
   GET /Product/?rating=5&[tag=fast|tag=scalable|tag=efficient]
   ```

   Build grouped queries in JavaScript:

   ```javascript
   let url = `/Product/?rating=5&[${tags.map(encodeURIComponent).join('|')}]`;
   ```

7. **Select specific properties with `select()`**: Append `select()` as a query function separated by `&`.

   | Syntax                                 | Returns                                     |
   | -------------------------------------- | ------------------------------------------- |
   | `?select(property)`                    | Values of a single property directly        |
   | `?select(property1,property2)`         | Objects with only the specified properties  |
   | `?select([property1,property2])`       | Arrays of property values                   |
   | `?select(property1,)`                  | Objects with a single specified property    |
   | `?select(property{subProp1,subProp2})` | Nested objects with specific sub-properties |

   ```
   GET /Product/?category=software&select(name)
   GET /Product/?brand.name=Microsoft&select(name,brand{name})
   ```

8. **Limit results with `limit(end)` or `limit(start,end)`**: Append as a query function.

   ```
   GET /Product/?rating=gt=3&inStock=true&select(rating,name)&limit(20)
   GET /Product/?rating=gt=3&limit(10,30)
   ```

9. **Sort results with `sort(property)` or `sort(+property,-property,...)`**: Prefix `+` or no prefix = ascending; `-` = descending. List multiple properties to break ties in order.

   ```
   GET /Product/?rating=gt=3&sort(+name)
   GET /Product/?sort(+rating,-price)
   ```

10. **Paginate with a total count**: Use `limit(start,end)` for paging and send a `Prefer` request header to receive a total match count.

    | `Prefer` value    | Meaning                                  |
    | ----------------- | ---------------------------------------- |
    | `count=exact`     | Exact count of matching records (opt-in) |
    | `count=estimated` | Fast approximate count                   |

    ```
    GET /Product/?category=software&limit(0,25)
    Prefer: count=exact
    ```

    The server responds with:

    | Header               | Example           | Description                                            |
    | -------------------- | ----------------- | ------------------------------------------------------ |
    | `Content-Range`      | `items 0-24/1234` | 0-based inclusive range out of total matching records  |
    | `Range-Unit`         | `items`           | Unit used by `Content-Range`                           |
    | `Preference-Applied` | `count=exact`     | Count mode the server applied (`exact` or `estimated`) |

    The response status is always `200`. When the total cannot be produced, it is reported as `*` (e.g., `Content-Range: items 0-24/*`).

    Enable exact counts in the application's REST configuration:

    ```yaml
    rest:
      exactCount: true
    ```

    Without this, a `count=exact` request is served as an estimate.

11. **Query across relationships using dot syntax**: Define relationships in the schema with `@relationship`, then filter and select across them.

    ```
    GET /Product/?brand.name=Microsoft
    GET /Brand/?products.name=Keyboard
    GET /Product/?brand.name=Microsoft&select(name,brand{name})
    ```

    Filtering on a related attribute produces INNER JOIN behavior. Selecting a relationship without filtering produces LEFT JOIN behavior — the property is omitted if the foreign key is null or references a non-existent record.

12. **Access a specific property by URL**: Append the property name with dot syntax to the record ID.

    ```
    GET /MyTable/123.propertyName
    ```

    This only works for declared schema properties. The suffixes `.json`, `.cbor`, `.msgpack`, and `.csv` are reserved as content-type selectors.

#### Examples

**Range filter with select and sort:**

```
GET /Product/?category=software&price=gt=100&price=lt=200&select(name,price)&sort(+price)
```

**Paginated request with exact count:**

```
GET /Product/?category=software&limit(0,25)
Prefer: count=exact
```

Response headers:

```
HTTP/1.1 200 OK
Content-Range: items 0-24/1234
Range-Unit: items
Preference-Applied: count=exact
```

**Relationship schema and join query:**

```graphql
type Product @table @export {
	id: Long @primaryKey
	name: String
	brandId: Long @indexed
	brand: Brand @relationship(from: "brandId")
}
type Brand @table @export {
	id: Long @primaryKey
	name: String
	products: [Product] @relationship(to: "brandId")
}
```

```
GET /Product/?brand.name=Microsoft&select(name,brand{name,id})
```

**Many-to-many relationship:**

```graphql
type Product @table @export {
	id: Long @primaryKey
	name: String
	resellerIds: [Long] @indexed
	resellers: [Reseller] @relationship(from: "resellerIds")
}
```

```
GET /Product/?resellers.name=Cool Shop&select(id,name,resellers{name,id})
```

**OR grouping with user-supplied tags:**

```javascript
let url = `/Product/?rating=5&[${tags.map(encodeURIComponent).join('|')}]`;
```

#### Notes

- The queried attribute must be indexed for basic attribute filtering to execute. For multi-attribute queries, only one attribute needs to be indexed.
- Null indexing requires indexes created after the feature was introduced. Rebuild existing indexes (remove and re-add) to support `name==null` queries.
- `limit()` must be a non-negative integer no larger than **10,000**, and the requested window (offset + limit) no larger than **1,000,000**, for count headers to be returned.
- A `HEAD` request with a `Prefer: count=exact` header returns count headers with no body — it saves bandwidth but still scans the matched set.
- When CORS is enabled, `Content-Range`, `Range-Unit`, and `Preference-Applied` are added to `Access-Control-Expose-Headers` automatically.
- Operators `!=` and `=ct=` (contains) do not produce cardinality estimates; the total is reported as `*` when these are used with `count=exact`.

### 2.3 Real-Time Apps with WebSockets and Pub/Sub

Instructions for the agent to follow when building real-time features in Harper using WebSockets and Pub/Sub.

#### When to Use

Apply this rule when implementing any feature that requires real-time bidirectional communication, live data streaming, or push-based updates in a Harper application. This includes chat, live dashboards, sensor feeds, and any scenario where clients must receive resource changes as they happen.

#### How It Works

1. **Enable WebSocket support**: WebSocket support is enabled automatically when the `rest` plugin is enabled. To explicitly disable it, set the following in your config:

   ```yaml
   rest:
     webSocket: false
   ```

2. **Connect a client to a resource**: A WebSocket connection to a resource URL automatically subscribes to that resource. When the record changes or a message is published to it, the connection receives the update.

   ```javascript
   let ws = new WebSocket('wss://server/my-resource/341');
   ws.onmessage = (event) => {
   	let data = JSON.parse(event.data);
   };
   ```

   `new WebSocket('wss://server/my-resource/341')` accesses the resource defined for `my-resource` with record id `341` and subscribes to it.

3. **Implement a custom `connect()` handler**: Override the `connect(incomingMessages)` method on a resource class to control WebSocket behavior. The method must return an async iterable (or generator) that produces messages to send to the client. See [automatic-apis.md](automatic-apis.md) for more on defining resource classes.

4. **Use the default `connect()` for event-style access**: Call `super.connect()` to get a streaming iterable that provides:
   - A `send(message)` method for pushing outgoing messages
   - A `close` event for cleanup on disconnect

5. **Handle message ordering in distributed environments**: Harper delivers messages to local subscribers immediately without inter-node coordination delay.

   | Message Type                                             | Behavior                                                                |
   | -------------------------------------------------------- | ----------------------------------------------------------------------- |
   | Non-retained (no `retain` flag)                          | Every message delivered in order received; suitable for chat            |
   | Retained (published with `retain`, or PUT/updated in DB) | Only the latest-timestamp message is kept; suitable for sensor readings |

6. **Use MQTT over WebSockets** when needed by setting the sub-protocol header:
   ```
   Sec-WebSocket-Protocol: mqtt
   ```

#### Examples

**Simple echo server** — override `connect(incomingMessages)` to yield each incoming message back to the client:

```javascript
export class Echo extends Resource {
	async *connect(incomingMessages) {
		for await (let message of incomingMessages) {
			yield message; // echo each message back
		}
	}
}
```

**Custom connect with timer and event-style access** — use `super.connect()` to get the outgoing stream, push periodic messages, echo incoming messages, and clean up on disconnect:

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

#### Notes

- WebSocket connections target a resource URL path. By default, connecting to a resource subscribes to changes for that resource.
- The `connect(incomingMessages)` method **must** return an async iterable or generator; returning a plain value will not work.
- `super.connect()` returns a streaming iterable with `send(message)` and a `close` event — use this when you need to push messages outside of the incoming message loop.
- For one-way real-time streaming without bidirectional communication, consider Server-Sent Events instead.
- For full pub/sub capabilities, Harper also supports MQTT; set `Sec-WebSocket-Protocol: mqtt` to use MQTT over WebSockets.

### 2.4 Checking Authentication

Instructions for the agent to handle user authentication, sessions, and JWT token issuance in Harper Resources.

#### When to Use

Apply this rule when implementing login/logout flows, reading the current authenticated user, issuing or refreshing JWT tokens, or minting scoped tokens from a custom Resource. Use it whenever a Resource must gate behavior on identity or credentials. See [custom-resources.md](custom-resources.md) for the broader Resource authoring model.

#### How It Works

##### 1. Reading the Current Authenticated User

**In an instance method**, call `getCurrentUser()` to get the user associated with the current request, or `undefined` if unauthenticated. The returned object exposes `username`, `role`, and `role.permission` flags.

**In a static verb**, read the user from the `context` argument instead — `context.user`:

```javascript
static async get(_target, context) {
    const user = context?.user;
    if (!user) return new Response(null, { status: 401 });
    return { username: user.username, role: user.role };
}
```

##### 2. Reading the Full Context

**In an instance method**, call `getContext()` to retrieve the current context, which includes:

- `user` — User object with username, role, and authorization information
- `transaction` — The current transaction

**In a static verb**, the context is the trailing argument:

- `(target, context)` for `get`/`delete`
- `(target, data, context)` for `put`/`patch`/`post`

When triggered by HTTP, the context also exposes `url`, `method`, `headers`, `responseHeaders`, `pathname`, `host`, `ip`, `body`, `data`, `lastModified`, and `requestContext`.

##### 3. Handling Sessions and Login

Enable sessions in `harper-config.yaml`:

```yaml
authentication:
  enableSessions: true
```

Use `context.login` in a static `post` verb to verify credentials and establish a session cookie:

```javascript
export class SignIn extends Resource {
	static async post(_target, data, context) {
		const { username, password } = (await data) ?? {};
		try {
			await context.login(username, password);
		} catch {
			return new Response('Invalid credentials', { status: 403 });
		}
		return new Response('Logged in', { status: 200 });
	}
}

export class SignOut extends Resource {
	static async post(_target, _data, context) {
		if (!context?.session?.user) return new Response(null, { status: 401 });
		await context.session.update({ user: null });
		return new Response('Logged out', { status: 200 });
	}
}
```

- `context.login(username, password)` verifies credentials and sets the session cookie on success.
- To end a session, call `context.session.update({ user: null })` — `update` is the session's only mutator.
- `context.session` is an empty object (not `undefined`) when sessions are enabled and no session cookie is present; test `context?.session?.user` to detect an established session.
- Cookie-based sessions are for browser clients. For non-browser clients, use JWT issuance.

##### 4. Creating Authentication Tokens

Call `create_authentication_tokens` with credentials in the body — no `Authorization` header is required when `username` and `password` are supplied:

```json
{
	"operation": "create_authentication_tokens",
	"username": "username",
	"password": "password"
}
```

Response:

```json
{
	"operation_token": "<jwt-operation-token>",
	"refresh_token": "<jwt-refresh-token>"
}
```

Pass the `operation_token` as a `Bearer` token on subsequent requests:

```bash
curl --location --request POST 'http://localhost:9925' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer <operation_token>' \
  --data-raw '{
      "operation": "search_by_hash",
      "schema": "dev",
      "table": "dog",
      "hash_values": [1],
      "get_attributes": ["*"]
  }'
```

##### 5. Refreshing the Operation Token

When the `operation_token` expires, pass the `refresh_token` as `Bearer <refresh_token>` and call `refresh_operation_token`:

```bash
curl --location --request POST 'http://localhost:9925' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer <refresh_token>' \
  --data-raw '{
    "operation": "refresh_operation_token"
  }'
```

Response:

```json
{
	"operation_token": "<new-jwt-operation-token>"
}
```

When both tokens have expired, call `create_authentication_tokens` again with username and password.

##### 6. Minting Scoped Tokens

A `super_user` can mint a scoped token with embedded permissions using `create_authentication_tokens` with an inline `role`. The minter must be authenticated; no `password` may be included in the body. Use `add_role`-style `permission` structure:

```json
{
	"operation": "create_authentication_tokens",
	"username": "reporting-service",
	"role": {
		"permission": {
			"operations": ["read_only"],
			"dev": {
				"tables": {
					"dog": {
						"read": true,
						"insert": false,
						"update": false,
						"delete": false,
						"attribute_permissions": []
					}
				}
			}
		}
	},
	"expires_in": "7d"
}
```

Authenticate the mint request with Basic Authentication or an existing `super_user` `operation_token`:

```bash
curl --location --request POST 'http://localhost:9925' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Basic <base64 of super_user:password>' \
  --data-raw '{
      "operation": "create_authentication_tokens",
      "username": "reporting-service",
      "role": { "permission": { "operations": ["read_only"] } },
      "expires_in": "7d"
  }'
```

Key constraints for scoped tokens:

- `username` is attribution only and must not name an existing user.
- No refresh token is issued; no user record is created.
- Scoped tokens cannot be revoked before expiry — choose `expires_in` carefully and prefer short lifetimes.
- `super_user` and `cluster_user` are always forced to `false` in the embedded role.
- In **mixed-version** clusters, only nodes with scoped-token support accept these tokens; older nodes reject them with 401.

##### 7. Issuing Tokens from a Custom Resource

Use `server.operation()` to mint tokens programmatically inside a Resource. Pass `authorize: true` as the **third argument** when the operation should run as the current authenticated user:

```javascript
import { Resource, server } from 'harper';

export class IssueTokens extends Resource {
	static async get(_target, context) {
		// Issue tokens for the current authenticated user
		const { operation_token, refresh_token } = await server.operation(
			{ operation: 'create_authentication_tokens' },
			context,
			true, // third argument: authorize as current user
		);
		return { operation_token, refresh_token };
	}

	static async post(_target, data) {
		// Issue tokens from credentials supplied in the body
		const { username, password } = await data;
		if (!username || !password) {
			return new Response('username and password required', { status: 400 });
		}
		const { operation_token, refresh_token } = await server.operation({
			operation: 'create_authentication_tokens',
			username,
			password,
		});
		return { operation_token, refresh_token };
	}
}

export class RefreshJWT extends Resource {
	static async post(_target, data) {
		const { refresh_token } = await data;
		if (!refresh_token) {
			return new Response('refresh_token required', { status: 400 });
		}
		const { operation_token } = await server.operation({
			operation: 'refresh_operation_token',
			refresh_token,
		});
		return { operation_token };
	}
}
```

Omit the third argument (or pass `false`) when the operation supplies its own credentials.

##### 8. Configuring Token Expiry

Set timeouts in `harper-config.yaml` under the `authentication` section:

```yaml
authentication:
  operationTokenTimeout: 1d # Default: 1 day
  refreshTokenTimeout: 30d # Default: 30 days
```

Valid duration strings follow the `jsonwebtoken` package format (e.g., `1d`, `12h`, `60m`). The `expires_in` field on scoped token minting accepts the same format.

#### Examples

##### Full Sign-In / Sign-Out Resource

```javascript
export class SignIn extends Resource {
	static async post(_target, data, context) {
		const { username, password } = (await data) ?? {};
		try {
			await context.login(username, password);
		} catch {
			return new Response('Invalid credentials', { status: 403 });
		}
		return new Response('Logged in', { status: 200 });
	}
}

export class SignOut extends Resource {
	static async post(_target, _data, context) {
		if (!context?.session?.user) return new Response(null, { status: 401 });
		await context.session.update({ user: null });
		return new Response('Logged out', { status: 200 });
	}
}
```

##### Reading the Current Authenticated User in a Static Verb

```javascript
static async get(_target, context) {
    const user = context?.user;
    if (!user) return new Response(null, { status: 401 });
    return { username: user.username, role: user.role };
}
```

##### Minting Tokens via cURL

```bash
curl --location --request POST 'http://localhost:9925' \
  --header 'Content-Type: application/json' \
  --data-raw '{
      "operation": "create_authentication_tokens",
      "username": "username",
      "password": "password"
  }'
```

#### Notes

- JWT authentication is **preferred over Basic Auth** when you want to avoid sending credentials on every request, your client can store tokens, or you have multiple sequential requests. For simple or **server-to-server** scenarios, use **Basic Authentication**.
- Always use **HTTPS** in production to protect tokens in transit.
- Treat tokens like passwords. If a token is compromised, it remains valid until expiry — use shorter `operationTokenTimeout` values in high-security environments.
- `context.login` and `context.session` require `enableSessions: true` in `harperdb-config.yaml`; they are for browser clients only.
- The `server.operation()` third argument (`authorize: true`) attributes the operation to — and permission-checks against — the current authenticated user. Omit it when supplying credentials directly in the operation body.
- In **mixed-version** clusters, scoped tokens are only accepted by nodes that support them; older nodes return 401.

## 3. Logic & Extension

### 3.1 Custom Resources

Instructions for the agent to follow when defining custom REST endpoints with JavaScript or TypeScript in Harper.

#### When to Use

Apply this rule when you need to create custom HTTP endpoints, wrap external APIs, or register routes programmatically in a Harper application. Use it any time business logic must live outside a table-backed schema, or when you need fine-grained control over URL shape and path parameters.

#### How It Works

1. **Import `Resource` from the `harper` package**: Always import explicitly rather than relying on globals.

   ```javascript
   import { tables, Resource } from 'harper';
   ```

   CommonJS alternative:

   ```javascript
   const { tables, Resource } = require('harper');
   ```

2. **Define a class that `extends Resource`**: Use `export class` so Harper exposes it as an endpoint. Implement HTTP methods as `static` methods on the class.

   ```javascript
   export class CustomEndpoint extends Resource {
   	static get(target) {
   		return {
   			data: doSomething(),
   		};
   	}
   }
   ```

3. **Use `static` async methods to call external services**: Each HTTP verb maps to a `static` method of the same lowercase name.

   ```javascript
   export class MyExternalData extends Resource {
   	static async get(target) {
   		const response = await fetch(`https://api.example.com/${target.id}`);
   		return response.json();
   	}

   	static async put(target, data) {
   		return fetch(`https://api.example.com/${target.id}`, {
   			method: 'PUT',
   			body: JSON.stringify(await data),
   		});
   	}
   }
   ```

4. **Control the URL by choosing the export form**: The shape of the export determines the resulting URL path.

   | Export form                                 | URL             | Notes                                                           |
   | ------------------------------------------- | --------------- | --------------------------------------------------------------- |
   | `export class Foo extends Resource {}`      | `/Foo/`         | Class name becomes the path segment; case-sensitive.            |
   | `export const Bar = { Foo };`               | `/Bar/Foo/`     | Nest under an object to add a path prefix.                      |
   | `export const bar = { 'foo-baz': Foo };`    | `/bar/foo-baz/` | Use object keys for lowercase, hyphens, or non-identifier URLs. |
   | `export { Foo as '/widget/:id' }`           | `/widget/:id`   | Rename the export to set the path directly.                     |
   | `static path = '/widget/:id'` (class field) | `/widget/:id`   | Declare path on the class; overrides the export name.           |
   | `server.resources.set('my-path', Foo);`     | `/my-path/`     | Programmatic registration; useful when the path is dynamic.     |

   URL path matching is case-sensitive — `/Foo/` and `/foo/` are different endpoints.

5. **Declare dynamic path segments with `static path`**: Use `:name` for a single segment and `*name` as a catch-all. Matched values are bound onto `target.<name>`.

   ```javascript
   export class Widget extends Resource {
   	// GET /widget/10/action/jump  ->  target.id === '10', target.action === 'jump'
   	static path = '/widget/:id/action/:action';
   	static get(target) {
   		return { id: target.id, action: target.action };
   	}
   }

   export class Files extends Resource {
   	// GET /files/a/b/c.txt  ->  target.rest === 'a/b/c.txt'
   	static path = '/files/*rest';
   	static get(target) {
   		return { path: target.rest };
   	}
   }
   ```

   - A leading `/` in `static path` makes the path root-relative (top-level), independent of the file's location.
   - A leading `./` or bare name resolves relative to the component directory.
   - A bare `*` (no name) binds under `target.wildcard`. A wildcard must be the final segment.
   - `static path` takes precedence over the export name.
   - Exact and static paths always win over parameterized ones. Among parameterized routes, more specific paths win: a literal segment beats `:param`, which beats `*`, compared left to right.

6. **Register programmatically when the path is dynamic**: Use `server.resources.set(` with a path string and the resource class.

   ```javascript
   server.resources.set('my-path', Foo);
   ```

7. **Optionally use a resource as a cache source for a local table**: Call `sourcedFrom` on the target table.
   ```javascript
   tables.MyCache.sourcedFrom(MyExternalData);
   ```

#### Examples

**Custom endpoint with external API wrapping:**

```javascript
import { tables, Resource } from 'harper';

export class MyExternalData extends Resource {
	static async get(target) {
		const response = await fetch(`https://api.example.com/${target.id}`);
		return response.json();
	}

	static async put(target, data) {
		return fetch(`https://api.example.com/${target.id}`, {
			method: 'PUT',
			body: JSON.stringify(await data),
		});
	}
}

// Use as a cache source for a local table
tables.MyCache.sourcedFrom(MyExternalData);
```

**Path parameters with `static path`:**

```javascript
import { Resource } from 'harper';

export class Widget extends Resource {
	// GET /widget/10/action/jump  ->  target.id === '10', target.action === 'jump'
	static path = '/widget/:id/action/:action';
	static get(target) {
		return { id: target.id, action: target.action };
	}
}

export class Files extends Resource {
	// GET /files/a/b/c.txt  ->  target.rest === 'a/b/c.txt'
	static path = '/files/*rest';
	static get(target) {
		return { path: target.rest };
	}
}
```

**Programmatic registration:**

```javascript
import { Resource } from 'harper';

export class Foo extends Resource {
	static get(target) {
		return { ok: true };
	}
}

server.resources.set('my-path', Foo);
```

#### Notes

- Avoid conflicting exports between the schema and the JavaScript implementation when a resource `extends` an existing table.
- Parameterized routes appear in the generated OpenAPI document as templated paths (e.g. `/widget/{id}/action/{action}`) and in MCP `resources/templates/list` as `{param}` URI templates.
- When bundling for SSR with a tool like Vite, keep `harper` external so it resolves to the runtime: `ssr: { external: ['harper'] }`.
- For components in their own directory, run `npm link harper` to ensure typings match the running installation.

### 3.2 Extending Tables

Instructions for the agent to follow when adding custom logic to automatically generated table resources in Harper.

#### When to Use

Apply this rule when you need to override or augment the default HTTP handler behavior (GET, POST, PUT, PATCH, DELETE) for a Harper table resource. Use it when a table needs computed properties, input transformation, authorization checks, or custom error responses.

#### How It Works

1. **Define the table schema without `@export`**: In `schema.graphql`, declare the table type but omit the `@export` directive. Leaving `@export` on the schema while also exporting a subclass with the same name produces conflicting endpoints.

   ```graphql
   # Omit the `@export` directive
   type MyTable @table {
   	id: Long @primaryKey
   	# ...
   }
   ```

2. **Extend the generated table class in `resources.js`**: Use `extends tables.<TableName>` to subclass the auto-generated resource. The exported JavaScript class owns the URL instead of the schema type.

   ```javascript
   export class MyTable extends tables.MyTable {
   	static async get(target) {
   		const record = await super.get(target);
   		return { ...record, computedField: 'value' };
   	}

   	static async post(target, data) {
   		return this.create({ ...(await data), status: 'pending' });
   	}
   }
   ```

3. **Call `super` with the correct argument form per operation**: When delegating to the default behavior, match arguments to the operation type:
   - Reads and deletes: `super.get(target)` / `super.delete(target)`
   - Collection create: `super.post(target, record)` — target carries no id
   - Updates: `super.put(target, data)` / `super.patch(target, data)`

4. **Set `statusCode` on thrown errors to control HTTP status**: A plain `.status` property is ignored. Use `.statusCode` on the error object:

   ```javascript
   const error = new Error('Name is required');
   error.statusCode = 400; // use statusCode, NOT status
   throw error;
   ```

   Uncaught errors are caught by the protocol handler and produce error responses for REST.

5. **Configure Harper to load both files**: Ensure your configuration references the schema and resource files:

   ```yaml
   rest: true
   graphqlSchema:
     files: schema.graphql
   jsResource:
     files: resources.js
   ```

#### Examples

Full example extending a table with a computed GET response, a custom POST, and a guarded handler that throws a typed error:

```javascript
export class MyTable extends tables.MyTable {
	static async get(target) {
		// get the record from the database
		const record = await super.get(target);
		// add a computed property before returning
		return { ...record, computedField: 'value' };
	}

	static async post(target, data) {
		// custom action on POST; return the write so the response waits for the commit
		return this.create({ ...(await data), status: 'pending' });
	}

	static async delete(target) {
		if (!authorized) {
			const error = new Error('Forbidden');
			error.statusCode = 403;
			throw error;
		}
		return super.delete(target);
	}
}
```

#### Notes

- Always omit `@export` from the schema type when you export a subclass with the same name in JavaScript. The exported class owns the endpoint registration.
- Call `super.get/post/put/patch/delete` to preserve Harper's default behavior unless you intend to replace it entirely.
- `statusCode` on an error object controls the HTTP response status for REST. A `.status` property is ignored.
- See [`Database / Schema`](/reference/v5/database/schema.md) for full schema API details.

### 3.3 Programmatic Table Requests

Instructions for the agent to follow when interacting with Harper tables programmatically using the `tables` object.

#### When to Use

Apply this rule when writing server-side Harper component code that reads from or writes to tables using the programmatic API — for example, in HTTP handlers, background jobs, timers, or SSR entry points. Use it whenever you need to construct queries with `conditions`, `sort`, `select`, pagination, or transactions outside of the REST layer.

#### How It Works

1. **Import `tables` (and other APIs) from `harper`**: Access every table defined in `schema.graphql` as a property of `tables`. Each property is the table class implementing the Resource API.

   ```javascript
   import { tables, transaction } from 'harper';
   const { Product } = tables;
   // same as: databases.data.Product
   ```

   For components in their own directory, run:

   ```bash
   npm link harper
   ```

   All installed components have `harper` automatically linked.

2. **Define your schema with `@table`**: Every type you want to access via `tables` must carry the `@table` directive. Mark queryable fields with `@indexed`.

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	name: String
   	price: Float
   }
   ```

3. **Query records using `search(`**: Pass a Query object to `search()`. The query is an async iterable.

   ```javascript
   const query = {
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 8.0 }],
   };
   for await (const record of Product.search(query)) {
   	// process record
   }
   ```

4. **Build `conditions`**: Each condition object supports the following properties:

   | Property     | Description                                                                                                                                              |
   | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `attribute`  | Property name, or array for chained/joined properties (e.g. `['brand', 'name']`)                                                                         |
   | `value`      | The value to match                                                                                                                                       |
   | `comparator` | `equals` (default), `greater_than`, `greater_than_equal`, `less_than`, `less_than_equal`, `starts_with`, `contains`, `ends_with`, `between`, `not_equal` |
   | `conditions` | Nested conditions array                                                                                                                                  |
   | `operator`   | `and` (default) or `or` for the nested `conditions`                                                                                                      |

5. **Apply `select` to shape results**: Pass an array of property names, a string for a single property, or nested objects for relationships.

   ```javascript
   // Flat select
   Product.search({ select: ['name', 'price'] });

   // Nested relationship select
   Book.get({ id: 42, select: ['id', 'title', { name: 'author', select: ['name'] }] });
   ```

   Special `select` values: `$id`, `$updatedtime`, `$distance`.

6. **Apply `sort`**: Harper uses an index to provide sort order.

   | Property     | Description                                                |
   | ------------ | ---------------------------------------------------------- |
   | `attribute`  | Property name (or array for chained relationship property) |
   | `descending` | Sort descending if `true` (default: `false`)               |
   | `next`       | Secondary sort to resolve ties (same structure)            |
   - If the sort `attribute` is `@indexed`, no condition is required.
   - If the sort `attribute` is not indexed, at least one entry in `conditions` (on **any** attribute) is required.
   - Sorting by a non-indexed attribute with zero conditions raises:
     > `HdbError: <attribute> is not indexed and not combined with any other conditions`
   - The bare `@primaryKey` is treated as not indexed for sort purposes. To iterate in primary-key order, add an open-ended condition:

     ```javascript
     Product.search({
     	conditions: [{ attribute: 'id', comparator: 'greater_than', value: '' }],
     	sort: { attribute: 'id' },
     });
     ```

   - Pass `allowFullScan: true` to permit an unconditional ordered scan, or omit `sort` entirely to iterate without an index requirement.

7. **Paginate with `limit` and `offset`**:

   ```javascript
   Product.search({ conditions: [...], limit: 20, offset: 40 });
   ```

8. **Debug with `explain` and `enforceExecutionOrder`**:
   - `explain: true` — returns conditions reordered as Harper will execute them.
   - `enforceExecutionOrder: true` — forces conditions to execute in the order supplied, disabling Harper's automatic re-ordering.

9. **Use `addTo` for concurrent-safe increments**: `addTo(property, value)` uses CRDT incrementation, safe across threads and nodes.

   ```javascript
   static async post(target, data) {
     const record = await this.update(target.id);
     record.addTo('quantity', -1);
   }
   ```

10. **Wrap background work in `transaction()`**: Harper auto-starts transactions for HTTP handlers. Use `transaction()` explicitly for timers, background jobs, or any code outside a natural transaction context.

    ```javascript
    await transaction(async (txn) => {
    	for (let item of data) {
    		await MyTable.put(item, txn);
    	}
    });
    ```

    The `txn` object exposes:

    | Member                | Type            | Description                                            |
    | --------------------- | --------------- | ------------------------------------------------------ |
    | `commit()`            | `() => Promise` | Commits the current transaction                        |
    | `abort()`             | `() => void`    | Aborts the transaction and resets it                   |
    | `resetReadSnapshot()` | `() => void`    | Resets the read snapshot to the latest committed state |
    | `timestamp`           | `number`        | Timestamp associated with the current transaction      |

    On normal callback completion the transaction commits automatically. If the callback throws, the transaction is aborted.

11. **Understand atomicity**: Transactions span a single database. All tables within the same database share one transactional context — reads return a consistent snapshot and writes across multiple tables commit atomically. Cross-database operations get separate transactions with no cross-database atomicity guarantee.

12. **Keep `harper` external when bundling for SSR**: In `vite.config`, mark `harper` as external so it resolves to the runtime rather than being bundled.

    ```javascript
    // vite.config
    ssr: {
    	external: ['harper'];
    }
    ```

#### Examples

**Full CRUD flow:**

```javascript
import { tables } from 'harper';
const { Product } = tables;

// Create
const created = await Product.create({ name: 'Shirt', price: 9.5 });

// Patch
await Product.patch(created.id, { price: Math.round(created.price * 0.8 * 100) / 100 });

// Get by primary key
const record = await Product.get(created.id);

// Search with conditions
for await (const record of Product.search({
	conditions: [{ attribute: 'price', comparator: 'less_than', value: 8.0 }],
})) {
	// process record
}
```

**Nested conditions with `or`:**

```javascript
Product.search({
	conditions: [
		{ attribute: 'price', comparator: 'less_than', value: 100 },
		{
			operator: 'or',
			conditions: [
				{ attribute: 'rating', comparator: 'greater_than', value: 4 },
				{ attribute: 'featured', value: true },
			],
		},
	],
});
```

**Chained attribute reference (join):**

```javascript
Product.search({ conditions: [{ attribute: ['brand', 'name'], value: 'Harper' }] });
```

**Background job with `transaction()`:**

```javascript
import { isMainThread } from 'node:worker_threads';
import { tables, transaction } from 'harper';
const { MyTable } = tables;

if (isMainThread) {
	let running = false;
	setInterval(async () => {
		if (running) return;
		running = true;
		try {
			let data = await (await fetch('https://example.com/data')).json();
			await transaction(async (txn) => {
				for (let item of data) {
					await MyTable.put(item, txn);
				}
			});
		} catch (error) {
			logger.error('hourly import failed', error);
		} finally {
			running = false;
		}
	}, 3600000);
}
```

**SSR with Harper data:**

```typescript
import { tables } from 'harper';

export async function render(url: string): Promise<string> {
	const product = await tables.Product.get(idFromUrl(url));
	return renderToString(/* <App product={product} /> */);
}
```

#### Notes

- `tables` and `databases` calls run in a trusted server-side context and do **not** automatically apply the target table's role permissions.
- Programmatic `update`, `patch`, and `delete` calls operate directly on stored data. Scope destructive operations with specific `conditions`, validate the affected set before writing, and gate them behind authorization controls.
- If `transaction()` is called with a context that already has an active transaction, it reuses that transaction — making it safe to call defensively.
- Always `await` the `transaction()` call and `catch` errors when outside a request context; an unawaited call means a failed write is never observed.
- Guard against timer overlap: if a job can outlast its interval, use a `running` flag to skip a tick rather than opening two transactions over the same rows.
- CommonJS is also supported: `const { tables, Resource } = require('harper');`

### 3.4 TypeScript Type Stripping in Harper

Instructions for the agent to run `.ts` files directly in Harper without a build step using Node.js's built-in type stripping.

#### When to Use

Apply this rule when writing Harper resource files in TypeScript. Use it any time you need to reference `.ts` source files from `config.yaml` or import between local TypeScript modules in a Harper project.

#### How It Works

1. **Ensure Node.js version**: Require Node.js 22.6 or later. Type stripping is unavailable on earlier versions.

2. **Point `jsResource` at `.ts` files**: The `jsResource` plugin loads both `.js` and `.ts` files. Set its `files` glob in `config.yaml` to target your `.ts` source files:

   ```yaml
   jsResource:
     files: 'resources/*.ts'
   ```

3. **Use explicit `.ts` extensions in local imports**: Node's loader does not resolve `'./helper'` to `'./helper.ts'`, so always include the full extension:

   ```typescript
   import { helper } from './helper.ts';
   ```

4. **Stay within type-stripping limits**: Only type annotations and declarations are removed. Do not use enums with runtime values, namespaces with runtime semantics, or any other features that require code transformation beyond type stripping.

#### Examples

A complete Harper resource written in TypeScript, using imports from the `harper` package:

```typescript
import { type RequestTargetOrId, Resource, tables } from 'harper';

export class MyResource extends Resource {
	async get(target?: RequestTargetOrId): Promise<{ message: string }> {
		return { message: 'Hello from TS' };
	}
}
```

Paired `config.yaml` entry loading the file via `jsResource`:

```yaml
jsResource:
  files: 'resources/*.ts'
```

#### Notes

- No build step or transpiler is required — Harper runs `.ts` files directly.
- Type imports (e.g., `import { type RequestTargetOrId }`) from the `harper` package work as usual.
- Unsupported TypeScript features include: enums with runtime values, namespaces with runtime semantics, and anything requiring code transformation beyond simple type stripping.

### 3.5 Caching External Data Sources in Harper

Instructions for the agent to implement integrated data caching from external sources using Harper's cache table directives and `sourcedFrom` API.

#### When to Use

Apply this rule when an application needs to wrap an external API, microservice, or database with a fast local cache. Use it when you need to define TTL-based cache expiration, connect an upstream data source to a Harper table, or implement on-demand cache invalidation.

#### How It Works

1. **Define a cache table with `expiration`**: Add the `expiration` argument to the `@table` directive in `schema.graphql`. The value is in seconds. When a record becomes stale, the next request fetches a fresh copy from the upstream source.

   ```graphql
   type JokeCache @table(expiration: 60) @export {
   	id: ID @primaryKey
   	setup: String
   	punchline: String
   }
   ```

2. **Implement an upstream source object**: In `resources.js`, create an object with a `get(id)` method that fetches data from the external API.

   ```javascript
   const jokeAPI = {
   	async get(id) {
   		const response = await fetch(`https://official-joke-api.appspot.com/jokes/${id}`);
   		return response.json();
   	},
   };
   ```

3. **Connect the source with `sourcedFrom`**: Call `sourcedFrom` on the table to register the upstream source. Harper will call `jokeAPI.get()` automatically when a record is missing or stale.

   ```javascript
   tables.JokeCache.sourcedFrom(jokeAPI);
   ```

   Harper's request flow after `sourcedFrom` is registered:
   - Request arrives for `/JokeCache/1`.
   - Harper checks if the record exists and is not stale.
   - If fresh, Harper returns it immediately.
   - If missing or stale, Harper calls `jokeAPI.get()`, stores the result in `JokeCache`, and returns it.
   - Multiple simultaneous requests for the same missing or stale record wait on a single upstream call — Harper prevents cache stampedes automatically.

4. **Configure plugins in `config.yaml`**: Enable `graphqlSchema`, `rest`, and `jsResource`.

   ```yaml
   graphqlSchema:
     files: 'schema.graphql'
   rest: true
   jsResource:
     files: 'resources.js'
   ```

5. **Implement on-demand invalidation**: To invalidate a cache entry before its TTL expires, export a class extending the table and call `this.invalidate(target)` in a `post` handler. Remove `@export` from the schema when using this pattern — the exported class provides the endpoint.

   ```javascript
   export class JokeCache extends tables.JokeCache {
   	static async post(target, data) {
   		const body = await data;
   		if (body?.action === 'invalidate') {
   			this.invalidate(target);
   			return { status: 200, data: { message: 'invalidated' } };
   		}
   	}
   }
   ```

   Update the schema to remove `@export`:

   ```graphql
   type JokeCache @table(expiration: 60) {
   	id: ID @primaryKey
   	setup: String
   	punchline: String
   }
   ```

#### Examples

**Complete `resources.js`**:

```javascript
// resources.js

const jokeAPI = {
	async get(id) {
		const response = await fetch(`https://official-joke-api.appspot.com/jokes/${id}`);
		return response.json();
	},
};

tables.JokeCache.sourcedFrom(jokeAPI);

export class JokeCache extends tables.JokeCache {
	static async post(target, data) {
		const body = await data;
		if (body?.action === 'invalidate') {
			this.invalidate(target);
			return { status: 200, data: { message: 'invalidated' } };
		}
	}
}
```

**Complete `schema.graphql`**:

```graphql
type JokeCache @table(expiration: 60) {
	id: ID @primaryKey
	setup: String
	punchline: String
}
```

**Fetch a cached record**:

```javascript
const response = await fetch('http://localhost:9926/JokeCache/1');
console.log(response.status); // 200
const etag = response.headers.get('etag'); // e.g. "abCDefGHij"
const joke = await response.json();
```

**Use ETag for conditional requests** (returns `304 Not Modified` if unchanged):

```javascript
const second = await fetch('http://localhost:9926/JokeCache/1', {
	headers: { 'If-None-Match': etag },
});
console.log(second.status); // 304
```

**Bypass the cache with `Cache-Control: no-cache`**:

```javascript
const response = await fetch('http://localhost:9926/JokeCache/1', {
	headers: { 'Cache-Control': 'no-cache' },
});
```

**Trigger invalidation via POST**:

```javascript
await fetch('http://localhost:9926/JokeCache/1', {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ action: 'invalidate' }),
});
```

#### Notes

- `expiration` is measured in seconds. Harper also supports separate `eviction` and `scanInterval` arguments on `@table` for fine-grained control over physical record removal.
- ETags are automatically computed from a record's last-modified timestamp. Include the double quotes when passing an ETag back in `If-None-Match` — they are part of the value.
- Exporting a class with the same name as a table (e.g., `export class JokeCache extends tables.JokeCache`) registers it as the HTTP endpoint for that table; `@export` in the schema is not required separately.
- For defining custom upstream source behavior beyond a simple `get`, see [custom-resources.md](custom-resources.md).
- For details on how `@table` and `@export` expose REST endpoints automatically, see [automatic-apis.md](automatic-apis.md).

## 4. Infrastructure & Ops

### 4.1 Deploying to Harper Fabric

Instructions for the agent to follow when deploying a Harper application to a remote Harper Fabric cloud cluster.

#### When to Use

Apply this rule when deploying a Harper application to a remote Harper Fabric cluster, whether from a local machine or a CI/CD pipeline. Use it to configure authentication, select a package source, and run `harper deploy` with the correct parameters.

See [creating-a-fabric-account-and-cluster.md](creating-a-fabric-account-and-cluster.md) to set up a cluster before deploying.

#### How It Works

1. **Authenticate against the cluster**: Run `harper login` once, pointing at the cluster's Application URL (found on the cluster's **Config → Overview** page). The CLI stores the token so subsequent commands need no credentials. If the current directory already has a `.env` file that sets no target, it also appends `HARPER_CLI_TARGET` to it.

   ```bash
   harper login <Application URL>
   # Provide cluster username and password when prompted
   ```

2. **Deploy the application**: After logging in, run `harper deploy` without repeating credentials. Omit `package` to package and deploy the current local directory.

   ```bash
   harper deploy \
     project=<name> \
     package=<package> \
     target=<remote> \
     restart=true \
     replicated=true
   ```

3. **Choose a package source**: Set `package` to any valid npm dependency value.

   | Value                                                        | Meaning                                        |
   | ------------------------------------------------------------ | ---------------------------------------------- |
   | _(omit)_                                                     | Package and deploy the current local directory |
   | `package="@harperdb/status-check"`                           | npm package                                    |
   | `package="HarperFast/status-check"`                          | GitHub shorthand                               |
   | `package="https://github.com/HarperFast/status-check"`       | GitHub URL                                     |
   | `package="git+ssh://git@github.com:HarperDB/secret-app.git"` | Private repo (SSH)                             |
   | `package="https://example.com/application.tar.gz"`           | Tarball                                        |

   When using git tags, use the `semver` directive:

   ```
   HarperFast/application-template#semver:v1.0.0
   ```

4. **Deploy by reference** (pinned commit): Use `by_ref=true` to send a pinned git reference instead of uploading a snapshot. The cluster fetches and builds that exact commit.

   ```bash
   harper deploy by_ref=true restart=true replicated=true
   ```

   - `by_ref` — Build the package reference from the local repository.
   - `ref` _(optional)_ — Deploy a specific commit, tag, or branch instead of `HEAD`. Implies `by_ref`. Resolved to a full commit SHA before being sent.
   - `credential` _(optional)_ — Set to `true` to authenticate the clone with the stored credential for the repository's host. Omit for public repositories.

   Deploy a specific tag or commit:

   ```bash
   harper deploy ref=v1.2.0 restart=true replicated=true
   harper deploy ref=9f8c2a1 restart=true replicated=true
   ```

   Valid `ref` values must resolve to `refs/heads/*` or `refs/tags/*`, or a bare branch or tag name. Qualified refs outside those two namespaces (e.g. `refs/pull/123/head`) are rejected. A full commit SHA is always accepted directly with no resolution attempted. Run `git fetch` if a ref can't be resolved, or pass a full commit SHA.

   **Commit and push before deploying by reference.** The cluster clones from the remote and only sees pushed commits.

5. **Roll back to a previous release**: Activate a kept release by its `deployment_id` to restore the exact installed release without a fetch, rebuild, or reinstall.

   ```bash
   harper deploy project=<name> deployment_id=<id> restart=true
   ```

6. **Provision a deploy credential for private repositories**: Run `harper deploy setup=true` once per component and source. This requires **super_user** privileges — run it with an administrative credential.

   ```bash
   harper deploy setup=true
   ```

   The setup flow:
   1. Fetches the cluster's public key with `get_secrets_public_key`.
   2. Encrypts the token locally into an `enc:v1:` envelope.
   3. Stores only the ciphertext with `set_secret`, scoped to the component.
   4. Grants the component permission to resolve it with `grant_secret`.
   5. Prints the `credentials` reference for the deploy to use.

   The plaintext never leaves your machine. Prefer a **fine-grained** personal access token with **Contents: Read-only** on the target repository. Avoid broad session tokens — they typically carry `read:org`, `gist`, and `workflow` scopes across your whole account.

7. **Deploy from a private repository**: Pass `credential=true` after provisioning the deploy credential.

   ```bash
   harper deploy by_ref=true credential=true restart=true replicated=true
   ```

8. **Use one-off authentication parameters** (not recommended for production): Pass `auth_username` and `auth_password` directly. These take precedence over environment variables and saved login tokens.

   ```bash
   harper deploy \
     project=<name> \
     package=<package> \
     auth_username=<username> \
     auth_password=<password> \
     target=<remote> \
     restart=true \
     replicated=true
   ```

9. **Use CI/CD pipelines**: For GitHub Actions, use workload identity (OIDC) so no Harper credential is stored in the pipeline. Alternatively, supply a refresh token from `harper login --for-ci`. On a `pull_request` run, pass the head SHA explicitly:

   ```bash
   harper deploy ref=${{ github.event.pull_request.head.sha }} restart=true replicated=true
   ```

#### Examples

**Login and deploy the current directory to a remote cluster:**

```bash
harper login https://my-cluster.harperdbcloud.com
harper deploy \
  project=my-app \
  target=https://my-cluster.harperdbcloud.com \
  restart=true \
  replicated=true
```

**Deploy a specific GitHub repository by tag:**

```bash
harper deploy \
  project=my-app \
  package="HarperFast/application-template#semver:v1.0.0" \
  target=https://my-cluster.harperdbcloud.com \
  restart=true \
  replicated=true
```

**Deploy by reference from a private repository after provisioning credentials:**

```bash
# Provision once (requires super_user)
harper deploy setup=true

# Deploy by reference with credential
harper deploy by_ref=true credential=true restart=true replicated=true
```

**Roll back to a previous deployment:**

```bash
harper deploy project=my-app deployment_id=<id> restart=true
```

#### Notes

- The cluster's Application URL is found on the **Config → Overview** page.
- `harper deploy setup=true` requires **super_user** — run it with an administrative credential, not the CI identity it provisions for.
- Secrets are stored scoped to the component, never in the global `processEnv` tier. The `enc:v1:` envelope is the only form of the token that ever leaves your machine or travels over the operations API.
- For SSH-based private repos, use the `add_ssh_key` operation to register keys before deploying.
- A `ref` pointing to `refs/tags` is resolved to a full commit SHA before the deploy is sent. Tags that move mid-deploy could otherwise leave cluster nodes running different code.
- The unpushed-commit check is skipped under GitHub Actions; the dirty-tree warning still applies.
- Deploying by reference means the cluster installs and builds from source. If your application requires a build step that cannot run on the node, deploy a built payload instead.

### 4.2 Creating a Harper Fabric Account and Cluster

Follow these steps to set up your Harper Fabric environment for deployment.

#### How It Works

1. **Sign Up/In**: Go to [https://fabric.harper.fast/](https://fabric.harper.fast/) and sign up or sign in.
2. **Create an Organization**: Create an organization (org) to manage your projects.
3. **Create a Cluster**: Create a new cluster. This can be on the free tier, no credit card required.
4. **Set Credentials**: During setup, set the cluster username and password to finish configuring it.
5. **Get Application URL**: Navigate to the **Config** tab and copy the **Application URL**.
6. **Configure Environment**: Update your `.env` file or GitHub Actions secrets with cluster-specific credentials.
7. **Next Steps**: See the [deploying-to-harper-fabric](deploying-to-harper-fabric.md) rule for detailed instructions on deploying your application successfully.

#### Examples

##### Environment Configuration

```bash
CLI_TARGET_USERNAME='YOUR_CLUSTER_USERNAME'
CLI_TARGET_PASSWORD='YOUR_CLUSTER_PASSWORD'
CLI_TARGET='YOUR_CLUSTER_URL'
```

### 4.3 Creating Harper Applications

The fastest way to start a new Harper project is using the `create-harper` CLI tool. This command
initializes a project with a standard folder structure, essential configuration files, and basic
schema definitions.

#### When to Use

Use this command when starting a new Harper application or adding a new Harper microservice to an
existing architecture.

#### Commands

Initialize a project using your preferred package manager:

##### NPM

```bash
npm create harper@latest
```

##### PNPM

```bash
pnpm create harper@latest
```

##### Bun

```bash
bun create harper@latest
```

#### Options

You can specify the project name and template directly:

```bash
npm create harper@latest my-app --template default
```

#### Next Steps

1. **Configure Environment**: Set up your `.env` file with local or cloud credentials.
2. **Define Schema**: Modify `schema.graphql` to fit your application's data model.
3. **Start Development**: Run `npm run dev` to start the local Harper instance.
4. **Deploy**: Use `npm run deploy` to push your application to Harper Fabric.

### 4.4 Serving Web Content

Instructions for the agent to follow when serving web content from Harper.

#### When to Use

Use this skill when you need to serve a frontend (HTML, CSS, JS, or a React/Vue app) directly from your Harper instance — either plain static files or an integrated Vite app with hot module replacement (HMR) in development and a real production build when deployed.

#### How It Works

There are two building blocks. Harper's built-in `static` plugin **serves** files; the `@harperfast/vite` plugin **builds** (and, for SSR, **renders**) a Vite app. For a Vite app they work **together** — the plugin builds into a directory and `static` serves that same directory.

##### Option A: Static plugin only (simple, pre-built assets)

For a plain static site or already-built assets, use `static` on its own:

```yaml
static:
  files: 'web/*'
```

- Place files in a `web/` folder in the project root; they are served from the root URL (e.g. `http://localhost:9926/index.html`).
- Static files are matched first; if none matches, Harper falls through to your resource and table APIs.

##### Option B: Vite plugin + static plugin (integrated Vite app)

> **Renamed in v1:** the plugin was previously `@harperfast/vite-plugin`. From `1.0.0` on it is **`@harperfast/vite`** (same key and `package`). It now pairs with the `static` plugin instead of building into `web/` itself.

`@harperfast/vite` **builds** your app — in `harper dev` it runs Vite in middleware mode with HMR; in `harper run` it runs `vite build` and rebuilds when watched files change (and renders HTML for SSR). The `static` plugin **serves** the built output. Point both at the same directory (`output`, default `dist`) — that shared directory is the only contract between them.

**SPA `config.yaml`** — list the plugin first so its dev server wins in `harper dev`; `notFound` + `fallthrough: false` makes client-side routing work:

```yaml
'@harperfast/vite':
  package: '@harperfast/vite'
  files: 'src/**/*'
  output: 'dist'

static:
  files: 'dist/**'
  notFound:
    file: 'index.html'
    statusCode: 200
  fallthrough: false
```

**SSR `config.yaml`** — add an `ssr` entry so the plugin renders `index.html`, and set `index: false` on `static` so it serves assets only:

```yaml
'@harperfast/vite':
  package: '@harperfast/vite'
  files: 'src/**/*'
  output: 'dist'
  ssr: 'src/entry-server.tsx'

static:
  files: 'dist/**'
  index: false
```

- Install dependencies: `npm install --save-dev vite @harperfast/vite @vitejs/plugin-react` (swap in your framework's Vite plugin, e.g. `@vitejs/plugin-vue`).
- Then `harper dev .` runs the app with HMR and `harper run .` runs the production build. Vite does _not_ need to be executed separately.

#### Reading Harper Data During SSR

The render entry (`src/entry-server.tsx`) runs **inside Harper**, so it can read straight from the database and render the data into the HTML — no client-side fetch/XHR. `tables` is the same live, process-wide registry available everywhere (see [Programmatic Table Requests](programmatic-table-requests.md)); import it and query a table in an async `render`:

```tsx
import { tables } from 'harper';

export async function render(url: string): Promise<string> {
	const product = await tables.Product.get(idFromUrl(url));
	return renderToString(
		<StrictMode>
			<App product={product} />
		</StrictMode>,
	);
}
```

Keep `harper` external in `vite.config.ts` so this import resolves to Harper's running runtime instead of being bundled. `node_modules/harper` is symlinked to the running install, and symlinked deps aren't reliably auto-externalized for SSR:

```typescript
export default defineConfig({
	ssr: { external: ['harper'] },
	// ...plugins, resolve, build
});
```

To hydrate on the client without re-fetching, embed the rendered data in the HTML (e.g. an inline `<script type="application/json">`) and read it back before hydration — so the page needs no XHR at all.

#### Deploying to Production

Because `@harperfast/vite` builds on the node and `static` serves the output, deploy the component as-is — no manual build-and-move step is needed:

```json
{
	"scripts": {
		"dev": "harper dev .",
		"start": "harper run .",
		"deploy": "harper deploy_component . restart=true replicated=true"
	}
}
```

On deploy the plugin runs `vite build` at startup (and rebuilds when `files` change) while `static` serves the result. If you prefer to build in CI, commit the build output, point `static` at it, and omit `files` so the plugin stays idle while `static` serves the prebuilt assets. Either way, `npm create harper@latest` scaffolds a working setup for you.

### 4.5 Harper Logging

Instructions for the agent to follow when implementing logging in Harper applications, including direct logger usage, tagged loggers, and console capture behavior.

#### When to Use

Apply this rule when writing any JavaScript component, plugin, or resource that needs to emit structured log entries, filter logs by component, or capture existing `console.log` output into Harper's log system. Use it whenever you need to understand log levels, log entry format, or the `logger` global API.

#### How It Works

1. **Use the `logger` global directly** — `logger` is available in all JavaScript components without any imports. Call the method matching the desired severity level:

   ```javascript
   logger.trace('detailed trace message');
   logger.debug('debug info', { someContext: 'value' });
   logger.info('informational message');
   logger.warn('potential issue');
   logger.error('error occurred', error);
   logger.fatal('fatal error');
   logger.notify('server is ready');
   ```

   Only entries at or above the configured `logging.level` (or `logging.external.level`) are written to `hdb.log`.

2. **Create a tagged logger with `withTag(`** — Call `logger.withTag(tag)` once per module or class to get a `TaggedLogger` scoped to that tag. This prefixes every log entry with the tag, making log output filterable by component.

   ```javascript
   const log = logger.withTag('my-resource');
   ```

   Because `TaggedLogger` methods for disabled levels are `null`, always use optional chaining (`?.`) when calling them:

   ```javascript
   log.debug?.('Fetching record', { id });
   log.warn?.('Record not found', { id });
   log.error?.('Failed to update record', err);
   ```

   `TaggedLogger` does not have a `withTag()` method.

3. **Understand the interface contracts** — `MainLogger` always has all methods defined:

   ```typescript
   interface MainLogger {
   	trace(...messages: any[]): void;
   	debug(...messages: any[]): void;
   	info(...messages: any[]): void;
   	warn(...messages: any[]): void;
   	error(...messages: any[]): void;
   	fatal(...messages: any[]): void;
   	notify(...messages: any[]): void;
   	withTag(tag: string): TaggedLogger;
   }
   ```

   `TaggedLogger` methods may be `null`:

   ```typescript
   interface TaggedLogger {
   	trace: ((...messages: any[]) => void) | null;
   	debug: ((...messages: any[]) => void) | null;
   	info: ((...messages: any[]) => void) | null;
   	warn: ((...messages: any[]) => void) | null;
   	error: ((...messages: any[]) => void) | null;
   	fatal: ((...messages: any[]) => void) | null;
   	notify: ((...messages: any[]) => void) | null;
   }
   ```

4. **Know the log levels** — From least to most severe:

   | Level    | Description                                                          |
   | -------- | -------------------------------------------------------------------- |
   | `trace`  | Highly detailed internal execution tracing.                          |
   | `debug`  | Diagnostic information useful during development.                    |
   | `info`   | General operational events.                                          |
   | `warn`   | Potential issues that don't prevent normal operation.                |
   | `error`  | Errors that affect specific operations.                              |
   | `fatal`  | Critical errors causing process termination.                         |
   | `notify` | Important operational milestones. Always logged regardless of level. |

   The default log level is `warn`. Setting a level includes that level and all more-severe levels.

5. **Enable console capture when porting existing code** — When `logging.console: true` is set, writes via `console.log`, `console.warn`, `console.error`, etc. are appended verbatim to `hdb.log`. Captured lines do **not** pass through `logger`'s level filter. Prefer `logger` directly in production code so that level filtering and tagging apply. Console capture is intended as a convenience for porting existing code and for debugging.

6. **Know where logs are written** — All standard log output goes to `<ROOTPATH>/log/hdb.log` (default: `~/hdb/log/hdb.log`). To also log to `stdout`/`stderr`, set `logging.stdStreams: true`.

#### Examples

##### Basic logging in a resource

```javascript
export class MyResource extends Resource {
	async get(id) {
		logger.debug('Fetching record', { id });
		const record = await super.get(id);
		if (!record) {
			logger.warn('Record not found', { id });
		}
		return record;
	}

	async put(record) {
		logger.info('Updating record', { id: record.id });
		try {
			return await super.put(record);
		} catch (err) {
			logger.error('Failed to update record', err);
			throw err;
		}
	}
}
```

##### Tagged logging with `withTag()`

```javascript
const log = logger.withTag('my-resource');

export class MyResource extends Resource {
	async get(id) {
		log.debug?.('Fetching record', { id });
		const record = await super.get(id);
		if (!record) {
			log.warn?.('Record not found', { id });
		}
		return record;
	}

	async put(record) {
		log.info?.('Updating record', { id: record.id });
		try {
			return await super.put(record);
		} catch (err) {
			log.error?.('Failed to update record', err);
			throw err;
		}
	}
}
```

Tagged entries appear in `hdb.log` with the tag in the header:

```
2023-03-09T14:25:05.269Z [info] [my-resource]: Updating record
```

#### Notes

- All log output is written to `<ROOTPATH>/log/hdb.log`. The `logger` global writes to this file at the configured `logging.external` level.
- Log entry format for `logger`: `<timestamp> [<level>] [<thread>/<id>]: <message>`
- Log entry format for `TaggedLogger`: `<timestamp> [<level>] [<tag>]: <message>`
- `console.log` output is only forwarded to `hdb.log` when `logging.console: true` is explicitly set; it is not forwarded by default.
- When logging to standard streams, run Harper in the foreground (`harper`, not `harper start`).
- `TaggedLogger` is bound to the configured log level at creation time — always use `?.` on its methods.

### 4.6 Load Environment Variables with loadEnv

Instructions for the agent to follow when loading environment variables from `.env` files into a Harper application using the `loadEnv` plugin.

#### When to Use

Apply this rule when a Harper application needs to supply secrets, API endpoints, or other configuration values to component code via `process.env` without hardcoding them. Use `loadEnv` any time you need to load one or more `.env` files at application startup.

#### How It Works

1. **Declare `loadEnv` in `config.yaml`**: Add `loadEnv` as the first entry in `config.yaml`. It is built into Harper and requires no installation.

   ```yaml
   loadEnv:
     files: '.env'
   ```

2. **Place `loadEnv` first**: Harper is a single-process application. List `loadEnv` before all other components so that environment variables are available on `process.env` before dependent components start.

   ```yaml
   # config.yaml — loadEnv must come first
   loadEnv:
     files: '.env'

   rest: true

   myApp:
     files: './src/*.js'
   ```

3. **Access loaded values in component code**: After `loadEnv` runs, all loaded values are available on `process.env` and shared across all components.

4. **Control override behavior**: By default, existing environment variables take precedence over values in `.env` files. Set `override: true` to make loaded values win instead.

   ```yaml
   loadEnv:
     files: '.env'
     override: true
   ```

5. **Load multiple files**: Pass an array of paths or a glob pattern to `files`. Files are loaded in the order specified.

   ```yaml
   loadEnv:
     files:
       - '.env'
       - '.env.local'
   ```

   or with a glob:

   ```yaml
   loadEnv:
     files: 'env-vars/*'
   ```

##### Configuration Options

| Option     | Type                 | Required | Description                                                                            |
| ---------- | -------------------- | -------- | -------------------------------------------------------------------------------------- |
| `files`    | `string \| string[]` | **Yes**  | Path(s) or glob pattern(s) to the env file(s) to load.                                 |
| `override` | `boolean`            | No       | If `true`, loaded values override existing environment variables. Defaults to `false`. |

#### Examples

**Single file, default behavior:**

```yaml
# config.yaml
loadEnv:
  files: '.env'

rest: true

myApp:
  files: './src/*.js'
```

**Multiple files with override:**

```yaml
# config.yaml
loadEnv:
  files:
    - '.env'
    - '.env.local'
  override: true

rest: true

myApp:
  files: './src/*.js'
```

#### Notes

- `loadEnv` loads values into `process.env` for **application** code only — it does not configure Harper itself.
- Harper's own instance-wide configuration is composed at startup **before** any component's `loadEnv` runs. Variables such as `HARPER_CONFIG`, `HARPER_SET_CONFIG`, and `HARPER_DEFAULT_CONFIG` delivered through a `.env` file are read too late and are ignored. Set Harper configuration directly in the configuration file or export variables in the real process/container environment before Harper starts.
- For production credentials, prefer the encrypted secrets store over a committed `.env` file. Secrets are also delivered to components via `process.env`.

### 4.7 v5 Upgrade: Breaking Changes and Migration Guide

Instructions for the agent to follow when migrating a Harper application to v5, covering all breaking changes and required code updates.

#### When to Use

Apply this rule when upgrading an existing Harper application from v4 to v5, when encountering runtime errors after upgrading, or when reviewing application code for v5 compatibility. Every breaking change listed here must be addressed before the application will behave correctly under v5.

#### How It Works

1. **Update the package import**: Replace all imports from `'harperdb'` with `from 'harper'`.

   ```javascript
   import { tables } from 'harper';
   ```

2. **Enable install scripts if needed**: Harper v5 runs `npm install` with `--ignore-scripts` by default. If your application requires install scripts (e.g., to compile native binaries), set `allowInstallScripts` in your deployment options.

3. **Update `Table.get` usage**: `Table.get` now returns a plain frozen record object, not a table class instance. The `wasLoadedFromSource()` method no longer exists on the returned object. Replace it with `loadedFromSource` on the `RequestTarget`:

   ```javascript
   // Before
   const record = await Table.get(id);
   if (record.wasLoadedFromSource()) {
   	// record was loaded from origin (not cache)
   }
   ```

   ```javascript
   // After
   import { getContext } from 'harper';
   const target = new RequestTarget();
   target.id = id;
   const record = await Table.get(target);
   if (target.loadedFromSource) {
   	// record was loaded from origin (not cache)
   }
   ```

   The record objects do have `getUpdatedTime` and `getExpiresAt` methods available.

4. **Handle frozen records**: The record object returned by `Table.get` is frozen — you cannot mutate it directly. Copy it before modifying:

   ```javascript
   // Before
   const record = await Table.get(id);
   record.property = 'changed';
   ```

   ```javascript
   // After
   let record = await Table.get(id);
   record = { ...record, property: 'changed' };
   ```

5. **Register allowed spawn commands via `allowedSpawnCommands`**: `spawn` and `execFile` may only launch executables listed in `applications.allowedSpawnCommands` in `harper-config.yaml`. Only the first token of the command is matched. `exec` is not usable through the substituted module, and `execSync` always throws.

   ```yaml
   applications:
     allowedSpawnCommands:
       - npm
       - node
   ```

   Additionally, `spawn`, `execFile`, and `fork` now require a `name` property in the `options` argument to prevent process multiplication across threads.

6. **Update transaction and context usage**: Harper v5 uses asynchronous context tracking. `Table.get` and other calls now automatically inherit the current transaction. Code that previously omitted context to bypass a transaction will no longer work as expected. Explicitly commit the transaction or wrap calls in a new transaction to read updated data:

   ```javascript
   import { setTimeout as delay } from 'node:timers/promises';
   import { getContext, transaction } from 'harper';

   class MyResource {
   	static async get(target) {
   		await getContext().transaction.commit();
   		while ((await transaction(() => Table.get(target))).status !== 'ready') {
   			await delay(100);
   		}
   		return Table.get(target);
   	}
   }
   ```

   Use `getContext` (exported from `'harper'`) to access the current transaction anywhere without passing context explicitly.

7. **Replace `blob.save()`**: The `blob.save()` method has been removed. Use the `saveBeforeCommit` flag in the options passed to the `Blob` constructor instead.

8. **Handle response `headers`**: If you return an object from a REST method with a `headers` property, Harper v5 will use it as the response headers. Ensure any object you return that incidentally has a `headers` property is intentional.

9. **Configure the module loader**: Harper v5 loads application modules through Node.js's VM module API. Control this with the `moduleLoader` setting:

   | Value                | Behavior                                         |
   | -------------------- | ------------------------------------------------ |
   | `vm-current-context` | Default. Shares intrinsics with Harper.          |
   | `vm`                 | Separate context and intrinsics per application. |
   | `native`             | Standard `import()`, no application context.     |
   | `compartment`        | SES Compartments; advanced and heavier.          |

   The default (`vm-current-context`) avoids `instanceof` failures for values crossing the application/Harper boundary. Choose `vm` only if you need separate per-application intrinsics. Use `native` if the VM loader causes compatibility problems you cannot otherwise resolve.

   To disable the VM loader entirely and restore pre-v5 behavior:

   ```yaml
   applications:
     moduleLoader: native
   ```

   Note: `logger` and per-app `config` are not available in `native` mode.

   If the goal is only to fix package compatibility while keeping application context for first-party code, `dependencyLoader: native` is a narrower option — it uses native loading only for npm packages while keeping the VM loader for application source files.

10. **Handle intrinsic `lockdown`**: The default `lockdown` mode (`freeze-after-load`) freezes JavaScript intrinsics (`Object`, `Array`, `Promise`, `Map`, `Set`, etc.) after all application code loads. Any code or dependency that modifies intrinsic prototypes at runtime will throw a `TypeError`. If a dependency requires a temporary workaround, set:

    ```yaml
    applications:
      lockdown: none
    ```

11. **Check `allowedDirectory` in production**: In production, applications can only load modules from within their own directory tree (`allowedDirectory: app`). If your application loads files from outside its directory, set:

    ```yaml
    applications:
      allowedDirectory: any
    ```

#### Examples

##### Full `harper-config.yaml` module loading block

```yaml
applications:
  lockdown: freeze-after-load
  moduleLoader: vm-current-context
  dependencyLoader: auto
  allowedDirectory: app
  allowedSpawnCommands:
    - npm
    - node
```

##### Updated import and context access

```javascript
import { tables, getContext, transaction } from 'harper';
```

##### Checking `loadedFromSource` after `Table.get`

```javascript
const target = new RequestTarget();
target.id = id;
const record = await Table.get(target);
if (target.loadedFromSource) {
	// record was loaded from origin (not cache)
}
```

##### Copying a frozen record before mutation

```javascript
let record = await Table.get(id);
record = { ...record, property: 'changed' };
```

#### Notes

- The `logger` exported from `'harper'` is tagged with the application name when using the VM module loader. It is not available in `native` mode.
- `instanceof` checks for values crossing the application/Harper boundary will fail when using `moduleLoader: vm` (separate intrinsics). Use `vm-current-context` (the default) to avoid this.
- `import()` behavior depends on the `moduleLoader` setting. In `native` mode, standard Node.js `import()` is used with no application context.
- Automatic context tracking simplifies code but requires explicit `commit()` or new `transaction()` calls when you need to observe data written within the same transaction.
- Use `getContext` from `'harper'` rather than passing context manually through every call — this is the recommended pattern in v5.

### 4.8 Delegating to the Built-in Agent

Harper 5.2+ ships with a **built-in agent** that runs _inside_ the server, on the main thread
adjacent to the operations API. Because it runs in-process, it can do things a remote client
cannot: call the operations API as RBAC-filtered tools, read and write component files under the
instance's components root, attach the V8 inspector to worker threads to debug and profile them,
schedule follow-up work, and consult the Harper best-practices skill. You send it a natural-language
task; it runs a tool-using loop under a super_user identity and reports back.

#### When to Use

Delegate to the built-in agent when the work is best done **on the instance itself** rather than
from your local client:

- Operating on a deployed instance in place — inspect the schema, build or adjust a component,
  restart, run an operation.
- Debugging or profiling a running instance — attach to a worker thread, capture a CPU profile,
  set a logpoint.
- Handing off a larger, multi-step task to an agent that already has the instance's tools,
  filesystem, and credentials in context.

Do the work in your own client instead when it's purely local (editing source before deploy) or
when you don't want a server-side agent making changes.

**Prerequisites:** the target instance must have the agent enabled (an `agent:` config block with
`enabled: true`) and a configured generative model backend. All agent operations require
**super_user**.

#### How It Works

The lifecycle assumes you have already deployed to and authenticated with the target instance (see
[deploying-to-harper-fabric.md](deploying-to-harper-fabric.md) — `harper login` stores a token so
you don't repeat credentials). Delegation reuses that same target and credentials.

There are two equivalent ways to drive the agent.

##### Option A — the `harper agent` CLI (simplest)

A thin client over the agent operations API that reuses your stored `harper login` credentials, so
no connector setup is needed:

```bash
# One-shot: send a task, print the reply, exit
harper agent "Describe the schema, then add a price index to the Product table."

# Interactive session (REPL)
harper agent

# Against a specific remote instead of the logged-in default
harper agent --target <Application URL> "List the databases and tables."
```

The CLI polls the run to completion and renders the transcript (tool calls, results, and the
agent's reply). When a run needs approval for a destructive action, it prompts you inline.

##### Option B — the agent operations API (programmatic)

Call the operations API directly (HTTP POST to the ops endpoint, super_user auth). This is the path
to use from scripts and services.

1. **Start a task** with `agent_prompt`. Returns a `session_id` and a `status`.

   ```bash
   curl -s -u <user>:<pass> <ops-endpoint> \
     -H 'Content-Type: application/json' \
     -d '{"operation":"agent_prompt","message":"Build a Customer table (id, email, name) exported over REST."}'
   ```

2. **Poll for progress** with `get_agent_session`, passing the `session_id`. The returned session
   carries the `status`, the `messages` transcript, and any `pendingApprovals`.

   ```bash
   curl -s -u <user>:<pass> <ops-endpoint> \
     -H 'Content-Type: application/json' \
     -d '{"operation":"get_agent_session","session_id":"<id>"}'
   ```

   Poll until `status` leaves `running` — terminal states are `completed`, `aborted`, and `error`;
   `awaiting_approval` means it is paused for an approval decision (see step 3).

3. **Approve or deny a paused action.** When the agent enabled configuration has `autoApprove:false`,
   a destructive tool call pauses the run with a `pendingApprovals[]` entry. Resolve it with
   `approve_agent_action`, then poll again — approval executes the saved call, denial hands the
   rejection back to the agent so it can adjust.

   ```bash
   curl -s -u <user>:<pass> <ops-endpoint> \
     -H 'Content-Type: application/json' \
     -d '{"operation":"approve_agent_action","session_id":"<id>","approval_id":"<approval-id>","approved":true}'
   ```

4. **Continue the conversation** by passing the same `session_id` back into `agent_prompt` with a
   new `message`. Omit `session_id` to start a fresh session.

Supporting operations: `list_agent_sessions` (recent sessions), `cancel_agent_run` (terminate a
running or paused session), and `set_agent_config` (adjust `autoApprove`, `allowDestructive`,
`model`, and related settings on a running instance).

#### Examples

**Delegate a build to a deployed Fabric instance and wait for the result:**

```bash
harper login <Application URL>
harper agent --target <Application URL> \
  "Create a Product table (id, name, price) exported over REST, then confirm the endpoint responds."
```

**Programmatic start-and-poll loop:**

```bash
SID=$(curl -s -u <user>:<pass> <ops-endpoint> -H 'Content-Type: application/json' \
  -d '{"operation":"agent_prompt","message":"Add a vector index to the Document.embedding field."}' \
  | jq -r .session_id)

while [ "$(curl -s -u <user>:<pass> <ops-endpoint> -H 'Content-Type: application/json' \
  -d "{\"operation\":\"get_agent_session\",\"session_id\":\"$SID\"}" | jq -r .status)" = "running" ]; do
  sleep 3
done
```

#### Notes

- **All agent operations require super_user.** Authenticate with `harper login`, which stores a
  short-lived JWT (operation token) plus a refresh token rather than your password — prefer that
  over passing credentials inline, and never embed a raw password in scripts or client config.
- **Approvals are your safety gate.** With `autoApprove:false`, the agent pauses before destructive
  tools (writing files, deploying, restarting) so an operator decides. Set `autoApprove:true` only
  when you want unattended runs.
- **Sessions are single-active.** A session that is `running` or `awaiting_approval` rejects a new
  `agent_prompt`; resolve the approval or cancel the run first.
- **MCP alternative.** For MCP-native clients, an instance with MCP enabled exposes the agent as
  curated MCP tools (`agent_prompt`, `get_agent_session`, `list_agent_sessions`) at the ops API's
  `/mcp` endpoint — the same delegation loop over the MCP transport instead of raw operations.
