---
name: vector-indexing
description: How to enable and query vector indexes for similarity search in Harper.
metadata:
  mode: generate
  sources:
    - reference/v5/database/schema.md#Vector Indexing
  sourceCommit: 3749d0c54be457a2a65d9a63c738a5dc88989ecd
  inputHash: 225b9bea420d9adc
---

# Vector Indexing

Instructions for the agent to enable HNSW vector indexes on table fields and query them for similarity search in Harper.

## When to Use

Apply this rule when adding a vector similarity search capability to a Harper table — for example, storing text embeddings and querying for nearest neighbors, filtering by distance threshold, or combining vector search with record-level access control. See [adding-tables-with-schemas.md](adding-tables-with-schemas.md) for how to define the surrounding table schema.

## How It Works

1. **Declare the vector index** on a `[Float]` field using `@indexed(type: "HNSW")`:

   ```graphql
   type Document @table {
   	id: Long @primaryKey
   	textEmbeddings: [Float] @indexed(type: "HNSW")
   }
   ```

2. **Query nearest neighbors** using the `sort` parameter with `attribute` and `target`:

   ```javascript
   let results = Document.search({
   	sort: { attribute: 'textEmbeddings', target: searchVector },
   	limit: 5,
   });
   ```

3. **Combine with filter conditions** to narrow results before or during traversal:

   ```javascript
   let results = Document.search({
   	conditions: [{ attribute: 'price', comparator: 'lt', value: 50 }],
   	sort: { attribute: 'textEmbeddings', target: searchVector },
   	limit: 5,
   });
   ```

   Conditions are evaluated _during_ graph traversal (predicate-aware search), not after. Very selective conditions are automatically diverted to an exact-scan strategy.

4. **Use a `vectorFilter` function** for predicates not expressible as conditions (JavaScript API only):

   ```javascript
   let results = Document.search(
   	{
   		sort: { attribute: 'textEmbeddings', target: searchVector },
   		vectorFilter: (record) =>
   			record.tenantId === context.user.tenantId && record.status === 'published',
   		limit: 10,
   	},
   	context,
   );
   ```

   The function receives a frozen candidate record and must return a boolean synchronously. It must be side-effect free and fast — it can run once per candidate visited during traversal (verdicts are memoized per query).

5. **Filter by distance threshold** using `target` on a condition instead of `sort`:

   ```javascript
   let results = Document.search({
   	conditions: {
   		attribute: 'textEmbeddings',
   		comparator: 'lt',
   		value: 0.1,
   		target: searchVector,
   	},
   });
   ```

6. **Include computed distance in results** using the `$distance` field in `select`:

   ```javascript
   let results = Document.search({
   	select: ['name', '$distance'],
   	sort: { attribute: 'textEmbeddings', target: searchVector },
   	limit: 5,
   });
   ```

   `$distance` works in both `sort`-based and threshold-based queries.

7. **Override the distance function or exploration budget per query** via options on the `sort` descriptor:

   ```javascript
   let results = Document.search({
   	sort: { attribute: 'textEmbeddings', target: searchVector, distance: 'dotProduct', ef: 200 },
   	limit: 5,
   });
   ```

   - `distance` — `"cosine"`, `"euclidean"`, or `"dotProduct"`.
   - `ef` — overrides the search exploration budget for this query. Higher values improve recall at the cost of latency.

8. **Tune filtered traversal** when a `vectorFilter` is very selective by raising `ef` or `filterExpansion`:

   ```javascript
   let results = Document.search(
   	{
   		sort: { attribute: 'textEmbeddings', target: searchVector, ef: 200, filterExpansion: 40 },
   		vectorFilter: (record) => record.category === 'rare',
   		limit: 10,
   	},
   	context,
   );
   ```

   Filtered traversal visits at most `ef * filterExpansion` nodes (`filterExpansion` defaults to `24`). If the budget is exhausted before results fill, the search returns what was found rather than erroring.

