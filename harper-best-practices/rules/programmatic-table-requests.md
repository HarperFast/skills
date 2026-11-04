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
  sourceCommit: e4a7bd899e1a68a83d9ed1d770ec73569fabc260
  inputHash: 1cf263fc987b2fbd
---

# Programmatic Table Requests

Instructions for the agent to follow when interacting with Harper tables programmatically using the `tables` object.

**Instead of:** ORM and query-builder clients (Prisma, Drizzle, Knex). Use this rule rather than adding that service. See `harper-architecture`.

## When to Use

Apply this rule when writing server-side code that reads, writes, queries, or transacts against Harper tables directly — for example, in HTTP handlers, background jobs, timers, or SSR entry points. Use it whenever you need to construct query objects with `conditions`, `sort`, `select`, `limit`, or `offset`, or when you need explicit transaction control via `transaction()`.

## How It Works

1. **Import `tables` (and other APIs) from `harper`**: Access tables by destructuring from the `tables` object. Each table defined with `@table` in `schema.graphql` is a property of `tables`.

   ```javascript
   import { tables, transaction } from 'harper';
   const { Product } = tables;
   // equivalent to: databases.data.Product
   ```

   For components in their own directory, link the package first:

   ```bash
   npm link harper
   ```

   For Vite SSR bundles, keep `harper` external so it resolves to the runtime rather than being bundled:

   ```javascript
   // vite.config
   ssr: {
   	external: ['harper'];
   }
   ```

2. **Define your schema with `@table` and `@indexed`**: Tables must be declared in `schema.graphql`. Mark attributes you intend to sort or filter by with `@indexed` to enable index-driven queries.

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	name: String
   	price: Float @indexed
   }
   ```

3. **Build a query object with `conditions`**: Pass a query object to `search(` or `get()`. Each entry in `conditions` specifies an `attribute`, a `comparator`, and a `value`.

   ```javascript
   const query = {
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 8.0 }],
   };
   for await (const record of Product.search(query)) {
   	// process record
   }
   ```

   Supported `comparator` values: `equals` (default), `greater_than`, `greater_than_equal`, `less_than`, `less_than_equal`, `starts_with`, `contains`, `ends_with`, `between`, `not_equal`, and full-text comparators (`matches`, `matches_all`, `matches_phrase`, `matches_prefix`, `matches_fuzzy`, `matches_fuzzy_prefix`, and their `not_` forms).

   Nest conditions with `operator: 'or'` or `operator: 'and'` (default):

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

   Use an array for `attribute` to traverse relationships:

   ```javascript
   Product.search({ conditions: [{ attribute: ['brand', 'name'], value: 'Harper' }] });
   ```

   The full set of condition properties:

   | Property                   | Description                                                                                                                                                                         |
   | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `attribute`                | Property name, or an array for chained/joined properties                                                                                                                            |
   | `value`                    | The value to match                                                                                                                                                                  |
   | `comparator`               | `equals` (default), `greater_than`, `greater_than_equal`, `less_than`, `less_than_equal`, `starts_with`, `contains`, `ends_with`, `between`, `not_equal`, or a full-text comparator |
   | `conditions`               | Nested conditions array                                                                                                                                                             |
   | `operator`                 | `and` (default) or `or` for the nested `conditions`                                                                                                                                 |
   | `fields`                   | Full-text source fields to search                                                                                                                                                   |
   | `includeHighlights`        | Include configured full-text highlights                                                                                                                                             |
   | `maxIndexLagMilliseconds`  | Maximum accepted full-text index lag                                                                                                                                                |
   | `waitForIndexMilliseconds` | Time to wait for acceptable full-text coverage                                                                                                                                      |

4. **Query with `search()`**: `search()` accepts a query object and returns an async iterable. Use `search({})` to iterate without conditions — this requires no index. If order doesn't matter, omit `sort` entirely and `search({})` iterates without an index requirement.

5. **Apply `select` to control returned fields**: Pass an array of property names, a string for a single property, or nested objects for related records.

   ```javascript
   // Array of fields
   Product.search({ select: ['name', 'price'] });

   // Partial related record
   const book = await Book.get({
   	id: 42,
   	select: ['id', 'title', { name: 'author', select: ['name'] }],
   });

   // Special properties: $id, $updatedtime, $distance, $score, $highlights
   ```

6. **Use `sort` with an `@indexed` attribute or a condition**: Harper requires either an `@indexed` sort attribute or at least one entry in `conditions`. Sorting by a non-indexed attribute with no conditions throws:

   > `HdbError: <attribute> is not indexed and not combined with any other conditions`

   To iterate a whole table in primary-key order, add an open-ended condition:

   ```javascript
   Product.search({
   	conditions: [{ attribute: 'id', comparator: 'greater_than', value: '' }],
   	sort: { attribute: 'id' },
   });
   ```

   Pass `allowFullScan: true` to permit an unconditional ordered scan without conditions. If order doesn't matter, omit `sort` entirely — `search({})` iterates without an index requirement.

   `sort` properties:

   | Property     | Description                                              |
   | ------------ | -------------------------------------------------------- |
   | `attribute`  | Property name or array for chained relationship property |
   | `descending` | Sort descending if `true` (default: `false`)             |
   | `next`       | Secondary sort to resolve ties (same structure)          |

7. **Paginate with `limit` and `offset`**: Bound result sets using `limit` (maximum records to return) and `offset` (records to skip).

   ```javascript
   Product.search({
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 100 }],
   	limit: 20,
   	offset: 40,
   });
   ```

8. **Use `explain` and `enforceExecutionOrder` for debugging and control**:
   - Set `explain: true` to return conditions reordered as Harper will execute them.
   - Set `enforceExecutionOrder: true` to force conditions to execute in the order supplied, disabling Harper's automatic re-ordering.

   ```javascript
   Product.search({
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 100 }],
   	explain: true,
   });
   ```

9. **Use `addTo` for concurrent-safe numeric updates**: Call `addTo` on a mutable Resource instance to increment or decrement a property using CRDT incrementation, safe across threads and nodes.

   ```javascript
   static async post(target, data) {
     const record = await this.update(target.id);
     record.addTo('quantity', -1); // decrement safely across nodes
   }
   ```

10. **Wrap background or timer work in `transaction()`**: HTTP handlers get a transaction automatically. Use `transaction()` explicitly for timers, background jobs, or any code outside a natural transaction context.

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

    Understand **atomicity**: all tables within the same database share one transactional context — reads return a consistent snapshot and writes across multiple tables commit atomically. Tables in different databases each get their own transaction with no cross-database atomicity guarantee.

## Examples

**Basic CRUD and query:**

```javascript
import { tables } from 'harper';
const { Product } = tables;

