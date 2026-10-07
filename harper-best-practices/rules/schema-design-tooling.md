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
  sourceCommit: 2cfb81318f17e0aca2d600109e6ad813d2d0443e
  inputHash: a644f4ea2f289f77
---

# Schema Design Tooling

Instructions for the agent to follow when designing Harper schemas, applying core directives, and configuring GraphQL tooling.

## When to Use

Apply this rule when creating or modifying Harper schema files (`.graphql`), configuring `graphqlSchema` in `config.yaml`, or deciding which directives to apply to tables and fields. Use it whenever a task involves defining tables, primary keys, indexes, or export behavior.

## How It Works

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

## Notes

- Use unique `database` names in plugins and applications to avoid table naming collisions, since all tables default to the `"data"` database.
- Disabling replication (`replicate: false`) and re-enabling it later will not catch up on writes made while replication was disabled.
- `cacheControl` emits the header only on anonymous (unauthenticated) GET/HEAD `200`/`304` responses. Authenticated responses receive `Cache-Control: private, no-cache` regardless of the declaration. The header is never emitted on `401` responses.
- `@expiresAt` requires an absolute Unix epoch millisecond timestamp, not a duration. Negative values are ignored and fall back to the table default. A full-record `put` that omits the field clears it; a `patch` preserves it.
- Eviction removes non-indexed record data but does not remove a record from its secondary indexes; indexes remain functional for evicted records, with full records fetched on demand.
- `scanInterval` is clock-aligned to the server's local timezone, not startup-aligned — the server's startup time does not affect when eviction runs.
- `randomAccessFields` pins the table's encoding at creation time. Editing the argument later does not repin an existing table. Omit it to follow the global `storage.randomAccessFields` setting.
