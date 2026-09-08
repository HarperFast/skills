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
  sourceCommit: 9e6ecf87dd25bb488ad44dc2876ca6439ccd682e
  inputHash: f5629f73cde74764
---

# Programmatic Table Requests

Instructions for the agent to interact with Harper tables programmatically using the `tables` object, the Query API, and transactions.

## When to Use

Apply this rule when writing server-side Harper component code that reads from or writes to tables directly — for example, in HTTP handlers, background jobs, timers, or SSR render functions. Use it whenever you need to construct queries with `conditions`, `sort`, `select`, `limit`, or `offset`, or when you need explicit transaction control via `transaction()`.

## How It Works

1. **Import `tables` (and other APIs) from `harper`**: Access every table defined in `schema.graphql` as a named property of `tables`. Each property is the table class implementing the Resource API.

   ```javascript
   import { tables, transaction } from 'harper';
   const { Product } = tables;
   // equivalent to: databases.data.Product
   ```

   For standalone components, run `npm link harper` so imports resolve to the live runtime.

2. **Define your schema with `@table`**: Tables must be declared in `schema.graphql`. Mark attributes you intend to sort or filter on with `@indexed`.

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	name: String
   	price: Float
   }
   ```

3. **Query records with `search(`**: Pass a Query object to `search(`. Iterate results with `for await`.

   ```javascript
   const query = {
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 8.0 }],
   };
   for await (const record of Product.search(query)) {
   	// process record
   }
   ```

4. **Build `conditions`**: Each condition object supports these properties:

   | Property     | Description                                                                                                                                              |
   | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `attribute`  | Property name, or array for chained/joined properties (e.g. `['brand', 'name']`)                                                                         |
   | `value`      | The value to match                                                                                                                                       |
   | `comparator` | `equals` (default), `greater_than`, `greater_than_equal`, `less_than`, `less_than_equal`, `starts_with`, `contains`, `ends_with`, `between`, `not_equal` |
   | `conditions` | Nested conditions array                                                                                                                                  |
   | `operator`   | `and` (default) or `or` for the nested `conditions`                                                                                                      |

5. **Control result shape with `select`**: Pass an array of property names, a single string, or nested objects for relationships.

   ```javascript
   // Scalar fields only
   Product.search({ select: ['name', 'price'] });

   // Partial related record
   Book.get({ id: 42, select: ['id', 'title', { name: 'author', select: ['name'] }] });
   ```

   Special `select` values: `$id`, `$updatedtime`, `$distance`.

6. **Paginate with `limit` and `offset`**:

   ```javascript
   Product.search({ conditions: [...], limit: 20, offset: 40 });
   ```

7. **Sort with `sort`**: The `sort` object accepts `attribute`, `descending` (default `false`), and `next` for tie-breaking. Harper uses an index for sort order — the sort `attribute` must be `@indexed`, **or** at least one entry in `conditions` must be present.

   Sorting by a non-indexed attribute with zero conditions raises:

   > `HdbError: <attribute> is not indexed and not combined with any other conditions`

   Note: `@primaryKey` alone is treated as not indexed for sort purposes. To scan the whole table in primary-key order, add an open-ended condition:

   ```javascript
   Product.search({
   	conditions: [{ attribute: 'id', comparator: 'greater_than', value: '' }],
   	sort: { attribute: 'id' },
   });
   ```

   Alternatively, pass `allowFullScan: true` to permit an unconditional ordered scan, or omit `sort` entirely to iterate without an index requirement.

8. **Debug query planning with `explain` and `enforceExecutionOrder`**:
   - `explain: true` — returns conditions reordered as Harper will execute them.
   - `enforceExecutionOrder: true` — forces conditions to execute in the order supplied, disabling automatic re-ordering.

9. **Use `addTo` for concurrent-safe numeric updates**: `addTo` uses CRDT incrementation, safe across threads and nodes.

   ```javascript
   const record = await Product.update(32);
   record.addTo('quantity', -1);
   ```

10. **Wrap background work in `transaction()`**: HTTP handlers get a transaction automatically. Use `transaction()` explicitly for timers, background jobs, or any code outside a request context. Always `await` the call and `catch` errors.

    ```javascript
    await transaction(async (txn) => {
    	for (let item of data) {
    		await MyTable.put(item, txn);
    	}
    });
    ```

    The `txn` object exposes:

    | Member                | Description                                            |
    | --------------------- | ------------------------------------------------------ |
    | `commit()`            | Commits the current transaction                        |
    | `abort()`             | Aborts and resets the transaction                      |
    | `resetReadSnapshot()` | Resets the read snapshot to the latest committed state |
    | `timestamp`           | Timestamp associated with the current transaction      |

    **Atomicity**: all tables in the same database share one transactional context — writes across multiple tables commit atomically. Tables in different databases each get their own transaction with no cross-database atomicity guarantee.

    If `transaction()` is called with a context that already has an active transaction, it reuses that transaction — safe to call defensively.

11. **Keep `harper` external when bundling for SSR**: In `vite.config`, mark `harper` as external so it resolves to the runtime rather than being bundled.

    ```javascript
    // vite.config
    ssr: {
    	external: ['harper'];
    }
    ```

## Examples

### Full CRUD sequence

```javascript
import { tables } from 'harper';
const { Product } = tables;

// Create
const created = await Product.create({ name: 'Shirt', price: 9.5 });

// Patch
await Product.patch(created.id, { price: Math.round(created.price * 0.8 * 100) / 100 });

// Retrieve by primary key
const record = await Product.get(created.id);

// Query with conditions
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

### Background job with `transaction()`

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

### SSR render with `tables`

```typescript
import { tables } from 'harper';

export async function render(url: string): Promise<string> {
	const product = await tables.Product.get(idFromUrl(url));
	return renderToString(/* <App product={product} /> */);
}
```

## Notes

- `tables` and `databases` do **not** automatically apply role permissions — calls run in a trusted server-side context. Apply your own authorization controls before exposing results.
- Destructive operations (`update`, `patch`, `delete`) act on live data and are not easily reversible. Scope them with specific `conditions` and validate the affected set before writing.
- `tables` is the same live, process-wide object whether accessed as a global or via `import { tables } from 'harper'`. A record written through one component is immediately visible to every other.
- Run `npm link harper` for components in their own directory to ensure typings match the running installation.
