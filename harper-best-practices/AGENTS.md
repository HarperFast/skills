# Harper Best Practices

Guidelines for building scalable, secure, and performant applications on Harper. These practices cover everything from initial schema design to advanced deployment strategies.

## 1. Schema & Data Design

### 1.1 Adding Tables with Schemas

Instructions for the agent to follow when adding tables to a Harper database.

#### When to Use

Use this skill when you need to define new data structures or modify existing ones in a Harper database.

#### How It Works

1. **Create Dedicated Schema Files**: Prefer having a dedicated schema `.graphql` file for each table. Check the `config.yaml` file under `graphqlSchema.files` to see how it's configured. It typically accepts wildcards (e.g., `schemas/*.graphql`), but may be configured to point at a single file.
2. **Use Directives**: All available directives for defining your schema are defined in `node_modules/harper/schema.graphql`. Common directives include `@table`, `@export`, `@primaryKey`, `@indexed`, and `@relationship`.
3. **Define Relationships**: Link tables together using the `@relationship` directive. For more details, see the [Defining Relationships](defining-relationships.md) skill.
4. **Enable Automatic APIs**: If you add `@table @export` to a schema type, Harper automatically sets up REST and WebSocket APIs for basic CRUD operations against that table. **Important**: REST endpoints also require `rest: true` in `config.yaml` — without it, `@export`ed tables will not respond to HTTP requests. For a detailed list of available endpoints and how to use them, see the [Automatic REST APIs](automatic-apis.md) skill.
   - `GET /{TableName}`: Describes the schema itself.
   - `GET /{TableName}/`: Lists all records (supports filtering, sorting, and pagination via query parameters). See the [Querying REST APIs](querying-rest-apis.md) skill for details.
   - `GET /{TableName}/{id}`: Retrieves a single record by its ID.
   - `POST /{TableName}/`: Creates a new record.
   - `PUT /{TableName}/{id}`: Updates an existing record.
   - `PATCH /{TableName}/{id}`: Performs a partial update on a record.
   - `DELETE /{TableName}/`: Deletes all records or filtered records.
   - `DELETE /{TableName}/{id}`: Deletes a single record by its ID.
5. **Consider Table Extensions**: If you are going to [extend the table](./extending-tables.md) in your resources, then do not `@export` the table from the schema.

#### Examples

In a hypothetical `schemas/ExamplePerson.graphql`:

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

Harper extends GraphQL with custom directives that define database behavior. These are typically defined in `node_modules/harper/schema.graphql`. If you don't have access to that file, here is a reference of the most important ones:

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
  - 'node_modules/harper/schema.graphql'
  - 'schema.graphql'
  - 'schemas/*.graphql'
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

Instructions for the agent to follow when defining relationships between Harper tables.

#### When to Use

Use this skill when you need to link data across different tables, enabling automatic joins and efficient related-data fetching via REST APIs.

#### How It Works

1. **Identify the Relationship Type**: Determine if it's one-to-one, many-to-one, or one-to-many.
2. **Use the `@relationship` Directive**: Apply it to a field in your GraphQL schema.
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
   - Example Filter: `GET /Book/?author.name=Harper`
   - Example Select: `GET /Author/?select(name,books(title))`

### 1.4 Vector Indexing

Instructions for the agent to follow when enabling and querying vector indexes for similarity search in Harper using the HNSW algorithm.

#### When to Use

Apply this rule when adding a vector index to a Harper table schema or writing similarity search queries against high-dimensional vector fields. Use it whenever you need approximate nearest-neighbor search, distance-threshold filtering, or distance-scored results.

#### How It Works

1. **Declare a vector index on a `[Float]` field**: Add `@indexed(type: "HNSW")` to any `[Float]` attribute in a `@table` type. See [adding-tables-with-schemas.md](adding-tables-with-schemas.md) for general schema setup.

   ```graphql
   type Document @table {
   	id: Long @primaryKey
   	textEmbeddings: [Float] @indexed(type: "HNSW")
   }
   ```

2. **Query by nearest neighbors using `sort`**: Call `Document.search()` with a `sort` object specifying `attribute` (the indexed field) and `target` (the query vector). Include `limit` to cap results.

   ```javascript
   let results = Document.search({
   	sort: { attribute: 'textEmbeddings', target: searchVector },
   	limit: 5,
   });
   ```

3. **Combine HNSW with filter conditions**: Add a `conditions` array alongside `sort` to pre-filter records before ranking by similarity.

   ```javascript
   let results = Document.search({
   	conditions: [{ attribute: 'price', comparator: 'lt', value: 50 }],
   	sort: { attribute: 'textEmbeddings', target: searchVector },
   	limit: 5,
   });
   ```

4. **Filter by distance threshold**: Place `target` directly on a condition (alongside `attribute`, `comparator`, and `value`) to return only records whose distance to the target vector is below a threshold. Use this form to bound result quality by a similarity cutoff rather than ranking.

   ```javascript
   let results = Document.search({
   	conditions: {
   		attribute: 'textEmbeddings',
   		comparator: 'lt',
   		value: 0.1,
   		target: searchVector,
   	},
   });
   ```

