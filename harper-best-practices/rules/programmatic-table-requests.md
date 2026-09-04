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
  sourceCommit: 677ad213d67822e109c83619e181ca23a59823db
  inputHash: ce2181ecade6522f
---

# Programmatic Table Requests

Instructions for the agent to interact with Harper tables programmatically using the `tables` object, including querying, transactions, and module integration.

## When to Use

Apply this rule when writing server-side Harper component code that reads from or writes to tables directly — bypassing REST endpoints — such as in request handlers, background jobs, timers, or SSR rendering. Use it whenever you need to construct queries with `conditions`, manage transactions explicitly, or perform CRDT-safe mutations.

## How It Works

1. **Import `tables` from `harper`**: Access all tables in the default `data` database via the `tables` object. Each table defined with `@table` in `schema.graphql` is a property.

   ```javascript
   import { tables } from 'harper';
   const { Product } = tables;
   // same as: databases.data.Product
   ```

2. **Define your schema with `@table`**: Tables must be declared in `schema.graphql`. Use `@indexed` on attributes you intend to sort or filter efficiently.

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	name: String
   	price: Float
   }
   ```

3. **Use `search(` to query records**: Pass a Query object to `search(`. Iterate results with `for await`.

   ```javascript
   const query = {
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 8.0 }],
   };
   for await (const record of Product.search(query)) {
   	// process record
   }
   ```

4. **Build `conditions` arrays to filter**: Each condition object supports these properties:

   | Property     | Description                                                                                                                                              |
   | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `attribute`  | Property name, or array for chained/joined properties (e.g. `['brand', 'name']`)                                                                         |
   | `value`      | The value to match                                                                                                                                       |
   | `comparator` | `equals` (default), `greater_than`, `greater_than_equal`, `less_than`, `less_than_equal`, `starts_with`, `contains`, `ends_with`, `between`, `not_equal` |
   | `conditions` | Nested conditions array                                                                                                                                  |
   | `operator`   | `and` (default) or `or` for the nested `conditions`                                                                                                      |

5. **Apply `select` to shape results**: Return only the fields you need. Supports arrays, nested relationship selects, and special properties.

   ```javascript
   // Array of fields
   Product.search({ select: ['name', 'price'] });

   // Nested relationship select
   Book.get({ id: 42, select: ['id', 'title', { name: 'author', select: ['name'] }] });
   ```

   Special `select` values: `$id`, `$updatedtime`, `$distance`.

6. **Apply `sort` with an `@indexed` attribute**: Harper uses an index to provide sort order. Sort by an `@indexed` attribute without requiring a condition, or provide at least one condition when sorting by a non-indexed attribute.

   ```javascript
   // Sort by primary key with an open-ended condition to avoid scan error
   Product.search({
   	conditions: [{ attribute: 'id', comparator: 'greater_than', value: '' }],
   	sort: { attribute: 'id' },
   });
   ```

   Sort object properties:

   | Property     | Description                                              |
   | ------------ | -------------------------------------------------------- |
   | `attribute`  | Property name or array for chained relationship property |
   | `descending` | Sort descending if `true` (default: `false`)             |
   | `next`       | Secondary sort to resolve ties (same structure)          |

7. **Use `limit` and `offset` for pagination**:

   ```javascript
   Product.search({ conditions: [...], limit: 20, offset: 40 });
   ```

8. **Use `explain` and `enforceExecutionOrder` for debugging**:
   - `explain: true` — returns conditions reordered as Harper will execute them.
   - `enforceExecutionOrder: true` — forces conditions to execute in the order supplied, disabling automatic re-ordering.

9. **Use `addTo` for concurrent-safe numeric updates**: `addTo` uses CRDT incrementation, safe across threads and nodes.

   ```javascript
   static async post(target, data) {
     const record = await this.update(target.id);
     record.addTo('quantity', -1); // decrement safely across nodes
   }
   ```

10. **Wrap background work in `transaction()`**: HTTP handlers get a transaction automatically. Use `transaction()` explicitly for timers, background jobs, or any code outside a natural transaction context.

    ```javascript
    import { tables } from 'harper';
    const { MyTable } = tables;

    if (isMainThread) {
    	setInterval(async () => {
    		let data = await (await fetch('https://example.com/data')).json();
    		transaction(async (txn) => {
    			for (let item of data) {
    				await MyTable.put(item, txn);
    			}
    		});
    	}, 3600000); // every hour
    }
    ```

    The `txn` object members:

    | Member                | Type            | Description                                            |
    | --------------------- | --------------- | ------------------------------------------------------ |
    | `commit()`            | `() => Promise` | Commits the current transaction                        |
    | `abort()`             | `() => void`    | Aborts the transaction and resets it                   |
    | `resetReadSnapshot()` | `() => void`    | Resets the read snapshot to the latest committed state |
    | `timestamp`           | `number`        | Timestamp associated with the current transaction      |

11. **Understand atomicity boundaries**: All tables within the same database share one transactional context — writes across multiple tables commit atomically. Tables in different databases each get their own transaction with no cross-database atomicity guarantee.

12. **Keep `harper` external in bundlers**: When using SSR bundlers, mark `harper` as external so it resolves to the live runtime. In `vite.config`:

    ```javascript
    ssr: {
    	external: ['harper'];
    }
    ```

## Examples

### Nested conditions query

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

### Full CRUD sequence

```javascript
// Create a new record (id auto-generated)
const created = await Product.create({ name: 'Shirt', price: 9.5 });

// Modify the record
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

### SSR rendering with `tables`

```typescript
import { tables } from 'harper';

export async function render(url: string): Promise<string> {
	const product = await tables.Product.get(idFromUrl(url));
	return renderToString(/* <App product={product} /> */);
}
```

### Mutable update with `addTo`

```javascript
const product = await Product.update(32);
product.status = 'active';
product.subtractFrom('quantity', 1);
product.save();
```

## Notes

- `tables` calls run in a trusted server-side context and do **not** automatically apply the target table's role permissions. Enforce authorization in your own application logic.
- Destructive operations (`update`, `patch`, `delete`) act on live data and are not easily reversible. Always scope with specific `conditions`, validate the affected set before writing, and gate behind authorization controls.
- Sorting by the bare `@primaryKey` alone with no conditions triggers `HdbError: <attribute> is not indexed and not combined with any other conditions`. Add an open-ended range condition or pass `allowFullScan: true` to permit an unconditional scan.
- Selecting a relationship field without filtering on it behaves as a **LEFT JOIN**; adding a condition on a related attribute behaves as an **INNER JOIN**.
- `transaction()` is safe to call defensively — if a transaction is already active on the context, it reuses it and executes the callback immediately.
- Link the `harper` package for correct typings in standalone component directories: `npm link harper`.
