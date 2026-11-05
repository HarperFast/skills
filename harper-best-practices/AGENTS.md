# Harper Best Practices

Guidelines for building scalable, secure, and performant applications on Harper. These practices cover everything from initial schema design to advanced deployment strategies.

## 1. Schema & Data Design

### 1.1 Adding Tables with Schemas

Instructions for the agent to follow when adding tables to a Harper database.

**Instead of:** Postgres, MySQL, MongoDB, DynamoDB, Supabase, Firebase. Use this rule rather than adding that service. See `harper-architecture`.

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

### 1.2 Schema Design and GraphQL Tooling

Instructions for the agent to follow when designing Harper database schemas using GraphQL type definitions, core directives, and tooling configuration.

#### When to Use

Apply this rule when creating or modifying Harper schema files — defining tables, primary keys, indexes, and export behavior. Use it when configuring `graphqlSchema` in `config.yaml` or when choosing directives to control table structure, access patterns, and record lifecycle.

#### How It Works

1. **Create a schema file** using standard GraphQL type definitions with Harper-specific directives. Name it (e.g., `schema.graphql`) and place it in your component directory.

   ```graphql
   type Dog @table {
   	id: Long @primaryKey
   	name: String
   	breed: String
   	age: Int
   }
   ```

2. **Register the schema** in the component's `config.yaml` using the `graphqlSchema` plugin:

   ```yaml
   graphqlSchema:
     files: 'schema.graphql'
   ```

3. **Mark every table type with `@table`**. This tells Harper to create and manage the table. The type name becomes the table name by default.

   ```graphql
   type MyTable @table {
   	id: Long @primaryKey
   }
   ```

   Use `@table` arguments to override defaults:

   | Argument                 | Type      | Default                       | Description                                                                    |
   | ------------------------ | --------- | ----------------------------- | ------------------------------------------------------------------------------ |
   | `table`                  | `String`  | type name                     | Override the table name                                                        |
   | `database`               | `String`  | `"data"`                      | Database to place the table in                                                 |
   | `expiration`             | `Int`     | —                             | Seconds until a record goes stale                                              |
   | `eviction`               | `Int`     | `0`                           | Additional seconds after `expiration` before physical removal                  |
   | `scanInterval`           | `Int`     | `(expiration + eviction) / 4` | Seconds between eviction scans                                                 |
   | `replicate`              | `Boolean` | `true`                        | Enable replication of this table                                               |
   | `replicaExpiration`      | `Float`   | `3600`                        | Seconds to keep a local residency replica                                      |
   | `replicaRefreshFraction` | `Float`   | `0.5`                         | Fraction of `replicaExpiration` after which a read renews the replica lifetime |
   | `audit`                  | `Boolean` | `logging.auditLog`            | Enable the table's transaction log                                             |
   | `cacheControl`           | `String`  | —                             | `Cache-Control` header for anonymous GET/HEAD 200/304 responses                |
   | `randomAccessFields`     | `Boolean` | `storage.randomAccessFields`  | Pin this table's record encoding                                               |

4. **Designate a primary key with `@primaryKey`** on exactly one field per table. Primary keys must be unique; duplicate inserts are rejected. If no primary key is provided on insert, Harper auto-generates one:
   - `String` or `ID` → UUID string
   - `Int`, `Long`, or `Any` → auto-incrementing integer

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	name: String
   }
   ```

   Use `Long` or `Any` for auto-generated numeric keys; `Int` is 32-bit and may be insufficient for large tables.

5. **Add `@indexed` to fields that need fast querying**. Required for filtering by an attribute in REST queries, SQL, or NoSQL operations. If the field value is an array, each element is individually indexed.

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	category: String @indexed
   	price: Float @indexed
   }
   ```

6. **Expose the table externally with `@export`**. This makes the table accessible via REST, MQTT, and other interfaces. The optional `name` parameter sets the URL path segment; without it, the type name is used.

   ```graphql
   type MyTable @table @export(name: "my-table") {
   	id: Long @primaryKey
   }
   ```

   `@export` alone does not serve HTTP traffic — REST must also be enabled for the application, either with `rest: true` in `config.yaml` or by Harper's built-in default for a component with no configuration file.

7. **Use `@sealed` to prevent extra properties** on records beyond those declared in the schema. By default, Harper allows records to have additional properties.

   ```graphql
   type StrictRecord @table @sealed {
   	id: Long @primaryKey
   	name: String
   }
   ```

8. **Use timestamp directives** to auto-populate lifecycle fields:
   - `@createdTime` — assigns Unix epoch milliseconds on record creation
   - `@updatedTime` — assigns Unix epoch milliseconds on every update
   - `@expiresAt` — marks a field as the record's absolute expiration time (Unix epoch milliseconds); authoritative over the table-level `expiration` default

9. **Use `@embed`** to automatically compute an embedding vector for an attribute whenever the source field is written (requires `source` and `model` arguments; field type must be `[Float]`):

   ```graphql
   type Document @table {
   	id: Long @primaryKey
   	text: String
   	embedding: [Float] @embed(source: "text", model: "default")
   }
   ```

10. **Use unique `database` names** in plugins or applications to avoid table naming collisions, since all tables default to the `data` database.

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

**Table with name override and specific database:**

```graphql
type Product @table(table: "products", database: "commerce") {
	id: Long @primaryKey
	name: String @indexed
	price: Float @indexed
}
```

**Caching table with expiration and eviction tuning:**

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

**Table with replica lifetime control:**

```graphql
# Keep fetched records for a day; a read after six hours renews them
type Order @table(replicaExpiration: 86400, replicaRefreshFraction: 0.25) {
	id: ID @primaryKey
	region: String @indexed
}
```

**Session table with per-record expiration and timestamps:**

```graphql
type Session @table {
	id: ID @primaryKey
	userId: String @indexed
	createdAt: Long @createdTime
	updatedAt: Long @updatedTime
	expiresAt: Long @expiresAt
}
```

**`config.yaml` registration:**

```yaml
graphqlSchema:
  files: 'schema.graphql'
```

#### Notes

- `@export` is a routing directive, not access control. Omitting it returns 404 to callers but does not protect the data — the table remains accessible through the Operations API and SQL. Use RBAC role grants and `attribute_permissions` for actual access control.
- `@hidden` (on types or fields) suppresses entries from MCP tool descriptors and the OpenAPI document only. It does not restrict data access. Use `attribute_permissions` on roles for field-level enforcement.
- Null values are indexed by default for `@indexed` fields, enabling queries like `GET /Product/?category=null`. This matches records that store `null`, not records that omit the attribute.
- `cacheControl` emits the header only on anonymous (unauthenticated) GET/HEAD 200/304 responses. Authenticated responses receive `Cache-Control: private, no-cache` regardless of the declaration.
- A `patch` of other fields preserves an existing `@expiresAt` value; a full `put` that omits the field clears it. Always re-include `expiresAt` in session-renewal writes.
- `replicaExpiration` and `randomAccessFields` apply to RocksDB only. LMDB tables ignore replica behavior regardless of settings.
- Disabling replication on a table (`replicate: false`) and re-enabling it later will not catch up on writes made while replication was disabled.

### 1.3 Defining Relationships Between Tables in Harper

Instructions for the agent to follow when defining and querying relationships between tables in Harper using the `@relationship` directive.

**Instead of:** ORM relations and join tables (Prisma, Drizzle, Sequelize). Use this rule rather than adding that service. See `harper-architecture`.

#### When to Use

Apply this rule when adding foreign-key relationships between schema tables, enabling join queries, or selecting nested related records in query results. Use it any time a schema type needs to reference records in another table via a `@relationship` directive.

#### How It Works

1. **Use `@relationship(from: attribute)` for many-to-one or many-to-many**: Place this on the field whose table holds the foreign key. The `from` argument names the attribute in this table that stores the foreign key referencing the target table's primary key.

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

2. **Use `@relationship(to: attribute)` for one-to-many or many-to-many**: Place this on the field whose table holds the primary key. The `to` argument names the attribute in the _target_ table that stores the foreign key. The result type must be an array.

   ```graphql
   type Network @table @export {
   	id: Long @primaryKey
   	name: String @indexed
   	shows: [RealityShow] @relationship(to: networkId) # one-to-many
   }
   ```

3. **Use `@relationship(from: attribute, to: attribute)` for foreign-key-to-foreign-key joins**: Specify both `from` and `to` when neither side uses the primary key. The result type must be an array. Harper resolves the relationship by searching the target table's `to` attribute for matches using this record's `from` attribute value.

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

4. **Query across relationships using dot-syntax**: Filter by related table attributes using dot-chained paths. This behaves as an INNER JOIN — only parents with a matching related record are returned.

   ```
   GET /RealityShow?network.name=Bravo
   GET /Product/?brand.name=Microsoft
   GET /Brand/?products.name=Keyboard
   ```

5. **Include relationship fields in results using `select()`**: Relationship attributes are not included by default. Use `select()` to project them. Selecting a relationship without an outer dot-syntax filter behaves as a LEFT JOIN.

   ```
   GET /Product/?brand.name=Microsoft&select(name,brand)
   GET /Product/?brand.name=Microsoft&select(name,brand{name})
   GET /Product/?name=Keyboard&select(name,brand{name,id})
   ```

6. **Apply conditions, sort, and pagination to nested related records using bracket syntax inside `select()`**: Use square brackets after the relationship name inside `select()` to filter, sort, and page each parent's related records independently.

   | Nested option      | Behavior                                                                   |
   | ------------------ | -------------------------------------------------------------------------- |
   | Conditions         | Qualify children; combine with `&` (AND), `\|` (OR), and groups.           |
   | `sort(price)`      | Order eligible children before pagination.                                 |
   | `limit(end)`       | Return at most `end` children per parent.                                  |
   | `limit(start,end)` | Skip `start` eligible children and return at most `end - start`.           |
   | `select(id,price)` | Project fields from returned children; omit to return whole child records. |

   Invalid `limit()` bounds (negative or fractional values) return HTTP 400. `limit(0)` returns no children without reading them.

7. **Use bracket syntax on the relationship name in the query string to require one related record to meet multiple conditions**: This is distinct from separate `&`-joined conditions, which may be satisfied by different related records.

   ```
   GET /Brand/?products[name=Keyboard&price=ge=30]
   ```

   Inside brackets, name attributes of the related table directly (e.g., `price`, not `products.price`). Values convert to the attribute's schema type, so `price=ge=30` needs no `number:` prefix inside brackets.

8. **Combine OR filters with child sorting and pagination**: Group OR conditions inside the relationship selection with `[condition1|condition2]`, then append `sort()`, `limit()`, and `select()` with `&`.

   ```
   GET /Brand/?sort(name,id)&limit(0,20)&select(id,name,products[[price=lt=number:30|price=ge=number:60]&sort(-price,id)&limit(1,2)&select(id,name,price)])
   ```

9. **Index foreign key and filter fields**: Keep relationship lookup fields and outer filter fields indexed. The `from` or `to` attribute referenced in `@relationship` should carry `@indexed`.

#### Examples

##### Many-to-one with join query

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
GET /Brand/?products.name=Keyboard
```

##### Many-to-many with array foreign key

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

##### Nested filtering and pagination

```graphql
type Brand @table @export {
	id: Int @primaryKey
	name: String @indexed
	products: [Product] @relationship(to: "brandId")
}

type Product @table @export {
	id: ID @primaryKey
	brandId: Int @indexed
	name: String
	price: Int @indexed
}
```

Keep every brand; show its cheapest product costing at least 30 (LEFT JOIN behavior — Budget Basics remains with an empty product list):

```
GET /Brand/?select(id,name,products[price=ge=number:30&sort(price)&limit(1)&select(id,name,price)])
```

Return only qualifying brands; inherit the outer price filter into nested results:

```
GET /Brand/?products.price=ge=number:30&select(id,name,products[sort(price)&limit(1)&select(id,name,price)])
```

Page through each brand's qualifying products (offset applies independently per brand):

```
GET /Brand/?products.price=ge=number:30&select(id,name,products[sort(price)&limit(1,2)&select(id,name,price)])
```

Bound parent pages with stable sorting:

```
GET /Brand/?products.price=ge=number:30&sort(name,id)&limit(0,20)&select(id,name,products[sort(price,id)&limit(1)&select(id,name,price)])
```

##### Conditions through several relationships

```graphql
type Company @table @export {
	id: ID @primaryKey
	departments: [Department] @relationship(to: "companyId")
}

type Department @table @export {
	id: ID @primaryKey
	companyId: ID @indexed
	employees: [Employee] @relationship(to: "departmentId")
}

