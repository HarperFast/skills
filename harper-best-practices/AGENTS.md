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
   - `GET /{TableName}`: Describes the schema itself.
   - `GET /{TableName}/`: Lists all records (supports filtering, sorting, and pagination via query parameters). See the [Querying REST APIs](querying-rest-apis.md) skill for details.
   - `GET /{TableName}/{id}`: Retrieves a single record by its ID.
   - `POST /{TableName}/`: Creates a new record.
   - `PUT /{TableName}/{id}`: Updates an existing record.
   - `PATCH /{TableName}/{id}`: Performs a partial update on a record.
   - `DELETE /{TableName}/`: Deletes all records or filtered records.
   - `DELETE /{TableName}/{id}`: Deletes a single record by its ID.
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

### 1.2 Schema Design and GraphQL Tooling

Instructions for the agent to follow when designing Harper database schemas using GraphQL type definitions, core directives, and tooling configuration.

#### When to Use

Apply this rule when creating or modifying Harper schema files (`.graphql`), configuring schema loading in `config.yaml`, or deciding which directives to apply to tables and fields. Use it whenever a task involves defining tables, primary keys, indexes, or export behavior.

#### How It Works

1. **Create a GraphQL schema file** with Harper-specific directives. Schemas ensure required tables exist on deployment, enforce types and constraints, control indexing, and define relationships.

   ```graphql
   type Dog @table {
   	id: Long @primaryKey
   	name: String
   	breed: String
   	age: Int
   }
   ```

2. **Register the schema in `config.yaml`** using the `graphqlSchema` plugin:

   ```yaml
   graphqlSchema:
     files: 'schema.graphql'
   ```

   Both plugins and applications can specify schemas.

3. **Mark each type as a table** with `@table`. The type name becomes the table name by default.

   ```graphql
   type MyTable @table {
   	id: Long @primaryKey
   }
   ```

   Key `@table` arguments:

   | Argument             | Type      | Default                       | Description                                                     |
   | -------------------- | --------- | ----------------------------- | --------------------------------------------------------------- |
   | `table`              | `String`  | type name                     | Override the table name                                         |
   | `database`           | `String`  | `"data"`                      | Database to place the table in                                  |
   | `expiration`         | `Int`     | —                             | Seconds until a record goes stale                               |
   | `eviction`           | `Int`     | `0`                           | Additional seconds after `expiration` before physical removal   |
   | `scanInterval`       | `Int`     | `(expiration + eviction) / 4` | Seconds between eviction scans                                  |
   | `replicate`          | `Boolean` | `true`                        | Enable replication of this table                                |
   | `cacheControl`       | `String`  | —                             | `Cache-Control` header for anonymous GET/HEAD 200/304 responses |
   | `randomAccessFields` | `Boolean` | `storage.randomAccessFields`  | Pin this table's record encoding                                |

4. **Designate a primary key** on every table using `@primaryKey`. Primary keys must be unique; duplicate inserts are rejected. If no primary key is provided on insert, Harper auto-generates one:
   - **UUID string** — when type is `String` or `ID`
   - **Auto-incrementing integer** — when type is `Int`, `Long`, or `Any`

   Use `Long` or `Any` for auto-generated numeric keys; `Int` is 32-bit and may be insufficient for large tables.

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	name: String
   }
   ```

5. **Add secondary indexes** with `@indexed` on any attribute that will be used for filtering in REST queries, SQL, or NoSQL operations. If the field value is an array, each element is individually indexed.

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	category: String @indexed
   	price: Float @indexed
   }
   ```

