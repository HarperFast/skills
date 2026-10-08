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
  sourceCommit: e73e5efb2823cc52caf7a6458d67fbcff3bbff2c
  inputHash: bb360b0d6c0a7bd4
---

# Programmatic Table Requests

Instructions for the agent to follow when interacting with Harper tables programmatically using the `tables` object.

## When to Use

Apply this rule when writing server-side Harper component code that reads from or writes to tables using the programmatic API — for example, in HTTP handlers, background jobs, timers, or SSR entry points. Use it whenever you need to construct queries with `conditions`, `sort`, `select`, pagination, or transactions outside of the REST layer.

## How It Works

1. **Import `tables` (and other APIs) from `harper`**: Access every table defined in `schema.graphql` as a property of `tables`. Each property is the table class implementing the Resource API.

   ```javascript
   import { tables, transaction } from 'harper';
   const { Product } = tables;
   // same as: databases.data.Product
   ```

   For components in their own directory, run:

   ```bash
   npm link harper
   ```

   All installed components have `harper` automatically linked.

2. **Define your schema with `@table`**: Every type you want to access via `tables` must carry the `@table` directive. Mark queryable fields with `@indexed`.

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	name: String
   	price: Float
   }
   ```

3. **Query records using `search(`**: Pass a Query object to `search()`. The query is an async iterable.

   ```javascript
   const query = {
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 8.0 }],
   };
   for await (const record of Product.search(query)) {
   	// process record
   }
   ```

4. **Build `conditions`**: Each condition object supports the following properties:

   | Property     | Description                                                                                                                                              |
   | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `attribute`  | Property name, or array for chained/joined properties (e.g. `['brand', 'name']`)                                                                         |
   | `value`      | The value to match                                                                                                                                       |
   | `comparator` | `equals` (default), `greater_than`, `greater_than_equal`, `less_than`, `less_than_equal`, `starts_with`, `contains`, `ends_with`, `between`, `not_equal` |
   | `conditions` | Nested conditions array                                                                                                                                  |
   | `operator`   | `and` (default) or `or` for the nested `conditions`                                                                                                      |

5. **Apply `select` to shape results**: Pass an array of property names, a string for a single property, or nested objects for relationships.

   ```javascript
   // Flat select
   Product.search({ select: ['name', 'price'] });

   // Nested relationship select
   Book.get({ id: 42, select: ['id', 'title', { name: 'author', select: ['name'] }] });
   ```

   Special `select` values: `$id`, `$updatedtime`, `$distance`.

6. **Apply `sort`**: Harper uses an index to provide sort order.

   | Property     | Description                                                |
   | ------------ | ---------------------------------------------------------- |
   | `attribute`  | Property name (or array for chained relationship property) |
   | `descending` | Sort descending if `true` (default: `false`)               |
   | `next`       | Secondary sort to resolve ties (same structure)            |
   - If the sort `attribute` is `@indexed`, no condition is required.
   - If the sort `attribute` is not indexed, at least one entry in `conditions` (on **any** attribute) is required.
   - Sorting by a non-indexed attribute with zero conditions raises:
     > `HdbError: <attribute> is not indexed and not combined with any other conditions`
   - The bare `@primaryKey` is treated as not indexed for sort purposes. To iterate in primary-key order, add an open-ended condition:

     ```javascript
     Product.search({
     	conditions: [{ attribute: 'id', comparator: 'greater_than', value: '' }],
     	sort: { attribute: 'id' },
     });
     ```

   - Pass `allowFullScan: true` to permit an unconditional ordered scan, or omit `sort` entirely to iterate without an index requirement.

7. **Paginate with `limit` and `offset`**:

   ```javascript
   Product.search({ conditions: [...], limit: 20, offset: 40 });
   ```

8. **Debug with `explain` and `enforceExecutionOrder`**:
   - `explain: true` — returns conditions reordered as Harper will execute them.
   - `enforceExecutionOrder: true` — forces conditions to execute in the order supplied, disabling Harper's automatic re-ordering.

9. **Use `addTo` for concurrent-safe increments**: `addTo(property, value)` uses CRDT incrementation, safe across threads and nodes.

   ```javascript
   static async post(target, data) {
     const record = await this.update(target.id);
     record.addTo('quantity', -1);
   }
   ```

10. **Wrap background work in `transaction()`**: Harper auto-starts transactions for HTTP handlers. Use `transaction()` explicitly for timers, background jobs, or any code outside a natural transaction context.

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

11. **Understand atomicity**: Transactions span a single database. All tables within the same database share one transactional context — reads return a consistent snapshot and writes across multiple tables commit atomically. Cross-database operations get separate transactions with no cross-database atomicity guarantee.

12. **Keep `harper` external when bundling for SSR**: In `vite.config`, mark `harper` as external so it resolves to the runtime rather than being bundled.

    ```javascript
    // vite.config
    ssr: {
    	external: ['harper'];
    }
    ```

## Examples

**Full CRUD flow:**

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
for await (const record of Product.search({
	conditions: [{ attribute: 'price', comparator: 'less_than', value: 8.0 }],
})) {
	// process record
}
```

**Nested conditions with `or`:**

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

**Chained attribute reference (join):**

```javascript
Product.search({ conditions: [{ attribute: ['brand', 'name'], value: 'Harper' }] });
```

**Background job with `transaction()`:**

```javascript
import { isMainThread } from 'node:worker_threads';
import { tables, transaction } from 'harper';
const { MyTable } = tables;

if (isMainThread) {
	let running = false;
	setInterval(async () => {
		if (running) return;
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
	}, 3600000);
}
```

**SSR with Harper data:**

```typescript
import { tables } from 'harper';

export async function render(url: string): Promise<string> {
	const product = await tables.Product.get(idFromUrl(url));
	return renderToString(/* <App product={product} /> */);
}
```

## Notes

- `tables` and `databases` calls run in a trusted server-side context and do **not** automatically apply the target table's role permissions.
- Programmatic `update`, `patch`, and `delete` calls operate directly on stored data. Scope destructive operations with specific `conditions`, validate the affected set before writing, and gate them behind authorization controls.
- If `transaction()` is called with a context that already has an active transaction, it reuses that transaction — making it safe to call defensively.
- Always `await` the `transaction()` call and `catch` errors when outside a request context; an unawaited call means a failed write is never observed.
- Guard against timer overlap: if a job can outlast its interval, use a `running` flag to skip a tick rather than opening two transactions over the same rows.
- CommonJS is also supported: `const { tables, Resource } = require('harper');`
