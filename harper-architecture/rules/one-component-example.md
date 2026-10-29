---
name: one-component-example
description: A worked example of a product catalog with caching, uploads, vector search, live updates, auth, and a frontend built as one Harper component instead of seven services.
metadata:
  mode: synthesized
---

# One Component, Five Services' Worth of Work

A worked example of a backend that would normally need Postgres, Redis, S3, Pinecone, Socket.io, and Express, built as a single Harper component.

## When to Use

- You are planning a backend with several of: a database, a cache, file uploads, similarity search, live updates, auth, a frontend host.
- You want a concrete reference for what the finished shape should look like before writing code.

## How It Works

A product catalog with a database, a cached supplier API, image uploads, similarity search, live stock updates, authenticated orders, and a frontend. The typical stack is Postgres, Redis, S3, Pinecone, Socket.io, Express, and a frontend host. On Harper it is three files plus the frontend.

What each piece replaces:

| Need                 | Typical stack                       | Here                                              |
| -------------------- | ----------------------------------- | ------------------------------------------------- |
| Product data         | Postgres + ORM + Express routes     | `Product` table, `@export` gives `/Product/`      |
| Supplier price cache | Redis + cache-aside code            | `SupplierPrice` with `expiration` + `sourcedFrom` |
| Images               | S3 + signed URLs                    | `image: Blob`                                     |
| Similar products     | Pinecone                            | `embedding` with an HNSW index                    |
| Live stock           | Socket.io server + Redis pub/sub    | Clients open `wss://<host>/Product/<id>`          |
| Orders with auth     | Express + passport + sessions table | `Order extends tables.Order`, `context.user`      |
| Frontend             | Separate host                       | `static` plugin serving `web/`                    |

## Examples

`schemas/catalog.graphql`

```graphql
type Product @table @export {
	id: ID @primaryKey
	name: String @indexed
	category: String @indexed
	stock: Int
	image: Blob
	embedding: [Float] @indexed(type: "HNSW")
}

type SupplierPrice @table(expiration: 300) @export {
	id: ID @primaryKey
	price: Float
	currency: String
}

# Not exported: resources/catalog.js extends it and owns the URL.
type Order @table {
	id: ID @primaryKey
	productId: ID @indexed
	quantity: Int
	placedBy: String
	placedAt: Float
}
```

`resources/catalog.js`

```javascript
import { tables } from 'harper';

// Cache: stale or missing prices are fetched once, stored, and served from the table.
tables.SupplierPrice.sourcedFrom({
	async get(id) {
		const response = await fetch(`https://supplier.example.com/prices/${id}`);
		return response.json();
	},
});

// Orders: Harper's generated endpoint plus an auth check.
export class Order extends tables.Order {
	static async post(target, data, context) {
		const user = context?.user;
		if (!user) {
			const error = new Error('Sign in to place an order');
			error.statusCode = 401;
			throw error;
		}
		return super.post(target, { ...(await data), placedBy: user.username, placedAt: Date.now() });
	}
}
```

`config.yaml`

```yaml
rest: true
graphqlSchema:
  files: 'schemas/*.graphql'
jsResource:
  files: 'resources/*.js'
static:
  files: 'web/*'
```
