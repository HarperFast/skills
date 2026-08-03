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
  sourceCommit: 3749d0c54be457a2a65d9a63c738a5dc88989ecd
  inputHash: ce22f3fefb660c6e
---

# Schema Design and GraphQL Tooling

Instructions for the agent to follow when designing Harper schemas, applying core directives, and configuring GraphQL tooling.

## When to Use

Apply this rule when creating or modifying Harper schema files (`.graphql`), configuring `graphqlSchema` in `config.yaml`, or deciding which directives to apply to types and fields. Use it any time you need to define tables, primary keys, indexes, or exported endpoints.

## How It Works

1. **Declare the schema file** in the component's `config.yaml` using the `graphqlSchema` plugin:

   ```yaml
   graphqlSchema:
     files: 'schema.graphql'
   ```

   Both plugins and applications can specify schemas.

2. **Mark types as tables** with `@table`. The type name becomes the table name by default:

   ```graphql
   type Dog @table {
   	id: Long @primaryKey
   	name: String
   	breed: String
   	age: Int
   }
   ```

3. **Set a primary key** on every table using `@primaryKey`. Primary keys must be unique; duplicate-key inserts are rejected. If no primary key is provided on insert, Harper auto-generates one based on the field type:
   - `String` or `ID` → UUID string
   - `Int`, `Long`, or `Any` → auto-incrementing integer

   Use `Long` or `Any` for auto-generated numeric keys; `Int` is 32-bit and may be insufficient for large tables.

4. **Index fields for querying** with `@indexed`. Required for filtering by an attribute in REST queries, SQL, or NoSQL operations:

   ```graphql
   type Breed @table {
   	id: Long @primaryKey
   	name: String @indexed
   }
   ```

   If the field value is an array, each element is individually indexed. Null values are indexed by default.

5. **Expose a table as an external endpoint** with `@export`. Available via REST, MQTT, and other interfaces. The optional `name` parameter sets the URL path segment:

   ```graphql
   type MyTable @table @export(name: "my-table") {
   	id: Long @primaryKey
   }
   ```

   Without `name`, the type name is used.

6. **Configure `@table` arguments** as needed. All arguments are optional:

   | Argument       | Type      | Default                       | Description                                                   |
   | -------------- | --------- | ----------------------------- | ------------------------------------------------------------- |
   | `table`        | `String`  | type name                     | Override the table name                                       |
   | `database`     | `String`  | `"data"`                      | Database to place the table in                                |
   | `expiration`   | `Int`     | —                             | Seconds until a record goes stale                             |
   | `eviction`     | `Int`     | `0`                           | Additional seconds after `expiration` before physical removal |
   | `scanInterval` | `Int`     | `(expiration + eviction) / 4` | Seconds between eviction scans                                |
   | `replicate`    | `Boolean` | `true`                        | Enable replication of this table                              |

7. **Apply additional field directives** where needed:
   - `@createdTime` — auto-assigns creation timestamp (Unix epoch ms)
   - `@updatedTime` — auto-assigns update timestamp (Unix epoch ms)
   - `@expiresAt` — marks a field as the record's absolute expiration time (Unix epoch ms)
   - `@embed(source:, model:)` — computes an embedding vector when the source field is written; field type must be `[Float]`
   - `@hidden` — suppresses the field from MCP tool descriptors and OpenAPI document (not an access-control mechanism)

8. **Use `@sealed`** on a type to prevent records from including properties beyond those declared in the schema:

   ```graphql
   type StrictRecord @table @sealed {
   	id: Long @primaryKey
   	name: String
   }
   ```

9. **Use unique database names** in plugins or applications to avoid table naming collisions, since all tables default to the `data` database.

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

**Table with expiration, eviction, and scan tuning:**

```graphql
# Expire after 5 minutes, evict after 1 hour, scan every 10 minutes
type WeatherCache @table(expiration: 300, eviction: 3300, scanInterval: 600) {
	id: ID @primaryKey
	temperature: Float
}
```

**Table with multiple `@table` arguments combined:**

```graphql
type Event @table(database: "analytics", expiration: 86400) {
	id: Long @primaryKey
	name: String @indexed
}
```

**Exported table with overridden table name:**

```graphql
type Product @table(table: "products") @export(name: "products") {
	id: Long @primaryKey
	category: String @indexed
	price: Float @indexed
}
```

**Table with timestamps and per-record expiration:**

```graphql
type Session @table {
	id: ID @primaryKey
	token: String
	createdAt: Long @createdTime
	updatedAt: Long @updatedTime
	expiresAt: Long @expiresAt
}
```

**Table with a hidden internal field:**

```graphql
type Customer @table {
	id: Long @primaryKey
	name: String

	"""
	Internal — do not surface to external consumers.
	"""
	creditScore: Int @hidden
}
```

## Notes

- `@table`, `@export`, `@sealed`, and `@hidden` are type-level directives; `@primaryKey`, `@indexed`, `@embed`, `@createdTime`, `@updatedTime`, `@expiresAt`, and `@hidden` are field-level directives.
- `eviction` removes non-indexed record data but does **not** remove a record from its secondary indexes. Indexes remain functional for evicted records; Harper fetches the full record on demand when a query matches an evicted entry.
- `scanInterval` is clock-aligned to the server's local timezone, not startup-aligned. The server's startup time does not affect when eviction runs.
- Replication is enabled by default. If you disable replication on a table and re-enable it later, it will not catch up on writes made while replication was disabled.
- `@hidden` is a metadata-visibility directive only. Use `attribute_permissions` on roles to enforce data access control.
- A full-record `put` that omits an `@expiresAt` field clears it; a `patch` of other fields preserves it.