type Employee @table @export {
	id: ID @primaryKey
	departmentId: ID @indexed
	tag: String @indexed
	level: Int @indexed
}
```

| Query                                                                      | Matches    | Why                                                         |
| -------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------- |
| `departments.employees.tag=oncall&departments.employees.level=ge=number:3` | c1, c2, c3 | each condition may be met by a different department         |
| `departments[employees.tag=oncall&employees.level=ge=number:3]`            | c1, c2     | one department must meet both, possibly by different people |
| `departments[employees[tag=oncall&level=ge=3]]`                            | c2         | one employee must meet both                                 |
| `departments.employees[tag=oncall&level=ge=3]`                             | c2         | same as the previous row                                    |

#### Notes

- `@relationship(from: ...)` — the foreign key is in **this** table; result type can be singular or array.
- `@relationship(to: ...)` — the foreign key is in the **target** table; result type **must** be an array.
- `@relationship(from: attribute, to: attribute)` — foreign-key-to-foreign-key join; result type **must** be an array.
- Selecting a relationship without an outer dot-syntax filter is a LEFT JOIN; parents without matching related records are retained.
- An outer filter joined with `&` (e.g., `products.price=ge=number:30`) removes parents without a qualifying related record **and** narrows the related records returned by `select()`. A condition inside an OR only decides which parents match; it does not narrow selected related records.
- A nested filter inside `select(...,products[...])` only narrows projected children; it does not remove the parent.
- Separate `&`-joined conditions on a one-to-many relationship may each be satisfied by a **different** related record. Use `relationship[cond1&cond2]` bracket syntax to require one related record to meet all conditions.
- Self-referential relationships (a table referencing itself) are supported for parent-child hierarchies.
- Nested filters require a table-backed relationship. Filters on plain JSON projections or full-text predicates inside a relationship selection return HTTP 400.
- Keep parent pages small using outer `limit()`; a nested `limit()` bounds children per parent, not the number of parents.

### 1.4 Vector Indexing

Instructions for the agent to enable HNSW vector indexes on table fields and query them for similarity search in Harper.

**Instead of:** Pinecone, Weaviate, pgvector. Use this rule rather than adding that service. See `harper-architecture`.

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

4. **Apply a function predicate** using `vectorFilter` (JavaScript API only) for predicates not expressible as conditions. The function receives each candidate record and must return a synchronous boolean. Records are frozen:

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

6. **Include computed distance** in results by adding `$distance` to `select`. Works with both `sort`-based ranking and threshold queries:

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

   - `distance` — overrides the index distance function: `"cosine"`, `"euclidean"`, or `"dotProduct"`.
   - `ef` — overrides the search exploration budget. Higher values improve recall at the cost of latency.

8. **Tune filtered traversal** when a `vectorFilter` is very selective. Filtered traversal is bounded by `ef * filterExpansion` nodes visited. Raise either knob to trade latency for recall:

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

9. **Configure HNSW index parameters** in the schema directive. Use the parameter table below to choose values:

   ```graphql
   type Document @table {
   	id: Long @primaryKey
   	textEmbeddings: [Float]
   		@indexed(type: "HNSW", distance: "euclidean", optimizeRouting: 0, efConstructionSearch: 100)
   }
   ```

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

   > Use `efConstructionSearch` (not `efSearchConstruction`). Changing `efConstructionSearch` on an existing index does not trigger a rebuild. Changing structural parameters (`distance`, `M`, `efConstruction`, `quantization`) does rebuild the index.

10. **Enable vector quantization** with `quantization: "int8"` to reduce index size and memory usage. Graph navigation uses quantized distances; nearest-neighbor `sort` queries are re-ranked against full-precision vectors for exact results:

    ```graphql
    type Document @table {
    	id: Long @primaryKey
    	textEmbeddings: [Float] @indexed(type: "HNSW", quantization: "int8")
    }
    ```

#### Examples

##### Basic nearest-neighbor search

```graphql
type Document @table {
	id: Long @primaryKey
	textEmbeddings: [Float] @indexed(type: "HNSW")
}
```

```javascript
let results = Document.search({
	sort: { attribute: 'textEmbeddings', target: searchVector },
	limit: 5,
});
```

##### Filtered vector search with row-level access control

```javascript
function canReadReport(record, context) {
	const user = context.user;
	if (user?.role?.permission?.super_user) return true;
	return user?.username != null && record.ownerId != null && record.ownerId === user.username;
}

export class Reports extends tables.Reports {
	get(target) {
		const context = this.getContext();
		if (target.isCollection) {
			target.rowFilter = canReadReport;
		} else if (!canReadReport(this, context)) {
			return new Response(null, { status: 404 });
		}
		return super.get(target);
	}

	search(target) {
		target.rowFilter = canReadReport;
		return super.search(target);
	}