5. **Include computed distance in results**: Add `'$distance'` to the `select` array to return the computed distance from the target vector alongside each record. `$distance` works in both `sort`-based and `conditions`-based queries.

   ```javascript
   let results = Document.search({
   	select: ['name', '$distance'],
   	sort: { attribute: 'textEmbeddings', target: searchVector },
   	limit: 5,
   });
   ```

6. **Tune HNSW parameters**: Pass additional parameters to `@indexed(type: "HNSW", ...)` to control index quality and performance:

   | Parameter              | Default           | Description                                                                                         |
   | ---------------------- | ----------------- | --------------------------------------------------------------------------------------------------- |
   | `distance`             | `"cosine"`        | Distance function: `"euclidean"` or `"cosine"` (negative cosine similarity)                         |
   | `efConstruction`       | `100`             | Max nodes explored during index construction. Higher = better recall, lower = better performance    |
   | `M`                    | `16`              | Preferred connections per graph layer. Higher = more space, better recall for high-dimensional data |
   | `optimizeRouting`      | `0.5`             | Heuristic aggressiveness for omitting redundant connections (0 = off, 1 = most aggressive)          |
   | `mL`                   | computed from `M` | Normalization factor for level generation                                                           |
   | `efSearchConstruction` | `50`              | Max nodes explored during search                                                                    |

#### Examples

**Schema with custom HNSW parameters:**

```graphql
type Document @table {
	id: Long @primaryKey
	textEmbeddings: [Float]
		@indexed(type: "HNSW", distance: "euclidean", optimizeRouting: 0, efSearchConstruction: 100)
}
```

**Nearest-neighbor search with distance output:**

```javascript
let results = Document.search({
	select: ['name', '$distance'],
	sort: { attribute: 'textEmbeddings', target: searchVector },
	limit: 5,
});
```

**Distance-threshold filter (no ranking):**

```javascript
let results = Document.search({
	conditions: {
		attribute: 'textEmbeddings',
		comparator: 'lt',
		value: 0.1,
		target: searchVector,
	},
});
```

#### Notes

- The default `distance` function is `cosine`. To use Euclidean distance, set `distance: "euclidean"` in the `@indexed` directive.
- `efConstruction` controls index build quality; increase it to improve recall at the cost of slower indexing.
- `$distance` is a special field — prefix it with `$` exactly as shown; it is not a schema attribute.
- `target` is required in both `sort`-based and threshold-based condition queries to identify the reference vector for distance computation.

### 1.5 Using Blob Datatype

Instructions for the agent to follow when working with the Blob data type in Harper.

#### When to Use

Use this skill when you need to store unstructured or large binary data (media, documents) that is too large for standard JSON fields. Blobs provide efficient storage and integrated streaming support.

#### How It Works

1. **Define Blob Fields**: In your GraphQL schema, use the `Blob` type:
   ```graphql
   type MyTable @table {
   	id: ID @primaryKey
   	data: Blob
   }
   ```
2. **Create and Store Blobs**: Use `createBlob()` from Harper's globals to wrap Buffers or Streams:
   ```javascript
   import { tables } from 'harper';
   const blob = createBlob(largeBuffer);
   await tables.MyTable.put('my-id', { data: blob });
   ```
3. **Use Streaming (Optional)**: For very large files, pass a stream to `createBlob()` to avoid loading the entire file into memory.
4. **Read Blob Data**: Retrieve the record and use `.bytes()` or streaming interfaces on the blob field:
   ```javascript
   const record = await tables.MyTable.get('my-id');
   const buffer = await record.data.bytes();
   ```
5. **Ensure Write Completion**: Use `saveBeforeCommit: true` in `createBlob` options if you need the blob fully written before the record is committed.
6. **Handle Errors**: Attach error listeners to the blob object to handle streaming failures.

### 1.6 Handling Binary Data

Instructions for the agent to follow when handling binary data in Harper.

#### When to Use

Use this skill when you need to store binary files (images, audio, etc.) in the database or serve them back to clients via REST endpoints.

#### How It Works

1. **Store Binary Data**: In your resource's `post` or `put` method, convert incoming data to Buffers and then to Blobs using `createBlob` from Harper's globals. Include the MIME type if available:

   ```typescript
   async post(target, record) {
     if (record.data) {
       record.data = createBlob(Buffer.from(record.data, record.encoding || 'base64'), {
         type: record.contentType || 'application/octet-stream',
       });
     }
     return super.post(target, record);
   }
   ```

2. **Serve Binary Data**: In your resource's `get` method, return a response object with the appropriate `Content-Type` and the binary data in the `body`:
   ```typescript
   async get(target) {
    const record = await super.get(target);
    if (record?.data) {
      return {
        status: 200,
        headers: { 'Content-Type': record.data.type || 'application/octet-stream' },
        body: record.data,
      };
    }
    return record;
   }
   ```
3. **Use the Blob Type**: Ensure your GraphQL schema uses the `Blob` scalar for binary fields.

## 2. API & Communication

### 2.1 Automatic APIs

Instructions for the agent to follow when utilizing Harper's automatic APIs.