6. **Expose tables via REST and other interfaces** using `@export`. Without `@export`, the table has no REST/MQTT route (callers get 404). The optional `name` parameter sets the URL path segment.

   ```graphql
   type MyTable @table @export(name: "my-table") {
   	id: Long @primaryKey
   }
   ```

   `@export` is a routing directive, not access control. The table remains accessible through the Operations API and SQL regardless. REST must also be enabled for the application (via `rest: true` in `config.yaml` or Harper's built-in default).

7. **Apply additional type directives** as needed:
   - `@sealed` — prevents records from including properties beyond those declared in the schema.
   - `@hidden` — suppresses the type from MCP tool descriptors and the OpenAPI document. Does not restrict data access.

8. **Apply field directives** for computed and lifecycle behavior:
   - `@createdTime` — assigns Unix epoch milliseconds on record creation.
   - `@updatedTime` — assigns Unix epoch milliseconds on each update.
   - `@expiresAt` — marks a field as the record's absolute expiration time (Unix epoch milliseconds); authoritative over the table-level `expiration` default.
   - `@embed` — computes an embedding vector when the source field is written (requires `source` and `model` arguments; field type must be `[Float]`).
   - `@hidden` (field) — suppresses the field from generated specs and MCP tool schemas; does not restrict data access.

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

**Exported table with cache control:**

```graphql
type Product @table(cacheControl: "public, max-age=60") @export {
	id: Long @primaryKey
	name: String
	price: Float
}
```

**Table with lifecycle fields and indexing:**

```graphql
type Event @table(database: "analytics", expiration: 86400) {
	id: Long @primaryKey
	name: String @indexed
	createdAt: Long @createdTime
	updatedAt: Long @updatedTime
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

**Sealed table preventing extra properties:**

```graphql
type StrictRecord @table @sealed {
	id: Long @primaryKey
	name: String
}
```

**`config.yaml` schema registration:**

```yaml
graphqlSchema:
  files: 'schema.graphql'
```

#### Notes

- Schemas are flexible by default — records may include additional properties beyond those declared. Use `@sealed` to prevent this.
- Use unique `database` names in plugins or applications to avoid table naming collisions, since all tables default to the `"data"` database.
- Replication is enabled by default. If you disable replication and re-enable it later, the table will not catch up on writes made while replication was disabled.
- `@hidden` (type or field) is a metadata-visibility directive only. Use table-level role permissions and `attribute_permissions` whitelists to restrict actual data access.
- `@export` absence causes 404 on REST/MQTT routes but does not protect data from the Operations API or SQL.
- The `cacheControl` argument emits headers only on anonymous (unauthenticated) GET/HEAD 200/304 responses. Authenticated responses receive `Cache-Control: private, no-cache`.
- `randomAccessFields` on `@table` pins the record encoding at table creation time. Editing the argument later does not repin an existing table.

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

Apply this rule when a schema field needs to store large binary content such as images, video, audio, or large HTML — typically content larger than 20KB. Use `Blob` instead of `Bytes` when streaming support and out-of-record storage are required. See [handling-binary-data.md](handling-binary-data.md) for broader binary data guidance.

#### How It Works

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

##### `BlobOptions` reference

Pass an options object as the second argument to `createBlob()`.

| Option             | Type      | Default     | Description                                                                                                              |
| ------------------ | --------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| `type`             | `string`  | `undefined` | MIME type to associate with the blob (e.g., `image/jpeg`). Readable via `blob.type` and used when serving HTTP.          |
| `size`             | `number`  | `undefined` | Size of the data in bytes, if known ahead of time. Otherwise inferred from a buffer or determined as a stream completes. |
| `saveBeforeCommit` | `boolean` | `false`     | Wait until the blob is fully written before the transaction commits.                                                     |
| `compress`         | `boolean` | `false`     | Compress the stored data with deflate.                                                                                   |
| `flush`            | `boolean` | `false`     | Flush the file to disk after writing, before the `createBlob` promise chain resolves.                                    |

#### Examples

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

#### Notes

- `Blob` stores data separately from the record. If you need the binary data to be a true, ACID-committed part of the record, use a `Bytes` field instead.
- All standard Web API `Blob` methods — `.text()`, `.arrayBuffer()`, `.stream()`, `.slice()`, and `.bytes()` — are available on retrieved blob fields.
- Without `saveBeforeCommit: true`, blobs are **not** ACID-compliant by default; a record can reference a blob before it is fully written to storage.

### 1.6 Handling Binary Data

Instructions for the agent to follow when storing and serving binary data (images, audio, arbitrary content types) in Harper.

#### When to Use

Apply this rule when a Harper resource needs to accept, store, or serve binary payloads such as images, audio files, or calendar data. Use it when REST clients send `base64`-encoded data inside JSON, when raw binary is uploaded via `PUT`/`POST`, or when a resource must stream binary back to the client with the correct `Content-Type`.

#### How It Works

1. **Accept base64-encoded binary from JSON clients**: Decode the incoming `base64` string with `Buffer.from` and wrap it using `createBlob`, recording the MIME type. Override `post` in your resource class:

   ```typescript
   import { type RequestTargetOrId, tables, createBlob } from 'harper';

   export class Photo extends tables.Photo {
   	static async post(target: RequestTargetOrId, record: any) {
   		if (record.data) {
   			record.data = createBlob(Buffer.from(record.data, record.encoding || 'base64'), {
   				type: record.contentType || 'application/octet-stream',
   			});
   		}
   		return super.post(target, record);
   	}
   }
   ```

2. **Serve binary from a resource**: Override `get` to return a response object with the blob's MIME type in the `Content-Type` header and the blob as the body. Harper streams it to the client:

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

3. **Upload raw binary with a non-standard content type**: Make a `PUT` or `POST` with any non-standard `Content-Type` header. Harper automatically stores the body as a record with `contentType` and `data` properties:

   ```http
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

   Retrieving that record returns the response with the stored `Content-Type` and body. If the content type is not from the `text` family, the data is treated as binary (a Node.js `Buffer`).

4. **Upload binary to a specific property**: Use `application/octet-stream` (or any image/binary MIME type) and target a sub-path to store binary directly on a property:

   ```http
   PUT /my-resource/33/image
   Content-Type: image/gif

   ...image data...
   ```

#### Examples

**End-to-end: accept base64 JSON, store as blob, serve as binary**

```typescript
import { type RequestTargetOrId, tables, createBlob } from 'harper';

export class Photo extends tables.Photo {
	// Accept base64-encoded uploads in JSON
	static async post(target: RequestTargetOrId, record: any) {
		if (record.data) {
			record.data = createBlob(Buffer.from(record.data, record.encoding || 'base64'), {
				type: record.contentType || 'application/octet-stream',
			});
		}
		return super.post(target, record);
	}

	// Stream the blob back with the correct Content-Type
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

- `createBlob` takes a `Buffer` as its first argument and an options object with a `type` property for the MIME type. See [using-blob-datatype.md](using-blob-datatype.md) for full details on the blob data type.
- Always fall back to `application/octet-stream` when no MIME type is known, both when creating and when serving blobs.
- When Harper retrieves a record that has both `contentType` and `data` properties, it automatically sets the response `Content-Type` and body — no custom `get` override is required for that case unless you need additional logic.
- Non-`text` content types cause `data` to be stored and returned as a Node.js `Buffer`.

## 2. API & Communication

### 2.1 Automatic APIs

Instructions for the agent to follow when using Harper's automatically generated REST and WebSocket APIs for exported tables and resources.

#### When to Use

Apply this rule when enabling HTTP REST endpoints or WebSocket subscriptions for Harper tables without writing custom handler code. Use it whenever a schema type needs to be served over HTTP, when configuring real-time subscriptions, or when setting up conditional caching behavior for REST responses.

#### How It Works

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

#### Examples

##### Full schema and config setup

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

##### Conditional GET with ETag caching

```
GET /Product/123
# Response includes:
# ETag: "abc123"

GET /Product/123
If-None-Match: "abc123"
# Response: 304 Not Modified (no body transferred)
```

##### POST and read the Location header

```
POST /Product/
Content-Type: application/json

{ "name": "Widget", "price": 9.99 }

# Response:
# 201 Created
# Location: 7f3a9c
```

##### PATCH (shallow merge only)

```
PATCH /Product/123
Content-Type: application/json

{ "price": 12.99 }
```

Only `price` is updated; other top-level properties are preserved. Nested objects in the body replace the stored sub-object wholesale — deep merge does not occur.

##### Request MessagePack response

```
GET /Product/123
Accept: application/msgpack
```

Alternatively, use the `.msgpack` suffix on the URL path where supported.

##### WebSocket with custom outgoing messages

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

##### Disable WebSocket while keeping REST

```yaml
rest:
  webSocket: false
```

#### Notes

- The trailing slash is significant: `/Product` addresses the resource itself; `/Product/` addresses its record collection. `POST /Product` (no trailing slash) returns `404`.
- `HEAD` is served as `GET` with the body omitted. `QUERY` is accepted on the collection path and reads its search from the request body.
- A `POST` to an existing primary key fails with `409` — it does not overwrite.
- A component directory with **no configuration file** gets REST enabled by Harper's built-in default. As soon as a `config.yaml` exists it is used verbatim — add `rest: true` explicitly or REST is off.
- Do not apply `@export` to a schema type and also export a same-named JavaScript subclass of that table — this produces conflicting endpoints.
- Server-Sent Events subscriptions are served on the same paths, negotiated via `Accept: text/event-stream`. They are not affected by the `webSocket` option.
- Every non-hidden exported resource is included in the generated OpenAPI document at `GET /openapi`. Mark a type `@hidden` or set `static hidden = true` on a programmatic Resource to omit it.
- MQTT over WebSockets requires the sub-protocol header `Sec-WebSocket-Protocol: mqtt`.

### 2.2 Querying REST APIs

Instructions for the agent to filter, sort, select, and paginate Harper REST API collections using URL query parameters.

#### When to Use

Apply this rule whenever building or modifying code that queries Harper REST collection endpoints. Use it when you need to filter records by attribute values, apply comparison operators, sort or paginate results, or join across related tables. See [automatic-apis.md](automatic-apis.md) for how Harper exposes tables as REST endpoints.

#### How It Works

1. **Filter by attribute**: Add query parameters matching attribute names and values. The queried attribute must be indexed.

   ```
   GET /Product/?category=software
   GET /Product/?category=software&inStock=true
   ```

2. **Apply comparison operators (FIQL syntax)**: Use FIQL operators in the query string for numeric, string, and date comparisons.

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

4. **Apply type conversion**: For FIQL comparators, Harper converts values automatically. Use explicit prefixes to force a type.

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

6. **Group conditions**: Use parentheses or square brackets to control order of operations. Prefer square brackets when constructing queries from user input, since standard URI encoding safely encodes `[` and `]`.

   ```
   GET /Product/?rating=5|(price=gt=100&price=lt=200)
   GET /Product/?rating=5&[tag=fast|tag=scalable|tag=efficient]
   ```

   Construct from JavaScript:

   ```javascript
   let url = `/Product/?rating=5&[${tags.map(encodeURIComponent).join('|')}]`;
   ```

7. **Select specific properties with `select(`**: Append `select(...)` as a query function separated by `&`.

   | Syntax                                 | Returns                                     |
   | -------------------------------------- | ------------------------------------------- |
   | `?select(property)`                    | Values of a single property directly        |
   | `?select(property1,property2)`         | Objects with only the specified properties  |
   | `?select([property1,property2])`       | Arrays of property values                   |
   | `?select(property1,)`                  | Objects with a single specified property    |
   | `?select(property{subProp1,subProp2})` | Nested objects with specific sub-properties |

8. **Paginate with `limit(`**: Use `limit(end)` or `limit(start,end)` to control result count and offset.

9. **Sort with `sort(`**: Use `sort(property)` or `sort(+property,-property,...)`. Prefix `+` or no prefix = ascending; `-` = descending.

10. **Query across relationships**: Use dot-syntax to filter by related table attributes. Relationships must be defined in the schema using `@relationship`. Relationship attributes are not included by default — use `select()` to include them.

    ```
    GET /Product/?brand.name=Microsoft&select(name,brand{name})
    ```

11. **Query for null values**: Use `=null` as the value to match null or non-null records.
    ```
    GET /Product/?discount=null
    ```

#### Examples

**Filter with comparison operators and select:**

```
GET /Product/?category=software&price=gt=100&price=lt=200&select(name,price)
```

**Paginate and sort:**

```
GET /Product/?rating=gt=3&inStock=true&select(rating,name)&limit(20)
GET /Product/?rating=gt=3&limit(10,30)
GET /Product/?rating=gt=3&sort(+name)
GET /Product/?sort(+rating,-price)
```

**OR logic with grouping:**

```
GET /Product/?price=lt=100|[rating=5&[tag=fast|tag=scalable|tag=efficient]&inStock=true]
```

**Relationship join with nested select:**

Define the schema:

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

Query with join:

```
GET /Product/?brand.name=Microsoft&select(name,brand{name,id})
GET /Brand/?products.name=Keyboard
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

**Access a specific property by record ID:**

```
GET /MyTable/123.propertyName
```

#### Notes

- Only indexed attributes can be used as the primary filter attribute; when combining multiple attributes, only one needs to be indexed.
- Relationship attributes are excluded from responses by default. Always use `select(` to include them.
- When selecting a related attribute without filtering on it, the behavior is a LEFT JOIN — the property is omitted if the foreign key is null or references a non-existent record.
- The suffixes `.json`, `.cbor`, `.msgpack`, and `.csv` in URL paths are reserved as content-type selectors and take precedence over a property of the same name.
- Square brackets are preferred over parentheses when building grouped queries programmatically, because `[` and `]` are safely URL-encoded by standard encoding functions while `(` is not.

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

Instructions for the agent to follow when handling user authentication, sessions, and JWT token issuance in Harper Resources.

#### When to Use

Apply this rule when implementing sign-in/sign-out flows, inspecting the current user, issuing or refreshing JWT tokens, or minting scoped tokens from a custom Resource. Use it whenever a Harper endpoint must gate access based on identity or produce credentials for downstream consumers. See [custom-resources.md](custom-resources.md) for the broader Resource authoring model.

#### How It Works

##### 1. Inspect the Current User

1. **Call `getCurrentUser()`** inside any Resource method to retrieve the authenticated user for the request, or `undefined` if unauthenticated.

   ```javascript
   async get(target) {
     const user = this.getCurrentUser();
     if (!user) return new Response(null, { status: 401 });
     return { username: user.username, role: user.role };
   }
   ```

   The returned object exposes `username`, `role`, and `role.permission` flags.

##### 2. Handle Sessions via `getContext()`

2. **Enable sessions** in `harperdb-config.yaml` before using session-based login:

   ```yaml
   authentication:
     enableSessions: true
   ```

3. **Call `context.login`** to verify credentials and establish a session cookie:

   ```javascript
   export class SignIn extends Resource {
   	async post(_target, data) {
   		const context = this.getContext();
   		try {
   			await context.login(data.username, data.password);
   		} catch {
   			return new Response('Invalid credentials', { status: 403 });
   		}
   		return new Response('Logged in', { status: 200 });
   	}
   }
   ```

4. **Delete the session** to sign out:

   ```javascript
   export class SignOut extends Resource {
   	async post() {
   		const context = this.getContext();
   		if (!context.session) return new Response(null, { status: 401 });
   		await context.session.delete(context.session.id);
   		return new Response('Logged out', { status: 200 });
   	}
   }
   ```

   Cookie-based sessions are intended for browser clients. For non-browser clients, use JWT issuance (see steps below).

##### 3. Issue JWT Tokens via the Operations API

5. **Call `create_authentication_tokens`** with credentials. No `Authorization` header is needed for this operation:

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

6. **Pass the `operation_token`** as a `Bearer` token on subsequent requests:

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

##### 4. Refresh an Expired Operation Token

7. **Call `refresh_operation_token`** using the `refresh_token` as the `Bearer` token when the `operation_token` expires:

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

##### 5. Mint Scoped Tokens

8. **Issue a scoped token** as a super user by passing an inline `role` object to `create_authentication_tokens`. Do not include `password`. Use `add_role`-style `permission` structure. Set `expires_in` to control lifetime:

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

   Response:

   ```json
   {
   	"operation_token": "<jwt-scoped-token>"
   }
   ```

   Key constraints for scoped tokens:
   - `username` is attribution only and must not match an existing `hdb_user`.
   - `super_user` and `cluster_user` are always forced to `false` in the embedded role.
   - No refresh token is issued; no user record is created.
   - Scoped tokens cannot be revoked before expiry — choose short `expires_in` values in high-security environments.
   - The permission object is validated at mint time; the resulting token must fit within a 12 KB `Authorization` header.

##### 6. Issue Tokens from a Custom Resource via `server.operation`

9. **Import `server`** and call `server.operation` to mint or refresh tokens programmatically from a Resource:

   ```javascript
   import { Resource, server } from 'harper';

   export class IssueTokens extends Resource {
   	static async get(_target, context) {
   		const { operation_token, refresh_token } = await server.operation(
   			{ operation: 'create_authentication_tokens' },
   			context,
   			true,
   		);
   		return { operation_token, refresh_token };
   	}

   	static async post(_target, data) {
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

   Pass `true` as the third argument to `server.operation` when the operation should run as the current authenticated user. Omit it (or pass `false`) when the operation supplies its own credentials.

##### 7. Configure Token Expiry

10. **Set token timeouts** in `harper-config.yaml` under the `authentication` section:

    ```yaml
    authentication:
      operationTokenTimeout: 1d # Default: 1 day
      refreshTokenTimeout: 30d # Default: 30 days
    ```

    Duration strings follow the `jsonwebtoken` package format (e.g., `1d`, `12h`, `60m`).

#### Examples

**Full sign-in/sign-out Resource pair with session:**

```javascript
import { Resource } from 'harper';

export class SignIn extends Resource {
	async post(_target, data) {
		const context = this.getContext();
		try {
			await context.login(data.username, data.password);
		} catch {
			return new Response('Invalid credentials', { status: 403 });
		}
		return new Response('Logged in', { status: 200 });
	}
}

export class SignOut extends Resource {
	async post() {
		const context = this.getContext();
		if (!context.session) return new Response(null, { status: 401 });
		await context.session.delete(context.session.id);
		return new Response('Logged out', { status: 200 });
	}
}
```

**Mint tokens via cURL:**

```bash
curl --location --request POST 'http://localhost:9925' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "operation": "create_authentication_tokens",
    "username": "username",
    "password": "password"
  }'
```

**Refresh an operation token via cURL:**

```bash
curl --location --request POST 'http://localhost:9925' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer <refresh_token>' \
  --data-raw '{
    "operation": "refresh_operation_token"
  }'
```

#### Notes

- Always use HTTPS in production to protect tokens in transit. Tokens must be treated like passwords.
- If a token is compromised, it remains valid until expiry. Use shorter `operationTokenTimeout` values in high-security environments.
- `enableSessions` must be `true` in `harperdb-config.yaml` for `context.login` and `context.session` to function.
- Scoped tokens are not tied to a user row; rotating the instance's JWT keys is the only way to invalidate them before `expires_in` elapses.
- In mixed-version clusters, only nodes with scoped-token support accept scoped tokens; older nodes return 401.

## 3. Logic & Extension

### 3.1 Custom Resources

Instructions for the agent to follow when defining custom REST endpoints with JavaScript or TypeScript in Harper.

#### When to Use

Apply this rule when creating custom HTTP endpoints, wrapping external APIs, or registering routes programmatically in a Harper application. Use it any time business logic must live outside a table-backed schema, or when a specific URL shape is required.

#### How It Works

1. **Import `Resource` from `harper`**: Always import from the `harper` package rather than relying on globals.

   ```javascript
   import { tables, Resource } from 'harper';
   ```

2. **Define a class that `extends Resource`**: Implement HTTP methods as `static` methods. Each method receives a `target` object.

   ```javascript
   export class CustomEndpoint extends Resource {
   	static get(target) {
   		return {
   			data: doSomething(),
   		};
   	}
   }
   ```

3. **Use `async` static methods for external calls**: Await fetch or other async operations inside `static` handlers.

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

4. **Export the class to create an endpoint**: The export form controls the resulting URL. Choose the form that matches the URL shape you need.

   | Export form                                 | URL             | Notes                                                           |
   | ------------------------------------------- | --------------- | --------------------------------------------------------------- |
   | `export class Foo extends Resource {}`      | `/Foo/`         | Class name becomes the path segment. Case-sensitive.            |
   | `export const Bar = { Foo };`               | `/Bar/Foo/`     | Nest under an object to add a path prefix.                      |
   | `export const bar = { 'foo-baz': Foo };`    | `/bar/foo-baz/` | Use object keys for lowercase, hyphens, or non-identifier URLs. |
   | `export { Foo as '/widget/:id' }`           | `/widget/:id`   | Rename the export to set the path directly.                     |
   | `static path = '/widget/:id'` (class field) | `/widget/:id`   | Declare path on the class; overrides the export name.           |
   | `server.resources.set('my-path', Foo);`     | `/my-path/`     | Programmatic registration for dynamic paths.                    |

   URL path matching is case-sensitive — `/Foo/` and `/foo/` are different endpoints.

5. **Declare path parameters with `static path`**: Use `:name` for a single segment and `*name` as a catch-all. Matched values are bound onto `target.<name>`.

   ```javascript
   export class Widget extends Resource {
   	static path = '/widget/:id/action/:action';
   	static get(target) {
   		return { id: target.id, action: target.action };
   	}
   }
   ```

   A `static path` takes precedence over the export name. A leading `/` makes the path root-relative (top-level). A leading `./` or bare name resolves relative to the component directory.

6. **Register programmatically when the path is dynamic**: Use `server.resources.set(` when the path cannot be known at export time.

   ```javascript
   server.resources.set('my-path', Foo);
   ```

7. **Optionally source a table from a custom resource**: Use the resource as a caching layer for a local table.
   ```javascript
   tables.MyCache.sourcedFrom(MyExternalData);
   ```

#### Examples

##### External API wrapper with GET and PUT

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

##### Path parameters with `static path`

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

##### Programmatic registration

```javascript
import { Resource } from 'harper';

export class Foo extends Resource {
	static get(target) {
		return { data: doSomething() };
	}
}

server.resources.set('my-path', Foo);
```

#### Notes

- A bare `*` wildcard (no name) binds under `target.wildcard`. A wildcard must be the final segment of the path.
- Resolution order: exact/static paths always win over parameterized ones. Among parameterized routes, more specific paths win — a literal segment beats `:param`, which beats `*`, compared left to right.
- Parameterized routes appear in the generated OpenAPI document as templated paths (e.g. `/widget/{id}/action/{action}`) and in MCP `resources/templates/list` as `{param}` URI templates.
- If a resource `extends` an existing table, avoid conflicting exports between the schema and the JavaScript implementation.
- Link the `harper` package in your component directory to ensure correct typings: `npm link harper`. All installed components have `harper` automatically linked.
- Harper runs as a single process — `tables`, `databases`, and other APIs are the same live, process-wide objects regardless of which component accesses them.

### 3.2 Extending Tables

Instructions for the agent to follow when adding custom logic to automatically generated table resources in Harper.

#### When to Use

Apply this rule when you need to add computed properties, intercept writes, enforce validation, or otherwise customize the behavior of a Harper table resource beyond what the default generated endpoints provide. Use it any time a `@table` type needs server-side logic attached to its REST handlers.

#### How It Works

1. **Define the schema without `@export`**: Declare the table type in `schema.graphql` and omit the `@export` directive. Leaving `@export` on the schema while also exporting a subclass with the same name produces conflicting endpoints. Let the JavaScript class own the URL instead.

   ```graphql
   # Omit the `@export` directive
   type MyTable @table {
   	id: Long @primaryKey
   	# ...
   }
   ```

2. **Extend the generated table class**: In `resources.js`, extend from the `tables.<TypeName>` global. The class name you export becomes the URL path. The exported class extends tables.

   ```javascript
   export class MyTable extends tables.MyTable {
   	static async get(target) {
   		const record = await super.get(target);
   		return { ...record, computedField: 'value' };
   	}

   	static async post(target, data) {
   		this.create({ ...(await data), status: 'pending' });
   	}
   }
   ```

3. **Call `super` to preserve default behavior**: When delegating to `super`, match the argument form to the operation:
   - Reads/deletes: `super.get(target)` / `super.delete(target)`
   - Collection create: `super.post(target, record)` — target carries no id
   - Updates: `super.put(target, data)` / `super.patch(target, data)`

   Omit the `super` call only if you intend to replace the default behavior entirely.

4. **Set `statusCode` on thrown errors to control HTTP responses**: Uncaught errors are caught by the protocol handler and produce error responses for REST. Use `.statusCode` — a plain `.status` property is ignored.

   ```javascript
   const error = new Error('Name is required');
   error.statusCode = 400; // use statusCode, NOT status
   throw error;
   ```

5. **Configure Harper to load both files**: Ensure your configuration references the schema and resource files.

   ```yaml
   rest: true
   graphqlSchema:
     files: schema.graphql
   jsResource:
     files: resources.js
   ```

#### Examples

Full end-to-end example — schema, resource class, and error handling:

```graphql
# schema.graphql — omit @export so the JS class owns the endpoint
type MyTable @table {
	id: Long @primaryKey
}
```

```javascript
// resources.js
export class MyTable extends tables.MyTable {
	static async get(target) {
		// get the record from the database
		const record = await super.get(target);
		// add a computed property before returning
		return { ...record, computedField: 'value' };
	}

	static async post(target, data) {
		// custom action on POST
		this.create({ ...(await data), status: 'pending' });
	}
}
```

Throwing a controlled HTTP error:

```javascript
if (!authorized) {
	const error = new Error('Forbidden');
	error.statusCode = 403;
	throw error;
}
```

#### Notes

- Always omit `@export` from the schema type when a JavaScript subclass is exporting the same name. The two registrations conflict.
- `super` must be called with the correct arguments for each operation type — mismatched arguments will not behave as expected.
- `statusCode` is the only recognized property for controlling HTTP status on thrown errors; `.status` is ignored.

### 3.3 Programmatic Table Requests

Instructions for the agent to interact with Harper tables programmatically using the `tables` object, including querying, transactions, and module integration.

#### When to Use

Apply this rule when writing server-side Harper component code that reads from or writes to tables directly — bypassing REST endpoints — such as in request handlers, background jobs, timers, or SSR rendering. Use it whenever you need to construct queries with `conditions`, manage transactions explicitly, or perform CRDT-safe mutations.

#### How It Works

1. **Import `tables` from `harper`**: Access all tables in the default `data` database via the `tables` object. Each table defined with `@table` in `schema.graphql` is a property.

   ```javascript
   import { tables } from 'harper';
   const { Product } = tables;
   // same as: databases.data.Product
   ```

2. **Define your schema with `@table`**: Tables must be declared in `schema.graphql`. Use `@indexed` on attributes you intend to sort or filter efficiently.

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	name: String
   	price: Float
   }
   ```

3. **Use `search(` to query records**: Pass a Query object to `search(`. Iterate results with `for await`.

   ```javascript
   const query = {
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 8.0 }],
   };
   for await (const record of Product.search(query)) {
   	// process record
   }
   ```

4. **Build `conditions` arrays to filter**: Each condition object supports these properties:

   | Property     | Description                                                                                                                                              |
   | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `attribute`  | Property name, or array for chained/joined properties (e.g. `['brand', 'name']`)                                                                         |
   | `value`      | The value to match                                                                                                                                       |
   | `comparator` | `equals` (default), `greater_than`, `greater_than_equal`, `less_than`, `less_than_equal`, `starts_with`, `contains`, `ends_with`, `between`, `not_equal` |
   | `conditions` | Nested conditions array                                                                                                                                  |
   | `operator`   | `and` (default) or `or` for the nested `conditions`                                                                                                      |

5. **Apply `select` to shape results**: Return only the fields you need. Supports arrays, nested relationship selects, and special properties.

   ```javascript
   // Array of fields
   Product.search({ select: ['name', 'price'] });

   // Nested relationship select
   Book.get({ id: 42, select: ['id', 'title', { name: 'author', select: ['name'] }] });
   ```

   Special `select` values: `$id`, `$updatedtime`, `$distance`.

6. **Apply `sort` with an `@indexed` attribute**: Harper uses an index to provide sort order. Sort by an `@indexed` attribute without requiring a condition, or provide at least one condition when sorting by a non-indexed attribute.

   ```javascript
   // Sort by primary key with an open-ended condition to avoid scan error
   Product.search({
   	conditions: [{ attribute: 'id', comparator: 'greater_than', value: '' }],
   	sort: { attribute: 'id' },
   });
   ```

   Sort object properties:

   | Property     | Description                                              |
   | ------------ | -------------------------------------------------------- |
   | `attribute`  | Property name or array for chained relationship property |
   | `descending` | Sort descending if `true` (default: `false`)             |
   | `next`       | Secondary sort to resolve ties (same structure)          |

7. **Use `limit` and `offset` for pagination**:

   ```javascript
   Product.search({ conditions: [...], limit: 20, offset: 40 });
   ```

8. **Use `explain` and `enforceExecutionOrder` for debugging**:
   - `explain: true` — returns conditions reordered as Harper will execute them.
   - `enforceExecutionOrder: true` — forces conditions to execute in the order supplied, disabling automatic re-ordering.

9. **Use `addTo` for concurrent-safe numeric updates**: `addTo` uses CRDT incrementation, safe across threads and nodes.

   ```javascript
   static async post(target, data) {
     const record = await this.update(target.id);
     record.addTo('quantity', -1); // decrement safely across nodes
   }
   ```

10. **Wrap background work in `transaction()`**: HTTP handlers get a transaction automatically. Use `transaction()` explicitly for timers, background jobs, or any code outside a natural transaction context.

    ```javascript
    import { tables } from 'harper';
    const { MyTable } = tables;

    if (isMainThread) {
    	setInterval(async () => {
    		let data = await (await fetch('https://example.com/data')).json();
    		transaction(async (txn) => {
    			for (let item of data) {
    				await MyTable.put(item, txn);
    			}
    		});
    	}, 3600000); // every hour
    }
    ```

    The `txn` object members:

    | Member                | Type            | Description                                            |
    | --------------------- | --------------- | ------------------------------------------------------ |
    | `commit()`            | `() => Promise` | Commits the current transaction                        |
    | `abort()`             | `() => void`    | Aborts the transaction and resets it                   |
    | `resetReadSnapshot()` | `() => void`    | Resets the read snapshot to the latest committed state |
    | `timestamp`           | `number`        | Timestamp associated with the current transaction      |

11. **Understand atomicity boundaries**: All tables within the same database share one transactional context — writes across multiple tables commit atomically. Tables in different databases each get their own transaction with no cross-database atomicity guarantee.

12. **Keep `harper` external in bundlers**: When using SSR bundlers, mark `harper` as external so it resolves to the live runtime. In `vite.config`:

    ```javascript
    ssr: {
    	external: ['harper'];
    }
    ```

#### Examples

##### Nested conditions query

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

##### Chained attribute reference (join/relationship)

```javascript
Product.search({ conditions: [{ attribute: ['brand', 'name'], value: 'Harper' }] });
```

##### Full CRUD sequence

```javascript
// Create a new record (id auto-generated)
const created = await Product.create({ name: 'Shirt', price: 9.5 });

// Modify the record
await Product.patch(created.id, { price: Math.round(created.price * 0.8 * 100) / 100 });

// Retrieve by primary key
const record = await Product.get(created.id);

// Query with conditions
const query = {
	conditions: [{ attribute: 'price', comparator: 'less_than', value: 8.0 }],
};
for await (const record of Product.search(query)) {
	// process record
}
```

##### SSR rendering with `tables`

```typescript
import { tables } from 'harper';

export async function render(url: string): Promise<string> {
	const product = await tables.Product.get(idFromUrl(url));
	return renderToString(/* <App product={product} /> */);
}
```

##### Mutable update with `addTo`

```javascript
const product = await Product.update(32);
product.status = 'active';
product.subtractFrom('quantity', 1);
product.save();
```

#### Notes

- `tables` calls run in a trusted server-side context and do **not** automatically apply the target table's role permissions. Enforce authorization in your own application logic.
- Destructive operations (`update`, `patch`, `delete`) act on live data and are not easily reversible. Always scope with specific `conditions`, validate the affected set before writing, and gate behind authorization controls.
- Sorting by the bare `@primaryKey` alone with no conditions triggers `HdbError: <attribute> is not indexed and not combined with any other conditions`. Add an open-ended range condition or pass `allowFullScan: true` to permit an unconditional scan.
- Selecting a relationship field without filtering on it behaves as a **LEFT JOIN**; adding a condition on a related attribute behaves as an **INNER JOIN**.
- `transaction()` is safe to call defensively — if a transaction is already active on the context, it reuses it and executes the callback immediately.
- Link the `harper` package for correct typings in standalone component directories: `npm link harper`.

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

Apply this rule when deploying a Harper application to a remote Harper Fabric cluster or any remote Harper instance. This includes first-time deploys, redeployments, rollbacks, CI/CD pipeline deploys, and provisioning credentials for private repositories. See [creating-a-fabric-account-and-cluster.md](creating-a-fabric-account-and-cluster.md) for setting up the cluster before deploying.

#### How It Works

1. **Authenticate against the remote cluster**: Run `harper login` once, pointing at the cluster's Application URL (found on the cluster's **Config → Overview** page). The CLI stores the token and writes `HARPER_CLI_TARGET` to a local `.env`.

   ```bash
   harper login <Application URL>
   # Provide cluster username and password when prompted
   ```

2. **Deploy the application**: After login, run `harper deploy` without repeating credentials. Set `restart=true` and `replicated=true` for a production deploy.

   ```bash
   harper deploy \
     project=<name> \
     package=<package> \
     target=<remote> \
     restart=true \
     replicated=true
   ```

3. **Use environment variables for CI/CD**: Instead of `harper login`, export credentials as environment variables before calling `harper deploy`.

   ```bash
   export HARPER_CLI_USERNAME=<username>
   export HARPER_CLI_PASSWORD=<password>
   harper deploy \
     project=<name> \
     package=<package> \
     target=<remote> \
     restart=true \
     replicated=true
   ```

4. **Choose a package source**: The `package` field accepts any valid npm dependency value. Select the form that matches your source:

   | Source                  | `package` value                                      |
   | ----------------------- | ---------------------------------------------------- |
   | Current local directory | Omit `package`                                       |
   | npm package             | `"@harperdb/status-check"`                           |
   | GitHub (public)         | `"HarperFast/status-check"` or full URL              |
   | Private repo (SSH)      | `"git+ssh://git@github.com:HarperDB/secret-app.git"` |
   | Tarball                 | `"https://example.com/application.tar.gz"`           |

   For git tags, use the `semver` directive:

   ```
   HarperFast/application-template#semver:v1.0.0
   ```

5. **Deploy by reference for reproducible deploys**: Pass `by_ref=true` to send a pinned git SHA instead of uploading a snapshot. The cluster fetches and builds from that exact commit.

   ```bash
   harper deploy by_ref=true restart=true replicated=true
   ```

   Use `ref` to target a specific commit, tag, or branch (resolved to a full SHA before sending):

   ```bash
   # Deploy a specific tag
   harper deploy ref=v1.2.0 restart=true replicated=true

   # Roll back by deploying an older commit
   harper deploy ref=9f8c2a1 restart=true replicated=true
   ```

   **Key constraints for `ref` values:**
   - Must name something a clone can fetch: `refs/heads/*` and `refs/tags/*`, or a bare branch or tag name.
   - Anything else (e.g., `refs/pull/123/head`) is rejected up front.
   - If a ref can't be resolved, the deploy stops — run `git fetch` and retry, or pass a full commit SHA.
   - Commit and push before deploying: the cluster clones from the remote and only sees pushed commits.

6. **Deploy private repositories by reference**: Pass `credential=true` alongside `by_ref=true`. The CLI attaches a credentials reference; the cluster resolves the secret in memory at clone time — no token travels in the operation body or lands on disk.

   ```bash
   harper deploy by_ref=true credential=true restart=true replicated=true
   ```

7. **Provision a deploy credential for private sources**: Run `harper deploy setup=true` once per component and source. This is interactive and requires **super_user** — run it with an administrative credential, not the CI identity.

   ```bash
   harper deploy setup=true
   ```

   This command:
   1. Fetches the cluster's public key with `get_secrets_public_key`.
   2. Encrypts the token locally into an `enc:v1:` envelope.
   3. Stores only the ciphertext with `set_secret`, in the component-scoped tier.
   4. Grants the component permission to resolve it with `grant_secret`.
   5. Prints the `credentials` reference for the deploy to use.

   Use a **fine-grained** personal access token (PAT) scoped to **Contents: Read-only** on the specific repository. Avoid session tokens from `gh` CLI — they typically carry `repo`, `read:org`, `gist`, and `workflow` scopes across your whole account.

#### Examples

**Standard deploy after login:**

```bash
harper login https://my-cluster.harperdbcloud.com
harper deploy \
  project=my-app \
  package="HarperFast/my-app" \
  target=https://my-cluster.harperdbcloud.com \
  restart=true \
  replicated=true
```

**CI/CD deploy using environment variables:**

```bash
export HARPER_CLI_USERNAME=admin
export HARPER_CLI_PASSWORD=secret
harper deploy \
  project=my-app \
  package="HarperFast/my-app" \
  target=https://my-cluster.harperdbcloud.com \
  restart=true \
  replicated=true
```

**Deploy by reference in GitHub Actions (pull request):**

```bash
harper deploy ref=${{ github.event.pull_request.head.sha }} restart=true replicated=true
```

**Deploy a private repo by reference with a provisioned credential:**

```bash
# Provision once (run as super_user)
harper deploy setup=true

# Deploy subsequently
harper deploy by_ref=true credential=true restart=true replicated=true
```

#### Notes

- `auth_username` and `auth_password` can be passed directly as deploy parameters for one-off commands, but this is not recommended for production. Dedicated authentication parameters take precedence over environment variables and saved login tokens.
- The `enc:v1:` envelope means the plaintext token never leaves your machine — only ciphertext is stored and replicated.
- Deploy credentials are stored scoped to the component, never in the global `processEnv` tier. If a global secret exists at the derived name, it is converted to the component-scoped tier automatically.
- Because stored credentials are durable, later deploys and rollbacks reuse them without re-entering anything.
- The unpushed-commit check is skipped under GitHub Actions; the dirty-tree warning still applies.
- Deploying by reference means the cluster installs and builds from source. If your application requires a build step that cannot run on the node, deploy the built output as a payload deploy instead.
- For SSH-based private repos, use the `add_ssh_key` operation to register keys before deploying.

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

Instructions for the agent to apply when migrating a Harper application to v5, covering all breaking changes and required code updates.

#### When to Use

Apply this rule when upgrading an existing Harper application to v5, when encountering runtime errors related to renamed packages, changed APIs, or security restrictions after a v5 upgrade, or when scaffolding new v5-compatible application code.

#### How It Works

1. **Update the package import from `harperdb` to `harper`**: All application code must import from `harper`, not `harperdb`.

   ```javascript
   import { tables } from 'harper';
   ```

2. **Enable `allowInstallScripts` if packages require install scripts**: Harper v5 uses `--ignore-scripts` by default when installing packages. If a package requires execution of install scripts (e.g., to install native binaries), set the `allowInstallScripts` option when deploying.

3. **Update `Table.get` usage — return value is now a frozen record object**: `Table.get` now returns a plain record object, not a table class instance. The record is frozen; you cannot add or mutate properties directly.
   - Replace direct property mutation:

     ```javascript
     let record = await Table.get(id);
     record = { ...record, property: 'changed' };
     ```

   - Replace `wasLoadedFromSource()` with `loadedFromSource` on the `target` object:

     ```javascript
     const target = new RequestTarget();
     target.id = id;
     const record = await Table.get(target);
     if (target.loadedFromSource) {
     	// record was loaded from origin (not cache)
     }
     ```

   The record objects still expose `getUpdatedTime` and `getExpiresAt` methods.

4. **Update transaction and context handling using `getContext`**: Harper v5 uses asynchronous context tracking. Context and the current transaction are automatically carried to all downstream calls — you no longer pass context explicitly. Import `getContext` and `transaction` from `harper`:

   ```javascript
   import { getContext, transaction } from 'harper';
   ```

   If your code previously omitted context to escape a transaction (e.g., to poll for updated data), explicitly commit the transaction and/or wrap each read in a new `transaction()` call:

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

5. **Register allowed spawn commands via `allowedSpawnCommands`**: `spawn` and `execFile` may only launch executables listed in `applications.allowedSpawnCommands` in `harperdb-config.yaml`. Only the first token of the command is matched. `exec` is not usable through the substituted module; `execSync` always throws.

   ```yaml
   applications:
     allowedSpawnCommands:
       - npm
       - node
   ```

   Additionally, `spawn`, `execFile`, and `fork` now require a `name` property in the `options` argument to prevent process multiplication across threads.

6. **Use `saveBeforeCommit` instead of `blob.save()`**: The `blob.save()` method has been removed. Pass the `saveBeforeCommit` flag in the options to the `Blob` constructor instead.

7. **Handle `headers` on returned response objects**: If you return an object from a REST method with a `headers` property, Harper v5 will use it as the response headers.

8. **Configure the VM module loader and `lockdown` in `harperdb-config.yaml`**: v5 loads application modules through Node.js's VM module API. Control all behavior under the `applications` key:

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

   **`moduleLoader` options:**

   | Value                | Behavior                                                                                                                         |
   | -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
   | `vm-current-context` | Default. VM loader in Harper's own context; shares intrinsics with Harper. Best compatibility.                                   |
   | `vm`                 | VM loader in a separate per-application context with its own intrinsics. Stronger isolation but may cause `instanceof` failures. |
   | `native`             | Standard Node.js `import()`. No VM loader; application-specific context (`logger`, `config`) unavailable.                        |
   | `compartment`        | SES Compartment-based loading. For specialized sandboxing only.                                                                  |

   **`lockdown` options:**

   | Value               | Behavior                                                |
   | ------------------- | ------------------------------------------------------- |
   | `freeze-after-load` | Default. Freezes intrinsics after all components load.  |
   | `freeze`            | Freezes intrinsics before loading any application code. |
   | `ses`               | Full SES lockdown via the `ses` package. Strictest.     |
   | `none`              | No lockdown. Use as a temporary workaround only.        |

   To disable the VM loader entirely and restore pre-v5 behavior:

   ```yaml
   applications:
     moduleLoader: native
   ```

#### Examples

**Full transaction polling pattern (v5):**

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

**Checking `loadedFromSource` after `Table.get`:**

```javascript
const target = new RequestTarget();
target.id = id;
const record = await Table.get(target);
if (target.loadedFromSource) {
	// record was loaded from origin (not cache)
}
```

**Full `harperdb-config.yaml` `applications` block:**

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

**Restricting allowed built-in modules:**

```yaml
applications:
  allowedBuiltinModules:
    - fs
    - path
    - http
```

#### Notes

- Always import Harper APIs from `'harper'`, not from global variables or `'harperdb'`.
- `getContext` is exported from `'harper'` and provides access to the current transaction without passing context explicitly.
- Record objects returned by `Table.get` are frozen — spread into a new object before modifying.
- `loadedFromSource` is a property on the `target` object, replacing the removed `wasLoadedFromSource()` instance method.
- `saveBeforeCommit` replaces the removed `blob.save()` method.
- The `headers` property on a returned REST response object is used as response headers.
- Under `lockdown: ses`, the constrained `fetch` applies only in `vm` mode. In `vm-current-context` and `native` modes, application code uses the standard global `fetch`.
- In production, `allowedDirectory: app` is the default; modules outside the application directory tree will throw. Set `allowedDirectory: any` only if legitimately required.
- `dependencyLoader: native` is a narrower option than `moduleLoader: native` — it uses native loading only for npm packages while keeping the VM loader for first-party application source files.

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
