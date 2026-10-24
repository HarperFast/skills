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
  sourceCommit: 34b029d96e2d16b68e11f2c6faef051811862af3
  inputHash: a7e7194f56122ebb
---

# Harper Schema Design and GraphQL Tooling

Instructions for the agent to follow when designing Harper database schemas using GraphQL type definitions, core directives, and tooling configuration.

## When to Use

Apply this rule when creating or modifying Harper schema files, configuring the `graphqlSchema` plugin in `config.yaml`, or deciding which directives to apply to tables and fields. Use it whenever you need to define tables, primary keys, indexes, or export endpoints.

## How It Works

1. **Create a schema file** using standard GraphQL type definitions with Harper-specific directives. Name it (e.g., `schema.graphql`) and place it in your component directory.

2. **Register the schema** in the component's `config.yaml` using the `graphqlSchema` plugin:

   ```yaml
   graphqlSchema:
     files: 'schema.graphql'
   ```

   Both plugins and applications can specify schemas.

3. **Mark types as tables** with `@table`. The type name becomes the table name by default.

   ```graphql
   type Dog @table {
   	id: Long @primaryKey
   	name: String
   	breed: String
   	age: Int
   }
   ```

4. **Designate a primary key** with `@primaryKey` on exactly one field per type. Primary keys must be unique; duplicate inserts are rejected. If no primary key is provided on insert, Harper auto-generates one:
   - `String` or `ID` → UUID string
   - `Int`, `Long`, or `Any` → auto-incrementing integer

   Use `Long` or `Any` for auto-generated numeric keys; `Int` is 32-bit and may be insufficient for large tables.

5. **Add secondary indexes** with `@indexed` on any field you need to filter by in REST queries, SQL, or NoSQL operations.

   ```graphql
   type Breed @table {
   	id: Long @primaryKey
   	name: String @indexed
   }
   ```

   If the field value is an array, each element is individually indexed. Null values are indexed by default.

6. **Expose tables as REST/MQTT endpoints** with `@export`. The optional `name` parameter sets the URL path segment; without it, the type name is used.

   ```graphql
   type MyTable @table @export(name: "my-table") {
   	id: Long @primaryKey
   }
   ```

   `@export` alone does not serve HTTP traffic — REST must also be enabled for the application via `rest: true` in `config.yaml` or Harper's built-in default.

7. **Configure `@table` arguments** as needed. All arguments are optional:

   | Argument                 | Type      | Default                       | Description                                                                    |
   | ------------------------ | --------- | ----------------------------- | ------------------------------------------------------------------------------ |
   | `table`                  | `String`  | type name                     | Override the table name                                                        |
   | `database`               | `String`  | `"data"`                      | Database to place the table in                                                 |
   | `expiration`             | `Int`     | —                             | Seconds until a record goes stale                                              |
   | `eviction`               | `Int`     | `0`                           | Additional seconds after `expiration` before physical removal                  |
   | `scanInterval`           | `Int`     | `(expiration + eviction) / 4` | Seconds between eviction scans                                                 |
   | `replicate`              | `Boolean` | `true`                        | Enable replication of this table                                               |
   | `replicaExpiration`      | `Float`   | `3600`                        | Seconds a replica fetched from another node is kept locally                    |
   | `replicaRefreshFraction` | `Float`   | `0.5`                         | Fraction of `replicaExpiration` after which a read renews the replica lifetime |
   | `cacheControl`           | `String`  | —                             | `Cache-Control` header value for anonymous GET/HEAD 200/304 responses          |
   | `randomAccessFields`     | `Boolean` | `storage.randomAccessFields`  | Pin this table's record encoding                                               |

8. **Apply additional field directives** where needed:
   - `@createdTime` — auto-assigns Unix epoch milliseconds on record creation
   - `@updatedTime` — auto-assigns Unix epoch milliseconds on each update
   - `@expiresAt` — marks a field as the record's absolute expiration timestamp (Unix epoch milliseconds); authoritative over the table-level `expiration` default
   - `@hidden` — suppresses the field from MCP tool descriptors and the OpenAPI document (not an access-control mechanism)
   - `@sealed` (type directive) — prevents records from including properties beyond those declared in the type

9. **Use `@embed`** to automatically compute an embedding vector for an attribute whenever the source field is written (requires `source` and `model` arguments; field type must be `[Float]`):
   ```graphql
   type Document @table {
   	id: Long @primaryKey
   	text: String
   	embedding: [Float] @embed(source: "text", model: "default")
   }
   ```
   The attribute is automatically indexed with an HNSW vector index and is immediately searchable by similarity. A failure to compute the embedding fails the write.

## Examples

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

**Override table name and database:**

```graphql
type Product @table(table: "products", database: "commerce") {
	id: Long @primaryKey
	name: String
	price: Float @indexed
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

**Replica configuration for sharded tables:**

```graphql
# Keep fetched records for a day; a read after six hours renews them
type Order @table(replicaExpiration: 86400, replicaRefreshFraction: 0.25) {
	id: ID @primaryKey
	region: String @indexed
}
```

**Sealed type with timestamps:**

```graphql
type StrictRecord @table @sealed {
	id: Long @primaryKey
	name: String
	createdAt: Long @createdTime
	updatedAt: Long @updatedTime
}
```

**Per-record expiration with `@expiresAt`:**

```graphql
type Session @table {
	id: ID @primaryKey
	token: String
	expiresAt: Long @expiresAt
}
```

**Random-access field encoding pinned at table creation:**

```graphql
type Reading @table(randomAccessFields: true) {
	id: ID @primaryKey
	sensorId: String @indexed
	celsius: Float
	recordedAt: Int
}
```

## Notes

- Schemas are flexible by default — records may include additional properties beyond those declared. Use `@sealed` to prevent this.
- Use unique `database` names in plugins and applications to avoid table naming collisions, since all tables default to the `"data"` database.
- Replication is enabled by default. Disabling replication (`replicate: false`) and re-enabling it later will not catch up on writes made while replication was disabled.
- `@export` is a routing directive, not access control. Omitting it returns 404 to callers but does not protect the data from the Operations API or SQL. Use RBAC and role permissions for actual access control.
- `@hidden` (on types or fields) is a metadata-visibility directive only — it suppresses entries from MCP tool descriptors and OpenAPI documents but does not restrict data access. Use `attribute_permissions` on roles for field-level access control.
- `cacheControl` emits the header only on anonymous (unauthenticated) GET/HEAD `200`/`304` responses. Authenticated responses receive `Cache-Control: private, no-cache` regardless of the declaration. The header is never emitted on `401` responses.
- `eviction` removes non-indexed record data but does not remove a record from its secondary indexes. Indexes remain functional for evicted records; Harper fetches the full record on demand when a query matches.
- `scanInterval` is clock-aligned to the server's local timezone, not startup-aligned. The eviction schedule is deterministic across restarts.
- A full-record `put` that omits an `@expiresAt` field clears it. A `patch` of other fields preserves it — session-renewal writes must re-include `expiresAt`.
