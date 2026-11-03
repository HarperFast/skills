---
name: querying-rest-apis
description: 'How to use query parameters to filter, sort, and paginate Harper REST APIs.'
metadata:
  mode: generate
  sources:
    - reference/v5/rest/querying.md
  sourceCommit: 1be709e3f84be0ff2a71bb35836a951bf687ad2a
  inputHash: 5198a7be7e56bb9a
---

# Querying Harper REST APIs

Instructions for the agent to filter, sort, select, and paginate records through Harper's URL-based REST query language.

## When to Use

Apply this rule whenever building or modifying code that queries Harper REST endpoints using URL query parameters. Use it when implementing filtering, sorting, pagination, field selection, or relationship traversal on collection paths. See [automatic-apis.md](automatic-apis.md) for how Harper exposes tables as REST endpoints.

## How It Works

1. **Filter by attribute**: Add query parameters matching attribute names. The queried attribute must be indexed.

   ```
   GET /Product/?category=software
   GET /Product/?category=software&inStock=true
   ```

2. **Filter for null values**: Use `=null` as the value to match null or non-null records.

   ```
   GET /Product/?discount=null
   ```

3. **Apply FIQL comparison operators**: Use these operators in query parameters for range and pattern matching.

   | Operator             | Meaning                                |
   | -------------------- | -------------------------------------- |
   | `==`                 | Equal                                  |
   | `=lt=`               | Less than                              |
   | `=le=`               | Less than or equal                     |
   | `=gt=`               | Greater than                           |
   | `=ge=`               | Greater than or equal                  |
   | `=ne=`, `!=`         | Not equal                              |
   | `=ct=`               | Contains (strings)                     |
   | `=sw=`, `==<value>*` | Starts with (strings)                  |
   | `=ew=`               | Ends with (strings)                    |
   | `=`, `===`           | Strict equality (no type conversion)   |
   | `!==`                | Strict inequality (no type conversion) |

   ```
   GET /Product/?price=gt=100
   GET /Product/?price=le=20
   GET /Product/?name==Keyboard*
   GET /Product/?category=software&price=gt=100&price=lt=200
   ```

   URL-encode colons in date values:

   ```
   GET /Product/?listDate=gt=2017-03-08T09%3A30%3A00.000Z
   ```

4. **Chain range conditions**: Omit the attribute name on the second condition to apply it to the same attribute. Only `gt`/`ge` combined with `lt`/`le` is supported.

   ```
   GET /Product/?price=gt=100&lt=200
   ```

5. **Apply type conversion**: For FIQL comparators, Harper converts values automatically. Use explicit type prefixes when needed.

   | Syntax                                    | Behavior                                    |
   | ----------------------------------------- | ------------------------------------------- |
   | `name==null`                              | Converts to `null`                          |
   | `name==123`                               | Converts to number if attribute is untyped  |
   | `name==true`                              | Converts to boolean if attribute is untyped |
   | `name==number:123`                        | Explicit number conversion                  |
   | `name==boolean:true`                      | Explicit boolean conversion                 |
   | `name==string:some%20text`                | Keep as string with URL decode              |
   | `name==date:2024-01-05T20%3A07%3A27.955Z` | Explicit Date conversion                    |

   For strict operators (`=`, `===`, `!==`), no automatic type conversion is applied.

6. **Combine conditions with OR**: Use `|` instead of `&`.

   ```
   GET /Product/?rating=5|featured=true
   ```

7. **Group conditions**: Use parentheses or square brackets to control order of operations. Prefer square brackets when constructing queries from user input.

   ```
   GET /Product/?rating=5|(price=gt=100&price=lt=200)
   GET /Product/?rating=5&[tag=fast|tag=scalable|tag=efficient]
   ```

   Construct from JavaScript:

   ```javascript
   let url = `/Product/?rating=5&[${tags.map(encodeURIComponent).join('|')}]`;
   ```

