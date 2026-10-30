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
  sourceCommit: da68d8e45f5422321c128a0cd67694bd0b97b155
  inputHash: a307b78a63f94fb1
---

# Programmatic Table Requests

Instructions for the agent to interact with Harper tables programmatically using the `tables` object, including querying, sorting, transactions, and module setup.

**Instead of:** ORM and query-builder clients (Prisma, Drizzle, Knex). Use this rule rather than adding that service. See `harper-architecture`.

## When to Use

Apply this rule when writing server-side Harper application code that reads or writes table data directly — for example, in HTTP handlers, background jobs, timers, or SSR entry points. Use it whenever you need to construct queries with `conditions`, paginate results, sort, run transactions, or perform CRDT updates.

## How It Works

1. **Import `tables` (and other APIs) from `harper`**: Access tables defined in `schema.graphql` via the `tables` object. Each table type is a property on `tables`.

   ```javascript
   import { tables, transaction } from 'harper';
   const { Product } = tables;
   // equivalent to: databases.data.Product
   ```

   For components in their own directory, link the package first:

   ```bash
   npm link harper
   ```

   All installed components have `harper` automatically linked.

2. **Define your schema with `@table`**: Every type you want to access via `tables` must be declared with `@table` in `schema.graphql`. Mark attributes you intend to sort or filter by index with `@indexed`.

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	name: String
   	price: Float
   }
   ```

3. **Use basic CRUD methods on the table class**: The table class implements the Resource API.

   ```javascript
   // Create a new record (id auto-generated)
   const created = await Product.create({ name: 'Shirt', price: 9.5 });

   // Modify the record
   await Product.patch(created.id, { price: Math.round(created.price * 0.8 * 100) / 100 });

   // Retrieve by primary key
   const record = await Product.get(created.id);
   ```

4. **Query with `search(` and a Query object**: Pass a query object with `conditions`, `sort`, `limit`, `offset`, `select`, and other options.

   ```javascript
   const query = {
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 8.0 }],
   };
   for await (const record of Product.search(query)) {
   	// process record
   }
   ```

5. **Construct `conditions`**: Each condition is an object with the following properties:

   | Property                   | Description                                                                                                                                                                         |
   | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `attribute`                | Property name, or array for chained/joined properties (e.g. `['brand', 'name']`)                                                                                                    |
   | `value`                    | The value to match                                                                                                                                                                  |
   | `comparator`               | `equals` (default), `greater_than`, `greater_than_equal`, `less_than`, `less_than_equal`, `starts_with`, `contains`, `ends_with`, `between`, `not_equal`, or a full-text comparator |
   | `conditions`               | Nested conditions array                                                                                                                                                             |
   | `operator`                 | `and` (default) or `or` for the nested `conditions`                                                                                                                                 |
   | `fields`                   | Full-text source fields to search                                                                                                                                                   |
   | `includeHighlights`        | Include configured full-text highlights                                                                                                                                             |
   | `maxIndexLagMilliseconds`  | Maximum accepted full-text index lag                                                                                                                                                |
   | `waitForIndexMilliseconds` | Time to wait for acceptable full-text coverage                                                                                                                                      |

   Use nested `conditions` with `operator` for compound logic:

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

6. **Apply `limit` and `offset` for pagination**:

   ```javascript
   Product.search({ conditions: [...], limit: 20, offset: 40 });
   ```

7. **Use `select` to project fields**: Pass an array of property names, a string for a single property, or nested objects for related records.

   ```javascript
   // Array of names
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

   Special `select` properties: `$id`, `$updatedtime`, `$distance`, `$score`, `$highlights`.

8. **Apply `sort`**: Provide a sort object with `attribute`, optional `descending`, and optional `next` for tie-breaking.

   | Property     | Description                                              |
   | ------------ | -------------------------------------------------------- |
   | `attribute`  | Property name or array for chained relationship property |
   | `descending` | Sort descending if `true` (default: `false`)             |
   | `next`       | Secondary sort to resolve ties (same structure)          |

   For collection queries, Harper requires one of:
   - A `sort` `attribute` marked `@indexed` — no condition required.
   - At least one `conditions` entry on any attribute when the sort attribute is not indexed.

   If neither is satisfied, Harper throws:

   > `HdbError: <attribute> is not indexed and not combined with any other conditions`

   Note: `@primaryKey` alone is treated as not indexed for sort purposes. To iterate a whole table in primary-key order, add an open-ended condition:

   ```javascript
   Product.search({
   	conditions: [{ attribute: 'id', comparator: 'greater_than', value: '' }],
   	sort: { attribute: 'id' },
   });
   ```

   Pass `allowFullScan: true` to permit an unconditional ordered scan without conditions. If order doesn't matter, omit `sort` entirely — `search({})` iterates without an index requirement.

