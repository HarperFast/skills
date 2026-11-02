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
  sourceCommit: 1b103f864df3a0d8444297c00e752c29c2e7e82b
  inputHash: f86e9daec93c62b6
---

# Schema Design and GraphQL Tooling

Instructions for the agent to follow when designing Harper database schemas using GraphQL type definitions, core directives, and tooling configuration.

## When to Use

Apply this rule when creating or modifying Harper schema files, configuring the `graphqlSchema` plugin in `config.yaml`, or deciding which directives to apply to tables and fields. Use it whenever a task involves defining tables, primary keys, indexes, exports, or field-level behaviors.

## How It Works

1. **Create a schema file** using standard GraphQL type definitions with Harper-specific directives. Name it (e.g., `schema.graphql`) and place it in the component directory.

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

3. **Mark every table type with `@table`**. This tells Harper to create the table on deployment. The type name becomes the table name by default.

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

6. **Expose a table via REST and MQTT with `@export`**. The optional `name` parameter sets the URL path segment; without it, the type name is used.

   ```graphql
   type MyTable @table @export(name: "my-table") {
   	id: Long @primaryKey
   }
   ```

   `@export` alone does not serve HTTP traffic — REST must also be enabled for the application via `rest: true` in `config.yaml` or by Harper's built-in default for a component with no config file.

7. **Apply additional type directives** as needed:
   - `@sealed` — prevents records from including properties beyond those declared in the schema.
   - `@hidden` — suppresses the type from MCP tool descriptors and the OpenAPI document (not an access-control mechanism).

8. **Apply additional field directives** as needed:
   - `@createdTime` — auto-assigns Unix epoch milliseconds on record creation.
   - `@updatedTime` — auto-assigns Unix epoch milliseconds on each update.
   - `@expiresAt` — marks a field as the record's absolute expiration timestamp (Unix epoch milliseconds).
   - `@hidden` — suppresses the field from MCP tool descriptors and the OpenAPI document.

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

**Minimal schema with two related tables:**

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

**Table with custom name, database, and expiration:**

```graphql
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

**Sealed table with timestamps:**

```graphql
type StrictRecord @table @sealed {
	id: Long @primaryKey
	name: String
	createdAt: Long @createdTime
	updatedAt: Long @updatedTime
}
```

**Table with per-record expiration:**

```graphql
type Session @table {
	id: ID @primaryKey
	token: String
	expiresAt: Long @expiresAt
}
```

**Full example combining multiple directives:**

```graphql
type Event @table(database: "analytics", expiration: 86400) {
	id: Long @primaryKey
	name: String @indexed
	createdAt: Long @createdTime
}
```

**`config.yaml` registration:**

```yaml
graphqlSchema:
  files: 'schema.graphql'
```

## Notes

- Schemas are flexible by default — records may include additional properties beyond those declared. Use `@sealed` to prevent this.
- Both plugins and applications can specify schemas via `graphqlSchema`.
- Use unique `database` names in plugins or applications to avoid table naming collisions with the default `"data"` database.
- `@export` is a routing directive, not access control. Omitting it returns 404 to callers but does not protect the data from the Operations API or SQL. Use RBAC and `attribute_permissions` for actual access control.
- `@hidden` (on types or fields) is a metadata-visibility directive only — it does not restrict data access. Use role `attribute_permissions` whitelists to restrict field-level reads.
- `cacheControl` emits the header only on anonymous (unauthenticated) GET/HEAD 200/304 responses. Authenticated responses receive `Cache-Control: private, no-cache` regardless of the declaration.
- For `@expiresAt`: a full-record `put` that omits the field clears it; a `patch` preserves it. Values must be absolute Unix epoch milliseconds — negative values are ignored.
- Disabling replication on a table (`replicate: false`) and re-enabling it later will not catch up on writes made while replication was disabled.
