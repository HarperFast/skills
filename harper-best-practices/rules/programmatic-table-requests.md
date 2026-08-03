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
  sourceCommit: 3749d0c54be457a2a65d9a63c738a5dc88989ecd
  inputHash: ace5c3f4a0ad4519
---

# Programmatic Table Requests

Instructions for the agent to interact with Harper tables programmatically using the `tables` object and its query API.

## When to Use

Apply this rule when writing server-side code that reads from or writes to Harper tables directly — for example, in request handlers, background jobs, or SSR rendering — without going through the REST API. Use it whenever you need to construct queries with `conditions`, `select`, `sort`, or `search(`.

## How It Works

1. **Import `tables`**: Pull `tables` from the `harper` package. Each property on `tables` corresponds to a table defined in `schema.graphql`.

   ```javascript
   import { tables } from 'harper';
   const { Product } = tables;
   // same as: databases.data.Product
   ```

2. **Define your schema**: Declare tables with `@table` in `schema.graphql`. Each type becomes a property on `tables`.

   ```graphql
   type Product @table {
   	id: Long @primaryKey
   	name: String
   	price: Float
   }
   ```

3. **Create and modify records**: Use `create`, `patch`, and `get` for basic CRUD.

   ```javascript
   const created = await Product.create({ name: 'Shirt', price: 9.5 });
   await Product.patch(created.id, { price: Math.round(created.price * 0.8 * 100) / 100 });
   const record = await Product.get(created.id);
   ```

4. **Query with `search(`**: Pass a query object to `Product.search(query)`. It returns an async iterable.

   ```javascript
   const query = {
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 8.0 }],
   };
   for await (const record of Product.search(query)) {
   	// process record
   }
   ```

5. **Build `conditions`**: Each condition object filters records. Nest conditions with `operator` for boolean logic.

   | Property     | Description                                                                                                                                              |
   | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `attribute`  | Property name, or array for chained/joined properties (e.g. `['brand', 'name']`)                                                                         |
   | `value`      | The value to match                                                                                                                                       |
   | `comparator` | `equals` (default), `greater_than`, `greater_than_equal`, `less_than`, `less_than_equal`, `starts_with`, `contains`, `ends_with`, `between`, `not_equal` |
   | `conditions` | Nested conditions array                                                                                                                                  |
   | `operator`   | `and` (default) or `or` for the nested `conditions`                                                                                                      |

6. **Use `select`** to control which properties are returned. Accepts an array of property names, a string for a single property, or nested objects for relationships.

   ```javascript
   // Array of names
   Product.search({ select: ['name', 'price'] });

   // Nested relationship select
   Book.get({ id: 42, select: ['id', 'title', { name: 'author', select: ['name'] }] });
   ```

   Special `select` values:
   - `$id` — returns the primary key regardless of its name
   - `$updatedtime` — returns the last-updated timestamp
   - `$distance` — returns the computed distance when querying a vector index

7. **Use `addTo`** for concurrent-safe numeric increments (CRDT incrementation, safe across threads and nodes).

   ```javascript
   const record = await Product.update(target.id);
   record.addTo('quantity', -1);
   ```

8. **Apply `sort`, `limit`, and `offset`** for ordering and pagination. A `sort` attribute must be `@indexed`, or at least one `conditions` entry must be present. Pass `allowFullScan: true` to permit an unconditional ordered scan.

   ```javascript
   Product.search({
   	conditions: [{ attribute: 'id', comparator: 'greater_than', value: '' }],
   	sort: { attribute: 'id' },
   });
   ```

   | Sort property | Description                                                |
   | ------------- | ---------------------------------------------------------- |
   | `attribute`   | Property name (or array for chained relationship property) |
   | `descending`  | Sort descending if `true` (default: `false`)               |
   | `next`        | Secondary sort to resolve ties (same structure)            |

## Examples

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

**Chained attribute reference (relationship join):**

```javascript
Product.search({ conditions: [{ attribute: ['brand', 'name'], value: 'Harper' }] });
```

**Deep nested `select` across multiple relationships:**

```javascript
Product.search({
	select: [
		'id',
		'name',
		{ name: 'segments', select: ['id', 'name', { name: 'client', select: ['id', 'name'] }] },
	],
});
```

**SSR usage — read directly from `tables` in a render function:**

```typescript
import { tables } from 'harper';

export async function render(url: string): Promise<string> {
	const product = await tables.Product.get(idFromUrl(url));
	return renderToString(/* <App product={product} /> */);
}
```

## Notes

- Scope destructive operations (`update`, `patch`, `delete`) with specific `conditions` and validate the affected set before writing. These operate on live data and are not easily reversible.
- Sorting by a bare `@primaryKey` with no conditions raises `HdbError: <attribute> is not indexed and not combined with any other conditions`. Add an open-ended condition or pass `allowFullScan: true`.
- Selecting a relationship field without filtering on it behaves as a **LEFT JOIN**. Adding a condition on a related attribute (e.g. `attribute: ['author', 'name']`) behaves as an **INNER JOIN**.
- A to-many relationship resolves to an array; `await` the property before iterating when needed.
- `tables` and `databases.data` reference the same live objects — a record written through one component is immediately visible to all others.
- Keep `harper` external when bundling for SSR (e.g. `ssr: { external: ['harper'] }` in `vite.config`) so it resolves to the runtime.