	subscribe(request) {
		request.rowFilter = canReadReport;
		return super.subscribe(request);
	}
}
```

##### Custom HNSW parameters with cosine distance

```graphql
type Document @table {
	id: Long @primaryKey
	textEmbeddings: [Float]
		@indexed(type: "HNSW", distance: "euclidean", optimizeRouting: 0, efConstructionSearch: 100)
}
```

#### Notes

- `vectorFilter` is available from the JavaScript API only — it cannot be expressed in a REST query string. It must be synchronous, side-effect free, and fast. Verdicts are memoized per query.
- `rowFilter` is also JavaScript API only. It participates in HNSW traversal so callers receive the k nearest _matching_ records. It does not apply to direct primary-key `get` calls. Prefer indexed query conditions for predicates that can be expressed declaratively.
- When a query passes no `ef` and the index does not explicitly configure `efConstructionSearch` (or `efConstruction`), the search budget auto-scales with index size.
- Distance-threshold (`lt`/`le`) queries with `quantization: "int8"` filter on approximate distance, not re-ranked full-precision distance.
- `$distance` is available in both `sort`-based ranking and `conditions`-based threshold queries.

### 1.5 Using the Blob Data Type

Instructions for the agent to follow when storing and retrieving large binary content using the `Blob` data type in Harper.

**Instead of:** S3 or GCS buckets for app-managed files. Use this rule rather than adding that service. See `harper-architecture`.

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

**Instead of:** S3 or GCS buckets for app-managed files. Use this rule rather than adding that service. See `harper-architecture`.

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

### 2.1 Automatic REST and WebSocket APIs

Instructions for the agent to follow when exposing Harper tables and custom resources as REST and WebSocket endpoints using Harper's automatically generated API layer.

**Instead of:** Hand-written CRUD routes (Express, Fastify, Next.js API routes). Use this rule rather than adding that service. See `harper-architecture`.

#### When to Use

Apply this rule when enabling HTTP REST access to Harper tables, when configuring WebSocket subscriptions on resource paths, or when customizing how exported resources respond to standard HTTP methods. Use it any time you need to wire up `rest: true`, handle conditional requests, or implement a `connect()` handler.

#### How It Works

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

#### Examples

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

#### Notes

- The trailing slash is always significant: `/Product` is the resource descriptor; `/Product/` is the record collection. `POST /Product` (no slash) returns `404`.
- `HEAD` is served exactly as `GET` with the response body omitted. `QUERY` is accepted on the collection path (`QUERY /Product/`) and runs a search taken from the request body rather than the URL.
- `PUT` always forces the primary key to match the `{id}` in the URL, re-stamps `@updatedTime`, and preserves `@createdTime` from the original record.
- PATCH merge is shallow only. A nested object in the body replaces the entire stored sub-object; omitted nested properties are lost.
- Server-Sent Events subscriptions are served on the same paths, negotiated via `Accept: text/event-stream`. They are not affected by the `webSocket` option.
- Leaving `@export` on the schema while also exporting a same-named subclass produces conflicting endpoints. When a JavaScript subclass should own the URL, omit `@export` from the schema and export the class instead.
- See [real-time-apps.md](real-time-apps.md) for patterns around WebSocket and event-driven resource design.
- See [querying-rest-apis.md](querying-rest-apis.md) for filtering, sorting, pagination, and content-type details.

### 2.2 Querying REST APIs

Instructions for the agent to filter, sort, select, and paginate Harper REST API collections using URL query parameters.

#### When to Use

Apply this rule when building or modifying HTTP requests against Harper REST collection endpoints that need attribute filtering, comparison operators, sorting, field selection, or pagination. Use it whenever constructing query strings for `GET` requests against table-backed resources exposed via `@export`. See [automatic-apis.md](automatic-apis.md) for how those endpoints are created.

#### How It Works

1. **Filter by attribute**: Add query parameters matching attribute names. The queried attribute must be indexed.

   ```
   GET /Product/?category=software
   GET /Product/?category=software&inStock=true
   ```

2. **Apply FIQL comparison operators**: Use FIQL syntax for range and equality comparisons.

   | Operator                                  | Meaning                                 |
   | ----------------------------------------- | --------------------------------------- |
   | `==`                                      | Equal                                   |
   | `=lt=`                                    | Less than                               |
   | `=le=`                                    | Less than or equal                      |
   | `=gt=`                                    | Greater than                            |
   | `=ge=`                                    | Greater than or equal                   |
   | `=ne=`, `!=`                              | Not equal                               |
   | `=between=(low,high)`, `=gele=(low,high)` | At least `low` and at most `high`       |
   | `=gelt=(low,high)`                        | At least `low` and less than `high`     |
   | `=gtle=(low,high)`                        | Greater than `low` and at most `high`   |
   | `=gtlt=(low,high)`                        | Greater than `low` and less than `high` |
   | `=ct=`                                    | Contains (strings)                      |
   | `=sw=`, `==<value>*`                      | Starts with (strings)                   |
   | `=ew=`                                    | Ends with (strings)                     |
   | `=`, `===`                                | Strict equality (no type conversion)    |
   | `!==`                                     | Strict inequality (no type conversion)  |

   ```
   GET /Product/?price=gt=100
   GET /Product/?price=le=20
   GET /Product/?category=software&price=gt=100&price=lt=200
   GET /Product/?price=between=(100,200)
   ```

   For date fields, URL-encode colons as `%3A`:

   ```
   GET /Product/?listDate=gt=2017-03-08T09%3A30%3A00.000Z
   ```

3. **Apply type conversion**: For FIQL comparators, Harper converts values automatically. Use explicit type prefixes when needed.

   | Syntax                                    | Behavior                                    |
   | ----------------------------------------- | ------------------------------------------- |
   | `name==null`                              | Converts to `null`                          |
   | `name==123`                               | Converts to number if attribute is untyped  |
   | `name==true`                              | Converts to boolean if attribute is untyped |
   | `name==number:123`                        | Explicit number conversion                  |
   | `name==boolean:true`                      | Explicit boolean conversion                 |
   | `name==string:some%20text`                | Keep as string with URL decode              |
   | `name==date:2024-01-05T20%3A07%3A27.955Z` | Explicit Date conversion                    |

   If the attribute declares a type in the schema (e.g., `Float`), values are always converted to that type before searching. For strict operators (`=`, `===`, `!==`), no automatic type conversion is applied.

4. **Query for null values**: Use `=null` to match records storing `null`; use `=ne=null` to match records with a present, non-null value. A record that omits the attribute matches neither.

   ```
   GET /Product/?discount=null
   GET /Product/?discount=ne=null
   ```

5. **Understand null and omitted value behavior**: Comparators treat a null value and an omitted value the same way, except `==null`, which matches a stored `null` only.
   - No range comparator (`=lt=`, `=le=`, `=gt=`, `=ge=`, `=between=`, etc.) matches a null or omitted value.
   - `=ne=` with a non-null value matches null and omitted values.
   - A `null` lower bound means no lower bound: `ge=null` and `gt=null` match every non-null value, and `between=(null,10)` returns the same records as `le=10`. A `null` upper bound: `lt=null` and `le=null` match nothing.
   - Sorting puts null and omitted values first; `-` puts them last, with no guaranteed order between the two.

6. **Chain range conditions**: Omit the attribute name on the second condition to apply it to the same attribute.

   ```
   GET /Product/?price=gt=100&lt=200
   ```

   Chaining supports `gt`/`ge` combined with `lt`/`le` only.

7. **Combine conditions with OR**: Use `|` instead of `&` for OR logic. Use parentheses or square brackets to group conditions.

   ```
   GET /Product/?rating=5|featured=true
   GET /Product/?rating=5|(price=gt=100&price=lt=200)
   GET /Product/?rating=5&[tag=fast|tag=scalable|tag=efficient]
   ```

   Prefer square brackets when constructing queries from user input:

   ```javascript
   let url = `/Product/?rating=5&[${tags.map(encodeURIComponent).join('|')}]`;
   ```

8. **Select specific fields with `select()`**: Specify which properties to include in the response.

   | Syntax                                 | Returns                                           |
   | -------------------------------------- | ------------------------------------------------- |
   | `?select(property)`                    | Values of a single property directly              |
   | `?select(property1,property2)`         | Objects with only the specified properties        |
   | `?select([property1,property2])`       | Arrays of property values                         |
   | `?select(property1,)`                  | Objects with a single specified property          |
   | `?select(property{subProp1,subProp2})` | Nested objects with specific sub-properties       |
   | `?select(id,products[limit(1)])`       | Parents with a constrained relationship selection |

   ```
   GET /Product/?category=software&select(name)
   GET /Product/?brand.name=Microsoft&select(name,brand{name})
   ```

9. **Limit results with `limit(end)` or `limit(start,end)`**: Return records in the zero-based window from `start` (inclusive) to `end` (exclusive). `limit(end)` starts at zero.

   ```
   GET /Product/?rating=gt=3&inStock=true&select(rating,name)&limit(20)
   GET /Product/?rating=gt=3&limit(10,30)
   ```

10. **Sort results with `sort(property)` or `sort(+property,-property,...)`**: Prefix `+` or no prefix = ascending; `-` = descending. Multiple properties break ties in order.

    ```
    GET /Product/?rating=gt=3&sort(+name)
    GET /Product/?sort(+rating,-price)
    ```

11. **Request total counts for pagination**: Send a `Prefer` header on `GET` or `HEAD` requests. Counting is opt-in; without the header, no count is computed. Counting requires a bounded `limit()` with page size (`end - start`, or `end` in the one-argument form) no larger than **10,000** and window end no larger than **1,000,000**.

    ```
    GET /Product/?category=software&limit(0,25)
    Prefer: count=exact
    ```

    | `Prefer` value    | Meaning                                                     |
    | ----------------- | ----------------------------------------------------------- |
    | `count=exact`     | Exact count of matching records; scans the full matched set |
    | `count=estimated` | Fast planner/table estimate; cheap and approximate          |

    Response headers:

    ```
    HTTP/1.1 200 OK
    Content-Range: items 0-24/1234
    Range-Unit: items
    Preference-Applied: count=exact
    ```

    | Header               | Example           | Description                                                               |
    | -------------------- | ----------------- | ------------------------------------------------------------------------- |
    | `Content-Range`      | `items 0-24/1234` | 0-based inclusive range of records returned out of the total matching set |
    | `Range-Unit`         | `items`           | The unit used by `Content-Range`                                          |
    | `Preference-Applied` | `count=exact`     | The count mode the server applied                                         |
    - The response status for paginated results is always `200`; Harper does not use `206 Partial Content`. `Content-Range` is informational.
    - Without `exactCount: true`, a `count=exact` request is served as an estimate (`Preference-Applied: count=estimated`). When the total cannot be produced, it is reported as `.../*` (e.g., `Content-Range: items 0-24/*`). `Preference-Applied` still echoes the requested mode, so an unavailable total (`.../*`) is distinct from a request that asked for no count.
    - Exact counting is off by default. Enable it in REST configuration:
      ```yaml
      rest:
        exactCount: true
      ```
    - When CORS is enabled, `Content-Range`, `Range-Unit`, and `Preference-Applied` are added to `Access-Control-Expose-Headers`.
    - Full-text queries cannot provide an exact total count; `Prefer: count=exact` returns `Content-Range: items <range>/*` for full-text indexes.
    - For JSON-array responses from full-text queries, check for a terminal error object shaped like `{ "error": "ErrorName: message" }` and treat the response as failed. A stream or JSON-parse error is also a failed page, not a record.

12. **Use full-text operators**: For a `FullText` field carrying `@fullText`, use the field name as the query attribute with a full-text comparator.

    ```
    GET /Product/?catalogSearch=matches=waterproof%20trail
    GET /Product/?catalogSearch=matches_phrase=trail%20running
    GET /Product/?catalogSearch=matches_prefix=waterproof%20tra&limit(10)
    ```

    Supported operators: `matches`, `matches_all`, `matches_phrase`, `matches_prefix`, `matches_fuzzy`, `matches_fuzzy_prefix`, plus a `not_` form of each. A negated full-text condition requires a non-negated condition on the same index. Repeat the parameter to provide both:

    ```
    GET /Product/?catalogSearch=matches=waterproof&catalogSearch=not_matches=leather
    ```

    Use operators like `=matches=`, `=matches_phrase=`, `=matches_prefix=`, and `=matches_fuzzy=` with the full-text field name. The REST URL syntax searches every source field in the index, so the caller must be allowed to read every source field.

13. **Query across relationships**: Use dot-syntax to filter by related table attributes. Relationships must be defined with `@relationship` in the schema.

    ```
    GET /Product/?brand.name=Microsoft
    GET /Product/?brand.name=Microsoft&select(name,brand{name})
    ```

    Selecting a relationship without an outer dot-syntax filter behaves as a LEFT JOIN. An outer filter joined with `&` removes parents without a qualifying related record. An outer relationship filter narrows nested relationship results. A nested filter inside `select(...,products[...])` only narrows projected products; it does not remove a parent.

14. **Apply conditions one related record must meet**: Use square brackets after the relationship name to require one related record to satisfy all enclosed conditions.

    ```
    GET /Brand/?products[name=Cable&price=ge=30]
    GET /Brand/?products[name=Keyboard&price=ge=30]
    ```

    Inside the brackets, name attributes of the related table directly (e.g., `price`, not `products.price`). Conditions combine with `&`, `|`, and groups.

15. **Filter and page nested relationships**: Use square brackets inside `select()` to apply conditions, sort, and pagination to each parent's related records.

    ```
    GET /Brand/?select(id,name,products[price=ge=number:30&sort(price)&limit(1)&select(id,name,price)])
    ```

    | Nested option      | Behavior                                                        |
    | ------------------ | --------------------------------------------------------------- |
    | Conditions         | Qualify children of the selected relationship                   |
    | `sort(price)`      | Order eligible children before pagination                       |
    | `limit(end)`       | Return at most `end` children per parent                        |
    | `limit(start,end)` | Skip `start` eligible children and return at most `end - start` |
    | `select(id,price)` | Project fields from returned children                           |
    - `limit(0)` returns no children without reading them. Invalid nested bounds (negative or fractional values) return HTTP 400.
    - Nested filters require a table-backed relationship. Filters on plain JSON projections or full-text predicates inside a relationship selection return HTTP 400.

#### Examples

##### Range filter with type conversion

```
GET /Product/?price=gt=100&price=lt=200
GET /Product/?price=between=(100,200)
```

##### Null query

```
GET /Product/?discount=null
GET /Product/?discount=ne=null
```

##### Select with sort and limit

```
GET /Product/?rating=gt=3&inStock=true&select(rating,name)&limit(20)
GET /Product/?sort(+rating,-price)
```

##### Paginated request with exact count

```
GET /Product/?category=software&limit(0,25)
Prefer: count=exact
```

Response headers:

```
Content-Range: items 0-24/1234
Range-Unit: items
Preference-Applied: count=exact
```

##### Relationship query with nested selection and pagination

```
GET /Brand/?products.price=ge=number:30&select(id,name,products[sort(price)&limit(1)&select(id,name,price)])
```

##### OR grouping with nested relationship filter and pagination

```
GET /Brand/?sort(name,id)&limit(0,20)&select(id,name,products[[price=lt=number:30|price=ge=number:60]&sort(-price,id)&limit(1,2)&select(id,name,price)])
```

##### Conditions through several relationship hops

```
GET /Company/?departments[employees[tag=oncall&level=ge=3]]
GET /Company/?departments.employees[tag=oncall&level=ge=3]
```

##### Many-to-many relationship query

```
GET /Product/?resellers.name=Cool Shop&select(id,name,resellers{name,id})
```

#### Notes

- Only indexed attributes can lead a filter query; at least one attribute in a multi-attribute query must be indexed.
- Null indexing requires indexes created in v4.3.0 or later. Existing indexes must be removed and re-added to support `discount=null` queries.
- For strict operators (`=`, `===`, `!==`), no automatic type conversion is applied — the value is decoded as a URL-encoded string.
- No range comparator (`=lt=`, `=le=`, `=gt=`, `=ge=`, `=between=`, etc.) matches a null or omitted value.
- `=ne=` with a non-null value matches null and omitted values.
- A `null` lower bound means no lower bound: `ge=null` and `gt=null` match every non-null value, and `between=(null,10)` returns the same records as `le=10`. A `null` upper bound: `lt=null` and `le=null` match nothing.
- Sorting puts null and omitted values first; `-` puts them last, with no guaranteed order between the two.
- A `HEAD` request with a `count` preference returns count headers with no body.
- The response status for paginated results is always `200`; Harper does not use `206 Partial Content`. `Content-Range` is informational.
- Without `exactCount: true`, a `count=exact` request is served as an estimate (`Preference-Applied: count=estimated`). When the total cannot be produced, it is reported as `.../*` (e.g., `Content-Range: items 0-24/*`). `Preference-Applied` still echoes the requested mode, so an unavailable total (`.../*`) is distinct from a request that asked for no count.
- When CORS is enabled, `Content-Range`, `Range-Unit`, and `Preference-Applied` are added to `Access-Control-Expose-Headers`.
- Full-text queries cannot provide an exact total count; with exact counting enabled, `Prefer: count=exact` returns an unavailable total (`.../*`).
- For JSON-array responses from full-text queries, check for a terminal error object shaped like `{ "error": "ErrorName: message" }` and treat the response as failed. A stream or JSON-parse error is also a failed page, not a record.
- Access a specific property of a record by appending it with dot syntax to the record id: `GET /MyTable/123.propertyName`. This only works for declared properties. The suffixes `.json`, `.cbor`, `.msgpack`, and `.csv` are reserved as content-type selectors and take precedence over a property of the same name.
- Querying through a relationship requires read permission on the related table and each related attribute named in a condition; without it, Harper returns HTTP 403.
- Nested filters require a table-backed relationship. Filters on plain JSON projections or full-text predicates inside a relationship selection return HTTP 400.
- `limit(0)` returns no children without reading them. Invalid nested bounds (negative or fractional values) return HTTP 400.

### 2.3 Real-Time Apps with WebSockets and Pub/Sub

Instructions for the agent to follow when building real-time features in Harper using WebSockets and Pub/Sub.

**Instead of:** Socket.io, `ws`, Pusher, Ably, Redis pub/sub, a separate MQTT broker. Use this rule rather than adding that service. See `harper-architecture`.

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

**Instead of:** Hand-rolled sessions, `passport`, `jsonwebtoken`, `bcrypt`. Use this rule rather than adding that service. See `harper-architecture`.

#### When to Use

Apply this rule when implementing sign-in/sign-out flows, reading the current authenticated user, issuing or refreshing JWT tokens, or minting scoped tokens from a custom Resource. Use it whenever a Resource must inspect, establish, or delegate authentication state. See [custom-resources.md](custom-resources.md) for the broader Resource authoring context.

#### How It Works

##### Reading the Current User

1. **Use `getCurrentUser()` in instance methods**: Call `getCurrentUser()` on a Resource instance to get the current authenticated user, or `undefined` if no user is authenticated. The returned object exposes `username`, `role`, and `role.permission` flags.

2. **Use `context.user` in static verbs**: Static verbs receive the context as a trailing argument. Read the current authenticated user from `context?.user`:

   ```javascript
   static async get(_target, context) {
     const user = context?.user;
     if (!user) return new Response(null, { status: 401 });
     return { username: user.username, role: user.role };
   }
   ```

3. **Use `getContext()` for dual-path static methods**: `getContext()` is a Resource instance method. For static methods that must work both via HTTP and direct server-side calls, import `getContext()` from the `harper` module. Static verbs receive context as the trailing argument — `(target, context)` for `get`/`delete`, `(target, data, context)` for `put`/`patch`/`post`.

4. **Access HTTP-specific context properties**: When triggered by HTTP, the context is the `Request` object with additional properties. Use these to read request metadata or set response headers:

   | Property          | Description                                                                      |
   | ----------------- | -------------------------------------------------------------------------------- |
   | `url`             | Full local path including query string                                           |
   | `method`          | HTTP method                                                                      |
   | `headers`         | Request headers (`context.headers.get(name)`)                                    |
   | `responseHeaders` | Response headers (`context.responseHeaders.set(name, value)`)                    |
   | `pathname`        | Path without query string                                                        |
   | `host`            | Host from the `Host` header                                                      |
   | `ip`              | Client IP address                                                                |
   | `body`            | Raw Node.js `Readable` stream (if a request body exists)                         |
   | `data`            | Promise resolving to the deserialized request body                               |
   | `lastModified`    | Controls `ETag`/`Last-Modified` response header                                  |
   | `requestContext`  | (Source resources only) Context of the upstream resource making the data request |
   | `transaction`     | Current transaction                                                              |

   When triggered by HTTP, the context also exposes `url`, `method`, `headers`, `responseHeaders`, `pathname`, `host`, `ip`, `body`, `data`, `lastModified`, and `requestContext`.

##### Session-Based Login and Logout

5. **Enable sessions in config**: Set `authentication.enableSessions: true` in `harperdb-config.yaml` before using `context.login` or `context.session`.

6. **Implement sign-in with `context.login`**: Call `context.login(username, password)` in a static `post` verb. It verifies credentials and establishes the session cookie on success:

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
   ```

7. **Implement sign-out by clearing the session user**: Use `context.session.update({ user: null })` — `update` is the session's only mutator. Test `context?.session?.user` to detect an established session, because `context.session` is an empty object (not `undefined`) when sessions are enabled and no session cookie is present:

   ```javascript
   export class SignOut extends Resource {
   	static async post(_target, _data, context) {
   		if (!context?.session?.user) return new Response(null, { status: 401 });
   		await context.session.update({ user: null });
   		return new Response('Logged out', { status: 200 });
   	}
   }
   ```

   Cookie-based sessions are intended for browser clients. For non-browser clients, use JWT issuance.

##### JWT Token Issuance

8. **Call `create_authentication_tokens` with credentials**: Send `username` and `password` in the request body. No `Authorization` header is required when credentials are in the body:

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

9. **Pass the `operation_token` as a Bearer token** on subsequent requests:

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

10. **Refresh an expired `operation_token`** using `refresh_operation_token`. Pass the `refresh_token` as `Bearer <refresh_token>`:

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

##### Scoped Tokens (Inline Role)

11. **Mint a scoped token as a `super_user`**: Pass `role` as an inline role-shaped object using the same `permission` structure as `add_role`. The minter must be authenticated as a `super_user`; no `password` may be included in the body. Use `expires_in` to set the token lifetime:

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

    Key constraints:
    - `username` is attribution only and must not name an existing user.
    - No refresh token is issued; no user record is created.
    - Scoped tokens cannot be revoked before expiry — prefer short lifetimes.
    - `super_user` and `cluster_user` are always forced to `false` in the embedded role.
    - In **mixed-version** clusters, only nodes with scoped-token support accept these tokens; older nodes reject them with a 401.

##### Issuing Tokens from a Custom Resource

12. **Use `server.operation()` to mint tokens programmatically**: Import `server` from `harper` and call `server.operation(operation, context, authorize)`. Pass `authorize: true` as the **third argument** when the operation should run as the current authenticated user; omit it or pass `false` when the operation supplies its own credentials:

    ```javascript
    import { Resource, server } from 'harper';

    export class IssueTokens extends Resource {
    	static async get(_target, context) {
    		// Caller is already authenticated — issue tokens for the current authenticated user.
    		const { operation_token, refresh_token } = await server.operation(
    			{ operation: 'create_authentication_tokens' },
    			context,
    			true,
    		);
    		return { operation_token, refresh_token };
    	}

    	static async post(_target, data) {
    		// Caller provides credentials in the body.
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

##### Token Expiry Configuration

13. **Configure token timeouts** in `harper-config.yaml` under the `authentication` section:

    ```yaml
    authentication:
      operationTokenTimeout: 1d # Default: 1 day
      refreshTokenTimeout: 30d # Default: 30 days
    ```

    Valid duration strings follow the `jsonwebtoken` package format (e.g., `1d`, `12h`, `60m`).

#### Examples

##### Full sign-in/sign-out Resource pair

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

##### Minting tokens via the Operations API

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

- **JWT is preferred over Basic Auth** for clients that can store tokens, want to avoid sending credentials on every request, or make multiple sequential requests. For simple or **server-to-server** scenarios, use Basic Authentication.
- Always use **HTTPS** in production to protect tokens in transit.
- Treat tokens like passwords. Because scoped tokens cannot be revoked before expiry, set short `expires_in` values in high-security environments and consider lowering `operationTokenTimeout`.
- A caller authenticated by a Bearer validator cannot mint tokens via the passwordless form — it must supply `username` and `password`.
- `enableSessions` is required in `harperdb-config.yaml` for `context.login` and `context.session` to be available.
- The **third argument** (`authorize: true`) to `server.operation()` attributes the operation to — and permission-checks against — the calling user.

## 3. Logic & Extension

### 3.1 Custom Resources

Instructions for the agent to follow when defining custom REST endpoints with JavaScript or TypeScript in Harper.

**Instead of:** Express, Fastify, or Koa route handlers; serverless functions. Use this rule rather than adding that service. See `harper-architecture`.

#### When to Use

Apply this rule when you need to create custom HTTP endpoints, wrap external APIs, or register routes programmatically in a Harper application. Use it any time business logic must live outside a standard table-backed resource.

#### How It Works

1. **Import `Resource` from `harper`**: Pull in the base class before extending it.

   ```javascript
   import { tables, Resource } from 'harper';
   ```

   CommonJS is also supported:

   ```javascript
   const { tables, Resource } = require('harper');
   ```

2. **Define a class that `extends Resource`**: Declare HTTP handler methods as `static` methods matching the HTTP verb (`get`, `put`, `post`, etc.). Each method receives a `target` object representing the request.

   ```javascript
   export class CustomEndpoint extends Resource {
   	static get(target) {
   		return {
   			data: doSomething(),
   		};
   	}
   }
   ```

3. **Wrap external APIs** by making the `static` methods `async` and using `fetch` or any other async call inside them.

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

   // Use as a cache source for a local table
   tables.MyCache.sourcedFrom(MyExternalData);
   ```

4. **Control the URL by choosing an export form**: The shape of the export determines the resulting endpoint URL.

   | Export form                                 | URL             | Notes                                                           |
   | ------------------------------------------- | --------------- | --------------------------------------------------------------- |
   | `export class Foo extends Resource {}`      | `/Foo/`         | Class name becomes the path segment. Case-sensitive.            |
   | `export const Bar = { Foo };`               | `/Bar/Foo/`     | Nest under an object to add a path prefix.                      |
   | `export const bar = { 'foo-baz': Foo };`    | `/bar/foo-baz/` | Use object keys for lowercase, hyphens, or non-identifier URLs. |
   | `export { Foo as '/widget/:id' }`           | `/widget/:id`   | Rename the export to set the path directly.                     |
   | `static path = '/widget/:id'` (class field) | `/widget/:id`   | Declare path on the class; overrides the export name.           |
   | `server.resources.set('my-path', Foo);`     | `/my-path/`     | Programmatic registration; useful when the path is dynamic.     |

   URL path matching is case-sensitive — `/Foo/` and `/foo/` are different endpoints.

5. **Declare dynamic path segments** using `static path` on the class. Use `:name` for a single segment and `*name` as a catch-all for the rest of the path. Matched values are bound onto `target.<name>`.

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

   - A bare `*` (no name) binds under `target.wildcard`.
   - A wildcard must be the final segment of the path.
   - A leading `/` makes the path root-relative (top-level), independent of the file's location.
   - A leading `./` or a bare name resolves relative to the component directory.
   - `static path` takes precedence over the export name.

6. **Understand resolution order**: Exact and static paths always win over parameterized ones. Among parameterized routes, more specific paths win: a literal segment beats a `:param`, which beats a `*` wildcard, compared left to right.

7. **Register programmatically** using `server.resources.set(` when the path must be determined at runtime rather than statically.
   ```javascript
   server.resources.set('my-path', Foo);
   ```

#### Examples

**Custom endpoint with a fixed path:**

```javascript
import { Resource } from 'harper';

export class CustomEndpoint extends Resource {
	static get(target) {
		return {
			data: doSomething(),
		};
	}
}
```

**External API wrapper used as a cache source:**

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

tables.MyCache.sourcedFrom(MyExternalData);
```

**Path parameters with `static path`:**

```javascript
import { Resource } from 'harper';

export class Widget extends Resource {
	static path = '/widget/:id/action/:action';
	static get(target) {
		return { id: target.id, action: target.action };
	}
}
```

**Programmatic registration:**

```javascript
server.resources.set('my-path', Foo);
```

#### Notes

- Do not create conflicting exports between a schema definition and a JavaScript implementation when a resource extends an existing table.
- Parameterized routes surface in the generated OpenAPI document as templated paths (e.g., `/widget/{id}/action/{action}`) and in MCP `resources/templates/list` as `{param}` URI templates.
- When bundling for SSR with a tool like Vite, keep `harper` external so it resolves to the runtime: `ssr: { external: ['harper'] }`.
- Run `npm link harper` in a component's own directory to ensure typings match the running installation. All installed components have `harper` automatically linked.

### 3.2 Extending Tables

Instructions for the agent to follow when adding custom logic to automatically generated table resources in Harper.

**Instead of:** Middleware and controllers wrapped around CRUD routes. Use this rule rather than adding that service. See `harper-architecture`.

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

Instructions for the agent to interact with Harper tables programmatically using the `tables` object, including querying, transactions, and module setup.

**Instead of:** ORM and query-builder clients (Prisma, Drizzle, Knex). Use this rule rather than adding that service. See `harper-architecture`.

#### When to Use

Apply this rule when writing server-side Harper code that reads or writes table data directly — for example, in request handlers, background jobs, timers, or SSR entry points. Use it whenever you need to construct a query with `conditions`, `sort`, `select`, `limit`, or `offset`, or when you need to wrap writes in a `transaction()`.

#### How It Works

1. **Import `tables` (and other APIs) from `harper`**: Access tables defined in `schema.graphql` via the `tables` object. Each table is a property matching its type name.

   ```javascript
   import { tables, transaction } from 'harper';
   const { Product } = tables;
   // equivalent to: databases.data.Product
   ```

   For CommonJS:

   ```javascript
   const { tables, Resource } = require('harper');
   ```

   For components in their own directory, link the package first:

   ```bash
   npm link harper
   ```

   When bundling for SSR with Vite, keep `harper` external so it resolves to the runtime — add `ssr: { external: ['harper'] }` in `vite.config`.

2. **Define your schema with `@table`**: Every type you want to access via `tables` must be declared with `@table` in `schema.graphql`. Use `@indexed` on attributes you intend to sort or filter by efficiently.

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	name: String
   	price: Float @indexed
   }
   ```

3. **Perform basic CRUD operations**: Use the table class methods directly.

   ```javascript
   // Create
   const created = await Product.create({ name: 'Shirt', price: 9.5 });

   // Patch
   await Product.patch(created.id, { price: Math.round(created.price * 0.8 * 100) / 100 });

   // Get by primary key
   const record = await Product.get(created.id);
   ```

4. **Query with `search(` and a query object**: Pass a query object with `conditions`, `sort`, `limit`, `offset`, `select`, and other options. `search(` returns an async iterable. If order doesn't matter, omit `sort` entirely and `search({})` will iterate without an index requirement.

   ```javascript
   const query = {
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 8.0 }],
   };
   for await (const record of Product.search(query)) {
   	// process record
   }
   ```

5. **Build `conditions` arrays**: Each condition object supports the following properties:

   | Property                   | Description                                                                                                                                                                                                                                                                                                         |
   | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `attribute`                | Property name, or array for chained/joined properties                                                                                                                                                                                                                                                               |
   | `value`                    | The value to match                                                                                                                                                                                                                                                                                                  |
   | `comparator`               | `equals` (default), `greater_than`, `greater_than_equal`, `less_than`, `less_than_equal`, `starts_with`, `contains`, `ends_with`, `between`, `not_equal`, or a full-text comparator (`matches`, `matches_all`, `matches_phrase`, `matches_prefix`, `matches_fuzzy`, `matches_fuzzy_prefix`, and their `not_` forms) |
   | `conditions`               | Nested conditions array                                                                                                                                                                                                                                                                                             |
   | `operator`                 | `and` (default) or `or` for nested `conditions`                                                                                                                                                                                                                                                                     |
   | `fields`                   | Full-text source fields to search; every name must belong to the selected full-text index                                                                                                                                                                                                                           |
   | `includeHighlights`        | Include configured full-text highlights                                                                                                                                                                                                                                                                             |
   | `maxIndexLagMilliseconds`  | Maximum accepted full-text index lag                                                                                                                                                                                                                                                                                |
   | `waitForIndexMilliseconds` | Time to wait for acceptable full-text coverage                                                                                                                                                                                                                                                                      |

   Use nested `conditions` and `operator` for compound logic:

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

   Use an array `attribute` to traverse relationships:

   ```javascript
   Product.search({ conditions: [{ attribute: ['brand', 'name'], value: 'Harper' }] });
   ```

6. **Apply `select` to shape results**: Pass an array of property names, nested objects for relationships, or a string for a single property.

   ```javascript
   // Flat select
   Product.search({ select: ['name', 'price'] });

   // Nested relationship select
   const book = await Book.get({
   	id: 42,
   	select: ['id', 'title', { name: 'author', select: ['name'] }],
   });

   // Special properties:
   // $id — primary key regardless of name
   // $updatedtime — last-updated timestamp
   // $distance — vector index distance
   // $score — full-text BM25 score
   // $highlights — full-text highlight fragments
   ```

7. **Use `sort` with `@indexed` attributes**: Provide a `sort` object with `attribute`, optional `descending`, and optional `next` for tie-breaking.

   | Property     | Description                                                |
   | ------------ | ---------------------------------------------------------- |
   | `attribute`  | Property name (or array for chained relationship property) |
   | `descending` | Sort descending if `true` (default: `false`)               |
   | `next`       | Secondary sort to resolve ties (same structure)            |

   ```javascript
   // attribute must be @indexed, or at least one condition must be present
   Product.search({
   	sort: { attribute: 'price', descending: true },
   });
   ```

   If the sort `attribute` is not `@indexed` and no `conditions` are present, Harper throws:

   > `HdbError: <attribute> is not indexed and not combined with any other conditions`

   To iterate a whole table in primary-key order, add an open-ended condition:

   ```javascript
   Product.search({
   	conditions: [{ attribute: 'id', comparator: 'greater_than', value: '' }],
   	sort: { attribute: 'id' },
   });
   ```

8. **Apply `limit` and `offset` for pagination**:

   ```javascript
   Product.search({
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 100 }],
   	sort: { attribute: 'price' },
   	limit: 20,
   	offset: 40,
   });
   ```

9. **Use `explain` and `enforceExecutionOrder` for debugging and control**:
   - Set `explain: true` to return conditions reordered as Harper will execute them.
   - Set `enforceExecutionOrder: true` to force conditions to execute in the order supplied, disabling Harper's automatic reordering.

   ```javascript
   Product.search({
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 100 }],
   	explain: true,
   });
   ```

10. **Use `addTo` for concurrent-safe numeric updates**: `addTo(property, value)` uses CRDT incrementation, safe across threads and nodes.

    ```javascript
    static async post(target, data) {
      const record = await this.update(target.id);
      record.addTo('quantity', -1); // decrement safely across nodes
    }
    ```

11. **Wrap out-of-context writes in `transaction()`**: HTTP request handlers get a transaction automatically. Use `transaction()` explicitly for timers, background jobs, or any code outside a natural transaction context.

    ```javascript
    import { isMainThread } from 'node:worker_threads';
    import { tables, transaction } from 'harper';
    const { MyTable } = tables;

    if (isMainThread) {
    	let running = false;
    	setInterval(async () => {
    		if (running) return; // the previous run has not committed yet
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

    - Always `await` the `transaction()` call and `catch` it.
    - Guard against overlap with a `running` flag when a job can outlast its interval.

12. **Understand `transaction()` atomicity and scope**: Transactions span a single database. All tables within the same database share one transactional context — reads return a consistent snapshot and writes across multiple tables commit with atomicity. Tables in different databases each get their own transaction with no cross-database atomicity guarantee.

    The `txn` object received by the callback exposes:

    | Member                | Type            | Description                                            |
    | --------------------- | --------------- | ------------------------------------------------------ |
    | `commit()`            | `() => Promise` | Commits the current transaction                        |
    | `abort()`             | `() => void`    | Aborts the transaction and resets it                   |
    | `resetReadSnapshot()` | `() => void`    | Resets the read snapshot to the latest committed state |
    | `timestamp`           | `number`        | Timestamp associated with the current transaction      |

    On normal callback completion the transaction commits automatically. If the callback throws, the transaction is aborted.

#### Examples

**Relationship group — one related record must meet all conditions:**

```javascript
const brands = [];
for await (const brand of Brand.search({
	conditions: [
		{
			attribute: 'products',
			conditions: [
				{ attribute: 'name', value: 'Keyboard' },
				{ attribute: 'price', comparator: 'greater_than_equal', value: 30 },
			],
		},
	],
	select: ['id', 'name', { name: 'products', select: ['name', 'price'] }],
})) {
	brands.push(brand);
}
```

**SSR entry point reading directly from Harper:**

```javascript
import { tables } from 'harper';

export async function render(url: string): Promise<string> {
  const product = await tables.Product.get(idFromUrl(url));
  return renderToString(/* <App product={product} /> */);
}
```

Keep `harper` external in `vite.config` — e.g. `ssr: { external: ['harper'] }` — so it resolves to the runtime instead of being bundled.

**Nested relationship select with constraints:**

```javascript
const brand = await Brand.get({
	id: 42,
	select: [
		'id',
		{
			name: 'products',
			conditions: [{ attribute: 'price', comparator: 'greater_than_equal', value: 30 }],
			sort: { attribute: 'price' },
			offset: 0,
			limit: 1,
			select: ['id', 'price'],
		},
	],
});
```

**Sort with secondary tie-breaker across a relationship:**

```javascript
Brand.search({
	conditions: [{ attribute: ['products', 'price'], comparator: 'greater_than_equal', value: 30 }],
	sort: { attribute: ['products', 'name'], next: { attribute: 'id' } },
});
```

#### Notes

- Calls through `tables` and `databases` run in a trusted server-side context and do not automatically apply the target table's role permissions. To enforce authorization, set `checkPermission: true` on the query and pass the authenticated `context` as the second argument to `search()` or `get()`. Harper then authorizes the read using `context.user`, including table, selected-property, and full-text source-field permissions.
- Programmatic `update`, `patch`, and `delete` calls operate directly on stored (potentially live production) data. Scope destructive operations with specific `conditions`, validate the affected set before writing, and gate them behind authorization controls.
- `transaction()` is safe to call defensively: if the context already has an active transaction, it reuses it and executes the callback immediately.
- `resetReadSnapshot()` on the `txn` object resets the read snapshot to the latest committed state mid-transaction.
- The bare `@primaryKey` is treated as not indexed for sort purposes (it uses the primary store, not a secondary index). Sorting by primary key alone with no `conditions` triggers the `HdbError: <attribute> is not indexed and not combined with any other conditions` error. Add an open-ended condition or pass `allowFullScan: true` to permit an unconditional scan.
- All installed components have `harper` automatically linked. For components in their own directory, run `npm link harper` manually.

### 3.4 TypeScript Type Stripping in Harper

Instructions for the agent to run `.ts` files directly in Harper without a build step using Node.js's built-in type stripping.

**Instead of:** `tsc` or `ts-node` build steps for server code. Use this rule rather than adding that service. See `harper-architecture`.

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

**Instead of:** Redis or Memcached cache-aside layers. Use this rule rather than adding that service. See `harper-architecture`.

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

Instructions for the agent to deploy a Harper application to Harper Fabric using the CLI, verify certification, and roll back using a previous release's `deployment_id`.

**Instead of:** Docker Compose stacks; deploying several services separately. Use this rule rather than adding that service. See `harper-architecture`.

#### When to Use

Apply this rule when deploying a Harper application to a remote Harper Fabric cluster, checking whether a rolling deploy was certified on each node, or restoring a previous release without rebuilding. Also apply it when provisioning credentials for private-source deploys or staging a build for later activation.

#### How It Works

1. **Authenticate against the cluster**: Run `harper login` once, pointing at the cluster's Application URL (found on **Config → Overview**). The CLI stores the token and sets the URL as the default target. If the current directory has a `.env` file, and neither that file nor your environment sets `HARPER_CLI_TARGET` or `CLI_TARGET`, login appends `HARPER_CLI_TARGET` to it.

   ```bash
   harper login <Application URL>
   # Provide cluster username and password when prompted
   ```

   For CI/CD pipelines, use workload identity (OIDC) or a refresh token from `harper login --for-ci` instead of a password. See [deploying-from-ci.md](deploying-from-ci.md) for a complete GitHub Actions workflow. For a one-off command, `auth_username=` and `auth_password=` are available but not recommended for production.

2. **Deploy the application**: Run `harper deploy` with the required parameters. A bare `target` host defaults to `https://<host>:9925`. Use `restart=rolling` for a staggered, zero-downtime restart across the cluster. Pass `replicated=false` to restrict the deploy to the single node you called; on Harper Fabric, omit it to reach every node.

   ```bash
   harper deploy \
     project=<name> \
     package=<package> \
     target=<remote> \
     restart=rolling \
     replicated=true
   ```

   Key parameters:

   | Parameter             | Description                                                                           |
   | --------------------- | ------------------------------------------------------------------------------------- |
   | `package=<reference>` | npm, GitHub, or tarball reference. Omit to deploy current directory.                  |
   | `target=<url>`        | Remote Harper instance URL. Bare host defaults to `https://<host>:9925`.              |
   | `restart=rolling`     | Restart nodes one at a time; each stays in rotation while it restarts.                |
   | `replicated=false`    | Deploy to the called node only.                                                       |
   | `wait=false`          | With `restart=rolling`, exit after the called node takes the release.                 |
   | `wait_timeout=<ms>`   | With `restart=rolling`, maximum wait time per node. Default: ten minutes per node.    |
   | `activate=false`      | Build and install without making the release live. Cannot be combined with `restart`. |
   | `ref=<committish>`    | Branch, tag, or commit SHA to deploy. Resolved to SHA. Implies `by_ref`.              |
   | `json=true`           | Print output as JSON instead of YAML.                                                 |