8. **Select specific properties with `select()`**: Specify which properties to return.

   | Syntax                                 | Returns                                           |
   | -------------------------------------- | ------------------------------------------------- |
   | `?select(property)`                    | Values of a single property directly              |
   | `?select(property1,property2)`         | Objects with only the specified properties        |
   | `?select([property1,property2])`       | Arrays of property values                         |
   | `?select(property1,)`                  | Objects with a single specified property          |
   | `?select(property{subProp1,subProp2})` | Nested objects with specific sub-properties       |
   | `?select(id,products[limit(1)])`       | Parents with a constrained relationship selection |

   ```
   GET /Product/?category=software&select(name)
   GET /Product/?brand.name=Microsoft&select(name,brand{name})
   ```

9. **Limit results with `limit(end)` or `limit(start,end)`**: Return records in a zero-based window from `start` (inclusive) to `end` (exclusive). `limit(end)` starts at zero.

   ```
   GET /Product/?rating=gt=3&inStock=true&select(rating,name)&limit(20)
   GET /Product/?rating=gt=3&limit(10,30)
   ```

10. **Sort results with `sort(property)` or `sort(+property,-property,...)`**: Prefix `+` or no prefix = ascending; `-` = descending. Multiple properties break ties in order.

    ```
    GET /Product/?rating=gt=3&sort(+name)
    GET /Product/?sort(+rating,-price)
    ```

11. **Request total counts for pagination**: Send a `Prefer` header on `GET` or `HEAD` requests. Counting is opt-in; without the header, no count is computed. Counting requires a bounded `limit()` with page size (`end - start`, or `end` in the one-argument form) no larger than **10,000**, and window end no larger than **1,000,000**.

    | Header value      | Meaning                                                                       |
    | ----------------- | ----------------------------------------------------------------------------- |
    | `count=exact`     | Exact number of matching records (requires `exactCount: true` in REST config) |
    | `count=estimated` | Fast planner/table estimate; approximate                                      |

    ```
    GET /Product/?category=software&limit(0,25)
    Prefer: count=exact
    ```

    Response headers:

    | Header               | Example           | Description                                                |
    | -------------------- | ----------------- | ---------------------------------------------------------- |
    | `Content-Range`      | `items 0-24/1234` | 0-based inclusive range returned out of total matching set |
    | `Range-Unit`         | `items`           | Unit used by `Content-Range`                               |
    | `Preference-Applied` | `count=exact`     | Count mode the server applied (`exact` or `estimated`)     |

    Enable exact counts in REST configuration:

    ```yaml
    rest:
      exactCount: true
    ```

    Without `exactCount: true`, a `count=exact` request is served as an estimate. When the total cannot be produced, it is reported as `*` (e.g., `Content-Range: items 0-24/*`). `Preference-Applied` still echoes the requested mode, so an unavailable total (`.../*`) is distinct from a request that asked for no count. Page size must be a non-negative integer no larger than **10,000**; window end no larger than **1,000,000**. Requests outside these bounds are served normally with no count headers.

12. **Query across relationships**: Use dot-syntax to filter by related table attributes. Relationships must be defined with `@relationship` in the schema.

    ```
    GET /Product/?brand.name=Microsoft
    GET /Brand/?products.name=Keyboard
    ```

    Include relationship attributes in the response using `select()`:

    ```
    GET /Product/?brand.name=Microsoft&select(name,brand)
    GET /Product/?brand.name=Microsoft&select(name,brand{name})
    ```

13. **Filter and page nested relationships**: Use square brackets inside `select()` to apply conditions, sort, and pagination to each parent's related records.

    ```
    GET /Brand/?select(id,name,products[price=ge=number:30&sort(price)&limit(1)&select(id,name,price)])
    ```

    An outer relationship filter also narrows that relationship's nested results — do not repeat the outer filter inside the brackets:

    ```
    GET /Brand/?products.price=ge=number:30&select(id,name,products[sort(price)&limit(1)&select(id,name,price)])
    ```

    Nested option reference:

    | Nested option      | Behavior                                                        |
    | ------------------ | --------------------------------------------------------------- |
    | Conditions         | Qualify children; combine with `&` (AND), `\|` (OR), and groups |
    | `sort(price)`      | Order eligible children before pagination                       |
    | `limit(end)`       | Return at most `end` children per parent                        |
    | `limit(start,end)` | Skip `start` eligible children and return at most `end - start` |
    | `select(id,price)` | Project fields from returned children                           |

