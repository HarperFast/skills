---
name: querying-rest-apis
description: 'How to use query parameters to filter, sort, and paginate Harper REST APIs.'
metadata:
  mode: generate
  sources:
    - reference/v5/rest/querying.md
  sourceCommit: da68d8e45f5422321c128a0cd67694bd0b97b155
  inputHash: c8940be82fa5bc15
---

# Querying Harper REST APIs

Instructions for the agent to filter, sort, select, and paginate records through Harper's URL-based REST query language.

## When to Use

Apply this rule whenever building or modifying HTTP requests against Harper collection endpoints that need attribute filtering, comparison operators, sorting, field selection, pagination, or relationship joins. Use it when constructing query strings for any REST interface exposed by Harper (see [automatic-apis.md](automatic-apis.md)).

## How It Works

1. **Filter by attribute**: Add query parameters matching attribute names. The queried attribute must be indexed.

   ```
   GET /Product/?category=software
   GET /Product/?category=software&inStock=true
   ```

   Query for null values with:

   ```
   GET /Product/?discount=null
   ```

2. **Apply comparison operators (FIQL syntax)**: Use FIQL operators in the query string for range and pattern matching.

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

3. **Chain conditions for range queries**: Omit the attribute name on the second condition to apply it to the same attribute.

   ```
   GET /Product/?price=gt=100&lt=200
   ```

   Chaining supports `gt`/`ge` combined with `lt`/`le` only.

4. **Apply type conversion**: For FIQL comparators, Harper converts values automatically. Use explicit type prefixes when needed.

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

5. **Combine conditions with OR logic**: Use `|` instead of `&`.

   ```
   GET /Product/?rating=5|featured=true
   ```

6. **Group conditions**: Use parentheses or square brackets to control order of operations. Prefer square brackets when constructing from user input.

   ```
   GET /Product/?rating=5|(price=gt=100&price=lt=200)
   GET /Product/?rating=5&[tag=fast|tag=scalable|tag=efficient]
   ```

   Construct from JavaScript:

   ```javascript
   let url = `/Product/?rating=5&[${tags.map(encodeURIComponent).join('|')}]`;
   ```

7. **Select specific properties with `select()`**: Include `select()` as a query function to control which fields are returned.

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

8. **Paginate with `limit(end)` or `limit(start,end)`**: Return records in a zero-based window. `limit(end)` starts at zero; `limit(start,end)` returns at most `end - start` records.

   ```
   GET /Product/?rating=gt=3&inStock=true&select(rating,name)&limit(20)
   GET /Product/?rating=gt=3&limit(10,30)
   ```

9. **Sort results with `sort(property)` or `sort(+property,-property,...)`**: Prefix `+` or no prefix = ascending; `-` = descending. Multiple properties break ties in order.

   ```
   GET /Product/?rating=gt=3&sort(+name)
   GET /Product/?sort(+rating,-price)
   ```

10. **Request total counts for pagination**: Send a `Prefer` header on `GET` or `HEAD` requests. Counting is opt-in; without the header, no count is computed. Counting requires a bounded `limit()` with page size (`end - start`, or `end` in the one-argument form) no larger than **10,000**, and window end no larger than **1,000,000**. A request with no `limit()`, one outside those bounds, or a non-numeric one is served normally with no count headers.

    | Value             | Meaning                                                                                       |
    | ----------------- | --------------------------------------------------------------------------------------------- |
    | `count=exact`     | Exact number of matching records (off by default; requires `exactCount: true` in REST config) |
    | `count=estimated` | Fast planner/table estimate; cheap, approximate                                               |

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

    Without `exactCount: true`, a `count=exact` request is served as an estimate. When the total cannot be produced, it is reported as `*` (e.g., `Content-Range: items 0-24/*`). `Preference-Applied` still echoes the requested mode, so an unavailable total (`.../*`) is distinct from a request that asked for no count.

11. **Query across relationships**: Use dot-syntax on related attributes. Relationships must be defined with `@relationship` in the schema.

    ```
    GET /Product/?brand.name=Microsoft
    GET /Brand/?products.name=Keyboard
    ```

    Include relationship attributes in the response using `select()`:

    ```
    GET /Product/?brand.name=Microsoft&select(name,brand)
    GET /Product/?brand.name=Microsoft&select(name,brand{name})
    ```

    Selecting a relationship without an outer dot-syntax filter behaves as a LEFT JOIN. An outer filter such as `products.price=ge=number:30` removes parents without a qualifying product and narrows the selected products.