3. **Choose a package source**: The `package` field accepts any valid npm dependency value.

   | Format                  | Example                                                                                       |
   | ----------------------- | --------------------------------------------------------------------------------------------- |
   | Current local directory | Omit `package`                                                                                |
   | npm package             | `package="@harperdb/status-check"`                                                            |
   | GitHub (public)         | `package="HarperFast/status-check"` or `package="https://github.com/HarperFast/status-check"` |
   | Private repo (SSH)      | `package="git+ssh://git@github.com:HarperDB/secret-app.git"`                                  |
   | Tarball                 | `package="https://example.com/application.tar.gz"`                                            |

   For git tags, use the `semver` directive: `HarperFast/application-template#semver:v1.0.0`. For an SSH-based private repo, register the key with `add_ssh_key` first.

4. **Provision credentials for private repositories**: Run `harper deploy setup=true` once per component and source. (With `provider=github-actions`, it sets up GitHub Actions OIDC deploys instead.) This requires `super_user` privileges — run it with an administrative credential, not the CI identity it provisions for.

   ```bash
   harper deploy setup=true
   ```

   The setup flow:
   - Fetches the cluster's public key with `get_secrets_public_key`.
   - Encrypts the token locally into an `enc:v1:` envelope.
   - Stores only the ciphertext with `set_secret` in the component-scoped tier — never in the global `processEnv` tier that every component and child process can read.
   - Grants the component permission to resolve it with `grant_secret`.

   Prefer a **fine-grained** personal access token scoped to **Contents: Read-only** on the target repository. Avoid the `gh` CLI session token, which carries `read:org`, `gist`, `workflow`, and `repo` scopes across your whole account. The encrypted token is durable and replayed on every cold deploy and rollback, so use the narrowest credential that does the job.

   Then deploy with `credential=true`:

   ```bash
   harper deploy by_ref=true credential=true restart=true replicated=true
   ```

