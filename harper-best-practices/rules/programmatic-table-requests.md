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
  sourceCommit: 1b103f864df3a0d8444297c00e752c29c2e7e82b
  inputHash: 6021f156d870acd9
---

# Programmatic Table Requests

Instructions for the agent to interact with Harper tables programmatically using the `tables` object, the Query API, and transactions.

**Instead of:** ORM and query-builder clients (Prisma, Drizzle, Knex). Use this rule rather than adding that service. See `harper-architecture`.

## When to Use

Apply this rule when writing server-side Harper code that reads, writes, or queries tables directly — for example, in HTTP handlers, background jobs, timers, or SSR entry points. Use it whenever you need to construct queries with `conditions`, `sort`, `select`, `limit`, or `offset`, or when you need explicit transaction control via `transaction()`.

## How It Works

1. **Import `tables` (and other APIs) from `harper`**: Access every table defined in `schema.graphql` as a property of the `tables` object. Each property is the table class implementing the Resource API.

   ```javascript
   import { tables, Resource } from 'harper';
   const { Product } = tables;
   // equivalent to: databases.data.Product
   ```

   CommonJS import is also supported: `const { tables, Resource } = require('harper');`

   For components in their own directory, link the package first:

   ```bash
   npm link harper
   ```

   When bundling for SSR with Vite, keep `harper` external so it resolves to the runtime rather than being bundled — add `ssr: { external: ['harper'] }` in `vite.config`.