9. **Use `explain` and `enforceExecutionOrder` for debugging and control**:
   - `explain: true` — returns conditions reordered as Harper will execute them.
   - `enforceExecutionOrder: true` — forces conditions to execute in the order supplied, disabling automatic re-ordering.

10. **Perform CRDT increments with `addTo`**: Use `addTo` on a mutable Resource instance for safe concurrent updates across threads and nodes.

    ```javascript
    static async post(target, data) {
      const record = await this.update(target.id);
      record.addTo('quantity', -1); // decrement safely across nodes
    }
    ```

11. **Use `transaction()` for explicit transactional control**: Required when code runs outside a natural transaction context (timers, background jobs). `transaction()` accepts an optional context and a callback; it commits on normal completion and aborts on throw.

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

    The `txn` object passed to the callback has:

    | Member                | Type            | Description                                            |
    | --------------------- | --------------- | ------------------------------------------------------ |
    | `commit()`            | `() => Promise` | Commits the current transaction                        |
    | `abort()`             | `() => void`    | Aborts the transaction and resets it                   |
    | `resetReadSnapshot()` | `() => void`    | Resets the read snapshot to the latest committed state |
    | `timestamp`           | `number`        | Timestamp associated with the current transaction      |

    **Atomicity**: All tables within the same database share a single transactional context — reads return a consistent snapshot and writes across multiple tables commit atomically. Cross-database operations have no atomicity guarantee.

    If `transaction()` is called with a context that already has an active transaction, it reuses that transaction — making it safe to call defensively.

12. **Keep `harper` external when bundling for SSR**: In `vite.config`, mark `harper` as external so it resolves to the runtime rather than being bundled.

    ```javascript
    // vite.config
    ssr: {
    	external: ['harper'];
    }
    ```

    Example SSR entry using `tables`:

    ```typescript
    import { tables } from 'harper';

    export async function render(url: string): Promise<string> {
    	const product = await tables.Product.get(idFromUrl(url));
    	return renderToString(/* <App product={product} /> */);
    }
    ```

## Examples

### Nested conditions with sort, limit, and offset

```javascript
import { tables } from 'harper';
const { Product } = tables;

const results = [];
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
	sort: { attribute: 'price', descending: false },
	limit: 10,
	offset: 0,
	select: ['id', 'name', 'price'],
})) {
	results.push(record);
}
```

### Relationship query with nested select and constraining conditions

```javascript
const brands = [];
for await (const brand of Brand.search({
	conditions: [{ attribute: ['products', 'price'], comparator: 'greater_than_equal', value: 30 }],
	select: [
		'id',
		'name',
		{ name: 'products', sort: { attribute: 'price' }, limit: 1, select: ['id', 'name', 'price'] },
	],
})) {
	brands.push(brand);
}
```

### Transaction with `resetReadSnapshot`

```javascript
import { tables, transaction } from 'harper';
const { MyTable } = tables;

await transaction(async (txn) => {
	const record = await MyTable.get('some-id');
	txn.resetReadSnapshot(); // refresh snapshot to latest committed state
	await MyTable.put({ ...record, status: 'processed' }, txn);
});
```

### CRDT increment with `addTo`

```javascript
import { tables } from 'harper';
const { Product } = tables;

const product = await Product.update(32);
product.status = 'active';
product.addTo('quantity', -1);
product.save();
```

## Notes

- Calls through `tables` run in a trusted server-side context and do **not** automatically apply the target table's role permissions. To enforce authorization, set `checkPermission: true` on the query and pass the authenticated `context` as the second argument to `search()` or `get()`.
- Scope destructive `update`, `patch`, and `delete` operations with specific `conditions` and validate the affected set before writing. These operate directly on stored data and are not easily reversible.
- `transaction()` must be `await`ed and wrapped in `catch` when used outside a request context. Guard against interval overlap with a `running` flag or equivalent.
- Selecting a relationship without an outer condition behaves as a **LEFT JOIN**; a top-level `conditions` entry on a related attribute behaves as an **INNER JOIN**.
- Only the combination of a non-`@indexed` sort `attribute` **and** zero `conditions` triggers `HdbError: <attribute> is not indexed and not combined with any other conditions`. Add a condition or mark the attribute `@indexed` to resolve it.
- `enforceExecutionOrder: true` disables Harper's automatic condition re-ordering; use only when execution order must be exact.
- CommonJS import is also supported: `const { tables, Resource } = require('harper');`
