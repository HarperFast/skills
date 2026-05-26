---
name: vector-indexing
description: How to enable and query vector indexes for similarity search in Harper.
metadata:
  mode: generate
  sources:
    - reference/v5/database/schema.md#Vector Indexing
  sourceCommit: e8fc9e51c7c04637b8ec02d073eed42d495034f1
  inputHash: 9c47b18c8795e403
---

# Vector Indexing

Instructions for the agent to follow when enabling and querying vector indexes for similarity search in Harper using the HNSW algorithm.

## When to Use

Apply this rule when adding a vector index to a Harper table schema to support approximate nearest-neighbor (similarity) search on high-dimensional float arrays. Use it whenever a query requires ranking results by vector similarity, optionally combined with filter conditions.

## How It Works

1. **Define the table schema with a vector index**: Add `@indexed(type: "HNSW")` to a `[Float]` attribute on a `@table` type. See [adding-tables-with-schemas](adding-tables-with-schemas.md) for general schema setup.

   ```graphql
   type Document @table {
   	id: Long @primaryKey
   	textEmbeddings: [Float] @indexed(type: "HNSW")
   }
   ```

2. **Query by nearest neighbors**: Call `.search()` with a `sort` parameter specifying the indexed `attribute` and a `target` vector. The `target` is the query vector to compare against.

   ```javascript
   let results = Document.search({
   	sort: { attribute: 'textEmbeddings', target: searchVector },
   	limit: 5,
   });
   ```

3. **Combine with filter conditions**: Add a `conditions` array alongside `sort` to filter results before ranking by similarity.

   ```javascript
   let results = Document.search({
   	conditions: [{ attribute: 'price', comparator: 'lt', value: 50 }],
   	sort: { attribute: 'textEmbeddings', target: searchVector },
   	limit: 5,
   });
   ```

4. **Tune HNSW parameters**: Pass additional parameters directly in the `@indexed` directive to control index quality and performance.

   | Parameter              | Default           | Description                                                                                         |
   | ---------------------- | ----------------- | --------------------------------------------------------------------------------------------------- |
   | `distance`             | `"cosine"`        | Distance function: `"euclidean"` or `"cosine"` (negative cosine similarity)                         |
   | `efConstruction`       | `100`             | Max nodes explored during index construction. Higher = better recall, lower = better performance    |
   | `M`                    | `16`              | Preferred connections per graph layer. Higher = more space, better recall for high-dimensional data |
   | `optimizeRouting`      | `0.5`             | Heuristic aggressiveness for omitting redundant connections (0 = off, 1 = most aggressive)          |
   | `mL`                   | computed from `M` | Normalization factor for level generation                                                           |
   | `efSearchConstruction` | `50`              | Max nodes explored during search                                                                    |

## Examples

Schema with default settings:

```graphql
type Document @table {
	id: Long @primaryKey
	textEmbeddings: [Float] @indexed(type: "HNSW")
}
```

Schema with custom parameters (euclidean distance, routing disabled, higher search recall):

```graphql
type Document @table {
	id: Long @primaryKey
	textEmbeddings: [Float]
		@indexed(type: "HNSW", distance: "euclidean", optimizeRouting: 0, efSearchConstruction: 100)
}
```

Filtered nearest-neighbor search:

```javascript
let results = Document.search({
	conditions: [{ attribute: 'price', comparator: 'lt', value: 50 }],
	sort: { attribute: 'textEmbeddings', target: searchVector },
	limit: 5,
});
```

## Notes

- The default `distance` function is `cosine`. Use `"euclidean"` when your vectors are not normalized or when Euclidean geometry better fits your use case.
- Increasing `efConstruction` improves index recall at the cost of build performance.
- `mL` is computed automatically from `M` unless explicitly overridden.
- Always pair `sort` with a `limit` to bound the number of nearest-neighbor results returned.
