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
  sourceCommit: 6cd8a2ea6372924486aac46a5d96ba00c10eff07
  inputHash: 923662328c12cee3
---

# Programmatic Table Requests

Instructions for the agent to interact with Harper tables programmatically using the `tables` object, the Query API, and transactions.

**Instead of:** ORM and query-builder clients (Prisma, Drizzle, Knex). Use this rule rather than adding that service. See `harper-architecture`.

## When to Use

Apply this rule when writing server-side Harper code that reads, writes, or queries tables directly — for example, in HTTP handlers, background jobs, timers, or SSR entry points. Use it whenever you need to construct queries with `conditions`, `sort`, `select`, `limit`, or `offset`, or when you need explicit transaction control via `transaction()`.

## How It Works

1. **Import `tables` (and other APIs) from `harper`**: Access every table defined in `schema.graphql` as a property of the `tables` object. Each property is the table class implementing the Resource API.

   ```javascript
   import { tables, transaction } from 'harper';
   const { Product } = tables;
   // equivalent to: databases.data.Product
   ```

   For components in their own directory, link the package first:

   ```bash
   npm link harper
   ```

   CommonJS is also supported:

   ```javascript
   const { tables, Resource } = require('harper');
   ```

2. **Define tables in `schema.graphql` with `@table`**: Each type marked `@table` becomes a property on `tables`.

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	name: String
   	price: Float
   }
   ```

3. **Use basic CRUD methods on the table class**: `create`, `patch`, `get`, `put`, `update`, `delete` are available via the Resource API.

   ```javascript
   const created = await Product.create({ name: 'Shirt', price: 9.5 });
   await Product.patch(created.id, { price: Math.round(created.price * 0.8 * 100) / 100 });
   const record = await Product.get(created.id);
   ```

4. **Query with `search(`** and a Query object\*\*: Pass a query object with `conditions`, `sort`, `select`, `limit`, and `offset`. `search()` returns an async iterable.

   ```javascript
   const query = {
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 8.0 }],
   };
   for await (const record of Product.search(query)) {
   	// process record
   }
   ```

5. **Build `conditions` arrays to filter records**: Each condition object supports the following properties:

   | Property                   | Description                                                                                                                                                                         |
   | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `attribute`                | Property name, or array for chained/joined properties                                                                                                                               |
   | `value`                    | The value to match                                                                                                                                                                  |
   | `comparator`               | `equals` (default), `greater_than`, `greater_than_equal`, `less_than`, `less_than_equal`, `starts_with`, `contains`, `ends_with`, `between`, `not_equal`, or a full-text comparator |
   | `conditions`               | Nested conditions array                                                                                                                                                             |
   | `operator`                 | `and` (default) or `or` for nested `conditions`                                                                                                                                     |
   | `fields`                   | Full-text source fields to search                                                                                                                                                   |
   | `includeHighlights`        | Include configured full-text highlights                                                                                                                                             |
   | `maxIndexLagMilliseconds`  | Maximum accepted full-text index lag                                                                                                                                                |
   | `waitForIndexMilliseconds` | Time to wait for acceptable full-text coverage                                                                                                                                      |

   Use nested `conditions` for compound logic:

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

   Use an array for `attribute` to traverse relationships (chained references):

   ```javascript
   Product.search({ conditions: [{ attribute: ['brand', 'name'], value: 'Harper' }] });
   ```

6. **Use `select` to project returned fields**: Pass an array of property names, a string for a single property, or nested objects for related records.

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

7. **Apply `sort` with `@indexed` attributes or combine with `conditions`**: The `sort` object accepts `attribute`, `descending` (default `false`), and `next` for secondary sort.

   Harper requires one of:
   - A `sort` `attribute` marked `@indexed` in the schema — no condition required.
   - At least one entry in `conditions` when the sort attribute is not indexed.

   Sorting by a non-indexed attribute with zero conditions raises:

   > `HdbError: <attribute> is not indexed and not combined with any other conditions`

   Note: `@primaryKey` alone is treated as not indexed for sort purposes. To iterate a whole table in primary-key order, add an open-ended condition:

   ```javascript
   Product.search({
   	conditions: [{ attribute: 'id', comparator: 'greater_than', value: '' }],
   	sort: { attribute: 'id' },
   });
   ```

   Pass `allowFullScan: true` to permit an unconditional ordered scan without conditions. If order doesn't matter, omit `sort` entirely — `search({})` iterates without an index requirement.

8. **Use `limit` and `offset` for pagination**:

   ```javascript
   Product.search({
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 100 }],
   	sort: { attribute: 'price' },
   	limit: 20,
   	offset: 40,
   });
   ```

9. **Use `explain` and `enforceExecutionOrder` for debugging and optimization**:
   - `explain: true` — returns conditions reordered as Harper will execute them.
   - `enforceExecutionOrder: true` — forces conditions to execute in the supplied order, disabling Harper's automatic re-ordering.

10. **Use `addTo` for safe concurrent numeric updates**: `addTo(property, value)` uses CRDT incrementation, safe across threads and nodes.

    ```javascript
    static async post(target, data) {
      const record = await this.update(target.id);
      record.addTo('quantity', -1); // decrement safely across nodes
    }
    ```

11. **Use `transaction()` for explicit transaction control**: Required when code runs outside a natural transaction context (timers, background jobs). `transaction()` accepts an optional context and an async callback; commits on normal completion, aborts on throw.

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

    Always `await` the `transaction()` call and `catch` it. Guard against overlap when a job can outlast its interval.

12. **Understand `transaction()` atomicity**: Transactions span a single database. All tables within the same database share one transactional context — reads return a consistent snapshot and writes are committed atomically. Tables in different databases each get their own transaction with no cross-database atomicity guarantee.

13. **Use `resetReadSnapshot()` on the transaction object when needed**: The `txn` object passed to the callback exposes:

    | Member                | Type            | Description                                            |
    | --------------------- | --------------- | ------------------------------------------------------ |
    | `commit()`            | `() => Promise` | Commits the current transaction                        |
    | `abort()`             | `() => void`    | Aborts the transaction and resets it                   |
    | `resetReadSnapshot()` | `() => void`    | Resets the read snapshot to the latest committed state |
    | `timestamp`           | `number`        | Timestamp associated with the current transaction      |

14. **Keep `harper` external when bundling for SSR**: In `vite.config`, mark `harper` as external so it resolves to the runtime rather than being bundled.

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

### Relationship selection with nested conditions (targeted for v5.4.0)

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

### Explicit transaction with `addTo`

```javascript
import { tables, transaction } from 'harper';
const { Product } = tables;