// Create
const created = await Product.create({ name: 'Shirt', price: 9.5 });

// Patch
await Product.patch(created.id, { price: Math.round(created.price * 0.8 * 100) / 100 });

// Get by primary key
const record = await Product.get(created.id);

// Query with conditions
const query = {
	conditions: [{ attribute: 'price', comparator: 'less_than', value: 8.0 }],
};
for await (const record of Product.search(query)) {
	// process record
}
```

**Explicit transaction in a timer (background job):**

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

**SSR with Vite reading directly from Harper:**

```typescript
import { tables } from 'harper';

export async function render(url: string): Promise<string> {
	const product = await tables.Product.get(idFromUrl(url));
	return renderToString(/* <App product={product} /> */);
}
```

Keep `harper` external in `vite.config` (`ssr: { external: ['harper'] }`) so it resolves to the runtime.

**Nested relationship select with conditions, sort, limit, and offset:**

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

## Notes

- Calls through `tables` and `databases` run in a trusted server-side context and do not automatically apply the target table's role permissions. Set `checkPermission: true` on the query and pass the authenticated `context` as the second argument. Harper then authorizes the read using `context.user`, including table, selected-property, and full-text source-field permissions. Passing the context alone does not request this check.
- Programmatic `update`, `patch`, and `delete` calls operate directly on stored data. Scope destructive operations with specific `conditions`, validate the affected set before writing, and gate them behind authorization controls.
- `transaction()` is safe to call defensively: if the context already has an active transaction, it reuses it and executes the callback immediately.
- Always `await` the `transaction()` call and `catch` errors when outside a request context. Guard against overlap in timers using a flag like `running` to prevent two transactions opening over the same rows.
- The bare `@primaryKey` is treated as not indexed for sort purposes (it uses the primary store, not a secondary index). Sorting by primary key alone with no conditions triggers `HdbError: <attribute> is not indexed and not combined with any other conditions`. Add an open-ended range condition or pass `allowFullScan: true` to permit an unconditional scan.
- `enforceExecutionOrder: true` disables Harper's automatic condition reordering; use only when you need to control execution sequence explicitly.
