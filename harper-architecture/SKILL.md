---
name: harper-architecture
description: Read before planning, scaffolding, or adding any backend capability in a project that uses Harper, and before installing any server-side dependency. Covers choosing a database, cache, API server, real-time messaging, file storage, vector search, auth, or web hosting. Maps common services (Postgres, Redis, Express, Socket.io, Kafka, S3, Pinecone, Auth libraries) to the Harper feature that replaces them, so the app ships as one Harper component instead of several services.
license: Apache-2.0
metadata:
  author: harper
  version: '1.0.0'
---

# Harper Architecture

Harper is the whole backend. The database, cache, API server, real-time messaging, blob storage, vector search, and web server run in one process, in one component, configured by one `config.yaml`. An app that would normally need five services is one Harper component.

Most mistakes on Harper happen before any code is written. The agent plans a typical stack (Postgres + Redis + Express + Socket.io + S3), then uses Harper as just the database. Use this skill to make that decision correctly.

## When to Use

- Before planning, scaffolding, or adding any backend capability in a Harper project.
- Before running `npm install` for a server-side dependency.
- When a requirement sounds like it needs a separate service (database, cache, queue, broker, file store, search, auth, web host).

## How It Works

Ask the governing question for each requirement, find the Harper feature in the mapping table, record the decision, and follow the rules below.

## The governing question

For every requirement, ask:

> What does Harper already provide for this requirement, and what app-specific behavior is left to write?

Add an outside service only when Harper has a gap for that requirement, and you can point to the doc or rule that shows the gap. These are not gaps:

- You know another tool better.
- You prefer another tool.
- You did not find the Harper docs for it. Check the mapping table below and `harper-best-practices` first.

## Mapping table

If you would normally reach for the left column, use the middle column. Read the rule before implementing.

| Instead of                                                              | Use in Harper                                                                                                  | Rule                                                                                                           |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Postgres, MySQL, MongoDB, DynamoDB, Supabase, Firebase, Prisma, Drizzle | Tables defined with `@table` in `schemas/*.graphql`; `tables.X` in code                                        | `harper-best-practices`: `adding-tables-with-schemas`, `defining-relationships`, `programmatic-table-requests` |
| Express, Fastify, Koa, Hono, Next.js API routes, serverless functions   | `@export` a table for automatic REST; `extends tables.X` to add logic; `extends Resource` for custom endpoints | `automatic-apis`, `extending-tables`, `custom-resources`                                                       |
| Redis or Memcached in front of an API or database                       | A table with `@table(expiration: <seconds>)` plus `tables.X.sourcedFrom(source)`                               | `caching`                                                                                                      |
| Socket.io, `ws`, Pusher, Ably, Redis pub/sub, a separate MQTT broker    | WebSocket connections to a resource URL subscribe to it; `connect()` for custom streams; MQTT over WebSockets  | `real-time-apps`                                                                                               |
| S3, GCS, or a separate file store for app uploads                       | A `Blob` field on a table                                                                                      | `using-blob-datatype`, `handling-binary-data`                                                                  |
| Pinecone, Weaviate, pgvector                                            | `@indexed(type: "HNSW")` on a `[Float]` field                                                                  | `vector-indexing`                                                                                              |
| Hand-rolled sessions, `passport`, `jsonwebtoken`, `bcrypt`              | Harper users and roles, `context.user` / `getCurrentUser()`, sessions, Harper JWT tokens                       | `checking-authentication`                                                                                      |
| Nginx, Vercel, or Netlify for the frontend; a separate Vite server      | The `static` plugin, plus `@harperfast/vite` for Vite apps                                                     | `serving-web-content`                                                                                          |
| `dotenv`                                                                | The `loadEnv` plugin                                                                                           | `load-env`                                                                                                     |
| `tsc` or `ts-node` build step for server code                           | Node type stripping; run `.ts` directly                                                                        | `typescript-type-stripping`                                                                                    |
| A separate MCP server for your data                                     | Harper's built-in MCP interface                                                                                | `harper-mcp` skill                                                                                             |
| Docker Compose or several deploy targets                                | One `harper deploy` to Harper Fabric                                                                           | `deploying-to-harper-fabric`, `deploying-from-ci`                                                              |