#### When to Use

Use this skill when you want to interact with Harper tables via REST or WebSockets without writing custom resource logic. This is ideal for basic CRUD operations and real-time updates.

#### How It Works

1. **Enable REST in `config.yaml`**: REST endpoints are **not active by default**. You must explicitly enable them:
   ```yaml
   rest: true
   ```
   Without this, `@export`ed tables will not respond to HTTP requests.
2. **Enable Automatic APIs**: Ensure your GraphQL schema includes the `@export` directive for the table.
3. **Access REST Endpoints**: Use the standard endpoints for your table (Note: Paths are case-sensitive).
4. **Use Automatic WebSockets**: Connect to `wss://your-harper-instance/{TableName}` to receive events whenever updates are made to that table. This is the easiest way to add real-time capabilities. (Use `ws://` for local development without SSL). For more complex needs, see [Real-time Apps](real-time-apps.md).
5. **Apply Filtering and Querying**: Use query parameters with `GET /{TableName}/` and `DELETE /{TableName}/`. See the [Querying REST APIs](querying-rest-apis.md) skill for advanced details.
6. **Customize if Needed**: If the automatic APIs don't meet your requirements, [customize the resources](./custom-resources.md).

#### Examples

##### Schema Configuration

```graphql
type MyTable @table @export {
	id: ID @primaryKey
	name: String
}
```

##### Common REST Operations

- **List Records**: `GET /MyTable/`
- **Create Record**: `POST /MyTable/`
- **Update Record**: `PATCH /MyTable/{id}`

### 2.2 Querying REST APIs

Instructions for the agent to follow when querying Harper's REST APIs.

#### When to Use

Use this skill when you need to perform advanced data retrieval (filtering, sorting, pagination, joins) using Harper's automatic REST endpoints.

#### How It Works

1. **Basic Filtering**: Use attribute names as query parameters: `GET /Table/?key=value`.
2. **Use Comparison Operators**: Append operators like `gt`, `ge`, `lt`, `le`, `ne` using FIQL-style syntax: `GET /Table/?price=gt=100`.
3. **Apply Logic and Grouping**: Use `&` for AND, `|` for OR, and `()` for grouping: `GET /Table/?(rating=5|featured=true)&price=lt=50`.
4. **Select Specific Fields**: Use `select()` to limit returned attributes: `GET /Table/?select(name,price)`.
5. **Paginate Results**: Use `limit(count)` or `limit(offset, count)` to set the number of records to return and skip.
   - Example (first 10): `GET /Table/?limit(10)`
   - Example (skip 20, return 10): `GET /Table/?limit(20, 10)`
6. **Sort Results**: Use `sort()` with `+` (asc) or `-` (desc) before the field name. Avoid `sort=field` format.
   - Example (asc): `GET /Table/?sort(+name)`
   - Example (desc): `GET /Table/?sort(-price)`
   - Example (combined): `GET /Table/?sort(-price,+name)`
7. **Query Relationships**: Use dot syntax for tables linked with `@relationship`: `GET /Book/?author.name=Harper`.

### 2.3 Real-time Applications

Instructions for the agent to follow when building real-time applications in Harper.

#### When to Use

Use this skill when you need to stream live updates to clients, implement chat features, or provide real-time data synchronization between the database and a frontend.

#### How It Works

1. **Check Automatic WebSockets**: If you only need to stream table changes, use [Automatic APIs](automatic-apis.md) which provide a WebSocket endpoint for every `@export`ed table.
2. **Implement `connect` in a Resource**: For custom bi-directional logic, implement the `connect` method.
3. **Use Pub/Sub**: Use `tables.TableName.subscribe(query)` to listen for specific data changes and stream them to the client.
4. **Handle SSE**: Ensure your `connect` method gracefully handles cases where `incomingMessages` is null (Server-Sent Events).
5. **Connect from Client**: Use standard WebSockets (`new WebSocket('wss://...')`) to connect to your resource endpoint. Ensure you use the appropriate scheme (`ws://` for HTTP, `wss://` for HTTPS).

#### Examples

##### Bi-directional WebSocket Resource

```typescript
import { Resource, tables } from 'harper';

export class MySocket extends Resource {
	async *connect(target, incomingMessages) {
		// Subscribe to table changes
		const subscription = await tables.MyTable.subscribe(target);
		if (!incomingMessages) {
			return subscription; // SSE mode
		}

		// Handle incoming client messages
		for await (let message of incomingMessages) {
			yield { received: message };
		}
	}
}
```

### 2.4 Checking Authentication

Instructions for the agent to follow when handling authentication and sessions.

#### When to Use

Use this skill when you need to implement sign-in/sign-out functionality, protect specific resource endpoints, or identify the currently logged-in user in a Harper application.

#### How It Works

1. **Configure Harper for Sessions**: Ensure `harper-config.yaml` has sessions enabled and local auto-authorization disabled for testing:
   ```yaml
   authentication:
     authorizeLocal: false
     enableSessions: true
   ```
