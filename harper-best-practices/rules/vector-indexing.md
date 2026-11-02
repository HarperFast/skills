---
name: vector-indexing
description: How to enable and query vector indexes for similarity search in Harper.
metadata:
  mode: generate
  sources:
    - reference/v5/database/schema.md#Vector Indexing
  sourceCommit: 1b103f864df3a0d8444297c00e752c29c2e7e82b
  inputHash: 8f9270223df41d20
---

# Vector Indexing

Instructions for the agent to enable HNSW vector indexes on table fields and query them for similarity search in Harper.

**Instead of:** Pinecone, Weaviate, pgvector. Use this rule rather than adding that service. See `harper-architecture`.

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

4. **Apply a function predicate** using `vectorFilter` (JavaScript API only) for predicates not expressible as conditions. The function receives each candidate record and must return a synchronous boolean. Records are frozen:

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

6. **Include computed distance** in results by adding `$distance` to `select`. Works with both `sort`-based ranking and threshold queries:

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

   - `distance` — overrides the index distance function: `"cosine"`, `"euclidean"`, or `"dotProduct"`.
   - `ef` — overrides the search exploration budget. Higher values improve recall at the cost of latency.

8. **Tune filtered traversal** when a `vectorFilter` is very selective. Filtered traversal is bounded by `ef * filterExpansion` nodes visited. Raise either knob to trade latency for recall:

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

9. **Configure HNSW index parameters** in the schema directive. Use the parameter table below to choose values:

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
   | `filterExpansion`      | `24`              | Visit-budget multiplier for filtered search: visits at most `ef * filterExpansion` nodes         |

   > Use `efConstructionSearch` (not `efSearchConstruction`). Changing `efConstructionSearch` on an existing index does not trigger a rebuild. Changing structural parameters (`distance`, `M`, `efConstruction`, `quantization`) does rebuild the index.

10. **Enable vector quantization** with `quantization: "int8"` to reduce index size and memory usage. Graph navigation uses quantized distances; nearest-neighbor `sort` queries are re-ranked against full-precision vectors for exact results:

    ```graphql
    type Document @table {
    	id: Long @primaryKey
    	textEmbeddings: [Float] @indexed(type: "HNSW", quantization: "int8")
    }
    ```

## Examples

### Basic nearest-neighbor search

```graphql
type Document @table {
	id: Long @primaryKey
	textEmbeddings: [Float] @indexed(type: "HNSW")
}
```

```javascript
let results = Document.search({
	sort: { attribute: 'textEmbeddings', target: searchVector },
	limit: 5,
});
```

### Filtered vector search with row-level access control

```javascript
function canReadReport(record, context) {
	const user = context.user;
	if (user?.role?.permission?.super_user) return true;
	return user?.username != null && record.ownerId != null && record.ownerId === user.username;
}

export class Reports extends tables.Reports {
	get(target) {
		const context = this.getContext();
		if (target.isCollection) {
			target.rowFilter = canReadReport;
		} else if (!canReadReport(this, context)) {
			return new Response(null, { status: 404 });
		}
		return super.get(target);
	}

	search(target) {
		target.rowFilter = canReadReport;
		return super.search(target);
	}

	subscribe(request) {
		request.rowFilter = canReadReport;
		return super.subscribe(request);
	}
}
```

### Custom HNSW parameters with cosine distance

```graphql
type Document @table {
	id: Long @primaryKey
	textEmbeddings: [Float]
		@indexed(type: "HNSW", distance: "euclidean", optimizeRouting: 0, efConstructionSearch: 100)
}
```

## Notes

- `vectorFilter` is available from the JavaScript API only — it cannot be expressed in a REST query string. It must be synchronous, side-effect free, and fast. Verdicts are memoized per query.
- `rowFilter` is also JavaScript API only. It participates in HNSW traversal so callers receive the k nearest _matching_ records. It does not apply to direct primary-key `get` calls. Prefer indexed query conditions for predicates that can be expressed declaratively.
- When a query passes no `ef` and the index does not explicitly configure `efConstructionSearch` (or `efConstruction`), the search budget auto-scales with index size.
- Distance-threshold (`lt`/`le`) queries with `quantization: "int8"` filter on approximate distance, not re-ranked full-precision distance.
- `$distance` is available in both `sort`-based ranking and `conditions`-based threshold queries.