5. **Deploy by reference for a reproducible source**: `by_ref=true` sends a pinned git reference instead of uploading the working directory, and the cluster fetches and builds that exact commit. It resolves the repository's `origin` remote and the current commit, then deploys `package=git+https://github.com/<owner>/<repo>.git#<full commit SHA>`.

   ```bash
   harper deploy by_ref=true restart=true replicated=true
   ```

   Deploy a specific tag or commit with `ref`:

   ```bash
   harper deploy ref=v1.2.0 restart=true replicated=true
   harper deploy ref=9f8c2a1 restart=true replicated=true
   ```

   Tags and branches are resolved to a full commit SHA before the deploy is sent. A `ref` that cannot be resolved stops the deploy — run `git fetch` and retry, or pass a full commit SHA. A full commit SHA is accepted directly with no resolution step. Valid refs must be in `refs/heads/*` or `refs/tags/*` if qualified; a ref like `refs/pull/123/head` is rejected up front even if your local checkout can resolve it. Commit and push before deploying — the cluster clones from the remote and only sees pushed commits.
   - On a GitHub Actions `pull_request` run, `by_ref` deploys the pull request's head commit. If the event payload isn't readable, the deploy stops; pass the commit explicitly:

     ```bash
     harper deploy ref=${{ github.event.pull_request.head.sha }} restart=true replicated=true
     ```

6. **Activate a staged build**: Make a staged build live using its `deployment_id`. Pass `restart` here, not on the stage step. Takes no `package`, `payload`, `credentials`, install options, or `urlPath`/`host` — those are rejected rather than ignored.

   ```json
   {
   	"operation": "deploy_component",
   	"project": "my-app",
   	"deployment_id": "a3f8c2d1-..."
   }
   ```

   Or via the CLI:

   ```bash
   harper deploy project=<name> deployment_id=<id> restart=true
   ```

7. **Stage a build for later activation**: Pass `activate=false` (`activate: false` in the operation) to build and install without making the release live. `activate: false` cannot be combined with `restart`.

   ```json
   {
   	"operation": "deploy_component",
   	"project": "my-app",
   	"package": "npm:@my-org/my-app@1.2.3",
   	"activate": false
   }
   ```

   The response names the artifact that is now waiting:

   ```json
   {
   	"deployment_id": "a3f8c2d1-...",
   	"message": "Staged: my-app. Deploy it with deploy_component deployment_id=a3f8c2d1-..."
   }
   ```

   The response includes a `deployment_id` naming the staged artifact. Staged builds and replaced releases together count against `deployment.stagingRetention.maxCount` (default `5`). Each kept release is a full installed copy of the component, `node_modules` included. The oldest are pruned at the next deploy or startup.
   - `404` means the id never existed on that node, was pruned, or the release was replaced and not kept. A `409` means the build exists but cannot be activated (e.g., belongs to another component, or files changed after staging).

8. **Roll back to a previous release**: Use `list_deployments` to find the `deployment_id` of the release to restore. Then activate that id with `restart`. This swaps in the exact installed release with no fetch, rebuild, or reinstall. The release it replaces is kept in turn, so you can go forward again the same way.

   ```json
   {
   	"operation": "deploy_component",
   	"project": "my-app",
   	"deployment_id": "<id of the deployment you want back>",
   	"restart": true
   }
   ```

9. **Check certification after a rolling deploy**: A deploy with `"restart": "rolling"` certifies the release on each node using a canary worker before rolling it out. The deploy response includes a `certification` field:

   | `certification` | Meaning                                                                                                                                                                         |
   | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `certified`     | The canary loaded the release; rollout proceeded.                                                                                                                               |
   | `uncertified`   | The rollout went on unchecked: the component ran nothing as it loaded (`loadComponent: dev-only`, an absent `if-installed` component, or safe mode), or no worker was replaced. |
   | `unavailable`   | Deploy restarted unchecked (no worker loads the component, `isolated` setting changed, already live, or `package: file:<dir>` source).                                          |
   | `not-requested` | The deploy did not restart.                                                                                                                                                     |
   - **A rejected release fails the deploy.** If the canary throws while loading the component, exits, or doesn't report within a minute, the deploy fails with `400`. The release it replaced is made live again, and nothing is replicated to other nodes. A restart that stops before the canary decides is reported with `status: "interrupted"`.
   - **A release with nothing to go back to fails closed.** A rejected first deploy, or one whose previous release was not kept, stays on disk, but no worker on that node loads it, even after Harper restarts. `get_status` reports the component as failed and says why. Deploy a fixed release, or activate the same `deployment_id` again with `restart` once the cause is fixed.
   - Another deploy or `drop_component` of the component on that node is refused with `409` until the rollout has finished.

