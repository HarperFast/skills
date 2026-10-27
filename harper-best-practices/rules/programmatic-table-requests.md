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
  sourceCommit: bea4e62cb7efd809bb67e00cbda01a410c1177b1
  inputHash: 3c377ada9ec7a963
---

# Programmatic Table Requests

Instructions for the agent to interact with Harper tables programmatically using the `tables` object, the Query API, and transactions.

## When to Use

Apply this rule when writing server-side Harper code that reads or writes table data directly — for example, in custom resource methods, background jobs, timers, or SSR entry points. Use it whenever you need to query, filter, sort, paginate, or transactionally update records without going through the REST layer.

## How It Works

1. **Import `tables` (and other APIs) from `harper`**: Access every table defined in `schema.graphql` as a property of `tables`. Each property is the table class implementing the Resource API.

   ```javascript
   import { tables, transaction } from 'harper';
   const { Product } = tables;
   // equivalent to: databases.data.Product
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

2. **Define your schema with `@table`**: Every type you want to access via `tables` must carry the `@table` directive. Mark attributes you intend to sort or filter on with `@indexed`.

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	name: String
   	price: Float
   }
   ```

3. **Query records using `search(`**: Pass a Query object to `search()`. The query is an async iterable; iterate the result with `for await`.

   ```javascript
   const query = {
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 8.0 }],
   };
   for await (const record of Product.search(query)) {
   	// process record
   }
   ```

4. **Perform basic CRUD operations**: Use `create`, `patch`, and `get` for single-record operations.

   ```javascript
   const created = await Product.create({ name: 'Shirt', price: 9.5 });
   await Product.patch(created.id, { price: Math.round(created.price * 0.8 * 100) / 100 });
   const record = await Product.get(created.id);
   ```

5. **Build `conditions` arrays**: Each condition object filters records. Nest conditions for boolean logic.

   | Property     | Description                                                                                                                                              |
   | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `attribute`  | Property name, or array for chained/joined properties                                                                                                    |
   | `value`      | The value to match                                                                                                                                       |
   | `comparator` | `equals` (default), `greater_than`, `greater_than_equal`, `less_than`, `less_than_equal`, `starts_with`, `contains`, `ends_with`, `between`, `not_equal` |
   | `conditions` | Nested conditions array                                                                                                                                  |
   | `operator`   | `and` (default) or `or` for the nested `conditions`                                                                                                      |

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

   For relationship traversal, pass an array as `attribute`:

   ```javascript
   Product.search({ conditions: [{ attribute: ['brand', 'name'], value: 'Harper' }] });
   ```

6. **Use `select` to shape returned records**: Pass an array of property names, a string for a single property, or nested objects for relationships.

   ```javascript
   // Array of fields
   Product.search({ select: ['name', 'price'] });

   // Whole related record
   const book = await Book.get({ id: 42, select: ['id', 'title', 'author'] });

   // Partial related record
   const book = await Book.get({
   	id: 42,
   	select: ['id', 'title', { name: 'author', select: ['name'] }],
   });

   // Deep nesting
   // select: ['id', 'name', { name: 'segments', select: ['id', 'name', { name: 'client', select: ['id', 'name'] }] }]
   ```

   Special properties: `$id`, `$updatedtime`, `$distance`.

7. **Paginate with `limit` and `offset`**: `limit` caps the number of records returned; `offset` skips records.

   ```javascript
   Product.search({ conditions: [...], limit: 20, offset: 40 });
   ```

8. **Sort results with `sort`**: Provide `attribute`, optional `descending`, and optional `next` for tie-breaking.

   | Property     | Description                                  |
   | ------------ | -------------------------------------------- |
   | `attribute`  | Property name or array for chained property  |
   | `descending` | Sort descending if `true` (default: `false`) |
   | `next`       | Secondary sort (same structure)              |

   Harper uses an index for sort order. The sort `attribute` must be `@indexed`, **or** at least one `conditions` entry must be present. Sorting by a non-indexed attribute with zero conditions raises:

   > `HdbError: <attribute> is not indexed and not combined with any other conditions`

   To iterate a whole table in primary-key order, add an open-ended condition:

   ```javascript
   Product.search({
   	conditions: [{ attribute: 'id', comparator: 'greater_than', value: '' }],
   	sort: { attribute: 'id' },
   });
   ```

   Pass `allowFullScan: true` to permit an unconditional ordered scan. Omit `sort` entirely to iterate without an index requirement.