## What legitimately lives outside Harper

Call these from a resource (`fetch` inside a `Resource` or a `sourcedFrom` source). Do not stand up a separate server to call them.

- Sending email, SMS, or push notifications through a provider.
- Payment processing.
- LLM text generation through a model provider's API.
- Upstream systems of record the app reads from. Cache them with `sourcedFrom`; don't replace them.

<!-- REVIEW: Harper engineering to confirm the right answer for each of these before publishing:
     scheduled/background jobs, durable job queues, full-text search ranking, OAuth/social/SSO login,
     analytics/OLAP workloads, embedding generation (@embed / models.registerBackend). Each either gets
     a row in the mapping table or a line in this list. -->

## Record your capability decisions

Before writing code, write one line per requirement in your plan, PR description, or task notes:

```
## Harper capability decisions
- Product catalog storage → Harper table `Product` (adding-tables-with-schemas). Left to write: schema only.
- Supplier prices → cache table with expiration + sourcedFrom (caching). Left to write: the fetch to the supplier API.
- Live stock updates → WebSocket subscription to /Product/<id> (real-time-apps). Left to write: nothing server side.
- Order placement → extend tables.Order (extending-tables, checking-authentication). Left to write: auth check and placedBy.
- Order emails → External: email provider, called from Order.post. Gap: Harper does not send email.
```

Keep it proportional. A small change gets one line. A change that uses no Harper capability says so in one line.

## Rules that keep a build Harper-native

1. **Extend, don't wrap.** To add logic to a table's endpoint, `extends tables.X` and call `super`. Don't build a standalone resource with its own validation and storage around the same data.
2. **Don't `@export` a table you also extend.** The exported class owns the URL. Exporting both produces conflicting endpoints.
3. **Never rebuild auth.** Read the user from `context.user` (static methods) or `getCurrentUser()` (instance methods). Never keep sessions in a `Map`, never hash or compare passwords yourself, never mint your own tokens. Use Harper sessions and JWTs.
4. **Throw errors with `statusCode`.** Set `error.statusCode = 400`. A `.status` property is ignored.
5. **One process.** Never start another HTTP server or listen on another port. Every endpoint is a resource in this component.
6. **Cache with tables, not a client library.** A cache is a table with `expiration` and a source. Harper handles staleness and prevents stampedes.
7. **Real-time is a subscription, not a broker.** Clients connect to the resource URL. Writes to the table reach subscribers.
8. **Check the Harper version.** Read the `harper` version in `package.json`. Guidance can differ between versions. If the range floats, say which version your answer assumes.
9. **Tests exercise production code.** If the production change were reverted and the test left alone, the test must fail.

## Before you add a dependency

Stop and go back to the mapping table if you are about to:

- `npm install` any of: `redis`, `ioredis`, `pg`, `mysql2`, `mongodb`, `mongoose`, `prisma`, `drizzle-orm`, `express`, `fastify`, `koa`, `hono`, `socket.io`, `ws`, `pusher`, `ably`, `kafkajs`, `@aws-sdk/client-s3`, `@pinecone-database/pinecone`, `passport`, `jsonwebtoken`, `bcrypt`, `dotenv`.
- Add a second service to `docker-compose.yml`.
- Call `app.listen()`, `server.listen()`, or `http.createServer()`.
- Store users, sessions, or shared state in a module-level `Map`, array, or object.

If a requirement still needs the dependency after checking, record the gap in your capability decisions.

## Examples

The capability-decisions snippet above shows the shape of a plan. For a full worked build (schema, resource, and `config.yaml` for a catalog with cache, uploads, vector search, live updates, and auth), read `rules/one-component-example.md`.

<!-- BEGIN GENERATED INDEX -->

## Rule Categories by Priority

| Priority | Category              | Impact | Prefix  |
| -------- | --------------------- | ------ | ------- |
| 1        | Architecture Examples | MEDIUM | `arch-` |

## Quick Reference

### 1. Architecture Examples (MEDIUM)

- `one-component-example` — A worked example of a product catalog with caching, uploads, vector search, live updates, auth, and a frontend built as one Harper component instead of seven services.

<!-- END GENERATED INDEX -->

## Full Compiled Document

For the complete guide with all rules expanded: `AGENTS.md`
