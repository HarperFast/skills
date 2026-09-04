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
  sourceCommit: 677ad213d67822e109c83619e181ca23a59823db
  inputHash: ecb06058191ba29f
---

# Schema Design and GraphQL Tooling

Instructions for the agent to follow when designing Harper database schemas using GraphQL type definitions, core directives, and tooling configuration.

## When to Use

Apply this rule when creating or modifying Harper schema files (`.graphql`), configuring schema loading in `config.yaml`, or deciding which directives to apply to tables and fields. Use it whenever a task involves defining tables, primary keys, indexes, or export behavior.

## How It Works

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

## Notes

- Schemas are flexible by default — records may include additional properties beyond those declared. Use `@sealed` to prevent this.
- Use unique `database` names in plugins or applications to avoid table naming collisions, since all tables default to the `"data"` database.
- Replication is enabled by default. If you disable replication and re-enable it later, the table will not catch up on writes made while replication was disabled.
- `@hidden` (type or field) is a metadata-visibility directive only. Use table-level role permissions and `attribute_permissions` whitelists to restrict actual data access.
- `@export` absence causes 404 on REST/MQTT routes but does not protect data from the Operations API or SQL.
- The `cacheControl` argument emits headers only on anonymous (unauthenticated) GET/HEAD 200/304 responses. Authenticated responses receive `Cache-Control: private, no-cache`.
- `randomAccessFields` on `@table` pins the record encoding at table creation time. Editing the argument later does not repin an existing table.
