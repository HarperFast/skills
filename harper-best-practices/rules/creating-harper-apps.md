---
name: creating-harper-apps
description: How to initialize a new Harper application using the CLI.
metadata:
  mode: generate
  sources:
    - learn/getting-started/create-your-first-application.md
    - reference/v5/components/applications.md#Local Development
  sourceCommit: b7fbddadd42eb4487190b650a9abc4bcfeef5819
  inputHash: aae210b12cfdaf9f
---

# Creating Harper Applications

Instructions for the agent to initialize and run a new Harper application using the CLI and configure its core files.

## When to Use

Apply this rule when scaffolding a new Harper application from scratch, wiring up a table schema, or starting the local development server. Use it any time `schema.graphql` or `config.yaml` need to be created or modified to register a table and enable plugins.

## How It Works

1. **Clone the starter repo**: Get the application template locally. If using a container, clone into the mounted `dev/` directory.

   ```bash
   git clone https://github.com/HarperFast/create-your-first-application.git first-harper-app
   ```

2. **Define a table in `schema.graphql`**: Open `schema.graphql` and declare a type with the `@table` directive. Use `@primaryKey` to designate the primary key field. Add typed fields using standard GraphQL scalar types (`String`, `Int`, `ID`, etc.).

   ```graphql
   type Dog @table {
   	id: ID @primaryKey
   	name: String
   	breed: String
   	age: Int
   }
   ```

3. **Register the schema in `config.yaml`**: Open `config.yaml` and configure the `graphqlSchema` plugin with a `files` property pointing to your schema file. This tells Harper to process the schema on startup.

   ```yaml
   graphqlSchema:
     files: 'schema.graphql'
   ```

4. **Start the development server**: From inside the application directory, run `harper dev`. This watches all files (except `node_modules`) and automatically restarts Harper worker threads when changes are detected.

   ```bash
   harper dev .
   ```

5. **Enable the REST API**: Add the `@export` directive to the table type in `schema.graphql`, then add `rest: true` to `config.yaml`.

   `schema.graphql`:

   ```graphql
   type Dog @table @export {
   	id: ID @primaryKey
   	name: String
   	breed: String
   	age: Int
   }
   ```

   `config.yaml`:

   ```yaml
   graphqlSchema:
     files: 'schema.graphql'
   rest: true
   ```

   After saving, `harper dev` restarts automatically. Confirm the REST plugin is active by checking the logs for:

   ```
   REST:               HTTP: 9926
   ```

## Examples

**Full `config.yaml` with REST enabled:**

```yaml
graphqlSchema:
  files: 'schema.graphql'
rest: true
```

**Full `schema.graphql` with REST export:**

```graphql
type Dog @table @export {
	id: ID @primaryKey
	name: String
	breed: String
	age: Int
}
```

**Create a record via `PUT`:**

```bash
curl 'http://localhost:9926/Dog/001' \
  -X PUT \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Harper",
    "breed": "Black Labrador / Chow Mix",
    "age": 5
  }' \
  -w "%{http_code}"
```

**Read a record via `GET`:**

```bash
curl -s 'http://localhost:9926/Dog/001' | jq
```

**Query records by attribute:**

```bash
curl -s 'http://localhost:9926/Dog/?age=5' | jq
```

## Notes

- `harper dev .` watches for file changes and restarts worker threads automatically. Use `harper run` instead when the main thread must also restart (the `dev` command does not restart the main thread).
- Stop either process with SIGINT (`Ctrl+C`).
- The `graphqlSchema` plugin is built-in; no additional dependency installation is required.
- The `files` property in `config.yaml` accepts a glob pattern — a single filename or a broader pattern are both valid.
- The `@table` directive marks a type as a database table. Without it, Harper treats the type as an arbitrary GraphQL type.
- The REST API defaults to port `9926`. This value is configurable.
- To deploy a local application to a running Harper instance without using `harper dev`, use:
  ```bash
  harper deploy \
    project=<name> \
    package=<path-to-project> \
    restart=true
  ```
