---
name: adding-tables-with-schemas
description: Guidelines for adding tables to a Harper database using GraphQL schemas.
metadata:
  mode: synthesized
---

# Adding Tables with Schemas

Instructions for the agent to follow when adding tables to a Harper database.

## When to Use

Use this skill when you need to define new data structures or modify existing ones in a Harper database.

## How It Works

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

## Examples

In a hypothetical `schemas/ExamplePerson.graphql`:

```graphql
type ExamplePerson @table @export {
	id: ID @primaryKey
	name: String
	tag: String @indexed
}
```
