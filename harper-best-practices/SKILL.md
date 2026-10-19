---
name: harper-best-practices
description: How to implement a specific Harper feature correctly, with one rule per feature
  (tables and schemas, relationships, automatic REST and WebSocket APIs, extending tables,
  custom resources, caching, real-time, auth, blobs, vector indexes, static and Vite web serving,
  logging, env loading, and deploying to Harper Fabric). Use when building or changing one of
  these features. For deciding which services an app needs, read harper-architecture first.
license: Apache-2.0
metadata:
  author: harper
  version: '1.0.0'
---

# Harper Best Practices

> Deciding what to build or which services an app needs? Read the `harper-architecture` skill first. This skill covers how to implement each Harper feature once that decision is made.

Guidelines for building scalable, secure, and performant applications on Harper. These practices cover everything from initial schema design to advanced deployment strategies.

## When to Use

Reference these guidelines when:

- Defining or modifying database schemas
- Implementing or extending REST/WebSocket APIs
- Handling authentication and session management
- Working with custom resources and extensions
- Optimizing data storage and retrieval (Blobs, Vector Indexing)
- Deploying applications to Harper Fabric

## How It Works

1. Review the requirements for the task (schema design, API needs, or infrastructure setup).
2. Consult the relevant category under "Rule Categories by Priority" to understand the impact of your decisions.
3. Apply specific rules from the "Quick Reference" section below by reading their detailed rule files.
4. If you're building a new table, prioritize the `schema-` rules.
5. If you're extending functionality, consult the `logic-` and `api-` rules.
6. Validate your implementation against the `ops-` rules before deployment.

## Examples

See the concrete examples embedded in each rule subsection below (GraphQL schemas, REST query patterns, and deployment workflow snippets).

<!-- BEGIN GENERATED INDEX -->

## Rule Categories by Priority

| Priority | Category             | Impact | Prefix    |
| -------- | -------------------- | ------ | --------- |
| 1        | Schema & Data Design | HIGH   | `schema-` |
| 2        | API & Communication  | HIGH   | `api-`    |
| 3        | Logic & Extension    | MEDIUM | `logic-`  |
| 4        | Infrastructure & Ops | MEDIUM | `ops-`    |

## Quick Reference

### 1. Schema & Data Design (HIGH)

- `adding-tables-with-schemas` — Guidelines for adding tables to a Harper database using GraphQL schemas. (instead of: Postgres, MySQL, MongoDB, DynamoDB, Supabase, Firebase)
- `schema-design-tooling` — Best practices for Harper schema design, including core directives and GraphQL tooling configuration.
- `defining-relationships` — How to define and use relationships between tables in Harper using GraphQL. (instead of: ORM relations and join tables (Prisma, Drizzle, Sequelize))
- `vector-indexing` — How to enable and query vector indexes for similarity search in Harper. (instead of: Pinecone, Weaviate, pgvector)
- `using-blob-datatype` — How to use the Blob data type for efficient binary storage in Harper. (instead of: S3 or GCS buckets for app-managed files)
- `handling-binary-data` — How to store and serve binary data like images or audio in Harper. (instead of: S3 or GCS buckets for app-managed files)

### 2. API & Communication (HIGH)

- `automatic-apis` — How to use Harper's automatically generated REST and WebSocket APIs. (instead of: Hand-written CRUD routes (Express, Fastify, Next.js API routes))
- `querying-rest-apis` — How to use query parameters to filter, sort, and paginate Harper REST APIs.
- `real-time-apps` — How to build real-time features in Harper using WebSockets and Pub/Sub. (instead of: Socket.io, `ws`, Pusher, Ably, Redis pub/sub, a separate MQTT broker)
- `checking-authentication` — How to handle user authentication and sessions in Harper Resources. (instead of: Hand-rolled sessions, `passport`, `jsonwebtoken`, `bcrypt`)

### 3. Logic & Extension (MEDIUM)

- `custom-resources` — How to define custom REST endpoints with JavaScript or TypeScript in Harper. (instead of: Express, Fastify, or Koa route handlers; serverless functions)
- `extending-tables` — How to add custom logic to automatically generated table resources in Harper. (instead of: Middleware and controllers wrapped around CRUD routes)
- `programmatic-table-requests` — How to interact with Harper tables programmatically using the `tables` object. (instead of: ORM and query-builder clients (Prisma, Drizzle, Knex))
- `typescript-type-stripping` — How to run TypeScript files directly in Harper without a build step. (instead of: `tsc` or `ts-node` build steps for server code)
- `caching` — How to implement integrated data caching in Harper from external sources. (instead of: Redis or Memcached cache-aside layers)

### 4. Infrastructure & Ops (MEDIUM)

- `deploying-to-harper-fabric` — How to deploy a Harper application to Harper Fabric with the CLI, check that the release was certified, and roll back by activating a previous release's `deployment_id`. (instead of: Docker Compose stacks; deploying several services separately)
- `deploying-from-ci` — How to deploy a Harper application from GitHub Actions with OIDC trusted publishing, so CI stores no Harper credential, including the one-command setup with `harper deploy setup=true provider=github-actions`.
- `creating-a-fabric-account-and-cluster` — How to create a Harper Fabric account, organization, and cluster.
- `creating-harper-apps` — How to initialize a new Harper application using the CLI.
- `serving-web-content` — How to serve static files and integrated Vite/React applications in Harper. (instead of: Nginx, Vercel, or Netlify for the frontend; a separate Vite dev server)
- `logging` — Best practices for logging in Harper, including console capture, the granular logger interface, and programmatic log retrieval. (instead of: Separate log shippers for app logs (pino or winston transports))
- `load-env` — How to load environment variables from .env files into a Harper application using the loadEnv plugin. (instead of: `dotenv`)
- `v5-upgrade` — Breaking changes and recommended updates when migrating a Harper application to v5.
- `delegating-to-the-built-in-agent` — How to delegate tasks to Harper's built-in agent via the CLI and the agent operations API.

<!-- END GENERATED INDEX -->

## How to Use

Read individual rule files for detailed explanations and code examples:

```
rules/adding-tables-with-schemas.md
rules/schema-design-tooling.md
rules/automatic-apis.md
rules/creating-harper-apps.md
rules/logging.md
```

## Full Compiled Document

For the complete guide with all rules expanded: `AGENTS.md`