2. **Implement Sign In**: Use `this.getContext().login(username, password)` to create a session:
   ```typescript
   async post(_target, data) {
    const context = this.getContext();
    try {
      await context.login(data.username, data.password);
    } catch {
      return new Response('Invalid credentials', { status: 403 });
    }
    return new Response('Logged in', { status: 200 });
   }
   ```
3. **Identify Current User**: Use `this.getCurrentUser()` to access session data:
   ```typescript
   async get() {
     const user = this.getCurrentUser?.();
     if (!user) return new Response(null, { status: 401 });
     return { username: user.username, role: user.role };
   }
   ```
4. **Implement Sign Out**: Use `this.getContext().logout()` or delete the session from context:
   ```typescript
   async post() {
     const context = this.getContext();
     await context.session?.delete?.(context.session.id);
     return new Response('Logged out', { status: 200 });
   }
   ```
5. **Protect Routes**: In your Resource, use `allowRead()`, `allowUpdate()`, etc., to enforce authorization logic based on `this.getCurrentUser()`. For privileged actions, verify `user.role.permission.super_user`.

#### Examples

##### Sign In Implementation

```typescript
async post(_target, data) {
  const context = this.getContext();
  try {
    await context.login(data.username, data.password);
  } catch {
    return new Response('Invalid credentials', { status: 403 });
  }
  return new Response('Logged in', { status: 200 });
}
```

##### Identify Current User

```typescript
async get() {
  const user = this.getCurrentUser?.();
  if (!user) return new Response(null, { status: 401 });
  return { username: user.username, role: user.role };
}
```

##### Sign Out Implementation

```typescript
async post() {
  const context = this.getContext();
  await context.session?.delete?.(context.session.id);
  return new Response('Logged out', { status: 200 });
}
```

#### Status code conventions used here

- 200: Successful operation. For `GET /me`, a `200` with empty body means “not signed in”.
- 400: Missing required fields (e.g., username/password on sign-in).
- 401: No current session for an action that requires one (e.g., sign out when not signed in).
- 403: Authenticated but not authorized (bad credentials on login attempt, or insufficient privileges).

#### Client considerations

- Sessions are cookie-based; the server handles setting and reading the cookie via Harper. If you make cross-origin requests, ensure the appropriate `credentials` mode and CORS settings.
- If developing locally, double-check the server config still has `authentication.authorizeLocal: false` to avoid accidental superuser bypass.

#### Token-based auth (JWT + refresh token) for non-browser clients

Cookie-backed sessions are great for browser flows. For CLI tools, mobile apps, or other non-browser clients, it’s often easier to use **explicit tokens**:

- **JWT (`operation_token`)**: short-lived bearer token used to authorize API requests.
- **Refresh token (`refresh_token`)**: longer-lived token used to mint a new JWT when it expires.

This project includes two Resource patterns for that flow:

##### Issuing tokens: `IssueTokens`

**Description / use case:** Generate `{ refreshToken, jwt }` either:

- with an existing Authorization token (either Basic Auth or a JWT) and you want to issue new tokens, or
- from an explicit `{ username, password }` payload (useful for direct “login” from a CLI/mobile client).

```javascript
export class IssueTokens extends Resource {
	static loadAsInstance = false;

	async get(target) {
		const { refresh_token: refreshToken, operation_token: jwt } =
			await databases.system.hdb_user.operation(
				{ operation: 'create_authentication_tokens' },
				this.getContext(),
			);
		return { refreshToken, jwt };
	}

	async post(target, data) {
		if (!data.username || !data.password) {
			throw new Error('username and password are required');
		}

		const { refresh_token: refreshToken, operation_token: jwt } =
			await databases.system.hdb_user.operation({
				operation: 'create_authentication_tokens',
				username: data.username,
				password: data.password,
			});
		return { refreshToken, jwt };
	}
}
```

**Recommended documentation notes to include:**

- `GET` variant: intended for “I already have an Authorization token, give me new tokens”.
- `POST` variant: intended for “I have credentials, give me tokens”.
- Response shape:
  - `refreshToken`: store securely (long-lived).
  - `jwt`: attach to requests (short-lived).

##### Refreshing a JWT: `RefreshJWT`

**Description / use case:** When the JWT expires, the client uses the refresh token to get a new JWT without re-supplying username/password.

```javascript
export class RefreshJWT extends Resource {
	static loadAsInstance = false;

	async post(target, data) {
		if (!data.refreshToken) {
			throw new Error('refreshToken is required');
		}

		const { operation_token: jwt } = await databases.system.hdb_user.operation({
			operation: 'refresh_operation_token',
			refresh_token: data.refreshToken,
		});
		return { jwt };
	}
}
```

**Recommended documentation notes to include:**

- Requires `refreshToken` in the request body.
- Returns a new `{ jwt }`.
- If refresh fails (expired/revoked), client must re-authenticate (e.g., call `IssueTokens.post` again).

##### Suggested client flow (high-level)

1. **Sign in (token flow)**
   - POST /IssueTokens/ with a body of `{ "username": "your username", "password": "your password" }` or GET /IssueTokens/ with an existing Authorization token.
   - Receive `{ jwt, refreshToken }` in the response
2. **Call protected APIs**
   - Send the JWT with each request in the Authorization header (as your auth mechanism expects)
