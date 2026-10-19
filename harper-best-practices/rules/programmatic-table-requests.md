---
name: programmatic-table-requests
description: How to interact with Harper tables programmatically using the `tables` object.
metadata:
  mode: generate
  sources:
    - reference/v5/database/api.md#`tables`
    - reference/v5/resources/resource-api.md#Query Object
    - 'reference/v5/database/api.md#`transaction(context?, callback)`'
    - >-
      reference/v5/resources/resource-api.md#`update(target: RequestTarget | Id,
      updates?: object): Promise<Resource>`
    - >-
      reference/v5/resources/resource-api.md#`addTo(property: string, value:
      number)`
    - reference/v5/components/javascript-environment.md#Module Formats
  sourceCommit: 6c3e29dd9149201364b0d74642725c30f0305e3e
  inputHash: b42fe5775d69e9a2
---

# Programmatic Table Requests

Instructions for the agent to interact with Harper tables programmatically using the `tables` object, the Query API, and transactions.

**Instead of:** ORM and query-builder clients (Prisma, Drizzle, Knex). Use this rule rather than adding that service. See `harper-architecture`.

## When to Use

Apply this rule when writing server-side Harper code that reads, writes, searches, or transactionally modifies table data through the `tables` object. Use it when building background jobs, SSR renderers, or any code that calls `search(`, `addTo`, `select`, `sort`, or `transaction()` directly rather than through REST endpoints.

## How It Works

1. **Import `tables` (and other APIs) from `harper`**: Access every table defined in `schema.graphql` as a named property of `tables`. This is equivalent to `databases.data.<TableName>`.

   ```javascript
   import { tables, Resource } from 'harper';
   const { Product } = tables;
   // same as: databases.data.Product
   ```

   CommonJS is also supported: `const { tables, Resource } = require('harper');`

   For components in their own directory, link the package first:

   ```bash
   npm link harper
   ```

   When bundling for SSR with Vite, keep `harper` external so it resolves to the runtime:

   ```javascript
   // vite.config
   ssr: {
   	external: ['harper'];
   }
   ```

2. **Define your schema with `@table` (and `@indexed` where needed)**: Tables must be declared in `schema.graphql`. Mark attributes that will be used as sort keys or standalone condition attributes with `@indexed`.

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	name: String
   	price: Float @indexed
   }
   ```

3. **Query records using `search(`**: Pass a Query object to `search()`. The query is an async iterable; iterate the result with `for await`. Use a `conditions` array to filter records. Each condition specifies `attribute`, `value`, and an optional `comparator`.

   | Property     | Description                                                                                                                                                                         |
   | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `attribute`  | Property name, or array for chained/joined properties                                                                                                                               |
   | `value`      | The value to match                                                                                                                                                                  |
   | `comparator` | `equals` (default), `greater_than`, `greater_than_equal`, `less_than`, `less_than_equal`, `starts_with`, `contains`, `ends_with`, `between`, `not_equal`, or a full-text comparator |
   | `conditions` | Nested conditions array                                                                                                                                                             |
   | `operator`   | `and` (default) or `or` for the nested `conditions`                                                                                                                                 |

   ```javascript
   for await (const record of Product.search({
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 8.0 }],
   })) {
   	// process record
   }
   ```

4. **Use `select` to control which properties are returned**: Pass an array of property names, a string for a single property, or nested objects for relationships.

   ```javascript
   const book = await Book.get({
   	id: 42,
   	select: ['id', 'title', { name: 'author', select: ['name'] }],
   });
   ```

   Special `select` properties:
   - `$id` — returns the primary key regardless of its name
   - `$updatedtime` — returns the last-updated timestamp
   - `$distance` — returns computed vector distance when using a vector index
   - `$score` — returns BM25 relevance score for full-text queries
   - `$highlights` — returns full-text fragments and matching spans

5. **Use `sort` with an `@indexed` attribute or combine with `conditions`**: Harper requires either an `@indexed` sort attribute or at least one `conditions` entry when sorting. Sorting by a non-indexed attribute with zero conditions raises:

   > `HdbError: <attribute> is not indexed and not combined with any other conditions`

   Note: `@primaryKey` alone is treated as not indexed for sort purposes. To iterate a whole table in primary-key order, add an open-ended condition:

   ```javascript
   Product.search({
   	conditions: [{ attribute: 'id', comparator: 'greater_than', value: '' }],
   	sort: { attribute: 'id' },
   });
   ```

   `sort` object properties:

   | Property     | Description                                                |
   | ------------ | ---------------------------------------------------------- |
   | `attribute`  | Property name (or array for chained relationship property) |
   | `descending` | Sort descending if `true` (default: `false`)               |
   | `next`       | Secondary sort to resolve ties (same structure)            |

6. **Apply `limit` and `offset` for pagination**: Add these to the Query object to bound result sets.

   ```javascript
   Product.search({
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 100 }],
   	limit: 20,
   	offset: 40,
   });
   ```

7. **Use `explain` and `enforceExecutionOrder` for debugging and optimization**:
   - `explain: true` — returns conditions reordered as Harper will execute them.
   - `enforceExecutionOrder: true` — forces conditions to execute in the order supplied, disabling Harper's automatic re-ordering.

8. **Use `addTo` for concurrent-safe numeric updates**: Increments or decrements a property using CRDT incrementation, safe across threads and nodes.

   ```javascript
   static async post(target, data) {
     const record = await this.update(target.id);
     record.addTo('quantity', -1); // decrement safely across nodes
   }
   ```

9. **Wrap background or timer work in `transaction()`**: HTTP handlers get a transaction automatically. Use `transaction()` explicitly for timers, background jobs, or any code outside a natural request context. Always `await` the call and `catch` errors.

   ```javascript
   await transaction(async (txn) => {
   	for (let item of data) {
   		await MyTable.put(item, txn);
   	}
   });
   ```

   The `txn` object exposes:

   | Member                | Type            | Description                                            |
   | --------------------- | --------------- | ------------------------------------------------------ |
   | `commit()`            | `() => Promise` | Commits the current transaction                        |
   | `abort()`             | `() => void`    | Aborts the transaction and resets it                   |
   | `resetReadSnapshot()` | `() => void`    | Resets the read snapshot to the latest committed state |
   | `timestamp`           | `number`        | Timestamp associated with the current transaction      |

   On normal callback completion the transaction commits automatically. If the callback throws, the transaction is aborted.

10. **Understand atomicity boundaries**: All tables within the same database share a single transactional context — reads return a consistent snapshot and writes are committed atomically. Tables in different databases each get their own transaction with no cross-database atomicity guarantee.

## Examples

### Basic CRUD and search

```javascript
import { tables } from 'harper';
const { Product } = tables;

// Create
const created = await Product.create({ name: 'Shirt', price: 9.5 });

// Patch
await Product.patch(created.id, { price: Math.round(created.price * 0.8 * 100) / 100 });

// Get by primary key
const record = await Product.get(created.id);

// Search with conditions
const query = {
	conditions: [{ attribute: 'price', comparator: 'less_than', value: 8.0 }],
};
for await (const record of Product.search(query)) {
	// process record
}
```

### Nested conditions with `or`

```javascript
Product.search({
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
});
```

### Chained attribute reference (join/relationship)

```javascript
Product.search({ conditions: [{ attribute: ['brand', 'name'], value: 'Harper' }] });
```

### Selecting and constraining related records

```javascript
const brand = await Brand.get({
	id: 42,
	select: [
		'id',
		{
			name: 'products',
			conditions: [{ attribute: 'price', comparator: 'greater_than_equal', value: 30 }],
			sort: { attribute: 'price' },
			offset: 0,
			limit: 1,
			select: ['id', 'price'],
		},
	],
});
```

### Background job with `transaction()`

```javascript
import { isMainThread } from 'node:worker_threads';
import { tables, transaction } from 'harper';
const { MyTable } = tables;

if (isMainThread) {
	let running = false;
	setInterval(async () => {
		if (running) return; // the previous run has not committed yet
		running = true;
		try {
			let data = await (await fetch('https://example.com/data')).json();
			await transaction(async (txn) => {
				for (let item of data) {
					await MyTable.put(item, txn);
				}
			});
		} catch (error) {
			logger.error('hourly import failed', error);
		} finally {
			running = false;
		}
	}, 3600000); // every hour
}
```

### SSR with Vite

```typescript
import { tables } from 'harper';

export async function render(url: string): Promise<string> {
	const product = await tables.Product.get(idFromUrl(url));
	return renderToString(/* <App product={product} /> */);
}
```

Keep `harper` external in `vite.config` so it resolves to the runtime:

```javascript
ssr: {
	external: ['harper'];
}
```

## Notes

- Calls through `tables` run in a trusted server-side context and do **not** automatically apply the target table's role permissions. Set `checkPermission: true` on the query and pass the authenticated `context` as the second argument when authorization is required.
- `update`, `patch`, and `delete` operate directly on stored data. Scope destructive operations with specific `conditions`, validate the affected set before writing, and gate them behind authorization controls.
- Pass `allowFullScan: true` to permit an unconditional ordered scan without conditions. If order doesn't matter, omit `sort` entirely — `search({})` iterates without an index requirement.
- If `transaction()` is called with a context that already has an active transaction, it reuses that transaction and executes the callback immediately — safe to call defensively.
- Guard timer-based jobs against overlap: a timer fires on schedule regardless of whether the previous run has committed. Use a `running` flag to skip a tick when the previous run is still active.