9. **Debug with `explain` and `enforceExecutionOrder`**: Set `explain: true` to receive conditions reordered as Harper will execute them. Set `enforceExecutionOrder: true` to force conditions to run in the order supplied, disabling automatic re-ordering.

10. **Mutate records with `update` and `addTo`**: `update` returns a mutable Resource instance; property assignments are written on commit. Use `addTo` for CRDT-safe numeric increments across threads and nodes.

    ```javascript
    const product = await Product.update(32);
    product.status = 'active';
    product.subtractFrom('quantity', 1);
    product.save();
    ```

    ```javascript
    static async post(target, data) {
      const record = await this.update(target.id);
      record.addTo('quantity', -1); // decrement safely across nodes
    }
    ```

11. **Wrap background work in `transaction()`**: Harper auto-starts transactions for HTTP handlers. Use `transaction()` explicitly for timers, background jobs, or any code outside a natural transaction context.

    ```javascript
    await transaction(async (txn) => {
    	for (let item of data) {
    		await MyTable.put(item, txn);
    	}
    });
    ```

    - Always `await` the `transaction()` call and `catch` it.
    - Guard against overlap when a job can outlast its interval (see example below).
    - If called with a context that already has an active transaction, `transaction()` reuses it — safe to call defensively.

    The `txn` object exposes:

    | Member                | Type            | Description                                            |
    | --------------------- | --------------- | ------------------------------------------------------ |
    | `commit()`            | `() => Promise` | Commits the current transaction                        |
    | `abort()`             | `() => void`    | Aborts and resets the transaction                      |
    | `resetReadSnapshot()` | `() => void`    | Resets the read snapshot to the latest committed state |
    | `timestamp`           | `number`        | Timestamp for the current transaction                  |

12. **Understand atomicity boundaries**: All tables within the same database share one transactional context — reads are consistent and writes are committed atomically. Tables in different databases each get their own transaction; there is no cross-database atomicity guarantee.

## Examples

### Basic CRUD and search

```javascript
import { tables } from 'harper';
const { Product } = tables;

const created = await Product.create({ name: 'Shirt', price: 9.5 });
await Product.patch(created.id, { price: Math.round(created.price * 0.8 * 100) / 100 });
const record = await Product.get(created.id);

const query = {
	conditions: [{ attribute: 'price', comparator: 'less_than', value: 8.0 }],
};
for await (const record of Product.search(query)) {
	console.log(record);
}
```

### Nested conditions with `select`, `sort`, `limit`, and `offset`

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
	select: ['name', 'price'],
	sort: { attribute: 'price', descending: true },
	limit: 10,
	offset: 0,
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
	}, 3600000);
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

Keep `harper` external in `vite.config`:

```javascript
// vite.config
ssr: {
	external: ['harper'];
}
```

## Notes

- `tables` and `databases` run in a trusted server-side context and do **not** automatically apply the target table's role permissions. Apply your own authorization controls.
- Programmatic `update`, `patch`, and `delete` operate on live data and are not easily reversible. Scope destructive operations with specific `conditions`, validate the affected set before writing, and gate them behind authorization controls.
- Selecting a relationship without an outer condition behaves as a **LEFT JOIN**; a top-level `conditions` entry on a related attribute behaves as an **INNER JOIN**.
- `resetReadSnapshot()` on the `txn` object refreshes the read snapshot to the latest committed state mid-transaction.
- For `atomicity`: all tables in the same database commit atomically together; cross-database operations have no atomicity guarantee.
