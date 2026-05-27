---
name: vector-indexing
description: How to enable and query vector indexes for similarity search in Harper.
metadata:
  mode: generate
  sources:
    - reference/v5/database/schema.md#Vector Indexing
  sourceCommit: 6d4a30ccd5b32528e0e9963565782dca9fff5ada
  inputHash: 3732961c671aac00
---

# Vector Indexing

Instructions for the agent to follow when enabling and querying vector indexes for similarity search in Harper using the HNSW algorithm.

## When to Use

Apply this rule when adding a vector index to a Harper table schema or writing similarity search queries against high-dimensional vector fields. Use it whenever you need approximate nearest-neighbor search, distance-threshold filtering, or distance-scored results.

## How It Works

1. **Declare a vector index on a `[Float]` field**: Add `@indexed(type: "HNSW")` to any `[Float]` attribute in a `@table` type. See [adding-tables-with-schemas.md](adding-tables-with-schemas.md) for general schema setup.

   ```graphql
   type Document @table {
   	id: Long @primaryKey
   	textEmbeddings: [Float] @indexed(type: "HNSW")
   }
   ```

2. **Query by nearest neighbors using `sort`**: Call `Document.search()` with a `sort` object specifying `attribute` (the indexed field) and `target` (the query vector). Include `limit` to cap results.

   ```javascript
   let results = Document.search({
   	sort: { attribute: 'textEmbeddings', target: searchVector },
   	limit: 5,
   });
   ```

3. **Combine HNSW with filter conditions**: Add a `conditions` array alongside `sort` to pre-filter records before ranking by similarity.

   ```javascript
   let results = Document.search({
   	conditions: [{ attribute: 'price', comparator: 'lt', value: 50 }],
   	sort: { attribute: 'textEmbeddings', target: searchVector },
   	limit: 5,
   });
   ```

4. **Filter by distance threshold**: Place `target` directly on a condition (alongside `attribute`, `comparator`, and `value`) to return only records whose distance to the target vector is below a threshold. Use this form to bound result quality by a similarity cutoff rather than ranking.

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

5. **Include computed distance in results**: Add `'$distance'` to the `select` array to return the computed distance from the target vector alongside each record. `$distance` works in both `sort`-based and `conditions`-based queries.

   ```javascript
   let results = Document.search({
   	select: ['name', '$distance'],
   	sort: { attribute: 'textEmbeddings', target: searchVector },
   	limit: 5,
   });
   ```

6. **Tune HNSW parameters**: Pass additional parameters to `@indexed(type: "HNSW", ...)` to control index quality and performance:

   | Parameter              | Default           | Description                                                                                         |
   | ---------------------- | ----------------- | --------------------------------------------------------------------------------------------------- |
   | `distance`             | `"cosine"`        | Distance function: `"euclidean"` or `"cosine"` (negative cosine similarity)                         |
   | `efConstruction`       | `100`             | Max nodes explored during index construction. Higher = better recall, lower = better performance    |
   | `M`                    | `16`              | Preferred connections per graph layer. Higher = more space, better recall for high-dimensional data |
   | `optimizeRouting`      | `0.5`             | Heuristic aggressiveness for omitting redundant connections (0 = off, 1 = most aggressive)          |
   | `mL`                   | computed from `M` | Normalization factor for level generation                                                           |
   | `efSearchConstruction` | `50`              | Max nodes explored during search                                                                    |

## Examples

**Schema with custom HNSW parameters:**

```graphql
type Document @table {
	id: Long @primaryKey
	textEmbeddings: [Float]
		@indexed(type: "HNSW", distance: "euclidean", optimizeRouting: 0, efSearchConstruction: 100)
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

**Distance-threshold filter (no ranking):**

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

- The default `distance` function is `cosine`. To use Euclidean distance, set `distance: "euclidean"` in the `@indexed` directive.
- `efConstruction` controls index build quality; increase it to improve recall at the cost of slower indexing.
- `$distance` is a special field — prefix it with `$` exactly as shown; it is not a schema attribute.
- `target` is required in both `sort`-based and threshold-based condition queries to identify the reference vector for distance computation.