9. **Configure HNSW index parameters** directly on the directive:

   ```graphql
   type Document @table {
   	id: Long @primaryKey
   	textEmbeddings: [Float]
   		@indexed(type: "HNSW", distance: "euclidean", optimizeRouting: 0, efConstructionSearch: 100)
   }
   ```

   | Parameter              | Default           | Description                                                                                      |
   | ---------------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
   | `distance`             | `"cosine"`        | Distance function: `"cosine"`, `"euclidean"`, or `"dotProduct"`                                  |
   | `efConstruction`       | `100`             | Max nodes explored during index construction. Higher = better recall, lower = better performance |
   | `M`                    | `16`              | Preferred connections per graph layer                                                            |
   | `optimizeRouting`      | `0.5`             | Heuristic aggressiveness for omitting redundant connections (0 = off, 1 = most aggressive)       |
   | `mL`                   | computed from `M` | Normalization factor for level generation                                                        |
   | `efConstructionSearch` | auto-scaled       | Max nodes explored during search. When unset, auto-scales with index size                        |
   | `quantization`         | —                 | `"int8"` stores vectors quantized to int8                                                        |
   | `filterExpansion`      | `24`              | Visit-budget multiplier for filtered search                                                      |

   Changing `efConstructionSearch` on an existing index does not trigger a rebuild. Changing structural parameters (`distance`, `M`, `efConstruction`, `quantization`) does rebuild the index.

10. **Enable int8 quantization** to reduce index size and memory usage:

    ```graphql
    type Document @table {
    	id: Long @primaryKey
    	textEmbeddings: [Float] @indexed(type: "HNSW", quantization: "int8")
    }
    ```

    Graph navigation uses quantized distances. For `sort` queries, Harper re-ranks results against full-precision vectors, restoring exact ordering and exact `$distance` values. Distance-threshold queries filter on the approximate distance.

11. **Implement record-level access control** by overriding `allowRead(user, target, context)` on the table resource. During vector queries the check participates in graph traversal, so a restricted user receives the k nearest records they are allowed to see:

    ```javascript
    export class Reports extends tables.Reports {
    	allowRead(user, target, context) {
    		if (!super.allowRead(user, target, context)) return false;
    		if (user.role.permission.super_user) return true;
    		if (this.ownerId == null) return true;
    		return this.ownerId === user.id;
    	}
    }
    ```

    The check must be synchronous, side-effect free, and fast. `this` is the frozen record during per-record evaluation. A thrown exception denies that record (fail closed).

## Examples

**Full schema with custom HNSW parameters:**

```graphql
type Document @table {
	id: Long @primaryKey
	textEmbeddings: [Float]
		@indexed(type: "HNSW", distance: "euclidean", optimizeRouting: 0, efConstructionSearch: 100)
}
```

**Nearest-neighbor search with distance output:**

```javascript
let results = Document.search({
	select: ['name', '$distance'],
	sort: { attribute: 'textEmbeddings', target: searchVector },
	limit: 5,
});
```

**Filtered vector search with tuned traversal budget:**

```javascript
let results = Document.search(
	{
		sort: { attribute: 'textEmbeddings', target: searchVector, ef: 200, filterExpansion: 40 },
		vectorFilter: (record) => record.category === 'rare',
		limit: 10,
	},
	context,
);
```

**Distance threshold query (no ranking, cutoff only):**

```javascript
let results = Document.search({
	conditions: {
		attribute: 'textEmbeddings',
		comparator: 'lt',
		value: 0.1,
		target: searchVector,
	},
});
```

## Notes

- Use `@indexed(type: "HNSW")` on a `[Float]` field — not on scalar fields.
- The default `distance` is `"cosine"`. Override it per-index via the directive or per-query via the `sort` descriptor.
- `efConstruction` seeds the initial value of `efConstructionSearch`. When neither is set, the search budget auto-scales with index size.
- `vectorFilter` is available from the JavaScript API only; it cannot be expressed in a REST query string.
- The parameter name Harper reads is `efConstructionSearch` (not `efSearchConstruction`).
- `$distance` must be listed explicitly in `select` to appear in results.
- For record-level `allowRead` overrides: collection-scope calls (where `this.ownerId` is `null`) should return `true` to open the connection; per-record filtering happens during query execution and event delivery.
