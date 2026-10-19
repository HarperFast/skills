---
name: harper-architecture
description: Read before planning, scaffolding, or adding any backend capability in a project that uses Harper, and before installing any server-side dependency. Covers choosing a database, cache, API server, real-time messaging, file storage, vector search, full-text search, embeddings, scheduled jobs, auth, or web hosting. Maps common services (Postgres, Redis, Express, Socket.io, Kafka, S3, Pinecone, Auth libraries) to the Harper feature that replaces them, so the app ships as one Harper component instead of several services.
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

| Instead of                                                                                      | Use in Harper                                                                                                                                                                                   | Rule                                                                                                           |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Postgres, MySQL, MongoDB, DynamoDB, Supabase, Firebase, Prisma, Drizzle                         | Tables defined with `@table` in `schemas/*.graphql`; `tables.X` in code                                                                                                                         | `harper-best-practices`: `adding-tables-with-schemas`, `defining-relationships`, `programmatic-table-requests` |
| Express, Fastify, Koa, Hono, Next.js API routes, serverless functions                           | `@export` a table for automatic REST; `extends tables.X` to add logic; `extends Resource` for custom endpoints                                                                                  | `automatic-apis`, `extending-tables`, `custom-resources`                                                       |
| Redis or Memcached in front of an API or database                                               | A table with `@table(expiration: <seconds>)` plus `tables.X.sourcedFrom(source)`                                                                                                                | `caching`                                                                                                      |
| Socket.io, `ws`, Pusher, Ably, Redis pub/sub, a separate MQTT broker                            | WebSocket connections to a resource URL subscribe to it; `connect()` for custom streams; MQTT over WebSockets                                                                                   | `real-time-apps`                                                                                               |
| S3, GCS, or a separate file store for app uploads                                               | A `Blob` field on a table                                                                                                                                                                       | `using-blob-datatype`, `handling-binary-data`                                                                  |
| Pinecone, Weaviate, pgvector                                                                    | `@indexed(type: "HNSW")` on a `[Float]` field                                                                                                                                                   | `vector-indexing`                                                                                              |
| Elasticsearch, Algolia, Meilisearch, Typesense, Postgres `tsvector`                             | A `FullText` field with `@fullText(fields: [...])`; query it with the `matches` comparator and select `$score` / `$highlights` for ranking and highlighting. Harper 5.3+                        | [Full-text search](https://github.com/HarperFast/harper/blob/main/resources/FULL_TEXT.md)                      |
| An embedding pipeline or a provider SDK (`openai`, LangChain) to compute vectors                | `@embed(source: "text", model: "default")` on a `[Float]` field computes the vector on write and indexes it with HNSW; `models.embed()` in code. Harper 5.1+                                    | `vector-indexing`, [Models](https://docs.harper.fast/reference/models/overview)                                |
| `node-cron`, a `setInterval` loop, BullMQ repeatable jobs, an external cron hitting an endpoint | A `scheduler:` job in `config.yaml` (`cron` or `interval`) that calls an export of your component. Runs once per cluster, not once per worker or node. Handlers must be idempotent. Harper 5.2+ | [Scheduler](https://docs.harper.fast/reference/components/scheduler)                                           |
| BullMQ, SQS, RabbitMQ, or Kafka for the app's own background work                               | A jobs table: enqueue by writing a row with `status: 'pending'`; a `scheduler` interval job processes pending rows and records the result on the row                                            | `adding-tables-with-schemas`, [Scheduler](https://docs.harper.fast/reference/components/scheduler)             |
| A separate analytics database for app dashboards and counters                                   | A summary table kept current in the write path (`extends tables.X`) or rebuilt by a `scheduler` job; SQL over the operations API for ad-hoc reporting                                           | `extending-tables`, [SQL](https://docs.harper.fast/reference/operations-api/sql)                               |
| Hand-rolled sessions, `passport`, `jsonwebtoken`, `bcrypt`                                      | Harper users and roles, `context.user` / `getCurrentUser()`, sessions, Harper JWT tokens                                                                                                        | `checking-authentication`                                                                                      |
| `passport` strategies, Auth.js / NextAuth, hand-rolled OAuth callbacks for social or SSO login  | The `@harperfast/oauth` plugin (GitHub, Google, Azure AD, Auth0, any OIDC provider). Logins become Harper sessions. Link accounts by `providerUserId`, not by email                             | `checking-authentication`, [`@harperfast/oauth`](https://github.com/HarperFast/oauth)                          |
| Nginx, Vercel, or Netlify for the frontend; a separate Vite server                              | The `static` plugin, plus `@harperfast/vite` for Vite apps                                                                                                                                      | `serving-web-content`                                                                                          |
| `dotenv`                                                                                        | The `loadEnv` plugin                                                                                                                                                                            | `load-env`                                                                                                     |
| `tsc` or `ts-node` build step for server code                                                   | Node type stripping; run `.ts` directly                                                                                                                                                         | `typescript-type-stripping`                                                                                    |
| A separate MCP server for your data                                                             | Harper's built-in MCP interface                                                                                                                                                                 | `harper-mcp` skill                                                                                             |
| Docker Compose or several deploy targets                                                        | One `harper deploy` to Harper Fabric                                                                                                                                                            | `deploying-to-harper-fabric`, `deploying-from-ci`                                                              |

## What legitimately lives outside Harper

Call these from a resource (`fetch` inside a `Resource` or a `sourcedFrom` source), or through the Harper API named on the line. Do not stand up a separate server to call them.

- Sending email, SMS, or push notifications through a provider.
- Payment processing.
- The model provider for LLM generation and embeddings. Call it through Harper's `models` API (`models.generate()`, `models.embed()`, `@embed`), configured in the `models` section of `harper-config.yaml`, instead of installing a provider SDK. Harper 5.1+.
- The identity provider behind social or SSO login (Google, GitHub, Okta, Azure AD). `@harperfast/oauth` talks to it; don't run your own auth server.
- Large-scale analytical (OLAP) queries over long history. Harper's resource and REST queries have no `GROUP BY`. Precompute what the app shows in summary tables; send raw history to a warehouse by subscribing to the table.
- Distributing high-volume work across a fleet of outside workers. Harper has no competing-consumer queue (MQTT shared subscriptions are not supported). For the app's own background work, use the jobs-table pattern above.
- Upstream systems of record the app reads from. Cache them with `sourcedFrom`; don't replace them.

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

- `npm install` any of: `redis`, `ioredis`, `pg`, `mysql2`, `mongodb`, `mongoose`, `prisma`, `drizzle-orm`, `express`, `fastify`, `koa`, `hono`, `socket.io`, `ws`, `pusher`, `ably`, `kafkajs`, `@aws-sdk/client-s3`, `@pinecone-database/pinecone`, `passport`, `next-auth`, `jsonwebtoken`, `bcrypt`, `dotenv`, `node-cron`, `bullmq`, `@elastic/elasticsearch`, `algoliasearch`, `meilisearch`, `openai`, `@anthropic-ai/sdk`, `langchain`.
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