12. **Filter and page each relationship's children**: Use square brackets inside `select()` to apply conditions, sort, and pagination per parent's related records.

    ```
    GET /Brand/?select(id,name,products[price=ge=number:30&sort(price)&limit(1)&select(id,name,price)])
    ```

    An outer relationship filter also narrows that relationship's nested results — do not repeat the outer filter inside `[...]` unless you want to narrow further.

    | Nested option      | Behavior                                                        |
    | ------------------ | --------------------------------------------------------------- |
    | Conditions         | Qualify children; combine with `&` (AND), `\|` (OR), and groups |
    | `sort(price)`      | Order eligible children before pagination                       |
    | `limit(end)`       | Return at most `end` children per parent                        |
    | `limit(start,end)` | Skip `start` eligible children and return at most `end - start` |
    | `select(id,price)` | Project fields from returned children                           |

## Examples

### Range filter with sort and limit

```
GET /Product/?category=software&price=gt=100&price=lt=200&sort(+price)&limit(0,25)
```

### Select specific fields with a relationship join

```
GET /Product/?brand.name=Microsoft&select(name,brand{name,id})
```

### Paginate with exact count

```
GET /Product/?category=software&limit(0,25)
Prefer: count=exact
```

Response:

```
HTTP/1.1 200 OK
Content-Range: items 0-24/1234
Range-Unit: items
Preference-Applied: count=exact
```

### Relationship schema with nested child filtering

```graphql
type Brand @table @export {
	id: Int @primaryKey
	name: String @indexed
	products: [Product] @relationship(to: "brandId")
}

type Product @table @export {
	id: ID @primaryKey
	brandId: Int @indexed
	name: String
	price: Int @indexed
}
```

Keep every brand; show its cheapest product costing at least 30:

```
GET /Brand/?select(id,name,products[price=ge=number:30&sort(price)&limit(1)&select(id,name,price)])
```

Return only qualifying brands; inherit the outer price filter:

```
GET /Brand/?products.price=ge=number:30&select(id,name,products[sort(price)&limit(1)&select(id,name,price)])
```

Page through each brand's qualifying products (skip first, return second):

```
GET /Brand/?products.price=ge=number:30&select(id,name,products[sort(price)&limit(1,2)&select(id,name,price)])
```

Bound parent pages with stable sorting:

```
GET /Brand/?products.price=ge=number:30&sort(name,id)&limit(0,20)&select(id,name,products[sort(price,id)&limit(1)&select(id,name,price)])
```

Combine OR filters with child sorting and pagination:

```
GET /Brand/?sort(name,id)&limit(0,20)&select(id,name,products[[price=lt=number:30|price=ge=number:60]&sort(-price,id)&limit(1,2)&select(id,name,price)])
```

### Many-to-many relationship

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

### Access a specific property by URL

```
GET /MyTable/123.propertyName
```

## Notes

- The queried attribute in a basic filter must be indexed.
- For full-text fields annotated with `@fullText`, use operators like `=matches=`, `=matches_phrase=`, `=matches_prefix=`, `=matches_fuzzy=`, and their `not_` negated forms. A negated full-text condition requires a non-negated condition on the same index.
- Full-text queries cannot provide an exact total count. With `exactCount: true`, `Prefer: count=exact` returns an unavailable total (`Content-Range: items 0-24/*`).
- The response status for paginated results is always `200`; Harper does not use `206 Partial Content`.
- When CORS is enabled, `Content-Range`, `Range-Unit`, and `Preference-Applied` are added to `Access-Control-Expose-Headers`.
- For JSON-array responses from full-text queries, check for a terminal error object shaped like `{ "error": "ErrorName: message" }` and treat the response as failed.
- Nested filters require a table-backed relationship. Filters on plain JSON projections or full-text predicates inside a relationship selection return HTTP 400.
- Invalid nested `limit` bounds (negative or fractional values) return HTTP 400. `limit(0)` returns no children without reading them.
- The suffixes `.json`, `.cbor`, `.msgpack`, and `.csv` in property access URLs are reserved as content-type selectors.
- See [automatic-apis.md](automatic-apis.md) for how Harper automatically exposes REST endpoints from schema definitions.
