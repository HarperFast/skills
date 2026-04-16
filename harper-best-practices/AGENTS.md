# Harper Best Practices

Guidelines for building scalable, secure, and performant applications on Harper. These practices cover everything from initial schema design to advanced deployment strategies.

---

## Table of Contents

1. [Schema & Data Design](#1-schema--data-design) — **HIGH**
   - 1.1 [Adding Tables with Schemas](#11-adding-tables-with-schemas)
   - 1.2 [Schema Design & Tooling](#12-schema-design--tooling)
   - 1.3 [Defining Relationships](#13-defining-relationships)
   - 1.4 [Vector Indexing](#14-vector-indexing)
   - 1.5 [Using Blobs](#15-using-blobs)
   - 1.6 [Handling Binary Data](#16-handling-binary-data)
2. [API & Communication](#2-api--communication) — **HIGH**
   - 2.1 [Automatic REST APIs](#21-automatic-rest-apis)
   - 2.2 [Querying REST APIs](#22-querying-rest-apis)
   - 2.3 [Real-time Applications](#23-real-time-applications)
   - 2.4 [Checking Authentication](#24-checking-authentication)
3. [Logic & Extension](#3-logic--extension) — **MEDIUM**
   - 3.1 [Custom Resources](#31-custom-resources)
   - 3.2 [Extending Table Resources](#32-extending-table-resources)
   - 3.3 [Programmatic Table Requests](#33-programmatic-table-requests)
   - 3.4 [TypeScript Type Stripping](#34-typescript-type-stripping)
   - 3.5 [Caching](#35-caching)
4. [Infrastructure & Ops](#4-infrastructure--ops) — **MEDIUM**
   - 4.1 [Creating Harper Applications](#41-creating-harper-applications)
   - 4.2 [Creating a Fabric Account and Cluster](#42-creating-a-fabric-account-and-cluster)
   - 4.3 [Deploying to Harper Fabric](#43-deploying-to-harper-fabric)
   - 4.4 [Serving Web Content](#44-serving-web-content)

---

## 1. Schema & Data Design

**Impact: HIGH**

### 1.1 Adding Tables with Schemas

Instructions for the agent to follow when adding tables to a Harper database.

#### When to Use

Use this skill when you need to define new data structures or modify existing ones in a Harper database.

#### How It Works

1. **Create Dedicated Schema Files**: Prefer having a dedicated schema `.graphql` file for each table. Check the `config.yaml` file under `graphqlSchema.files` to see how it's configured. It typically accepts wildcards (e.g., `schemas/*.graphql`), but may be configured to point at a single file.
2. **Use Directives**: All available directives for defining your schema are defined in `node_modules/harperdb/schema.graphql`. Common directives include `@table`, `@export`, `@primaryKey`, `@indexed`, and `@relationship`.
3. **Define Relationships**: Link tables together using the `@relationship` directive.
4. **Enable Automatic APIs**: If you add `@table @export` to a schema type, Harper automatically sets up REST and WebSocket APIs for basic CRUD operations against that table.
5. **Consider Table Extensions**: If you are going to extend the table in your resources, then do not `@export` the table from the schema.

#### Example

```graphql
type ExamplePerson @table @export {
	id: ID @primaryKey
	name: String
	tag: String @indexed
}
```

### 1.2 Schema Design & Tooling

Harper uses GraphQL schemas to define database tables, relationships, and APIs. To ensure the best development experience for both humans and AI agents, it's important to understand the core directives and configure your project tooling correctly.

#### Core Harper Directives

Harper extends GraphQL with custom directives that define database behavior. These are typically defined in `node_modules/harperdb/schema.graphql`. If you don't have access to that file, here is a reference of the most important ones:

##### Table Definition
- `@table`: Marks a GraphQL type as a Harper database table.
- `@export`: Automatically generates REST and WebSocket APIs for the table.
- `@table(expiration: Int)`: Configures a time-to-expire for records in the table (useful for caching).

##### Attribute Constraints & Indexing
- `@primaryKey`: Specifies the unique identifier for the table.
- `@indexed`: Creates a standard index on the field for faster lookups.
- `@indexed(type: "HNSW", distance: "cosine" | "euclidean" | "dot")`: Creates a vector index for similarity search.

##### Relationships
- `@relationship(from: String)`: Defines a relationship to another table. `from` specifies the local field holding the foreign key.

##### Authentication & Authorization
- `@auth(role: String)`: Restricts access to a table or field based on user roles.

#### Configuring GraphQL Tooling

To get the best IDE support (autocompletion, validation) and to help AI agents understand your schema context, you should create a `graphql.config.yml` file in your project root.

This file tells GraphQL tools where to find Harper's built-in types and directives alongside your own schema files.

##### Creating `graphql.config.yml`

Create a file named `graphql.config.yml` in your project root with the following content:

```yaml
schema:
  - "node_modules/harperdb/schema.graphql"
  - "schema.graphql"
  - "schemas/*.graphql"
```

##### Why this is important:
1. **Shared Directives**: It includes `@table`, `@primaryKey`, etc., so they aren't marked as "unknown directives".
2. **Context for Agents**: When an agent reads your project, seeing this config helps it locate the core Harper definitions, leading to more accurate code generation.
3. **Consistency**: The `npm create harper@latest` command includes this by default. Manually adding it to existing projects ensures they follow the same standards.

#### Example Project Structure

A typical Harper project with proper schema tooling:

```text
my-harper-app/
├── config.yaml
├── graphql.config.yml
├── package.json
├── schema.graphql
└── resources.js
```

### 1.3 Defining Relationships

Using the `@relationship` directive to link tables.

#### When to Use

Use this when you have two or more tables that need to be logically linked (e.g., a "Product" table and a "Category" table).

#### How It Works

1. **Identify the Relationship Type**: Determine if it's one-to-one, many-to-one, or one-to-many.
2. **Apply the `@relationship` Directive**: In your GraphQL schema, use the `@relationship` directive on the field that links to another table.
   - **Many-to-One (Current table holds FK)**: Use `from`.
     ```graphql
     type Book @table @export {
     	authorId: ID
     	author: Author @relationship(from: "authorId")
     }
     ```
   - **One-to-Many (Related table holds FK)**: Use `to` and an array type.
     ```graphql
     type Author @table @export {
     	books: [Book] @relationship(to: "authorId")
     }
     ```
3. **Query with Relationships**: Use dot syntax in REST API calls for filtering or the `select()` operator for including related data.

#### Example

```graphql
type Product @table @export {
	id: ID @primaryKey
	name: String
	categoryId: ID
	category: Category @relationship(from: "categoryId")
}

type Category @table @export {
	id: ID @primaryKey
	name: String
	products: [Product] @relationship(to: "categoryId")
}
```

### 1.4 Vector Indexing

How to define and use vector indexes for efficient similarity search.

#### When to Use

Use this when you need to perform similarity searches on high-dimensional data, such as image embeddings, text embeddings, or any other numeric vectors.

#### How It Works

1. **Define the Vector Field**: In your GraphQL schema, define a field with a list of floats (e.g., `[Float]`).
2. **Apply the `@indexed` Directive**: Use the `@indexed` directive on the vector field and specify the index type as `HNSW`.
3. **Configure the Index (Optional)**: You can provide additional configuration for the vector index, such as the distance metric (e.g., `cosine`, `euclidean`).
4. **Querying**: Use the `vector` operator in your REST or programmatic requests to perform similarity searches.

#### Example

```graphql
type Document @table @export {
	id: ID @primaryKey
	content: String
	embedding: [Float] @indexed(type: "HNSW")
}
```

### 1.5 Using Blobs

How to store and retrieve large data in Harper.

#### When to Use

Use this when you need to store large, unstructured data such as files, images, or large text documents that exceed the typical size of a standard database field.

#### How It Works

1. **Define the Blob Field**: Use the `Blob` scalar type in your GraphQL schema.
2. **Storing Data**: Send the data as a buffer or a stream when creating or updating a record.
3. **Retrieving Data**: Access the blob field, which will return the data as a stream or buffer.

### 1.6 Handling Binary Data

How to store and serve binary data like images or MP3s.

#### When to Use

Use this when your application needs to handle binary files, particularly for storage and retrieval.

#### How It Works

1. **Use the `Blob` type**: As with general large data, the `Blob` type is best for binary files. Ensure you store and retrieve the appropriate MIME type (e.g., `image/jpeg`, `audio/mpeg`) for the data.
2. **Streaming**: For large files, use streaming to minimize memory usage during upload and download.
3. **MIME Types**: Store the MIME type alongside the binary data to ensure it is served correctly by your application logic.

---

## 2. API & Communication

**Impact: HIGH**

### 2.1 Automatic REST APIs

Details on the CRUD endpoints automatically generated for exported tables.

#### Endpoints

- `GET /{TableName}`: Describes the schema.
- `GET /{TableName}/`: Lists records (supports filtering/sorting).
- `GET /{TableName}/{id}`: Gets a record by ID.
- `POST /{TableName}/`: Creates a record.
- `PUT /{TableName}/{id}`: Updates a record.
- `PATCH /{TableName}/{id}`: Partial update.
- `DELETE /{TableName}/`: Deletes records.
- `DELETE /{TableName}/{id}`: Deletes by ID.

### 2.2 Querying REST APIs

How to use filters, operators, sorting, and pagination in REST requests.

#### Query Parameters

- `limit`: Number of records to return.
- `offset`: Number of records to skip.
- `sort`: Field to sort by.
- `order`: `asc` or `desc`.
- `filter`: JSON object for filtering.

### 2.3 Real-time Applications

Implementing WebSockets and Pub/Sub for live data updates.

#### When to Use

Use this for applications that require live updates, such as chat apps, live dashboards, or collaborative tools.

#### How It Works

1. **WebSocket Connection**: Connect to the Harper WebSocket endpoint. Use `wss://` for secure connections over HTTPS, or `ws://` for local development.
2. **Subscribing**: Subscribe to table updates or specific records.
3. **Pub/Sub**: Use the internal bus to publish and subscribe to custom events.

### 2.4 Checking Authentication

How to use sessions to verify user identity and roles.

#### When to Use

Use this to secure your application by ensuring that only authorized users can access certain resources or perform specific actions.

#### How It Works

1. **Session Handling**: Access the session object from the request context.
2. **Identity Verification**: Check for the presence of a user ID or token.
3. **Role Checks**: Verify if the user has the required roles for the action.

---

## 3. Logic & Extension

**Impact: MEDIUM**

### 3.1 Custom Resources

How to define custom REST endpoints using JavaScript or TypeScript.

#### How It Works

1. **Create Resource File**: Define your logic in a JS or TS file.
2. **Export Handlers**: Export functions like `GET`, `POST`, etc.
3. **Registration**: Ensure the resource is correctly registered in your application configuration.

### 3.2 Extending Table Resources

Adding custom logic to automatically generated table resources.

#### How It Works

1. **Define Extension**: Create a resource file that targets an existing table.
2. **Intercept Requests**: Use handlers to add custom validation or data transformation.
3. **No `@export`**: If extending, remember not to `@export` the table in the schema.

### 3.3 Programmatic Table Requests

How to use filters, operators, sorting, and pagination in programmatic table requests.

#### Usage

When writing custom resources, use the internal API to query tables with full support for advanced filtering and sorting.

### 3.4 TypeScript Type Stripping

Using TypeScript directly without build tools via Node.js Type Stripping.

#### Configuration

Harper supports native TypeScript type stripping, allowing you to run `.ts` files directly. Ensure your environment is configured to take advantage of this for faster development cycles.

### 3.5 Caching

How caching is defined and implemented in Harper applications.

#### Strategies

- **In-memory**: For fast access to frequently used data.
- **Distributed**: For scaling across multiple nodes in Harper Fabric.

---

## 4. Infrastructure & Ops

**Impact: MEDIUM**

### 4.1 Creating Harper Applications

The fastest way to start a new Harper project is using the `create-harper` CLI tool. This command initializes a project with a standard folder structure, essential configuration files, and basic schema definitions.

#### When to Use

Use this command when starting a new Harper application or adding a new Harper microservice to an existing architecture.

#### Commands

Initialize a project using your preferred package manager:

**NPM**

```bash
npm create harper@latest
```

**PNPM**

```bash
pnpm create harper@latest
```

**Bun**

```bash
bun create harper@latest
```

### 4.2 Creating a Fabric Account and Cluster

Follow these steps to set up your Harper Fabric environment for deployment.

#### How It Works

1. **Sign Up/In**: Go to [https://fabric.harper.fast/](https://fabric.harper.fast/) and sign up or sign in.
2. **Create an Organization**: Create an organization (org) to manage your projects.
3. **Create a Cluster**: Create a new cluster. This can be on the free tier, no credit card required.
4. **Set Credentials**: During setup, set the cluster username and password to finish configuring it.
5. **Get Application URL**: Navigate to the **Config** tab and copy the **Application URL**.
6. **Configure Environment**: Update your `.env` file or GitHub Actions secrets with these cluster-specific credentials:
   ```bash
   CLI_TARGET_USERNAME='YOUR_CLUSTER_USERNAME'
   CLI_TARGET_PASSWORD='YOUR_CLUSTER_PASSWORD'
   CLI_TARGET='YOUR_CLUSTER_URL'
   ```

### 4.3 Deploying to Harper Fabric

Globally scaling your Harper application.

#### Benefits

- **Global Distribution**: Low latency for users everywhere.
- **Automatic Sync**: Data is synced across the fabric automatically.
- **Free Tier**: Start for free and scale as you grow.

#### How It Works

1. **Sign up**: Follow the [Creating a Fabric Account and Cluster](#42-creating-a-fabric-account-and-cluster) steps to create a Harper Fabric account, organization, and cluster.
2. **Configure Environment**: Add your cluster credentials and cluster application URL to `.env`:
   ```bash
   CLI_TARGET_USERNAME='YOUR_CLUSTER_USERNAME'
   CLI_TARGET_PASSWORD='YOUR_CLUSTER_PASSWORD'
   CLI_TARGET='YOUR_CLUSTER_URL'
   ```
3. **Deploy From Local Environment**: Run `npm run deploy`.
4. **Set up CI/CD**: Configure `.github/workflows/deploy.yaml` and set repository secrets for automated deployments.

#### Manual Setup for Existing Apps

If your application was not created with `npm create harper`, you'll need to manually configure the deployment scripts and CI/CD workflow.

#### 1. Update `package.json`

Add the following scripts and dependencies to your `package.json`:

```json
{
	"scripts": {
		"deploy": "dotenv -- npm run deploy:component",
		"deploy:component": "harperdb deploy_component . restart=rolling replicated=true"
	},
	"devDependencies": {
		"dotenv-cli": "^11.0.0",
		"harperdb": "^4.7.20"
	}
}
```

#### Why split the scripts?

The `deploy` script is separated from `deploy:component` to ensure environment variables from your `.env` file are properly loaded and passed to the Harper CLI.

- `deploy`: Uses `dotenv-cli` to load environment variables (like `CLI_TARGET`, `CLI_TARGET_USERNAME`, and `CLI_TARGET_PASSWORD`) before executing the next command.
- `deploy:component`: The actual command that performs the deployment.

By using `dotenv -- npm run deploy:component`, the environment variables are correctly set in the shell session before `harperdb deploy_component` is called, allowing it to authenticate with your cluster.

#### 2. Configure GitHub Actions

Create a `.github/workflows/deploy.yaml` file with the following content:

```yaml
name: Deploy to Harper Fabric
on:
  workflow_dispatch:
#  push:
#    branches:
#      - main
concurrency:
  group: main
  cancel-in-progress: false
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          cache: 'npm'
          node-version: '20'
      - name: Install dependencies
        run: npm ci
      - name: Run unit tests
        run: npm test
      - name: Run lint
        run: npm run lint
      - name: Deploy
        run: npm run deploy
        env:
          CLI_TARGET: ${{ secrets.CLI_TARGET }}
          CLI_TARGET_USERNAME: ${{ secrets.CLI_TARGET_USERNAME }}
          CLI_TARGET_PASSWORD: ${{ secrets.CLI_TARGET_PASSWORD }}
```

Be sure to set the following repository secrets in your GitHub repository:

- `CLI_TARGET`
- `CLI_TARGET_USERNAME`
- `CLI_TARGET_PASSWORD`

### 4.4 Serving Web Content

Two ways to serve web content from a Harper application.

#### Methods

1. **Static Serving**: Serve HTML, CSS, and JS files directly. If using the Vite plugin for development, ensure Harper is running (e.g., `harperdb run .`) to allow for Hot Module Replacement (HMR).
2. **Dynamic Rendering**: Use custom resources to render content on the fly.