3. **JWT expires**
   - POST /RefreshJWT/ with a body of `{ "refreshToken": "your refresh token" }`.
   - Receive `{ jwt }` in the response and continue

#### Quick checklist

- [ ] Public endpoints explicitly `allowRead`/`allowCreate` as needed.
- [ ] Sign-in uses `context.login` and handles 400/403 correctly.
- [ ] Protected routes call `ensureSuperUser(this.getCurrentUser())` (or another role check) before doing work.
- [ ] Sign-out verifies a session and deletes it.
- [ ] `authentication.authorizeLocal` is `false` and `enableSessions` is `true` in Harper config.
- [ ] If using tokens: `IssueTokens` issues `{ jwt, refreshToken }`, `RefreshJWT` refreshes `{ jwt }` with a `refreshToken`.

## 3. Logic & Extension

### 3.1 Custom Resources

Instructions for the agent to follow when creating custom resources in Harper.

#### When to Use

Use this skill when the automatic CRUD operations provided by `@table @export` are insufficient, and you need custom logic, third-party API integration, or specialized data handling for your REST endpoints.

#### How It Works

1. **Check if a Custom Resource is Necessary**: Verify if [Automatic APIs](./automatic-apis.md) or [Extending Tables](./extending-tables.md) can satisfy the requirement first.
2. **Create the Resource File**: Create a `.ts` or `.js` file in the directory specified by `jsResource` in `config.yaml` (typically `resources/`).
3. **Define the Resource Class**: Export a class extending `Resource` from `harper`:

   ```typescript
   import { type RequestTargetOrId, Resource } from 'harper';

   export class MyResource extends Resource {
   	async get(target?: RequestTargetOrId) {
   		return { message: 'Hello from custom GET!' };
   	}
   }
   ```

4. **Implement HTTP Methods**: Add methods like `get`, `post`, `put`, `patch`, or `delete` to handle corresponding requests.
5. **Route Nesting and Naming**: You can control the URL structure by how you export your resources:
   - **Direct Class Export**: `export class Foo extends Resource` creates endpoints at `/Foo/`. Class names are case-sensitive in the URL.
   - **Nested Objects**: `export const Bar = { Foo };` creates endpoints at `/Bar/Foo/`.
   - **Lowercase and Hyphens**: Use object keys to define custom paths: `export const bar = { 'foo-baz': Foo };` exposes endpoints at `/bar/foo-baz/`.
6. **Access Tables (Optional)**: Import and use the `tables` object to interact with your data:
   ```typescript
   import { tables } from 'harper';
   // ... inside a method
   const results = await tables.MyTable.list();
   ```
7. **Configure Loading**: Ensure `config.yaml` points to your resource files (e.g., `jsResource: { files: 'resources/*.ts' }`).

### 3.2 Extending Tables

Instructions for the agent to follow when extending table resources in Harper.

#### When to Use

Use this skill when you need to add custom validation, side effects (like webhooks), data transformation, or custom access control to the standard CRUD operations of a Harper table.

#### How It Works

1. **Define the Table in GraphQL**: In your `.graphql` schema, define the table using the `@table` directive. **Do not** use `@export` if you plan to extend it.
   ```graphql
   type MyTable @table {
   	id: ID @primaryKey
   	name: String
   }
   ```
2. **Create the Extension File**: Create a `.ts` file in your `resources/` directory.
3. **Extend the Table Resource**: Export a class that extends `tables.YourTableName`:

   ```typescript
   import { type RequestTargetOrId, tables } from 'harper';

   export class MyTable extends tables.MyTable {
   	async post(target: RequestTargetOrId, record: any) {
   		// Custom logic here
   		if (!record.name) {
   			throw new Error('Name required');
   		}
   		return super.post(target, record);
   	}
   }
   ```

4. **Override Methods**: Override `get`, `post`, `put`, `patch`, or `delete` as needed. Always call `super[method]` to maintain default Harper functionality unless you intend to replace it entirely.
5. **Implement Logic**: Use overrides for validation, side effects, or transforming data before/after database operations.

### 3.3 Programmatic Table Requests

Instructions for the agent to follow when interacting with Harper tables via code.

#### When to Use

Use this skill when you need to perform database operations (CRUD, search, subscribe) from within Harper Resources or scripts.

#### How It Works

1. **Access the Table**: Use the global `tables` object followed by your table name (e.g., `tables.MyTable`).
2. **Perform CRUD Operations**:
   - **Get**: `await tables.MyTable.get(id)` for a single record or `await tables.MyTable.get({ conditions: [...] })` for multiple.
   - **Create**: `await tables.MyTable.post(record)` (auto-generates ID) or `await tables.MyTable.put(id, record)`.
   - **Update**: `await tables.MyTable.patch(id, partialRecord)` for partial updates.
   - **Delete**: `await tables.MyTable.delete(id)`.
3. **Use Updatable Records for Atomic Ops**: Call `update(id)` to get a reference, then use `addTo` or `subtractFrom` for atomic increments/decrements:
   ```typescript
   const stats = await tables.Stats.update('daily');
   stats.addTo('viewCount', 1);
   ```