10. **Check rolling deploy job status**: A `deploy_component` with `"restart": "rolling"` returns a `restartJobId`. Call `get_job` on the node that received the deploy — `system.hdb_job` is not replicated.

    ```json
    { "operation": "get_job", "id": "<restartJobId>" }
    ```

    `get_job` returns status `COMPLETE`, `IN_PROGRESS`, or `ERROR`. It answers only on the node that ran the job — `system.hdb_job` is not replicated. For a rolling deploy, that is the node that received the deploy. A deploy-only role that polls for rolling deploys must include `get_job` in its operations allowlist. The job ends `COMPLETE` on success, or `ERROR` with a `message` listing each node's outcome under `activated`.

11. **Monitor `list_deployments` correctly**: A deploy in progress reads `pending`, or `loading` once its release has started loading. A rolling deploy's record reads `rolling_out` until the job has visited every node; filter `list_deployments` without `status` and check each record's `status` is a finished one (`success`, `failed`, `staged`, or `partial`). `completed_at` alone does not indicate completion, since a `rolling_out` record already has it.

    ```json
    {
    	"operation": "list_deployments",
    	"project": "my-app",
    	"limit": 20
    }
    ```

    - The `list_deployments` response strips `payload_blob` and replaces it with `payload_blob_present`; use `get_deployment_payload` to retrieve the tarball.

#### Examples

##### Full rolling deploy from a git tag

```bash
harper login https://my-cluster.harperdbcloud.com
harper deploy \
  project=my-app \
  ref=v1.2.0 \
  restart=rolling \
  replicated=true \
  credential=true
```

##### Stage a build, then activate in a maintenance window

```json
{
	"operation": "deploy_component",
	"project": "my-app",
	"package": "npm:@my-org/my-app@1.2.3",
	"activate": false
}
```

Response:

```json
{
	"deployment_id": "a3f8c2d1-...",
	"message": "Staged: my-app. Deploy it with deploy_component deployment_id=a3f8c2d1-..."
}
```

Activate later with restart:

```json
{
	"operation": "deploy_component",
	"project": "my-app",
	"deployment_id": "a3f8c2d1-...",
	"restart": true
}
```

##### Roll back using list_deployments

```json
{ "operation": "list_deployments", "project": "my-app", "limit": 10 }
```

```json
{
	"operation": "deploy_component",
	"project": "my-app",
	"deployment_id": "<previous-deployment-id>",
	"restart": true
}
```

##### Check a rolling deploy job

```json
{ "operation": "get_job", "id": "4a982782-929a-4507-8794-26dae1132def" }
```

The job ends `COMPLETE` when every node has taken the release, or `ERROR` with node-level detail if any node did not.

##### Certification rejection response

```json
{
	"error": "my-app was not deployed: release 9b2e... failed to load in its canary worker: my-app.jsResource: ... Deployment a3f8c2d1..., the release it replaced, is live again. No other node received it. Deploy a fix, or activate deployment 9b2e... again once the cause is fixed.",
	"deployment_id": "9b2e...",
	"certification": {
		"status": "rejected",
		"reason": "my-app.jsResource: ...",
		"failures": [
			{ "key": "my-app.jsResource", "name": "ResourceLoadError", "message": "...", "stack": "..." }
		],
		"restored": "a3f8c2d1...",
		"failed_closed": false
	}
}
```

#### Notes

- `replicated=false` restricts a deploy to the single node you called. On Harper Fabric, omit this parameter to reach every node.
- `restart=rolling` cannot be combined with `activate=false`.
- `deployment_id` activation takes no `package`, `payload`, `credentials`, install options, or `urlPath`/`host` — supplying them is rejected.
- `file:` directory sources cannot be staged with `activate=false` and are not kept as rollback targets.
- `deployment.stagingRetention.maxCount` (default `5`) caps staged builds and kept replaced releases together per component. At the default, budget disk for up to five extra copies per component, `node_modules` included.
- A deploy-only role that waits for rolling deploys must include `get_job` in its operations allowlist.
- `get_job` answers only on the node that ran the job — `system.hdb_job` is not replicated.
- The `enc:v1:` envelope is the only form of the token that ever leaves your machine or appears in API logs.
- The secret provisioned by `harper deploy setup=true` is stored scoped to the component, never in the global `processEnv` tier.
- For creating the cluster itself, see [creating-a-fabric-account-and-cluster.md](creating-a-fabric-account-and-cluster.md). For full CI/CD pipeline setup, see [deploying-from-ci.md](deploying-from-ci.md).

### 4.2 Deploying a Harper Application from GitHub Actions with OIDC

Instructions for the agent to follow when deploying a Harper application from GitHub Actions using OIDC trusted publishing, so no Harper credential is stored in CI.

#### When to Use

Apply this rule when wiring up a GitHub Actions workflow to deploy a Harper application without storing a `HARPER_CLI_REFRESH_TOKEN` or any other durable credential in CI. Use it when setting up a new pipeline, rotating access, or diagnosing a failed OIDC exchange. See [deploying-to-harper-fabric.md](deploying-to-harper-fabric.md) for Fabric-specific deployment context.

#### How It Works

##### One-Command Setup (branch-triggered deploys)

1. **Run setup once** from the project's checkout, signed in as a `super_user` (`harper login`). Remove any `HARPER_CLI_TARGET` line from the checkout's `.env` first:

   ```bash
   harper deploy setup=true provider=github-actions project=my-app
   ```

   If your workflow file is not `.github/workflows/deploy.yaml`, pass it explicitly with `workflow=`. Otherwise the policy pins `deploy.yaml` and runs of your workflow cannot match it:

   ```bash
   harper deploy setup=true provider=github-actions project=my-app workflow=.github/workflows/deploy.yml
   ```

2. **Understand what setup does** — it performs these steps in order:
   - Resolves the GitHub repository from the checkout's `origin` remote (or `repo=<owner>/<name>`), fetching its numeric id and canonical name. Pass `repository_id=<id>` when neither `gh` nor the public API can answer (e.g., a private repo without `gh`).
   - Validates the workflow file: it must be able to run on `main` (or `branch=`), run a job in the `production` environment (`environment=`), and grant `permissions: id-token: write`. Setup stops before writing anything if the workflow could never match or never request a token.
   - Creates a role and a user named `<project>-ci-deploy` with permissions limited to `deploy_component`, `get_deployment`, `get_job`, and `registration_info`, plus the trust policy `github-actions-<project>`.
   - Reads the policy back and compares it claim by claim with what it intended to write.
   - Sets the repository's `HARPER_CLI_TARGET` variable via `gh` if one does not already exist.

3. **Re-running setup** leaves the cluster and variable unchanged. A role, user, or policy that already exists but differs stops setup before it writes. To replace a policy, drop it first:

   ```bash
   harper drop_oidc_trust id=github-actions-<project>
   ```

   Then run setup again.

4. **Revoke access** when needed:
   - Stop future runs: `harper drop_oidc_trust id=github-actions-<project>`
   - Also stop tokens already issued (valid up to one hour): `harper alter_user username=<project>-ci-deploy active=false`

##### Manual Setup (tag-triggered deploys or custom policies)

When deploying on version tags, `workflow_ref` cannot be pinned (the tag is unknown at policy-write time). Create the role, user, and policy by hand.

1. **Log in as `super_user`**:

   ```bash
   harper login https://my-cluster.example.com:9925
   ```

2. **Create a deploy-only role and user**:

   ```bash
   harper add_role role=ci_deploy permission='{"operations":["deploy_component","get_job","get_deployment","registration_info"]}'
   harper add_user username=ci-deploy role=ci_deploy active=true password="$(openssl rand -base64 32)"
   ```

   | Operation           | Purpose                                                                                    |
   | ------------------- | ------------------------------------------------------------------------------------------ |
   | `deploy_component`  | The deploy itself                                                                          |
   | `get_deployment`    | Read deployment record; required for `harper deploy restart=rolling` to wait on every node |
   | `get_job`           | Poll the rolling restart job; required or wait step fails with `403`                       |
   | `registration_info` | Version check before upload; omitting it causes a refused-operation log entry per run      |
   - `restart_service` is not needed: Harper starts the rolling restart's job itself. The password is required to create the user but a GitHub Actions pipeline never uses it, so this command discards it.

3. **Add a trust policy** pinning `repository_id`, `workflow_path`, and `environment`:

   ```bash
   harper add_oidc_trust \
     id=my-app-release \
     issuer=https://token.actions.githubusercontent.com \
     audience=https://my-cluster.example.com:9925/ \
     user=ci-deploy \
     claims='{"repository_id":"67890","workflow_path":"my-org/my-app/.github/workflows/deploy.yml","environment":"production"}'
   ```

   - `repository_id` — immutable; survives renames. Look it up with `gh api repos/my-org/my-app --jq .id`.
   - `workflow_path` — Harper derives it from `workflow_ref` by removing the `@<ref>` suffix. Format: `<owner>/<repo>/<path>`.
   - `environment` — gates the ref. Without it, anyone who can push a branch can mint a token.
   - `audience` — must be the exact target URL with its port and a **trailing slash**.

4. **Configure the GitHub environment**. In the repository's **Settings → Environments → production**, set **Deployment branches and tags** to the `v*` tag pattern. Add required reviewers if a release needs approval.

5. **Store the target as a repository variable** (not a secret — it is not sensitive):

   ```bash
   gh variable set HARPER_CLI_TARGET --repo my-org/my-app --body https://my-cluster.example.com:9925/
   ```

6. **For private repositories**, store a durable credential once from your machine. For a private repository (git-tag deploys), use a fine-grained personal access token with **Contents: read-only** scoped to the application repository. For GitHub Packages, use a token with the `read:packages` scope. Store it in Harper with `harper deploy setup=true`:

   For a private repository:

   ```bash
   harper deploy setup=true provider=github project=my-app
   ```

   For GitHub Packages, store a durable token with the `read:packages` scope in Harper once with `harper deploy setup=true provider=npm project=my-app registry=https://npm.pkg.github.com scope=@my-org`. The name is derived from the component and the host: `deploy.my-app.git.github.com` for the repository, `deploy.my-app.npm.pkg.github.com` for GitHub Packages. Reference it by name in the workflow — never the token itself. Add `credential=true` to the deploy command in the workflow.

##### How OIDC Authentication Works in the Workflow

A job authenticates through the trust policy automatically — nothing in the workflow names the policy — when all four conditions hold:

1. The job declares `id-token: write`.
2. `HARPER_CLI_TARGET` equals the policy's `audience` (URL with port and trailing slash).
3. The run matches the policy's claims (repository, workflow file, branch/environment).
4. **Nothing else is configured to authenticate.** `auth_username=`/`auth_password=`, credentials in the target URL, `HARPER_CLI_USERNAME`/`HARPER_CLI_PASSWORD`, `HARPER_CLI_REFRESH_TOKEN` or `HARPER_CLI_OPERATION_TOKEN`, and a saved `harper login` all outrank the exchange. Remove any existing credential from the runner environment before enabling OIDC, or it keeps winning silently.

The exchange runs only when GitHub sets `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, which it does for a job that declares `permissions: id-token: write`. Without them, the CLI falls through to its other credential sources rather than reporting a failure.

On success the CLI prints to stderr:

```
Requesting a GitHub Actions identity token for https://my-instance.harperdb.io:9925/...
Authenticated as 'ci-deploy' via OIDC trust policy 'my-app-prod'.
```

Diagnose a rejected exchange with `list_oidc_trust` and the instance's `oidc-trust` log. The server does not report which check failed.

##### Diagnosing with `list_oidc_trust`

Run as `super_user`:

```bash
harper list_oidc_trust
```

Returns `{ "policies": [ ... ] }`. Each entry includes `id`, `issuer`, `audience`, `claims`, `user`, `enabled`, `exchangeable`, and `invalid_reason` when applicable.

- **`invalid_reason`** — set when the policy cannot authenticate anyone (malformed, or the named user was deleted or deactivated). This is the fastest explanation for a rejected exchange. When two exchangeable policies can match the same token but give it a different user or operations, both carry `invalid_reason` naming the rival. Drop or disable one, or give them claims that keep them apart.
- **`exchangeable`** — `true` when the exchange considers the policy; `false` when disabled, malformed, or not specific enough (e.g., a GitHub Actions policy that pins no ref).

##### Dropping a Policy with `drop_oidc_trust`

```bash
harper drop_oidc_trust id=my-app-prod
```

Fails with `404` if no policy has that `id`. Does not revoke tokens already issued — those remain valid for up to one hour. To stop an already-issued token, also run `alter_user`:

```bash
harper alter_user username=ci-deploy active=false
```

##### Policy Specificity for GitHub Actions (`token.actions.githubusercontent.com`)

For this issuer, every policy must satisfy all three specificity requirements:

| Requirement            | Satisfied by                                                             | Left open otherwise                             |
| ---------------------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
| **Pin the repository** | `repository_id`, `repository`                                            | Any repository                                  |
| **Pin the workflow**   | `workflow_ref`, `workflow_path`, `job_workflow_ref`, `job_workflow_path` | Any workflow in that repository                 |
| **Gate the ref**       | `workflow_ref`, `ref`, `environment`                                     | Any branch that can be pushed to the repository |

Additional constraints:

- `repository_id` is preferred over `repository` because it is immutable and survives renames.
- `workflow_ref` pins workflow + ref together. Use for branch-triggered deploys, e.g. `my-org/my-app/.github/workflows/deploy.yml@refs/heads/main`.
- `workflow_path` pins the workflow without the ref. Use for tag-triggered deploys combined with `environment`.
- `ref_type: tag` is not accepted as a ref gate, `sub` is not accepted as a pin, and `job_workflow_ref` pins the workflow without gating the ref. `pull_request_target` runs are denied unless the policy constrains `event_name`.

#### Examples

##### Path A: Deploy a Tagged Release (`v1.2.3`) from the Repository

Push a semver tag (`v1.2.3`), and every node clones and installs that commit. `by_ref=true` deploys `git+https://github.com/<owner>/<repo>.git#<sha>`, where the SHA is the commit the tag points to (`GITHUB_SHA`), and every node clones that exact commit even if the tag is moved later. Pass `ref=<sha>` to deploy a different commit. If the repository needs a build step to be runnable, do not reach for `install_allow_scripts` — use Path B instead.

