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
  sourceCommit: b7fbddadd42eb4487190b650a9abc4bcfeef5819
  inputHash: 4faa3baed7cfa854
---

# Schema Design and Tooling

Instructions for the agent to follow when designing Harper schemas, applying core directives, and configuring GraphQL tooling.

## When to Use

Apply this rule when creating or modifying Harper schema files, configuring `graphqlSchema` in `config.yaml`, or deciding which directives to apply to tables and fields. Use it any time a component needs tables, indexes, primary keys, or exported endpoints defined.

## How It Works

1. **Create a GraphQL schema file** with Harper-specific directives. Name it (e.g., `schema.graphql`) and place it in your component directory.

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

2. **Register the schema in `config.yaml`** using the `graphqlSchema` plugin key:

   ```yaml
   graphqlSchema:
     files: 'schema.graphql'
   ```

   Both plugins and applications can specify schemas this way.

3. **Mark every table type with `@table`**. The type name becomes the table name by default. Use optional arguments to override behavior:

   | Argument       | Type      | Default                       | Description                                                   |
   | -------------- | --------- | ----------------------------- | ------------------------------------------------------------- |
   | `table`        | `String`  | type name                     | Override the table name                                       |
   | `database`     | `String`  | `"data"`                      | Database to place the table in                                |
   | `expiration`   | `Int`     | —                             | Seconds until a record goes stale                             |
   | `eviction`     | `Int`     | `0`                           | Additional seconds after `expiration` before physical removal |
   | `scanInterval` | `Int`     | `(expiration + eviction) / 4` | Seconds between eviction scans                                |
   | `replicate`    | `Boolean` | `true`                        | Enable replication of this table                              |

4. **Designate a primary key on every table** using `@primaryKey`. Primary keys must be unique; duplicate-key inserts are rejected. If no key is provided on insert, Harper auto-generates one:
   - `String` or `ID` → UUID string
   - `Int`, `Long`, or `Any` → auto-incrementing integer

   Prefer `Long` or `Any` for auto-generated numeric keys; `Int` is 32-bit and may be insufficient for large tables.

5. **Index fields that need fast querying** with `@indexed`. This is required for filtering by that attribute in REST queries, SQL, or NoSQL operations. If the field value is an array, each element is individually indexed.

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	category: String @indexed
   	price: Float @indexed
   }
   ```

6. **Expose a table as an external resource endpoint** with `@export`. This makes the table accessible via REST, MQTT, and other interfaces. The optional `name` parameter sets the URL path segment; without it, the type name is used.

   ```graphql
   type MyTable @table @export(name: "my-table") {
   	id: Long @primaryKey
   }
   ```

7. **Restrict extra properties** with `@sealed` when records must not include attributes beyond those declared. By default, Harper allows additional properties.

   ```graphql
   type StrictRecord @table @sealed {
   	id: Long @primaryKey
   	name: String
   }
   ```

8. **Configure expiration, eviction, and scan behavior** together when building caching tables. These three arguments control the full record lifecycle:
   - `expiration` — record becomes stale; next request triggers a source fetch
   - `eviction` — additional time after `expiration` before physical removal
   - `scanInterval` — how often Harper scans for records to evict; clock-aligned, not startup-aligned

## Examples

**Caching table with tuned expiration:**

```graphql
# Expire after 5 minutes, evict after 1 hour, scan every 10 minutes
type WeatherCache @table(expiration: 300, eviction: 3300, scanInterval: 600) {
	id: ID @primaryKey
	temperature: Float
}
```

**Table in a named database with expiration and an indexed field:**

```graphql
type Event @table(database: "analytics", expiration: 86400) {
	id: Long @primaryKey
	name: String @indexed
}
```

**Session cache with auto-expiry:**

```graphql
type Session @table(expiration: 3600) {
	id: Long @primaryKey
	userId: String
}
```

**Table with audit timestamps:**

```graphql
type Order @table @export(name: "orders") {
	id: Long @primaryKey
	createdAt: Long @createdTime
	updatedAt: Long @updatedTime
	status: String @indexed
}
```

**Overriding the table name and disabling replication:**

```graphql
type Product @table(table: "products") {
	id: Long @primaryKey
	name: String
}

type LocalRecord @table(replicate: false) {
	id: Long @primaryKey
	value: String
}
```

## Notes

- Use unique `database` names in plugins and applications to avoid table naming collisions, since all tables default to the `"data"` database.
- Eviction removes non-indexed record data but does **not** remove a record from its secondary indexes. Indexes remain functional for evicted records; Harper fetches the full record from the source on demand when a query matches an evicted record.
- `scanInterval` is clock-aligned to the server's local timezone. The server's startup time does not affect when eviction runs.
- If replication is disabled on a table and later re-enabled, it will not catch up on writes made while replication was disabled.
- Null values are indexed by `@indexed` fields, enabling queries such as `GET /Product/?category=null`.