4. **Search and Stream**: Use `search(query)` for efficient streaming of large result sets:
   ```typescript
   for await (const record of tables.MyTable.search({ conditions: [...] })) {
     // process record
   }
   ```
   See the [Query Conditions](#query-conditions) section below for the full query object reference.
5. **Real-time Subscriptions**: Use `subscribe(query)` to listen for changes:
   ```typescript
   for await (const event of tables.MyTable.subscribe(query)) {
   	// handle event
   }
   ```
6. **Publish Events**: Use `publish(id, message)` to trigger subscriptions without necessarily persisting data.

#### Query Conditions

When passing a query to `search()`, `get()`, or `subscribe()`, use a query object with a `conditions` array.

##### Condition Object Shape

| Property     | Description                                                                                |
| ------------ | ------------------------------------------------------------------------------------------ |
| `attribute`  | Field name, or array of field names to traverse a relationship (e.g., `['brand', 'name']`) |
| `value`      | The value to compare against                                                               |
| `comparator` | One of the comparator strings below (default: `equals`)                                    |
| `operator`   | `and` (default) or `or` — applies to a nested `conditions` block                           |
| `conditions` | Nested array of condition objects for complex AND/OR logic                                 |

##### Comparator Values

Use these exact strings — incorrect comparator names will silently fail or error:

| Comparator           | Meaning                                                    |
| -------------------- | ---------------------------------------------------------- |
| `equals`             | Exact match (default)                                      |
| `not_equal`          | Not equal                                                  |
| `greater_than`       | `>`                                                        |
| `greater_than_equal` | `>=`                                                       |
| `less_than`          | `<`                                                        |
| `less_than_equal`    | `<=`                                                       |
| `starts_with`        | String starts with value                                   |
| `contains`           | String contains value                                      |
| `ends_with`          | String ends with value                                     |
| `between`            | Value is between two bounds (pass `value` as `[min, max]`) |

##### Query Object Parameters

| Property     | Description                                                                          |
| ------------ | ------------------------------------------------------------------------------------ |
| `conditions` | Array of condition objects                                                           |
| `limit`      | Maximum number of records to return                                                  |
| `offset`     | Number of records to skip (for pagination)                                           |
| `select`     | Array of attribute names to return; supports `$id` and `$updatedtime`                |
| `sort`       | Object with `attribute`, `descending` (bool), and optional `next` for secondary sort |

##### Examples

**Simple filter:**

```javascript
for await (const record of tables.Product.search({
  conditions: [{ attribute: 'price', comparator: 'less_than', value: 100 }],
  limit: 20,
})) { ... }
```

**AND + nested OR:**

```javascript
for await (const record of tables.Product.search({
  conditions: [
    { attribute: 'price', comparator: 'less_than', value: 100 },
    {
      operator: 'or',
      conditions: [
        { attribute: 'rating', comparator: 'greater_than', value: 4 },
        { attribute: 'featured', value: true },
      ],
    },
  ],
})) { ... }
```

**Relationship traversal:**

```javascript
for await (const record of tables.Book.search({
  conditions: [{ attribute: ['brand', 'name'], comparator: 'equals', value: 'Harper' }],
})) { ... }
```

**Sort and paginate:**

```javascript
for await (const record of tables.Product.search({
  conditions: [{ attribute: 'inStock', value: true }],
  sort: { attribute: 'price', descending: false },
  limit: 10,
  offset: 20,
})) { ... }
```

#### Cautions

Be very careful when performing updates and deletions! You may be dealing with live production data. The wrong request to delete, without approval from a human, could be devastating to a business. Always use the proper approval process.

### 3.4 TypeScript Type Stripping

Instructions for the agent to follow when using TypeScript in Harper.

#### When to Use

Use this skill when you want to write Harper Resources in TypeScript and have them execute directly in Node.js without an intermediate build or compilation step.

#### How It Works

1. **Verify Node.js Version**: Ensure you are using Node.js v22.6.0 or higher.
2. **Name Files with `.ts`**: Create your resource files in the `resources/` directory with a `.ts` extension.
3. **Use TypeScript Syntax**: Write your resource classes using standard TypeScript (interfaces, types, etc.).
   ```typescript
   import { Resource } from 'harper';
   export class MyResource extends Resource {
   	async get(): Promise<{ message: string }> {
   		return { message: 'Running TS directly!' };
   	}
   }
   ```
4. **Use Explicit Extensions in Imports**: When importing other local modules, include the `.ts` extension: `import { helper } from './helper.ts'`.
5. **Configure `config.yaml`**: Ensure `jsResource` points to your `.ts` files:
   ```yaml
   jsResource:
     files: 'resources/*.ts'
   ```

### 3.5 Caching

Instructions for the agent to follow when implementing caching in Harper.

#### When to Use

Use this skill when you need high-performance, low-latency storage for data from external sources. It's ideal for reducing API calls to third-party services, preventing cache stampedes, and making external data queryable as if it were native Harper tables.

#### How It Works

1. **Configure a Cache Table**: Define a table in your `schema.graphql` with an `expiration` (in seconds).
2. **Define an External Source**: Create a Resource class that fetches the data from your source.
3. **Attach Source to Table**: Use `sourcedFrom` to link your resource to the table.
4. **Implement Active Caching (Optional)**: Use `subscribe()` for proactive updates. See [Real-Time Apps](real-time-apps.md).
5. **Implement Write-Through Caching (Optional)**: Define `put` or `post` in your resource to propagate updates upstream.

#### Examples

##### Schema Configuration

```graphql
type MyCache @table(expiration: 3600) @export {
	id: ID @primaryKey
}
```

##### Resource Implementation

```js
import { Resource, tables } from 'harper';

export class ThirdPartyAPI extends Resource {
	async get() {
		const id = this.getId();
		const response = await fetch(`https://api.example.com/items/${id}`);
		if (!response.ok) {
			throw new Error('Source fetch failed');
		}
		return await response.json();
	}
}