```yaml
# .github/workflows/deploy.yml
name: Deploy to Harper
on:
  push:
    tags: ['v*']

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    permissions:
      contents: read
      id-token: write
    env:
      HARPER_CLI_TARGET: ${{ vars.HARPER_CLI_TARGET }}
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: 26
      - run: npm install --global harper@^5.3
      - name: Deploy the tagged commit
        run: harper deploy project=my-app by_ref=true restart=rolling json=true > deploy.json
      - name: Wait for every node to take the release
        run: |
          # From v5.4.0 a certified rolling deploy waited for every node itself.
          [ "$(jq -r '.rollout.status // empty' deploy.json)" != success ] || exit 0
          JOB_ID=$(jq -r '.restartJobId // empty' deploy.json)
          [ -n "$JOB_ID" ] || { echo "The rolling deploy returned no restartJobId"; exit 1; }
          LAST="could not be read"
          for attempt in $(seq 60); do
            sleep 10
            harper get_job id="$JOB_ID" json=true > job.json || continue
            case $(jq -r '.[0].status // "MISSING"' job.json) in
              COMPLETE) exit 0 ;;
              ERROR) jq -r '.[0].message' job.json; exit 1 ;;
              MISSING) LAST="was not on the node that answered; its outcome is unknown" ;;
              *) LAST="was still running" ;;
            esac
          done
          echo "After 60 polls, job $JOB_ID $LAST"
          exit 1
```

For a private repository, add `credential=true` to the deploy command.

Key details for Path A:

- **No secrets.** `HARPER_CLI_TARGET` is the only thing the workflow is given. `id-token: write` lets the CLI request an identity token, and `environment: production` puts the `environment` claim the trust policy requires into it.
- **`persist-credentials: false`** keeps the job's `GITHUB_TOKEN` out of `.git/config`, where `actions/checkout` otherwise leaves it for every later step. From v6 it saves the token in a file under `$RUNNER_TEMP` rather than in `.git/config`, which `harper deploy` uploads with the checkout, but later steps can still read it.
- **`harper@^5.3`** pins the CLI's major version. 5.3 is the first CLI that authenticates with the identity token.
- **`by_ref=true`** deploys `git+https://github.com/<owner>/<repo>.git#<sha>`. Pass `ref=<sha>`, with the full commit SHA, to deploy a different commit.
- **`replicated` isn't needed.** On Harper Fabric and Harper Pro, a deploy goes to every node unless you pass `replicated=false`. Each node fetches and installs the package itself.
- **`restart=rolling`** restarts nodes one at a time. `restart=true` deploys to every node at once; each node replaces its workers a few at a time while the others keep serving.
- **`json=true`** prints the deploy's result as JSON on stdout. Progress and authentication messages go to stderr.
- **`restartJobId`** — present in the deploy JSON when a rolling restart job was started. Absent when `rollout.status` is already `success` (v5.4.0+ certified rolling deploy waited itself).
- **`.[0].status`** — the wait loop reads job status from `get_job`'s array response. An empty list means the job is not on the node that answered; the loop retries.
- **`certification`**: on v5.4.0 and later, `restart=rolling` loads the release in a canary worker on each node before that node serves it, so a release that fails to load is rejected. The `certification` field in the deploy result reflects this. When `certification` is `unavailable`, the wait step must poll `restartJobId` with `get_job`.
- **`load-balanced` clusters**: Harper does not replicate jobs. Only the node that received the deploy knows the rolling job. Through a load-balanced cluster URL, polls from `get_job` must eventually reach that node. If your load balancer routes polls to a different node than the deploy, use one node's own URL for both the deploy and the wait, and as the trust policy's `audience`.

##### Path B: Build in CI, Publish to GitHub Packages, Deploy the Artifact

Give `package.json` a scoped name and `"publishConfig": { "registry": "https://npm.pkg.github.com" }`:

```json
{
	"name": "@my-org/my-app",
	"version": "1.2.3",
	"publishConfig": { "registry": "https://npm.pkg.github.com" },
	"files": ["config.yaml", "schema.graphql", "dist/"]
}
```

The deploy installs the version the tag names, and `npm publish` publishes the version in `package.json`, so they must agree: `npm version 1.2.3` sets one and creates the other as `v1.2.3`.

```yaml
# .github/workflows/deploy.yml
name: Build, publish, and deploy to Harper
on:
  push:
    tags: ['v*']

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: 26
          registry-url: https://npm.pkg.github.com
          scope: '@my-org'
      - run: npm ci
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - run: npm run build
      - run: npm test
      - name: Publish to GitHub Packages
        run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  deploy:
    needs: publish
    runs-on: ubuntu-latest
    environment: production
    permissions:
      id-token: write
    env:
      HARPER_CLI_TARGET: ${{ vars.HARPER_CLI_TARGET }}
    steps:
      - uses: actions/setup-node@v7
        with:
          node-version: 26
      - run: npm install --global harper@^5.3
      - name: Deploy the published version
        run: |
          harper deploy project=my-app package="@my-org/my-app@${GITHUB_REF_NAME#v}" \
            credentials='[{"registry":"https://npm.pkg.github.com","scope":"@my-org","secret":"deploy.my-app.npm.pkg.github.com"}]' \
            restart=rolling json=true > deploy.json
      - name: Wait for every node to take the release
        run: |
          # From v5.4.0 a certified rolling deploy waited for every node itself.
          [ "$(jq -r '.rollout.status // empty' deploy.json)" != success ] || exit 0
          JOB_ID=$(jq -r '.restartJobId // empty' deploy.json)
          [ -n "$JOB_ID" ] || { echo "The rolling deploy returned no restartJobId"; exit 1; }
          LAST="could not be read"
          for attempt in $(seq 60); do
            sleep 10
            harper get_job id="$JOB_ID" json=true > job.json || continue
            case $(jq -r '.[0].status // "MISSING"' job.json) in
              COMPLETE) exit 0 ;;
              ERROR) jq -r '.[0].message' job.json; exit 1 ;;
              MISSING) LAST="was not on the node that answered; its outcome is unknown" ;;
              *) LAST="was still running" ;;
            esac
          done
          echo "After 60 polls, job $JOB_ID $LAST"
          exit 1
```

The workflow has two jobs so the job that can request an identity token runs none of your code:

- **`publish`** installs, builds, tests and publishes, with `contents: read` and `packages: write` only. It cannot request an identity token.
- **`deploy`** runs once `publish` has finished (`needs: publish`), and holds the `production` environment and `id-token: write`. It installs only the Harper CLI, then deploys the published version. The trust policy still matches it: only this job names the environment, so only its token carries the `environment` claim the policy requires.

##### Check the Deployment Record

```bash
harper get_deployment deployment_id="$(jq -r .deployment_id deploy.json)" json=true
```

Go back to a previous release by activating its `deployment_id`, with no rebuild or reinstall: `harper deploy project=my-app deployment_id=<id> restart=rolling`. Use `list_deployments` to see the history of what was deployed and when, and filter by commit with `sha`.

#### Notes

- **`vars.HARPER_CLI_TARGET`** is a repository variable, not a secret. The target URL is not sensitive.
- **`id-token: write`** must appear on the specific job that runs `harper` commands, not only at the workflow level.
- **Trailing slash** in `audience` is required. The CLI requests its token for the exact target URL including port and trailing slash.
- **`enabled`** — setup never writes a policy that already exists, so it cannot undo a disable. A policy that is disabled shows `enabled: false` in `list_oidc_trust`.
- **`drop_oidc_trust` does not revoke tokens already issued.** A minted JWT is valid for one hour. To stop a token already in circulation, also run `harper alter_user username=<project>-ci-deploy active=false`.
- **`invalid_reason`** on a `list_oidc_trust` entry is the fastest diagnostic for a rejected exchange. The exchange server does not report which check failed.
- **`workflow=`** must point to a `.yml` or `.yaml` file inside `.github/workflows/`. If the file is not committed in the checkout when setup runs, the policy uses defaults regardless of your actual workflow.
- **`environment: production`** on the deploy job is what puts the `environment` claim into the OIDC token. Without it the trust policy's `environment` claim cannot match.
- **`actions/checkout`** with `persist-credentials: false` prevents the job's `GITHUB_TOKEN` from being saved where later steps or uploaded content can read it.
- **`npm install --global harper@^5.3`** pins the CLI's major version. 5.3 is the first CLI that authenticates with the identity token.
- **`runs-on: ubuntu-latest`** satisfies the git ≥ 2.31 requirement for git-host credentials. Windows nodes are not supported for git credentials.
- **`push:` / `tags: ['v*']`** — tag-triggered workflows cannot use `workflow_ref` in the trust policy. Use `workflow_path` + `environment` instead.
- **`jobs:`** — split build/publish and deploy into separate jobs so the job with `id-token: write` runs none of the repository's build code.
- **`add_oidc_trust`** replaces a policy with the same `id`. Setup checks for a conflicting policy just before writing, but a policy created by another `super_user` in that moment could still be overwritten.
- **`token.actions.githubusercontent.com`** — for this issuer, every policy must satisfy all three specificity requirements: pin the repository, pin the workflow, and gate the ref.
- **`repository_id`** is preferred over `repository` because it is immutable and survives renames.
- **`<project>-ci-deploy`** — the user and role name setup creates. This user can deploy any component on the cluster; access control comes down to who can merge to the branch (or push a matching tag).
- **`registration_info`** — omitting it from the role still allows deploys, but the cluster logs a refused operation on every run.
- **`oidc-trust`** — the instance log stream to check when diagnosing exchange failures.
- **`alter_user`** — use `harper alter_user username=<project>-ci-deploy active=false` to immediately invalidate the user, stopping tokens already issued from authorizing further operations.
- **`super_user`** — both `list_oidc_trust` and `drop_oidc_trust` require `super_user`. Setup must also be run as `super_user`.
- **`credential=true`** — add to the deploy command for private repositories to attach the stored git credential (`deploy.my-app.git.github.com`).

### 4.3 Creating a Harper Fabric Account and Cluster

Follow these steps to set up your Harper Fabric environment for deployment.

#### How It Works

