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
  sourceCommit: e4a7bd899e1a68a83d9ed1d770ec73569fabc260
  inputHash: 16a9e0488c853439
---

# Schema Design and GraphQL Tooling

Instructions for the agent to follow when designing Harper database schemas using GraphQL type definitions, core directives, and tooling configuration.

## When to Use

Apply this rule when creating or modifying Harper schema files — defining tables, primary keys, indexes, and export behavior. Use it when configuring `graphqlSchema` in `config.yaml` or when choosing directives to control table structure, access patterns, and record lifecycle.

## How It Works

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

## Notes

- `@export` is a routing directive, not access control. Omitting it returns 404 to callers but does not protect the data — the table remains accessible through the Operations API and SQL. Use RBAC role grants and `attribute_permissions` for actual access control.
- `@hidden` (on types or fields) suppresses entries from MCP tool descriptors and the OpenAPI document only. It does not restrict data access. Use `attribute_permissions` on roles for field-level enforcement.
- Null values are indexed by default for `@indexed` fields, enabling queries like `GET /Product/?category=null`. This matches records that store `null`, not records that omit the attribute.
- `cacheControl` emits the header only on anonymous (unauthenticated) GET/HEAD 200/304 responses. Authenticated responses receive `Cache-Control: private, no-cache` regardless of the declaration.
- A `patch` of other fields preserves an existing `@expiresAt` value; a full `put` that omits the field clears it. Always re-include `expiresAt` in session-renewal writes.
- `replicaExpiration` and `randomAccessFields` apply to RocksDB only. LMDB tables ignore replica behavior regardless of settings.
- Disabling replication on a table (`replicate: false`) and re-enabling it later will not catch up on writes made while replication was disabled.