14. **Model many-to-many relationships**: Use an array of foreign key values without a junction table.
    ```graphql
    type Product @table @export {
    	id: Long @primaryKey
    	name: String
    	resellerIds: [Long] @indexed
    	resellers: [Reseller] @relationship(from: "resellerIds")
    }
    ```
    ```
    GET /Product/?resellers.name=Cool Shop&select(id,name,resellers{name,id})
    ```

## Examples

### Range filter with sort, select, and limit

```
GET /Product/?category=software&price=gt=100&price=lt=200&sort(+price,-name)&select(name,price)&limit(0,25)
Prefer: count=exact
```

### Relationship schema and join query

```graphql
type Product @table @export {
	id: Long @primaryKey
	name: String
	brandId: Long @indexed
	brand: Brand @relationship(from: "brandId")
}
type Brand @table @export {
	id: Long @primaryKey
	name: String
	products: [Product] @relationship(to: "brandId")
}
```

```
GET /Product/?brand.name=Microsoft&select(name,brand{name,id})
```

### Paginated brands with one qualifying product each

```
GET /Brand/?products.price=ge=number:30&sort(name,id)&limit(0,20)&select(id,name,products[sort(price,id)&limit(1)&select(id,name,price)])
```

Response:

```json
[
	{
		"id": 42,
		"name": "Acme",
		"products": [{ "id": "p2", "name": "Keyboard", "price": 35 }]
	},
	{
		"id": 44,
		"name": "Studio Gear",
		"products": [{ "id": "p5", "name": "Stand", "price": 45 }]
	}
]
```

### OR filter with grouping

```
GET /Brand/?sort(name,id)&limit(0,20)&select(id,name,products[[price=lt=number:30|price=ge=number:60]&sort(-price,id)&limit(1,2)&select(id,name,price)])
```

### Full-text search

```
GET /Product/?catalogSearch=matches=waterproof%20trail
GET /Product/?catalogSearch=matches_phrase=trail%20running
GET /Product/?catalogSearch=matches=waterproof&catalogSearch=not_matches=leather
```

## Notes

- The queried attribute in a basic filter must be indexed.
- For `=gt=`, `=lt=`, and other FIQL operators, the attribute must be indexed for the query to execute.
- For full-text fields annotated with `@fullText`, use operators like `=matches=`, `=matches_phrase=`, `=matches_prefix=`, `=matches_fuzzy=`, and their `not_` negated forms. A negated full-text condition requires a non-negated condition on the same index.
- Full-text queries cannot provide an exact total count; `Prefer: count=exact` returns `Content-Range: items <range>/*` for full-text queries.
- `select()` must be used to include relationship attributes in responses; they are not returned by default.
- An outer relationship filter (e.g., `products.price=ge=number:30`) removes parents without qualifying children and also narrows the nested candidates. A filter inside `select(...,products[...])` only narrows projected children and does not remove parents.
- Invalid nested bounds (negative or fractional values) return HTTP 400. `limit(0)` returns no children without reading them.
- Nested filters require a table-backed relationship. Full-text predicates inside a relationship selection return HTTP 400.
- `count=exact` requires `exactCount: true` in the REST configuration; without it, `count=exact` requests are served as estimates (`Preference-Applied: count=estimated`).
- The response status for paginated results is always `200`; Harper does not use `206 Partial Content`. `Content-Range` is informational.
- A `HEAD` request with a `count` preference returns count headers with no body.
- When CORS is enabled, `Content-Range`, `Range-Unit`, and `Preference-Applied` are added to `Access-Control-Expose-Headers` so browser clients can read them cross-origin.
- Each page request runs a new query; concurrent changes can cause repeats or omissions between pages.
- For JSON-array responses from full-text queries, check for a terminal error object shaped like `{ "error": "ErrorName: message" }` and treat the response as failed. A stream or JSON-parse error is also a failed page, not a record.
- Use a unique field as the final sort key (e.g., `sort(name,id)`) to ensure deterministic ordering when sort values are equal.
- Access a specific property of a record by appending it with dot syntax to the record id: `GET /MyTable/123.propertyName`. This only works for declared properties. The suffixes `.json`, `.cbor`, `.msgpack`, and `.csv` in property access URLs are reserved as content-type selectors and take precedence over a property of the same name.