1. **Sign Up/In**: Go to [https://fabric.harper.fast/](https://fabric.harper.fast/) and sign up or sign in.
2. **Create an Organization**: Create an organization (org) to manage your projects.
3. **Create a Cluster**: Create a new cluster. This can be on the free tier, no credit card required.
4. **Set Credentials**: During setup, set the cluster username and password to finish configuring it.
5. **Get Application URL**: Navigate to the **Config** tab and copy the **Application URL**.
6. **Connect the CLI**: Run `harper login` with the Application URL to store a token for the cluster, and set the URL as `HARPER_CLI_TARGET` in your `.env` file. Prefer this to putting the cluster username and password in `.env`, and don't store them in GitHub Actions secrets: to deploy from GitHub Actions, set up OIDC trusted publishing instead (see [deploying-from-ci](deploying-from-ci.md)).
7. **Next Steps**: See the [deploying-to-harper-fabric](deploying-to-harper-fabric.md) rule for detailed instructions on deploying your application successfully.

#### Examples

##### Environment Configuration

```bash
harper login YOUR_CLUSTER_URL
```

```bash
# .env
HARPER_CLI_TARGET='YOUR_CLUSTER_URL'
```

### 4.4 Creating Harper Applications

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

1. **Define Schema**: Modify `schema.graphql` to fit your application's data model.
2. **Start Development**: Run `npm run dev` to start the local Harper instance.
3. **Connect the CLI to your cluster**: Create a cluster (see
   [creating-a-fabric-account-and-cluster](creating-a-fabric-account-and-cluster.md)), run `harper login` with its
   Application URL as a super user, and set that URL as `HARPER_CLI_TARGET` in the project's `.env` file. Don't put a
   cluster username or password in `.env` or in GitHub secrets.
4. **Deploy**: See [Deploying](#deploying).

#### Deploying

Every template except the legacy `early-hints` example ships a GitHub Actions workflow,
`.github/workflows/deploy.yaml`. It tests every pull request and deploys to the cluster when a change merges to `main`.
The deploy job holds no Harper credential: its `harper` commands authenticate with GitHub's OIDC identity token under a
trust policy on the cluster. The Next.js templates' workflow also runs `next build` before it uploads.

1. **Set up CI deploys once**: Push the project to a GitHub repository, then run `npm run deploy:setup-ci` from the
   project, logged in to the cluster as a super user. It runs `harper deploy setup=true provider=github-actions` for the
   project, which creates a deploy-only role and user and a trust policy matched to the workflow, and sets the
   repository's `HARPER_CLI_TARGET` variable when the `gh` CLI is signed in (otherwise it prints the command to run).
   Running it again changes nothing. See [deploying-from-ci](deploying-from-ci.md) for what it checks and how to
   customize it.

   The command needs the Harper 5.4.0 CLI or later (`harper version`); an earlier CLI can't run it. Without 5.4.0, set
   up the same role, user, policy and variable by hand, as a super user. The policy must match the scaffolded workflow:
   its `deploy.yaml` file on `main`, in the `production` environment. The `audience` is the cluster URL with its port
   and a trailing slash, and `HARPER_CLI_TARGET` must be that same string:

   ```bash
   gh api repos/<owner>/<repo> --jq .id   # the repository_id
   harper add_role role=<name>-ci-deploy permission='{"operations":["deploy_component","get_job","registration_info"]}'
   harper add_user username=<name>-ci-deploy role=<name>-ci-deploy active=true password="$(openssl rand -base64 32)"
   harper add_oidc_trust \
     id=github-actions-<name> \
     issuer=https://token.actions.githubusercontent.com \
     audience=https://my-cluster.example.com:9925/ \
     user=<name>-ci-deploy \
     claims='{"repository_id":"<id>","workflow_ref":"<owner>/<repo>/.github/workflows/deploy.yaml@refs/heads/main","environment":"production"}'
   gh variable set HARPER_CLI_TARGET --repo <owner>/<repo> --body https://my-cluster.example.com:9925/
   ```

   If you restrict the `production` environment's deployment branches, allow `main`.

2. **Deploy by merging to `main`**, or by running the workflow from the **Actions** tab. The workflow deploys with
   `restart=rolling` and waits for every node to take the release. The run's summary names the `deployment_id` and its
   `certification`.
3. **Deploy by hand with `npm run deploy`**: It runs `harper deploy project=<name> restart=rolling` from your machine, as
   the user you logged in with.
4. **Go back to an earlier release** by activating its `deployment_id`, with nothing reinstalled:

   ```bash
   harper list_deployments project=<name>
   harper deploy project=<name> deployment_id=<id> restart=rolling
   ```

   See [deploying-to-harper-fabric](deploying-to-harper-fabric.md).

Use your package manager's equivalent of `npm run` (`pnpm run`, `bun run`, `yarn`) if the project uses another one.

Projects created before create-harper 1.13.0 deploy on version tags with a `HARPER_CLI_REFRESH_TOKEN` secret, and
don't have `deploy:setup-ci`. To move one over:

1. Scaffold a new project with the same name and template, and copy its `.github/workflows/deploy.yaml` over the old
   workflow.
2. Set up the cluster for it, with the `project=` value that workflow passes to `harper deploy` as `<name>`: with the
   5.4.0 CLI, `harper deploy setup=true provider=github-actions project=<name>`; with an earlier one, by hand as in
   step 1.
3. Push the new workflow to `main`.
4. Once the workflow's run on `main` has succeeded, wait step included, delete the `HARPER_CLI_REFRESH_TOKEN` secret.
   Deleting it doesn't revoke the token, which stays valid until it expires. To cut it off now, mint a new one for that
   user with `harper login --for-ci`, which invalidates the old one, or deactivate the user with `alter_user` if
   nothing else uses it.

### 4.5 Serving Web Content

Instructions for the agent to follow when serving web content from Harper.

**Instead of:** Nginx, Vercel, or Netlify for the frontend; a separate Vite dev server. Use this rule rather than adding that service. See `harper-architecture`.

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

### 4.6 Harper Logging

Instructions for the agent to follow when implementing logging in Harper applications, including direct logger usage, tagged loggers, and console capture behavior.

**Instead of:** Separate log shippers for app logs (pino or winston transports). Use this rule rather than adding that service. See `harper-architecture`.

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

### 4.7 Load Environment Variables with loadEnv

Instructions for the agent to follow when loading environment variables from `.env` files into a Harper application using the `loadEnv` plugin.

**Instead of:** `dotenv`. Use this rule rather than adding that service. See `harper-architecture`.

#### When to Use

Apply this rule when a Harper application needs to supply secrets, API endpoints, or other configuration values to component code via `process.env` without hardcoding them. Use `loadEnv` whenever `.env` files must be loaded at application startup before other components run.

#### How It Works

1. **Declare `loadEnv` first in `config.yaml`**: Place `loadEnv` before all other components so environment variables are available when dependent components start. Harper is single-process, so variables loaded onto `process.env` are shared across all components.

   ```yaml
   # config.yaml — loadEnv must come first
   loadEnv:
     files: '.env'

   rest: true

   myApp:
     files: './src/*.js'
   ```

2. **Configure the `files` option**: Specify one or more paths or glob patterns pointing to the env files to load. This option is required.

3. **Set `override` if needed**: By default, existing environment variables take precedence over values in `.env` files (`override` defaults to `false`). Set `override: true` to make loaded values overwrite existing environment variables.

4. **Access values in component code**: Read loaded variables from `process.env` as usual. No installation is needed — `loadEnv` is built into Harper.

##### Configuration Options

| Option     | Type                 | Required | Description                                                                            |
| ---------- | -------------------- | -------- | -------------------------------------------------------------------------------------- |
| `files`    | `string \| string[]` | **Yes**  | Path(s) or glob pattern(s) to the env file(s) to load.                                 |
| `override` | `boolean`            | No       | If `true`, loaded values override existing environment variables. Defaults to `false`. |

#### Examples

**Basic usage — load a single `.env` file:**

```yaml
loadEnv:
  files: '.env'
```

**Override existing environment variables:**

```yaml
loadEnv:
  files: '.env'
  override: true
```

**Load multiple named files (loaded in order specified):**

```yaml
loadEnv:
  files:
    - '.env'
    - '.env.local'
```

**Load files via glob pattern:**

```yaml
loadEnv:
  files: 'env-vars/*'
```

#### Notes

- `loadEnv` does **not** need to be installed — it is built into Harper and only needs to be declared in `config.yaml`.
- `loadEnv` supplies **application** environment variables for component code. It does **not** configure Harper itself. Harper's own configuration is composed at startup before any `loadEnv` runs, so variables like `HARPER_CONFIG`, `HARPER_SET_CONFIG`, and `HARPER_DEFAULT_CONFIG` delivered through a `.env` file are read too late and are ignored.
- To change Harper's configuration, set it in the configuration file or export the variable in the process/container environment before Harper starts — not through `loadEnv`.
- The `harper` CLI reads a `.env` file in the current directory separately from `loadEnv`. Commands such as `harper deploy` will fail if the file sets CLI target, credentials, or proxy names (e.g., `HTTPS_PROXY`) unless those names are already set in the process environment. Keep such values in a differently named file listed under `files`, or set them in the process environment directly.
- For production credentials, prefer the encrypted, replicated secrets store over a committed `.env` file. Secrets are delivered to components via `process.env` and never appear in operation logs or replication payloads.
- A component's `.env` file can be managed remotely via the Operations API (`get_env_keys`, `set_env_value`, `delete_env_value`). Changes reach running code only after the node's worker threads restart.

### 4.8 v5 Upgrade: Breaking Changes and Migration Guide

Instructions for the agent to apply when migrating a Harper application to v5, covering all breaking changes and required code updates.

#### When to Use

Apply this rule when upgrading an existing Harper application from v4 to v5, when encountering runtime errors related to module loading, transactions, record access, or process spawning after a v5 upgrade, or when scaffolding new v5-compatible application code.

#### How It Works

1. **Update the package import**: Replace all imports from `'harperdb'` with `from 'harper'`.

   ```javascript
   import { tables } from 'harper';
   ```

2. **Enable install scripts if needed**: Harper v5 runs `npm install` with `--ignore-scripts` by default. If your application requires install scripts (e.g., to install native binaries), set `allowInstallScripts` in your deployment options.

3. **Update `Table.get` usage**: `Table.get` now returns a plain frozen record object, not a table class instance. The `wasLoadedFromSource()` method no longer exists on the returned record. Use a `RequestTarget` and check `loadedFromSource` on the target instead.

   ```javascript
   // Before (v4):
   const record = await Table.get(id);
   if (record.wasLoadedFromSource()) {
   	// record was loaded from origin (not cache)
   }
   ```

   ```javascript
   // After (v5):
   const target = new RequestTarget();
   target.id = id;
   const record = await Table.get(target);
   if (target.loadedFromSource) {
   	// record was loaded from origin (not cache)
   }
   ```

   The record objects still expose `getUpdatedTime` and `getExpiresAt` methods.

4. **Handle frozen records**: Records returned by `Table.get` are frozen — you cannot mutate them directly. Spread into a new object instead.

   ```javascript
   // Before (v4):
   const record = await Table.get(id);
   record.property = 'changed';
   ```

   ```javascript
   // After (v5):
   let record = await Table.get(id);
   record = { ...record, property: 'changed' };
   ```

5. **Update transaction and context usage**: Harper v5 uses asynchronous context tracking. `Table.get` and other table calls now automatically inherit the current transaction. If your code previously omitted context to bypass a transaction and read the latest data, that workaround no longer works. Explicitly commit the transaction and/or wrap reads in a new transaction using `getContext` and `transaction` from `'harper'`.

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

6. **Register allowed spawn commands**: Spawning child processes via `node:child_process` is now restricted. Only executables listed in `applications.allowedSpawnCommands` in `harper-config.yaml` may be spawned. Additionally, `spawn`, `execFile`, and `fork` require a `name` property in the `options` argument to prevent process multiplication across threads. `exec` is not usable through the substituted module, and `execSync` always throws.

   ```yaml
   applications:
     allowedSpawnCommands:
       - npm
       - node
   ```

7. **Replace `blob.save()`**: The `blob.save()` method has been removed. Use the `saveBeforeCommit` flag in the options passed to the `Blob` constructor instead.

8. **Configure the module loader**: Harper v5 loads application modules through Node.js's VM module API. The default mode is `vm-current-context`, which shares JavaScript intrinsics (`Object`, `Array`, `Promise`, etc.) with Harper to avoid `instanceof` and identity-check failures across the application/Harper boundary.

   ```yaml
   applications:
     lockdown: seal-after-load
     moduleLoader: vm-current-context # vm-current-context (default) | vm | native | compartment
     dependencyLoader: auto # auto (default) | app | native
     allowedDirectory: app # app (default) | any
   ```

   - Use `vm` only if you need separate per-application intrinsics.
   - Use `native` to restore pre-v5 behavior (standard `import()`), but note that application-specific context (tagged `logger`, per-app `config`) will not be available.
   - Use `dependencyLoader: native` to apply native loading only to npm packages while keeping the VM loader for first-party source files.

9. **Configure `lockdown`**: The default `lockdown: seal-after-load` seals intrinsic prototypes (`Object`, `Array`, `Promise`, `Map`, `Set`, and others) after all components load, blocking prototype pollution. Before v5.4.0 the default was `freeze-after-load`, which froze the intrinsics instead. If a dependency mutates an intrinsic prototype at runtime and throws a `TypeError`, set `lockdown: none` as a temporary workaround.

   ```yaml
   applications:
     lockdown: seal-after-load
   ```

   An in-place upgrade from v4 retains the existing config file, which has no `lockdown` value — Harper will not lock intrinsics until you explicitly add the key.

10. **Check `allowedDirectory` in production**: In production, `allowedDirectory: app` is the default, restricting module loading to the application's own directory tree. If your application loads modules from outside its directory, set `allowedDirectory: any`. This restriction does not apply in dev mode.

11. **Update response objects**: If a REST method returns an object with a `headers` property, Harper v5 will use it as the response headers. Ensure any object with a `headers` property returned from a REST method is intentional.

12. **Use `getContext` instead of passing context explicitly**: Context no longer needs to be threaded through every call. Access it via `getContext` exported from `'harper'`. Prefer `static` methods on Resources/Tables for endpoints and access request information from the `target` argument or via `getContext`.

#### Examples

##### Full `harper-config.yaml` module loading block

```yaml
applications:
  lockdown: seal-after-load
  moduleLoader: vm-current-context
  dependencyLoader: auto
  allowedDirectory: app
  allowedSpawnCommands:
    - npm
    - node
```

##### Disabling the VM loader entirely

```yaml
applications:
  moduleLoader: native
```

##### Checking `loadedFromSource` and using `getContext`

```javascript
import { getContext, transaction } from 'harper';

const target = new RequestTarget();
target.id = id;
const record = await Table.get(target);
if (target.loadedFromSource) {
	// record was loaded from origin (not cache)
}
```

##### Spreading a frozen record

```javascript
let record = await Table.get(id);
record = { ...record, property: 'changed' };
```

#### Notes

- The `logger` exported from `'harper'` is tagged with the application name when using the VM module loader. It is not available with `moduleLoader: native`.
- `instanceof` checks for values crossing the application/Harper boundary will fail when using `moduleLoader: vm` (separate intrinsics). Use `moduleLoader: vm-current-context` (the default) to avoid this.
- `import()` behavior depends on the selected `moduleLoader`. With `native`, it behaves as standard Node.js `import()` with no application context.
- The `exec` function from `node:child_process` is not usable through the substituted module in v5; `execSync` always throws.
- Record objects returned by `Table.get` expose `getUpdatedTime` and `getExpiresAt` even though they are frozen plain objects.

### 4.9 Delegating to the Built-in Agent

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