// Attach source to table
tables.MyCache.sourcedFrom(ThirdPartyAPI);
```

## 4. Infrastructure & Ops

### 4.1 Deploying to Harper Fabric

Instructions for the agent to follow when deploying to Harper Fabric.

#### When to Use

Use this skill when you are ready to move your Harper application from local development to a cloud-hosted environment.

#### How It Works

1. **Sign up**: Follow the [creating-a-fabric-account-and-cluster](creating-a-fabric-account-and-cluster.md) rule to create a Harper Fabric account, organization, and cluster.
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

##### 1. Update `package.json`

Add the following scripts and dependencies to your `package.json`:

```json
{
	"scripts": {
		"deploy": "dotenv -- npm run deploy:component",
		"deploy:component": "harper deploy_component . restart=rolling replicated=true"
	},
	"devDependencies": {
		"dotenv-cli": "^11.0.0",
		"harper": "^5.0.0"
	}
}
```

###### Why split the scripts?

The `deploy` script is separated from `deploy:component` to ensure environment variables from your `.env` file are properly loaded and passed to the Harper CLI.

- `deploy`: Uses `dotenv-cli` to load environment variables (like `CLI_TARGET`, `CLI_TARGET_USERNAME`, and `CLI_TARGET_PASSWORD`) before executing the next command.
- `deploy:component`: The actual command that performs the deployment.

By using `dotenv -- npm run deploy:component`, the environment variables are correctly set in the shell session before `harper deploy_component` is called, allowing it to authenticate with your cluster.

##### 2. Configure GitHub Actions

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
        uses: actions/checkout@8e8c483db84b4bee98b60c0593521ed34d9990e8 # v6.0.1
        with:
          fetch-depth: 0
          fetch-tags: true
      - name: Set up Node.js
        uses: actions/setup-node@395ad3262231945c25e8478fd5baf05154b1d79f # v6.1.0
        with:
          cache: 'npm'
          node-version-file: '.nvmrc'
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

Be sure to set the following repository secrets in your GitHub repository's /settings/secrets/actions:

- `CLI_TARGET`
- `CLI_TARGET_USERNAME`
- `CLI_TARGET_PASSWORD`

### 4.2 Creating a Harper Fabric Account and Cluster

Follow these steps to set up your Harper Fabric environment for deployment.

#### How It Works

1. **Sign Up/In**: Go to [https://fabric.harper.fast/](https://fabric.harper.fast/) and sign up or sign in.
2. **Create an Organization**: Create an organization (org) to manage your projects.
3. **Create a Cluster**: Create a new cluster. This can be on the free tier, no credit card required.
4. **Set Credentials**: During setup, set the cluster username and password to finish configuring it.
5. **Get Application URL**: Navigate to the **Config** tab and copy the **Application URL**.
6. **Configure Environment**: Update your `.env` file or GitHub Actions secrets with cluster-specific credentials.
7. **Next Steps**: See the [deploying-to-harper-fabric](deploying-to-harper-fabric.md) rule for detailed instructions on deploying your application successfully.

#### Examples

##### Environment Configuration

```bash
CLI_TARGET_USERNAME='YOUR_CLUSTER_USERNAME'
CLI_TARGET_PASSWORD='YOUR_CLUSTER_PASSWORD'
CLI_TARGET='YOUR_CLUSTER_URL'
```

### 4.3 Creating Harper Applications

The fastest way to start a new Harper project is using the `create-harper` CLI tool. This command initializes a project with a standard folder structure, essential configuration files, and basic schema definitions.

#### When to Use

Use this command when starting a new Harper application or adding a new Harper microservice to an existing architecture.

#### Commands

Initialize a project using your preferred package manager:

##### NPM

```bash
npm create harper@latest
```

##### PNPM

```bash
pnpm create harper@latest
```

##### Bun

```bash
bun create harper@latest
```

#### Options

You can specify the project name and template directly:

```bash
npm create harper@latest my-app --template default
```

#### Next Steps

1. **Configure Environment**: Set up your `.env` file with local or cloud credentials.
2. **Define Schema**: Modify `schema.graphql` to fit your application's data model.
3. **Start Development**: Run `npm run dev` to start the local Harper instance.
4. **Deploy**: Use `npm run deploy` to push your application to Harper Fabric.

### 4.4 Serving Web Content

Instructions for the agent to follow when serving web content from Harper.

#### When to Use

Use this skill when you need to serve a frontend (HTML, CSS, JS, or a React app) directly from your Harper instance.

#### How It Works

1. **Choose a Method**: Decide between the simple Static Plugin or the integrated Vite Plugin.
2. **Option A: Static Plugin (Simple)**:
   - Add to `config.yaml`:
     ```yaml
     static:
       files: 'web/*'
     ```
   - Place files in a `web/` folder in the project root.
   - Files are served at the root URL (e.g., `http://localhost:9926/index.html`).
