---
name: schema-design-tooling
description: >-
  Best practices for Harper schema design, including core directives and GraphQL
  tooling configuration.
metadata:
  mode: generate
  sources:
    - reference/v5/database/schema.md#Overview
    - reference/v5/database/schema.md#Type Directives
    - reference/v5/database/schema.md#Field Directives
  sourceCommit: 4aea8b1fffc53ee1dcf4841676350fef58f24056
  inputHash: af9e326b0cf010d8
---

# Schema Design and GraphQL Tooling

Instructions for the agent to follow when designing Harper schemas, applying core directives, and configuring GraphQL tooling.

## When to Use

Apply this rule when creating or modifying Harper schema files, configuring `graphqlSchema` in `config.yaml`, or deciding which directives to apply to tables and fields. Use it whenever a task involves defining tables, primary keys, indexes, or export behavior.

## How It Works

1. **Load the schema via `graphqlSchema`**: In the component's `config.yaml`, point to the schema file:

   ```yaml
   graphqlSchema:
     files: 'schema.graphql'
   ```

   Both plugins and applications can specify schemas. The schema ensures required tables exist on deployment, enforces types, controls indexing, and defines relationships.

2. **Mark tables with `@table`**: Apply `@table` to every GraphQL type that should become a Harper database table. The type name becomes the table name by default.

   ```graphql
   type Dog @table {
   	id: Long @primaryKey
   	name: String
   	breed: String
   	age: Int
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
   | `replicaExpiration`      | `Float`   | `3600`                        | Seconds a record fetched from another node is kept as a local replica          |
   | `replicaRefreshFraction` | `Float`   | `0.5`                         | Fraction of `replicaExpiration` after which a read renews the replica lifetime |
   | `audit`                  | `Boolean` | `logging.auditLog`            | Enable the table's transaction log                                             |
   | `cacheControl`           | `String`  | —                             | `Cache-Control` header for anonymous GET/HEAD 200/304 responses                |
   | `randomAccessFields`     | `Boolean` | `storage.randomAccessFields`  | Pin this table's record encoding                                               |

3. **Designate a primary key with `@primaryKey`**: Apply `@primaryKey` to exactly one field per table. Primary keys must be unique; duplicate inserts are rejected.

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	name: String
   }
   ```

   If no primary key is provided on insert, Harper auto-generates one:
   - **UUID string** — when type is `String` or `ID`
   - **Auto-incrementing integer** — when type is `Int`, `Long`, or `Any`

   Prefer `Long` or `Any` for auto-generated numeric keys; `Int` is 32-bit and may be insufficient for large tables.

4. **Index queryable fields with `@indexed`**: Apply `@indexed` to any field that must be filterable via REST queries, SQL, or NoSQL operations.

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	category: String @indexed
   	price: Float @indexed
   }
   ```

   If the field value is an array, each element is individually indexed. Null values are indexed by default.

5. **Expose tables externally with `@export`**: Apply `@export` to make a table accessible via REST, MQTT, and other interfaces. The optional `name` parameter sets the URL path segment.

   ```graphql
   type MyTable @table @export(name: "my-table") {
   	id: Long @primaryKey
   }
   ```

   `@export` alone does not serve HTTP traffic — REST must also be enabled for the application via `rest: true` in `config.yaml` or Harper's built-in default. `@export` is a routing directive, not access control: omitting it returns 404 to callers but the table remains accessible through the Operations API and SQL.

6. **Prevent extra properties with `@sealed`** (when needed): Apply `@sealed` to reject records that include properties beyond those declared in the schema. By default, Harper allows additional properties.

   ```graphql
   type StrictRecord @table @sealed {
   	id: Long @primaryKey
   	name: String
   }
   ```

7. **Use unique database names for plugins and applications**: All tables default to the `data` database. Specify a distinct `database` argument on `@table` to avoid naming collisions between components.

8. **Apply timestamp and expiration field directives** where needed:
   - `@createdTime` — auto-assigns a Unix epoch millisecond timestamp on record creation.
   - `@updatedTime` — auto-assigns a Unix epoch millisecond timestamp on each update.
   - `@expiresAt` — marks a field as the record's absolute expiration time (Unix epoch milliseconds); overrides the table-level `expiration` default.
   - `@hidden` — suppresses the type or field from MCP tool descriptors and the OpenAPI document. Does not restrict data access.

   ```graphql
   type Event @table {
   	id: Long @primaryKey
   	createdAt: Long @createdTime
   	updatedAt: Long @updatedTime
   }

   type Session @table {
   	id: ID @primaryKey
   	token: String
   	expiresAt: Long @expiresAt
   }
   ```

   Key `@expiresAt` behaviors:
   - Takes an absolute Unix epoch millisecond timestamp, not a duration. A full-record `put` that omits the field clears it; a `patch` preserves it.
   - A per-record value may extend or shorten a record's expiration relative to the table-level `expiration` default. When a record omits the field, the table default (if any) applies.

9. **Use `@embed`** to automatically compute an embedding vector for an attribute whenever the source field is written (requires `source` and `model` arguments; field type must be `[Float]`):
   ```graphql
   type Document @table {
   	id: Long @primaryKey
   	text: String
   	embedding: [Float] @embed(source: "text", model: "default")
   }
   ```
   The attribute is automatically indexed with an HNSW vector index. A failure to compute the embedding fails the write. An update that does not touch the `source` field leaves the vector unchanged. Setting the `source` field to `null` sets the vector to `null`.

## Examples

**Minimal schema with two tables:**

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

**Caching table with expiration, eviction, and scan tuning:**

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

**Table in a named database with expiration:**

```graphql
type Event @table(database: "analytics", expiration: 86400) {
	id: Long @primaryKey
	name: String @indexed
}
```

**Replica lifetime tuning:**

```graphql
# Keep fetched records for a day; a read after six hours renews them
type Order @table(replicaExpiration: 86400, replicaRefreshFraction: 0.25) {
	id: ID @primaryKey
	region: String @indexed
}
```

**Random-access field encoding pinned on the table:**

```graphql
type Reading @table(randomAccessFields: true) {
	id: ID @primaryKey
	sensorId: String @indexed
	celsius: Float
	recordedAt: Int
}
```

**`config.yaml` loading the schema:**

```yaml
graphqlSchema:
  files: 'schema.graphql'
```

## Notes

- Schemas are flexible by default — records may include additional properties. Use `@sealed` to prevent this.
- `@export` is a routing directive, not an access control mechanism. Use RBAC and `attribute_permissions` to restrict data access.
- `cacheControl` on `@table` only emits the header for anonymous (unauthenticated) GET/HEAD 200/304 responses. Authenticated responses always receive `Cache-Control: private, no-cache`.
- `expiration`, `eviction`, and `scanInterval` work together: `expiration` marks a record stale, `eviction` controls physical removal, and `scanInterval` sets how often the sweep runs. Eviction scans are clock-aligned to the server's local timezone, not startup-aligned.
- Eviction removes non-indexed record data but does not remove a record from its secondary indexes; indexes remain functional for evicted records.
- `replicaExpiration` and `replicaRefreshFraction` apply only on the RocksDB engine. On LMDB, remote reads remain proxy reads regardless of these settings.
- Disabling replication on a table (`replicate: false`) and re-enabling it later will not catch up on writes made while replication was disabled.
- `randomAccessFields` on `@table` pins the encoding when the table is created. Editing the argument later does not repin an existing table.
- `@hidden` is a metadata-visibility directive only — it does not restrict data access. Use `attribute_permissions` on roles for field-level access control.