await transaction(async (txn) => {
	const product = await Product.update(32, txn);
	product.addTo('quantity', -1);
	product.status = 'active';
	product.save();
});
```

### Chained relationship sort across brands and products

```javascript
Brand.search({
	conditions: [{ attribute: ['products', 'price'], comparator: 'greater_than_equal', value: 30 }],
	sort: { attribute: ['products', 'name'], next: { attribute: 'id' } },
});
```

## Notes

- Calls through `tables` run in a trusted server-side context and do **not** automatically apply the target table's role permissions. Set `checkPermission: true` on the query and pass the authenticated `context` as the second argument to `search()` or `get()`. Harper then authorizes the read using `context.user`, including table, selected-property, and full-text source-field permissions. Passing the context alone does not request this check.
- Scope destructive `update`, `patch`, and `delete` operations with specific `conditions`. Validate the affected set before writing. These operations act on live data and are not easily reversible.
- `transaction()` is safe to call defensively: if the context already has an active transaction, it reuses it and executes the callback immediately.
- `enforceExecutionOrder: true` disables Harper's automatic condition reordering — use only when you need to control execution sequence explicitly.
- For components in standalone directories, run `npm link harper` to ensure typings resolve to the current running installation. All installed components have `harper` automatically linked.
- When using `vite.config` for SSR builds, always set `ssr: { external: ['harper'] }` — symlinked dependencies are not reliably auto-externalized.