3. **Option B: Vite Plugin (Advanced/Development)**:
   - Add to `config.yaml`:
     ```yaml
     '@harperfast/vite-plugin':
       package: '@harperfast/vite-plugin'
     ```
   - Ensure `vite.config.ts` and `index.html` are in the project root.

   ```javascript
   import vue from '@vitejs/plugin-vue';
   import path from 'node:path';
   import { defineConfig } from 'vite';

   // https://vite.dev/config/
   export default defineConfig({
   	plugins: [vue()],
   	resolve: {
   		alias: {
   			'@': path.resolve(import.meta.dirname, './src'),
   		},
   	},
   	build: {
   		outDir: 'web',
   		emptyOutDir: true,
   		rolldownOptions: {
   			external: ['**/*.test.*', '**/*.spec.*'],
   		},
   	},
   });
   ```

   - Install dependencies: `npm install --save-dev vite @harperfast/vite-plugin`.
   - Then `harper run .` will start up Harper and Vite with HMR. Vite does _not_ need to be executed separately.

4. **Deploy for Production**: For Vite apps, use a build script to generate static files into a `web/` folder and deploy them using the static handler pattern. For example, these scripts in a package.json can perform the necessary steps:
   ```json
   "build": "vite build",
   "deploy": "rm -Rf deploy && npm run build && mkdir deploy && mv web deploy/ && cp -R deploy-template/* deploy/ && cp -R schemas resources deploy/ && (cd deploy && harper deploy_component . project=web restart=rolling replicated=true) && rm -Rf deploy",
   ```
   Then in production, the "Static Plugin" option will performantly and securely serve your assets. `npm create harper@latest` scaffolds all of this for you.

### 4.5 Logging Best Practices

Harper provides a robust logging system that captures standard output and offers a granular, tagged logging interface for both local and deployed environments.

#### Standard Console Logging

The simplest way to log in Harper is using standard JavaScript console methods. `console.log()`, `console.warn()`, `console.error()`, and `console.trace()` are automatically captured by Harper and can be viewed in the logs.

- `console.log(...)`: Captured as `stdout` level in Harper logs.
- `console.warn(...)`: Captured as `stderr` level in Harper logs.
- `console.error(...)`: Captured as `stderr` level in Harper logs.
- `console.trace(...)`: Captured as `stdout` level in Harper logs (includes stack trace).

#### Harper Logger

For more granularity and better organization, use Harper's built-in `logger`. You can use the global `logger` object or import it from the `harper` package.

##### Log Levels

The Harper `logger` supports the following levels (ordered by increasing severity):

- `trace`
- `debug`
- `info`
- `warn`
- `error`
- `fatal`
- `notify`

##### Usage

```typescript
import { logger, loggerWithTag } from 'harper';

// Basic logging
logger.info('Application started');
logger.error('An error occurred', error);

// Tagged logging for better filtering (Namespacing)
const authLogger = loggerWithTag('auth');
authLogger.debug('User login attempt', { userId: '123' });
```

Using `loggerWithTag` is highly recommended for grouping related logs, making them much easier to filter and analyze in the Harper Studio or via the API.

#### Programmatic Log Retrieval

You can programmatically read logs from a deployed Harper instance using the `read_log` operation. This is useful for building custom monitoring tools or debugging dashboards.

##### `read_log` Operation

The `read_log` operation is a POST request to the Harper instance.

**Example Request:**

```json
{
	"operation": "read_log",
	"limit": 100,
	"start": 0,
	"level": "error",
	"order": "desc",
	"from": "2024-01-01T00:00:00.000Z",
	"until": "2024-01-02T00:00:00.000Z"
}
```

##### Parameters

- `limit`: Number of log entries to return.
- `start`: Offset for pagination.
- `level`: Filter by log level (`info`, `error`, `warn`, `debug`, `trace`, `notify`, `fatal`, `stdout`, `stderr`).
- `from`: ISO 8601 timestamp to start reading from.
- `until`: ISO 8601 timestamp to stop reading at.
- `order`: Sort order, either `asc` or `desc`.
- `replicated`: (Boolean) Include logs from replicated nodes in a cluster.

##### Log Entry Structure

Each log entry returned by `read_log` typically includes:

- `level`: The severity level of the log.
- `timestamp`: When the log was recorded.
- `thread`: The execution thread.
- `tags`: An array of tags (e.g., from `loggerWithTag`).
- `node`: The node name in a Harper cluster.
- `message`: The logged content.
