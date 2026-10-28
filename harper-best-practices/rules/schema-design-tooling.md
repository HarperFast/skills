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
  sourceCommit: 6c3e29dd9149201364b0d74642725c30f0305e3e
  inputHash: 34e3857d55b137fc
---

# Schema Design and GraphQL Tooling

Instructions for the agent to follow when designing Harper schemas, applying core directives, and configuring GraphQL tooling.

## When to Use

Apply this rule when creating or modifying Harper schema files, configuring the `graphqlSchema` plugin in `config.yaml`, or deciding which directives to apply to tables and fields. Use it whenever a task involves defining tables, primary keys, indexes, or export behavior.

## How It Works

1. **Define the schema file** using standard GraphQL type definitions with Harper-specific directives. Save it as a `.graphql` file (e.g., `schema.graphql`).

2. **Register the schema** in the component's `config.yaml` using the `graphqlSchema` plugin:

   ```yaml
   graphqlSchema:
     files: 'schema.graphql'
   ```

   Both plugins and applications can specify schemas.

3. **Mark tables with `@table`** to declare a GraphQL type as a Harper database table. The type name becomes the table name by default.

   ```graphql
   type Dog @table {
   	id: Long @primaryKey
   	name: String
   	breed: String
   	age: Int
   }
   ```

   Pass optional arguments to `@table` to control behavior:

   | Argument                 | Type      | Default                          | Description                                                                    |
   | ------------------------ | --------- | -------------------------------- | ------------------------------------------------------------------------------ |
   | `table`                  | `String`  | type name                        | Override the table name                                                        |
   | `database`               | `String`  | `"data"`                         | Database to place the table in                                                 |
   | `expiration`             | `Int`     | —                                | Seconds until a record goes stale                                              |
   | `eviction`               | `Int`     | `0`                              | Additional seconds after `expiration` before physical removal                  |
   | `scanInterval`           | `Int`     | `(expiration + eviction) / 4`    | Seconds between eviction scans                                                 |
   | `replicate`              | `Boolean` | `true`                           | Enable replication of this table                                               |
   | `replicaExpiration`      | `Float`   | `3600`                           | Seconds a replica fetched from another node is kept locally                    |
   | `replicaRefreshFraction` | `Float`   | `0.5`                            | Fraction of `replicaExpiration` after which a read renews the replica lifetime |
   | `audit`                  | `Boolean` | per `logging.auditLog`           | Enable the table's transaction log                                             |
   | `cacheControl`           | `String`  | —                                | `Cache-Control` header on anonymous GET/HEAD 200/304 responses                 |
   | `randomAccessFields`     | `Boolean` | per `storage.randomAccessFields` | Pin this table's record encoding                                               |

4. **Designate a primary key with `@primaryKey`** on exactly one field per table. Primary keys must be unique; duplicate inserts are rejected.

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	name: String
   }
   ```

   If no primary key is provided on insert, Harper auto-generates one:
   - **UUID string** — when type is `String` or `ID`
   - **Auto-incrementing integer** — when type is `Int`, `Long`, or `Any`

   Use `Long` or `Any` for auto-generated numeric keys; `Int` is 32-bit and may be insufficient for large tables.

5. **Index fields with `@indexed`** to enable fast querying, filtering via REST, SQL, or NoSQL operations.

   ```graphql
   type Breed @table {
   	id: Long @primaryKey
   	name: String @indexed
   }
   ```

   If the field value is an array, each element is individually indexed. Null values are indexed by default.

6. **Expose tables externally with `@export`** to make them accessible via REST, MQTT, and other interfaces.

   ```graphql
   type MyTable @table @export(name: "my-table") {
   	id: Long @primaryKey
   }
   ```

   The optional `name` parameter sets the URL path segment. Without `name`, the type name is used. `@export` alone does not serve HTTP traffic — REST must also be enabled for the application via `rest: true` in `config.yaml` or Harper's built-in default.

   > `@export` is a routing directive, not access control. Omitting it returns 404 to callers but does not protect the data — the table remains accessible through the Operations API and SQL. Use RBAC role grants and `attribute_permissions` to restrict data access.

7. **Apply additional type directives** as needed:
   - `@sealed` — prevents records from including properties beyond those declared in the schema.
   - `@hidden` — suppresses the type from MCP tool descriptors and the OpenAPI document. Does not restrict data access.

8. **Apply additional field directives** as needed:
   - `@createdTime` — auto-assigns a Unix epoch millisecond timestamp on record creation.
   - `@updatedTime` — auto-assigns a Unix epoch millisecond timestamp on each update.
   - `@expiresAt` — marks a field as the record's absolute expiration time (Unix epoch milliseconds); overrides the table-level `expiration` default.
   - `@hidden` (field) — suppresses the field from generated specs and MCP tool schemas; does not restrict data access.

9. **Use `@embed`** to automatically compute an embedding vector for an attribute whenever the source field is written (requires `source` and `model` arguments; field type must be `[Float]`):
   ```graphql
   type Document @table {
   	id: Long @primaryKey
   	text: String
   	embedding: [Float] @embed(source: "text", model: "default")
   }
   ```
   The attribute is automatically indexed with an HNSW vector index and is immediately searchable by similarity.

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

**Table with overridden name and database:**

```graphql
type Product @table(table: "products", database: "commerce") @export {
	id: Long @primaryKey
	name: String
	category: String @indexed
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

**Table with public cache-control for CDN caching:**

```graphql
type Product @table(cacheControl: "public, max-age=60") @export {
	id: Long @primaryKey
	name: String
	price: Float
}
```

**Table with replica settings for sharded data:**

```graphql
# Keep fetched records for a day; a read after six hours renews them
type Order @table(replicaExpiration: 86400, replicaRefreshFraction: 0.25) {
	id: ID @primaryKey
	region: String @indexed
}
```

**Sealed table with timestamps:**

```graphql
type StrictRecord @table @sealed {
	id: Long @primaryKey
	name: String
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

**`config.yaml` registration:**

```yaml
graphqlSchema:
  files: 'schema.graphql'
```

## Notes

- Schemas are flexible by default — records may include additional properties beyond those declared. Use `@sealed` to prevent this.
- When designing plugins or applications, use unique `database` names in `@table` to avoid table naming collisions, since all tables default to the `data` database.
- Replication is enabled by default. Disabling replication (`replicate: false`) and re-enabling it later will not catch up on writes made while replication was disabled.
- `@hidden` (type or field) is a metadata-visibility directive only. It suppresses types or fields from generated API specs and MCP tool schemas but does not restrict data access. Use role grants and `attribute_permissions` for access control.
- The `cacheControl` argument emits headers only on anonymous (unauthenticated) GET/HEAD 200/304 responses. Authenticated responses receive `Cache-Control: private, no-cache` regardless of the declaration. The value is never emitted on 401 responses.
- `@expiresAt` takes an absolute Unix epoch millisecond timestamp, not a duration. A full-record `put` that omits the field clears it; a `patch` preserves it.
- `randomAccessFields` on `@table` pins the table's encoding at creation time. Editing the argument later does not repin an existing table.
