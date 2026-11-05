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
  sourceCommit: 0a29827da61afe7fff40ee8de87e1d4c2c286bea
  inputHash: 4f4e5f98986aef68
---

# Programmatic Table Requests

Instructions for the agent to interact with Harper tables programmatically using the `tables` object, including querying, transactions, and module setup.

**Instead of:** ORM and query-builder clients (Prisma, Drizzle, Knex). Use this rule rather than adding that service. See `harper-architecture`.

## When to Use

Apply this rule when writing server-side Harper code that reads or writes table data directly — for example, in request handlers, background jobs, timers, or SSR entry points. Use it whenever you need to construct a query with `conditions`, `sort`, `select`, `limit`, or `offset`, or when you need to wrap writes in a `transaction()`.

## How It Works

1. **Import `tables` (and other APIs) from `harper`**: Access tables defined in `schema.graphql` via the `tables` object. Each table is a property matching its type name.

   ```javascript
   import { tables, transaction } from 'harper';
   const { Product } = tables;
   // equivalent to: databases.data.Product
   ```

   For CommonJS:

   ```javascript
   const { tables, Resource } = require('harper');
   ```

   For components in their own directory, link the package first:

   ```bash
   npm link harper
   ```

   When bundling for SSR with Vite, keep `harper` external so it resolves to the runtime — add `ssr: { external: ['harper'] }` in `vite.config`.

2. **Define your schema with `@table`**: Every type you want to access via `tables` must be declared with `@table` in `schema.graphql`. Use `@indexed` on attributes you intend to sort or filter by efficiently.

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	name: String
   	price: Float @indexed
   }
   ```

3. **Perform basic CRUD operations**: Use the table class methods directly.

   ```javascript
   // Create
   const created = await Product.create({ name: 'Shirt', price: 9.5 });

   // Patch
   await Product.patch(created.id, { price: Math.round(created.price * 0.8 * 100) / 100 });

   // Get by primary key
   const record = await Product.get(created.id);
   ```

4. **Query with `search(` and a query object**: Pass a query object with `conditions`, `sort`, `limit`, `offset`, `select`, and other options. `search(` returns an async iterable. If order doesn't matter, omit `sort` entirely and `search({})` will iterate without an index requirement.

   ```javascript
   const query = {
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 8.0 }],
   };
   for await (const record of Product.search(query)) {
   	// process record
   }
   ```

5. **Build `conditions` arrays**: Each condition object supports the following properties:

   | Property                   | Description                                                                                                                                                                                                                                                                                                         |
   | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `attribute`                | Property name, or array for chained/joined properties                                                                                                                                                                                                                                                               |
   | `value`                    | The value to match                                                                                                                                                                                                                                                                                                  |
   | `comparator`               | `equals` (default), `greater_than`, `greater_than_equal`, `less_than`, `less_than_equal`, `starts_with`, `contains`, `ends_with`, `between`, `not_equal`, or a full-text comparator (`matches`, `matches_all`, `matches_phrase`, `matches_prefix`, `matches_fuzzy`, `matches_fuzzy_prefix`, and their `not_` forms) |
   | `conditions`               | Nested conditions array                                                                                                                                                                                                                                                                                             |
   | `operator`                 | `and` (default) or `or` for nested `conditions`                                                                                                                                                                                                                                                                     |
   | `fields`                   | Full-text source fields to search; every name must belong to the selected full-text index                                                                                                                                                                                                                           |
   | `includeHighlights`        | Include configured full-text highlights                                                                                                                                                                                                                                                                             |
   | `maxIndexLagMilliseconds`  | Maximum accepted full-text index lag                                                                                                                                                                                                                                                                                |
   | `waitForIndexMilliseconds` | Time to wait for acceptable full-text coverage                                                                                                                                                                                                                                                                      |

   Use nested `conditions` and `operator` for compound logic:

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

   Use an array `attribute` to traverse relationships:

   ```javascript
   Product.search({ conditions: [{ attribute: ['brand', 'name'], value: 'Harper' }] });
   ```

6. **Apply `select` to shape results**: Pass an array of property names, nested objects for relationships, or a string for a single property.

   ```javascript
   // Flat select
   Product.search({ select: ['name', 'price'] });

   // Nested relationship select
   const book = await Book.get({
   	id: 42,
   	select: ['id', 'title', { name: 'author', select: ['name'] }],
   });

   // Special properties:
   // $id — primary key regardless of name
   // $updatedtime — last-updated timestamp
   // $distance — vector index distance
   // $score — full-text BM25 score
   // $highlights — full-text highlight fragments
   ```

7. **Use `sort` with `@indexed` attributes**: Provide a `sort` object with `attribute`, optional `descending`, and optional `next` for tie-breaking.

   | Property     | Description                                                |
   | ------------ | ---------------------------------------------------------- |
   | `attribute`  | Property name (or array for chained relationship property) |
   | `descending` | Sort descending if `true` (default: `false`)               |
   | `next`       | Secondary sort to resolve ties (same structure)            |

   ```javascript
   // attribute must be @indexed, or at least one condition must be present
   Product.search({
   	sort: { attribute: 'price', descending: true },
   });
   ```

   If the sort `attribute` is not `@indexed` and no `conditions` are present, Harper throws:

   > `HdbError: <attribute> is not indexed and not combined with any other conditions`

   To iterate a whole table in primary-key order, add an open-ended condition:

   ```javascript
   Product.search({
   	conditions: [{ attribute: 'id', comparator: 'greater_than', value: '' }],
   	sort: { attribute: 'id' },
   });
   ```

8. **Apply `limit` and `offset` for pagination**:

   ```javascript
   Product.search({
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 100 }],
   	sort: { attribute: 'price' },
   	limit: 20,
   	offset: 40,
   });
   ```

9. **Use `explain` and `enforceExecutionOrder` for debugging and control**:
   - Set `explain: true` to return conditions reordered as Harper will execute them.
   - Set `enforceExecutionOrder: true` to force conditions to execute in the order supplied, disabling Harper's automatic reordering.

   ```javascript
   Product.search({
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 100 }],
   	explain: true,
   });
   ```

10. **Use `addTo` for concurrent-safe numeric updates**: `addTo(property, value)` uses CRDT incrementation, safe across threads and nodes.

    ```javascript
    static async post(target, data) {
      const record = await this.update(target.id);
      record.addTo('quantity', -1); // decrement safely across nodes
    }
    ```

11. **Wrap out-of-context writes in `transaction()`**: HTTP request handlers get a transaction automatically. Use `transaction()` explicitly for timers, background jobs, or any code outside a natural transaction context.

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

12. **Understand `transaction()` atomicity and scope**: Transactions span a single database. All tables within the same database share one transactional context — reads return a consistent snapshot and writes across multiple tables commit with atomicity. Tables in different databases each get their own transaction with no cross-database atomicity guarantee.

    The `txn` object received by the callback exposes:

    | Member                | Type            | Description                                            |
    | --------------------- | --------------- | ------------------------------------------------------ |
    | `commit()`            | `() => Promise` | Commits the current transaction                        |
    | `abort()`             | `() => void`    | Aborts the transaction and resets it                   |
    | `resetReadSnapshot()` | `() => void`    | Resets the read snapshot to the latest committed state |
    | `timestamp`           | `number`        | Timestamp associated with the current transaction      |

    On normal callback completion the transaction commits automatically. If the callback throws, the transaction is aborted.

## Examples

**Relationship group — one related record must meet all conditions:**

```javascript
const brands = [];
for await (const brand of Brand.search({
	conditions: [
		{
			attribute: 'products',
			conditions: [
				{ attribute: 'name', value: 'Keyboard' },
				{ attribute: 'price', comparator: 'greater_than_equal', value: 30 },
			],
		},
	],
	select: ['id', 'name', { name: 'products', select: ['name', 'price'] }],
})) {
	brands.push(brand);
}
```

**SSR entry point reading directly from Harper:**

```javascript
import { tables } from 'harper';

