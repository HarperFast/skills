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

Instructions for the agent to interact with Harper tables programmatically using the `tables` object and its query API.

## When to Use

Apply this rule when writing server-side Harper code that reads, writes, or queries table data directly — for example, in HTTP handlers, background jobs, or SSR entry points. Use it whenever you need to construct a `search()` query with `conditions`, `select`, `sort`, or other query parameters, or when you need to perform CRDT-safe mutations with `addTo`.

## How It Works

1. **Import `tables`**: Import from the `harper` package. Each table defined in `schema.graphql` with `@table` is available as a property.

   ```javascript
   import { tables } from 'harper';
   const { Product } = tables;
   // same as: databases.data.Product
   ```

2. **Create, patch, and retrieve records**: Use `create`, `patch`, and `get` on the table class.

   ```javascript
   const created = await Product.create({ name: 'Shirt', price: 9.5 });
   await Product.patch(created.id, { price: Math.round(created.price * 0.8 * 100) / 100 });
   const record = await Product.get(created.id);
   ```

3. **Query with `search(` and `conditions`**: Pass a query object to `search()`. The `conditions` array filters records.

   ```javascript
   const query = {
   	conditions: [{ attribute: 'price', comparator: 'less_than', value: 8.0 }],
   };
   for await (const record of Product.search(query)) {
   	// ...
   }
   ```

   Each condition object supports these properties:

   | Property     | Description                                                                                                                                              |
   | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `attribute`  | Property name, or array for chained/joined properties (e.g. `['brand', 'name']`)                                                                         |
   | `value`      | The value to match                                                                                                                                       |
   | `comparator` | `equals` (default), `greater_than`, `greater_than_equal`, `less_than`, `less_than_equal`, `starts_with`, `contains`, `ends_with`, `between`, `not_equal` |
   | `conditions` | Nested conditions array                                                                                                                                  |
   | `operator`   | `and` (default) or `or` for the nested `conditions`                                                                                                      |

4. **Use `select` to shape results**: Pass `select` in the query object to control which properties are returned.
   - Array of names: `['name', 'price']`
   - Single string: `'id'`
   - Nested select for relationships: `[{ name: 'brand', select: ['id', 'name'] }]`
   - Special properties: `$id`, `$updatedtime`, `$distance`

   ```javascript
   const book = await Book.get({
   	id: 42,
   	select: ['id', 'title', { name: 'author', select: ['name'] }],
   });
   ```

5. **Sort results**: Include a `sort` object in the query. The `attribute` must be `@indexed`, or at least one `conditions` entry must be present.

   | Property     | Description                                                |
   | ------------ | ---------------------------------------------------------- |
   | `attribute`  | Property name (or array for chained relationship property) |
   | `descending` | Sort descending if `true` (default: `false`)               |
   | `next`       | Secondary sort to resolve ties (same structure)            |

   To iterate a whole table in primary-key order, add an open-ended range condition:

   ```javascript
   Product.search({
   	conditions: [{ attribute: 'id', comparator: 'greater_than', value: '' }],
   	sort: { attribute: 'id' },
   });
   ```

   Pass `allowFullScan: true` to permit an unconditional ordered scan without conditions.

6. **Perform CRDT-safe increments with `addTo`**: Use `addTo` on a mutable resource instance to safely increment or decrement a numeric property across concurrent threads and nodes.

   ```javascript
   static async post(target, data) {
     const record = await this.update(target.id);
     record.addTo('quantity', -1); // decrement safely across nodes
   }
   ```

7. **Scope destructive operations carefully**: `update`, `patch`, and `delete` operate directly on stored data. Always scope with specific `conditions`, validate the affected set before writing, and gate behind authorization controls.

## Examples

**Nested conditions with `operator: 'or'`:**

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

**Chained attribute reference for relationships:**

```javascript
Product.search({ conditions: [{ attribute: ['brand', 'name'], value: 'Harper' }] });
```

**Selecting nested related records:**

```javascript
// Whole related record
const book = await Book.get({ id: 42, select: ['id', 'title', 'author'] });
book.author.name;

// Partial related record
const book = await Book.get({
	id: 42,
	select: ['id', 'title', { name: 'author', select: ['name'] }],
});

// Multi-level nesting
select: [
	'id',
	'name',
	{ name: 'segments', select: ['id', 'name', { name: 'client', select: ['id', 'name'] }] },
];
```

**SSR usage:**

```typescript
import { tables } from 'harper';

export async function render(url: string): Promise<string> {
	const product = await tables.Product.get(idFromUrl(url));
	return renderToString(/* <App product={product} /> */);
}
```

## Notes

- `tables` is shorthand for `databases.data` — both reference the same live, process-wide objects.
- Calls through `tables` run in a trusted server-side context and do **not** automatically apply the target table's role permissions.
- Selecting a relationship without filtering on it behaves as a **LEFT JOIN**; adding a condition on a related attribute behaves as an **INNER JOIN**.
- A non-indexed `sort` attribute with zero `conditions` raises `HdbError: <attribute> is not indexed and not combined with any other conditions`. The bare `@primaryKey` is treated as not indexed for this purpose.
- Use `explain: true` in the query object to see conditions reordered as Harper will execute them (debugging/optimization).
- Use `enforceExecutionOrder: true` to force conditions to execute in the supplied order, disabling automatic re-ordering.
- Keep `harper` external when bundling for SSR (e.g. `ssr: { external: ['harper'] }` in `vite.config`) so it resolves to the runtime.