2. **Define your schema with `@table` (and `@indexed` for sortable/filterable attributes)**: Tables must be declared in `schema.graphql`. Mark attributes with `@indexed` to enable index-driven sorts and condition filtering without full scans.

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	name: String
   	price: Float @indexed
   }
   ```

3. **Query records using `search(`** with a Query object\*\*: Pass a query object to `Product.search(query)`. The async iterator yields matching records.

   ```javascript
   const query = {
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 8.0 }],
   };
   for await (const record of Product.search(query)) {
   	// process record
   }
   ```

4. **Build `conditions` to filter records**: Each condition object targets an attribute with a comparator and value. Nest conditions with `operator` for boolean logic.

   Condition object properties:

   | Property                   | Description                                                                                                                                                                         |
   | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `attribute`                | Property name, or an array for chained/joined properties (e.g. `['brand', 'name']`)                                                                                                 |
   | `value`                    | The value to match                                                                                                                                                                  |
   | `comparator`               | `equals` (default), `greater_than`, `greater_than_equal`, `less_than`, `less_than_equal`, `starts_with`, `contains`, `ends_with`, `between`, `not_equal`, or a full-text comparator |
   | `conditions`               | Nested conditions array                                                                                                                                                             |
   | `operator`                 | `and` (default) or `or` for the nested `conditions`                                                                                                                                 |
   | `fields`                   | Full-text source fields to search; every name must belong to the selected full-text index                                                                                           |
   | `includeHighlights`        | Include configured full-text highlights                                                                                                                                             |
   | `maxIndexLagMilliseconds`  | Maximum accepted full-text index lag                                                                                                                                                |
   | `waitForIndexMilliseconds` | Time to wait for acceptable full-text coverage                                                                                                                                      |

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

   Use an array for `attribute` to traverse relationships (chained/joined properties):

   ```javascript
   Product.search({ conditions: [{ attribute: ['brand', 'name'], value: 'Harper' }] });
   ```

5. **Use `select` to project returned fields**: Pass an array of property names, a string for a single property, or nested objects for related records.

   ```javascript
   // Flat projection
   Product.search({ select: ['name', 'price'] });

   // Whole related record
   const book = await Book.get({ id: 42, select: ['id', 'title', 'author'] });

   // Partial related record
   const book = await Book.get({
   	id: 42,
   	select: ['id', 'title', { name: 'author', select: ['name'] }],
   });

   // Multi-level nesting
   // select: ['id', 'name', { name: 'segments', select: ['id', 'name', { name: 'client', select: ['id', 'name'] }] }]
   ```

   Special `select` properties: `$id`, `$updatedtime`, `$distance`, `$score`, `$highlights`.

6. **Apply `sort`, `limit`, and `offset` for ordering and pagination**: `sort` requires either an `@indexed` attribute or at least one `conditions` entry. Omitting both triggers:

   > `HdbError: <attribute> is not indexed and not combined with any other conditions`

   The `sort` object properties:

   | Property     | Description                                                |
   | ------------ | ---------------------------------------------------------- |
   | `attribute`  | Property name (or array for chained relationship property) |
   | `descending` | Sort descending if `true` (default: `false`)               |
   | `next`       | Secondary sort to resolve ties (same structure)            |

   To iterate a whole table in primary-key order, add an open-ended condition:

   ```javascript
   Product.search({
   	conditions: [{ attribute: 'id', comparator: 'greater_than', value: '' }],
   	sort: { attribute: 'id' },
   });
   ```

   Pass `allowFullScan: true` to permit an unconditional ordered scan without conditions. If order doesn't matter, omit `sort` entirely — `search({})` iterates without an index requirement.

   Use `limit` and `offset` for pagination:

   ```javascript
   Product.search({
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 100 }],
   	sort: { attribute: 'price', descending: true, next: { attribute: 'id' } },
   	limit: 20,
   	offset: 40,
   });
   ```

7. **Use `explain` and `enforceExecutionOrder` for debugging and execution control**:
   - `explain: true` — returns conditions reordered as Harper will execute them.
   - `enforceExecutionOrder: true` — forces conditions to execute in the supplied order, disabling Harper's automatic re-ordering.

   ```javascript
   Product.search({
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 100 }],
   	explain: true,
   });
   ```

8. **Use `addTo` for concurrent-safe numeric updates**: `addTo` uses CRDT incrementation, safe across threads and nodes.

   ```javascript
   static async post(target, data) {
     const record = await this.update(target.id);
     record.addTo('quantity', -1); // decrement safely across nodes
   }
   ```

9. **Use `transaction()` for explicit transaction control**: Required when code runs outside a natural transaction context (timers, background jobs). Always `await` the call and `catch` errors. Guard against overlapping runs.

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

   The `txn` object received by the callback:

   | Member                | Type            | Description                                            |
   | --------------------- | --------------- | ------------------------------------------------------ |
   | `commit()`            | `() => Promise` | Commits the current transaction                        |
   | `abort()`             | `() => void`    | Aborts the transaction and resets it                   |
   | `resetReadSnapshot()` | `() => void`    | Resets the read snapshot to the latest committed state |
   | `timestamp`           | `number`        | Timestamp associated with the current transaction      |

   On normal callback completion the transaction commits automatically. If the callback throws, the transaction is aborted.

10. **Understand `atomicity` and transaction scope**: Transactions span a single database. All tables within the same database share one transactional context — reads return a consistent snapshot and writes across multiple tables commit atomically. Tables in different databases each get their own transaction with no cross-database atomicity guarantee.

## Examples

### Basic CRUD

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

### Nested relationship select with conditions, sort, limit, offset

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

### Collection query with relationship filter and nested select

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

- Calls through `tables` run in a trusted server-side context and do **not** automatically apply the target table's role permissions. To enforce authorization, set `checkPermission: true` on the query and pass the authenticated `context` as the second argument to `search()` or `get()`. Harper then authorizes the read using `context.user`, including table, selected-property, and full-text source-field permissions.
- Scope destructive `update`, `patch`, and `delete` operations with specific `conditions` and validate the affected set before writing. These operate on live data and are not easily reversible.
- If `transaction()` is called with a context that already has an active transaction, it reuses that transaction and executes the callback immediately — making it safe to call defensively.
- `sort` on a bare `@primaryKey` (with no conditions) triggers the not-indexed error because the primary key uses its own primary store rather than a secondary index. Add an open-ended condition or pass `allowFullScan: true` to permit an unconditional scan.
- `enforceExecutionOrder: true` disables Harper's automatic condition re-ordering — use only when you need to control execution sequence explicitly.
- `resetReadSnapshot()` on the `txn` object resets the read snapshot to the latest committed state within an active transaction.