export async function render(url: string): Promise<string> {
  const product = await tables.Product.get(idFromUrl(url));
  return renderToString(/* <App product={product} /> */);
}
```

Keep `harper` external in `vite.config` — e.g. `ssr: { external: ['harper'] }` — so it resolves to the runtime instead of being bundled.

**Nested relationship select with constraints:**

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

**Sort with secondary tie-breaker across a relationship:**

```javascript
Brand.search({
	conditions: [{ attribute: ['products', 'price'], comparator: 'greater_than_equal', value: 30 }],
	sort: { attribute: ['products', 'name'], next: { attribute: 'id' } },
});
```

## Notes

- Calls through `tables` and `databases` run in a trusted server-side context and do not automatically apply the target table's role permissions. To enforce authorization, set `checkPermission: true` on the query and pass the authenticated `context` as the second argument to `search()` or `get()`. Harper then authorizes the read using `context.user`, including table, selected-property, and full-text source-field permissions.
- Programmatic `update`, `patch`, and `delete` calls operate directly on stored (potentially live production) data. Scope destructive operations with specific `conditions`, validate the affected set before writing, and gate them behind authorization controls.
- `transaction()` is safe to call defensively: if the context already has an active transaction, it reuses it and executes the callback immediately.
- `resetReadSnapshot()` on the `txn` object resets the read snapshot to the latest committed state mid-transaction.
- The bare `@primaryKey` is treated as not indexed for sort purposes (it uses the primary store, not a secondary index). Sorting by primary key alone with no `conditions` triggers the `HdbError: <attribute> is not indexed and not combined with any other conditions` error. Add an open-ended condition or pass `allowFullScan: true` to permit an unconditional scan.
- All installed components have `harper` automatically linked. For components in their own directory, run `npm link harper` manually.
