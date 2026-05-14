---
name: querying-rest-apis
description: How to filter, sort, and paginate Harper REST APIs via URL query strings and programmatic conditions.
---

# Querying REST APIs

Instructions for the agent to follow when querying Harper's REST APIs.

## When to Use

Use this skill when you need to perform advanced data retrieval (filtering, sorting, pagination, joins) using Harper's automatic REST endpoints or programmatic table calls inside custom resources.

## URL Query String Syntax

1. **Basic Filtering**: Use attribute names as query parameters: `GET /Table/?key=value`.
2. **Use Comparison Operators**: Append operators like `gt`, `ge`, `lt`, `le`, `ne` using FIQL-style syntax: `GET /Table/?price=gt=100`.
3. **Apply Logic and Grouping**: Use `&` for AND, `|` for OR, and `()` for grouping: `GET /Table/?(rating=5|featured=true)&price=lt=50`.
4. **Select Specific Fields**: Use `select()` to limit returned attributes: `GET /Table/?select(name,price)`.
5. **Paginate Results**: Use `limit(count)` or `limit(offset, count)` to set the number of records to return and skip.
   - Example (first 10): `GET /Table/?limit(10)`
   - Example (skip 20, return 10): `GET /Table/?limit(20, 10)`
6. **Sort Results**: Use `sort()` with `+` (asc) or `-` (desc) before the field name. Avoid `sort=field` format.
   - Example (asc): `GET /Table/?sort(+name)`
   - Example (desc): `GET /Table/?sort(-price)`
   - Example (combined): `GET /Table/?sort(-price,+name)`
7. **Query Relationships**: Use dot syntax for tables linked with `@relationship`: `GET /Book/?author.name=Harper`.

## Programmatic Conditions (Custom Resources)

When querying tables inside custom resources (e.g., `tables.MyTable.search(query)`), use a query object with a `conditions` array instead of URL syntax.

### Condition Object Shape

Each entry in `conditions` has:

| Property | Description |
|---|---|
| `attribute` | Field name (string), or array of field names to traverse a relationship (e.g., `['brand', 'name']`) |
| `value` | The value to compare against |
| `comparator` | One of the comparator strings below (default: `equals`) |
| `operator` | `and` (default) or `or` — applies to a nested `conditions` block |
| `conditions` | Nested array of condition objects for complex AND/OR logic |

### Comparator Values

Use these exact strings — incorrect comparator names will silently fail or error:

| Comparator | Meaning |
|---|---|
| `equals` | Exact match (default) |
| `not_equal` | Not equal |
| `greater_than` | `>` |
| `greater_than_equal` | `>=` |
| `less_than` | `<` |
| `less_than_equal` | `<=` |
| `starts_with` | String starts with value |
| `contains` | String contains value |
| `ends_with` | String ends with value |
| `between` | Value is between two bounds (pass `value` as `[min, max]`) |

### Query Object Parameters

| Property | Description |
|---|---|
| `conditions` | Array of condition objects (see above) |
| `limit` | Maximum number of records to return |
| `offset` | Number of records to skip (for pagination) |
| `select` | Array of attribute names to return; supports `$id` and `$updatedtime` |
| `sort` | Object with `attribute`, `descending` (bool), and optional `next` for secondary sort |

### Examples

**Simple filter:**
```javascript
const results = await tables.Product.search({
  conditions: [{ attribute: 'price', comparator: 'less_than', value: 100 }],
  limit: 20,
});
```

**AND + nested OR:**
```javascript
const results = await tables.Product.search({
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

**Relationship traversal:**
```javascript
const results = await tables.Book.search({
  conditions: [{ attribute: ['brand', 'name'], comparator: 'equals', value: 'Harper' }],
});
```

**Sort and paginate:**
```javascript
const results = await tables.Product.search({
  conditions: [{ attribute: 'inStock', value: true }],
  sort: { attribute: 'price', descending: false },
  limit: 10,
  offset: 20,
});
```
