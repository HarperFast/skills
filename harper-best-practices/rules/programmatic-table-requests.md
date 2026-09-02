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
    - reference/v5/components/javascript-environment.md#Module Loading
  sourceCommit: 0d151a2c1f8d3988aef4dc6fc7deaa3e13f13589
  inputHash: 5d5d41abe1a19f03
---

# Programmatic Table Requests

Instructions for the agent to interact with Harper tables programmatically using the `tables` object, the Query API, and transactions.

## When to Use

Apply this rule when writing server-side Harper component code that reads from or writes to tables directly — bypassing REST endpoints — such as in request handlers, background jobs, timers, or SSR rendering. Use it whenever you need to construct queries with `conditions`, `sort`, `select`, pagination, or wrap writes in a `transaction()`.

## How It Works

1. **Import `tables` (and other APIs) from `harper`**: Access every table defined in `schema.graphql` as a named property of `tables`. Each property is the table class implementing the Resource API.

   ```javascript
   import { tables, transaction } from 'harper';
   const { Product } = tables;
   // equivalent to: databases.data.Product
   ```

   CommonJS alternative:

   ```javascript
   const { tables, transaction } = require('harper');
   ```

2. **Define your schema with `@table`**: Each type annotated `@table` in `schema.graphql` becomes a property on `tables`. Add `@indexed` to attributes you intend to sort or filter on efficiently.

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	name: String
   	price: Float
   }
   ```

3. **Perform basic CRUD operations**: Use the methods on the table class directly.

   ```javascript
   // Create (id auto-generated)
   const created = await Product.create({ name: 'Shirt', price: 9.5 });

   // Patch specific fields
   await Product.patch(created.id, { price: Math.round(created.price * 0.8 * 100) / 100 });

   // Retrieve by primary key
   const record = await Product.get(created.id);
   ```

4. **Query with `search(` and a Query object**: Pass a query object to `Product.search(query)`. The method returns an async iterable.

   ```javascript
   for await (const record of Product.search({
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 8.0 }],
   })) {
   	// process record
   }
   ```

5. **Build `conditions`**: Each entry in the `conditions` array filters records. Nest conditions for boolean logic.

   | Property     | Description                                                                                                                                              |
   | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `attribute`  | Property name, or array for chained/joined properties (e.g. `['brand', 'name']`)                                                                         |
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

   For relationship traversal, use an array attribute reference:

   ```javascript
   Product.search({ conditions: [{ attribute: ['brand', 'name'], value: 'Harper' }] });
   ```

6. **Apply `select` to shape results**: Pass an array of property names, a single string, or nested objects for relationships.

   ```javascript
   // Array of fields
   Product.search({ select: ['name', 'price'] });

   // Whole related record
   const book = await Book.get({ id: 42, select: ['id', 'title', 'author'] });
   book.author.name;

   // Partial related record
   const book = await Book.get({
   	id: 42,
   	select: ['id', 'title', { name: 'author', select: ['name'] }],
   });

   // Deep nesting
   // select: ['id', 'name', { name: 'segments', select: ['id', 'name', { name: 'client', select: ['id', 'name'] }] }]
   ```

   Special `select` values: `$id`, `$updatedtime`, `$distance`.
   - Selecting a relationship without filtering it behaves as a **LEFT JOIN**.
   - Adding a condition on a related attribute behaves as an **INNER JOIN**.

7. **Paginate with `limit` and `offset`**:

   ```javascript
   Product.search({ conditions: [...], limit: 20, offset: 40 });
   ```

8. **Sort results with `sort`**: The `sort` attribute must be `@indexed`, or at least one `conditions` entry must be present. Sorting by a non-indexed attribute with zero conditions throws an error.

   | Property     | Description                                              |
   | ------------ | -------------------------------------------------------- |
   | `attribute`  | Property name or array for chained relationship property |
   | `descending` | Sort descending if `true` (default: `false`)             |
   | `next`       | Secondary sort to resolve ties (same structure)          |

   To iterate a whole table in primary-key order, add an open-ended condition:

   ```javascript
   Product.search({
   	conditions: [{ attribute: 'id', comparator: 'greater_than', value: '' }],
   	sort: { attribute: 'id' },
   });
   ```

   Pass `allowFullScan: true` to permit an unconditional ordered scan. Omit `sort` entirely to iterate without an index requirement.

9. **Debug with `explain` and `enforceExecutionOrder`**:
   - `explain: true` — returns conditions reordered as Harper will execute them.
   - `enforceExecutionOrder: true` — forces conditions to execute in the order supplied, disabling automatic re-ordering.

10. **Use `addTo` for concurrent-safe increments**: Applies CRDT incrementation — safe across threads and nodes.

    ```javascript
    static async post(target, data) {
      const record = await this.update(target.id);
      record.addTo('quantity', -1); // decrement safely across nodes
    }
    ```

11. **Wrap background writes in `transaction()`**: HTTP handlers get a transaction automatically. Use `transaction()` explicitly for timers, background jobs, or any code outside a natural request context.

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

    - Always `await` the `transaction()` call and `catch` it.
    - Guard against overlap with a `running` flag when a job can outlast its interval.
    - If `transaction()` is called inside an already-active transaction context, it reuses that transaction safely.

12. **Understand `atomicity` and `resetReadSnapshot()`**: Transactions span a single database. All tables in the same database share one transactional context — reads return a consistent snapshot, writes commit atomically. Cross-database operations have no atomicity guarantee.

    The `txn` object passed to the callback exposes:

    | Member                | Type            | Description                                            |
    | --------------------- | --------------- | ------------------------------------------------------ |
    | `commit()`            | `() => Promise` | Commits the current transaction                        |
    | `abort()`             | `() => void`    | Aborts the transaction and resets it                   |
    | `resetReadSnapshot()` | `() => void`    | Resets the read snapshot to the latest committed state |
    | `timestamp`           | `number`        | Timestamp associated with the current transaction      |

13. **Keep `harper` external when bundling for SSR**: In `vite.config`, mark `harper` as external so it resolves to the live runtime rather than being bundled.

    ```typescript
    // vite.config
    // ssr: { external: ['harper'] }
    ```

    SSR render function example:

    ```typescript
    import { tables } from 'harper';

    export async function render(url: string): Promise<string> {
    	const product = await tables.Product.get(idFromUrl(url));
    	return renderToString(/* <App product={product} /> */);
    }
    ```

## Examples

### Full query with conditions, select, sort, limit, and offset

```javascript
import { tables } from 'harper';
const { Product } = tables;

for await (const record of Product.search({
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
	select: ['name', 'price', { name: 'brand', select: ['id', 'name'] }],
	sort: { attribute: 'price', descending: true },
	limit: 20,
	offset: 0,
})) {
	console.log(record);
}
```

### Transactional batch write in a background job

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

### CRDT-safe decrement with `addTo`

```javascript
import { tables } from 'harper';
const { Product } = tables;

const product = await Product.update(32);
product.addTo('quantity', -1);
product.save();
```

## Notes

- `tables` calls run in a trusted server-side context and do **not** automatically apply the target table's role permissions.
- Destructive operations (`update`, `patch`, `delete`) act on live data and are not easily reversible. Always scope with specific `conditions` and validate the affected set before writing.
- Sorting by the bare `@primaryKey` alone with no `conditions` is rejected — add an open-ended range condition or use `allowFullScan: true`.
- `tables`, `databases`, and other Harper APIs are the same live, process-wide objects regardless of whether accessed as globals or via `import { tables } from 'harper'`.
- For components in their own directory, run `npm link harper` to ensure typings resolve to the current installation.
