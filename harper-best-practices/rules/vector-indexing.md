---
name: vector-indexing
description: How to enable and query vector indexes for similarity search in Harper.
metadata:
  mode: generate
  sources:
    - reference/v5/database/schema.md#Vector Indexing
  sourceCommit: d4cbc1a7dd400462e4a3243f944b3a75d89b29ca
  inputHash: 1dae788bc850ea90
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

2. **Query nearest neighbors** using `Document.search()` with the `sort` parameter. Set `attribute` to the indexed field and `target` to the query vector:

   ```javascript
   let results = Document.search({
   	sort: { attribute: 'textEmbeddings', target: searchVector },
   	limit: 5,
   });
   ```

3. **Combine with filter conditions** to narrow results before or during graph traversal. Selective conditions are automatically diverted to an exact-scan strategy:

   ```javascript
   let results = Document.search({
   	conditions: [{ attribute: 'price', comparator: 'lt', value: 50 }],
   	sort: { attribute: 'textEmbeddings', target: searchVector },
   	limit: 5,
   });
   ```

4. **Apply a function predicate during traversal** using `vectorFilter` (JavaScript API only). The function receives each candidate record and must return a synchronous boolean. It must be side-effect free and fast:

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

5. **Filter by distance threshold** using `target` directly on a condition alongside `comparator` and `value`. This returns matches within the threshold without using `sort`:

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

6. **Include computed distance in results** by adding `$distance` to `select`. Works with both `sort`-based and threshold queries:

   ```javascript
   let results = Document.search({
   	select: ['name', '$distance'],
   	sort: { attribute: 'textEmbeddings', target: searchVector },
   	limit: 5,
   });
   ```

7. **Tune per-query search options** on the `sort` descriptor using `distance` and `ef`:

   ```javascript
   let results = Document.search({
   	sort: { attribute: 'textEmbeddings', target: searchVector, distance: 'dotProduct', ef: 200 },
   	limit: 5,
   });
   ```

8. **Tune filtered traversal** with `ef` and `filterExpansion` when a `vectorFilter` is very selective. The visit budget is `ef * filterExpansion` nodes (`filterExpansion` defaults to `24`):

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

9. **Enforce row-level access control** using `rowFilter` on search and subscription targets (JavaScript API only). Attach it in an operation override. For vector queries, `rowFilter` participates in HNSW traversal so callers receive the k nearest _matching_ records:

   ```javascript
   function canReadReport(record, context) {
   	const user = context.user;
   	if (user?.role?.permission?.super_user) return true;
   	return user?.username != null && record.ownerId != null && record.ownerId === user.username;
   }

   export class Reports extends tables.Reports {
   	search(target) {
   		target.rowFilter = canReadReport;
   		return super.search(target);
   	}
   }
   ```

### HNSW Index Parameters

Configure parameters directly on `@indexed(type: "HNSW", ...)`:

| Parameter              | Default           | Description                                                                                      |
| ---------------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| `distance`             | `"cosine"`        | Distance function: `"cosine"`, `"euclidean"`, or `"dotProduct"`                                  |
| `efConstruction`       | `100`             | Max nodes explored during index construction. Higher = better recall, lower = better performance |
| `M`                    | `16`              | Preferred connections per graph layer                                                            |
| `optimizeRouting`      | `0.5`             | Heuristic aggressiveness for omitting redundant connections (0 = off, 1 = most aggressive)       |
| `mL`                   | computed from `M` | Normalization factor for level generation                                                        |
| `efConstructionSearch` | auto-scaled       | Max nodes explored during search. When unset, auto-scales with index size                        |
| `quantization`         | —                 | `"int8"` stores vectors quantized to int8                                                        |
| `filterExpansion`      | `24`              | Visit-budget multiplier for filtered search: visits at most `ef * filterExpansion` nodes         |

Per-query `sort` descriptor options:

| Option     | Values                                    | Description                                            |
| ---------- | ----------------------------------------- | ------------------------------------------------------ |
| `distance` | `"cosine"`, `"euclidean"`, `"dotProduct"` | Overrides the index's distance function for this query |
| `ef`       | integer                                   | Overrides the search exploration budget for this query |

## Examples

**Index with custom HNSW parameters:**

```graphql
type Document @table {
	id: Long @primaryKey
	textEmbeddings: [Float]
		@indexed(type: "HNSW", distance: "euclidean", optimizeRouting: 0, efConstructionSearch: 100)
}
```

**Index with int8 quantization:**

```graphql
type Document @table {
	id: Long @primaryKey
	textEmbeddings: [Float] @indexed(type: "HNSW", quantization: "int8")
}
```

**Nearest-neighbor search with distance included:**

```javascript
let results = Document.search({
	select: ['name', '$distance'],
	sort: { attribute: 'textEmbeddings', target: searchVector },
	limit: 5,
});
```

**Filtered traversal with tuned budget:**

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

## Notes

- `vectorFilter` and `rowFilter` are available from the JavaScript API only; they cannot be set through REST or QUERY request data.
- `vectorFilter` functions must be synchronous, side-effect free, and fast — they can run once per candidate record visited during traversal; verdicts are memoized per query. Records passed to them are frozen.
- `rowFilter` does not apply to a direct primary-key `get`.
- Changing `efConstructionSearch` on an existing index does not trigger a rebuild. Structural parameters (`distance`, `M`, `efConstruction`, `quantization`) do rebuild the index when changed.
- With `quantization: "int8"`, nearest-neighbor `sort` queries re-rank results against full-precision vectors, restoring exact ordering and exact `$distance` values. Distance-threshold (`lt`/`le`) queries filter on the approximate distance.
- The correct parameter name is `efConstruction` (seeds the construction budget) and `efConstructionSearch` (controls search budget). The name `efSearchConstruction` is a previous documentation error.
- When no `ef` is passed and `efConstructionSearch` (or `efConstruction`) is not explicitly set, the search budget auto-scales with index size.
- `cosine` is the default distance function when `distance` is not specified.
