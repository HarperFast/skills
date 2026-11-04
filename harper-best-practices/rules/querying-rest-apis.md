---
name: querying-rest-apis
description: 'How to use query parameters to filter, sort, and paginate Harper REST APIs.'
metadata:
  mode: generate
  sources:
    - reference/v5/rest/querying.md
  sourceCommit: e4a7bd899e1a68a83d9ed1d770ec73569fabc260
  inputHash: 54c39dcf275926f2
---

# Querying REST APIs

Instructions for the agent to filter, sort, select, and paginate Harper REST API collections using URL query parameters.

## When to Use

Apply this rule when building or modifying code that queries Harper REST collection endpoints and needs to filter records by attribute value, apply comparison operators, sort results, select specific properties, or paginate through large result sets. This rule also covers querying across related tables using dot-syntax and relationship joins. See [automatic-apis.md](automatic-apis.md) for how Harper exposes tables as REST endpoints.

## How It Works

1. **Filter by attribute**: Add query parameters matching attribute names. The queried attribute must be indexed.

   ```
   GET /Product/?category=software
   GET /Product/?category=software&inStock=true
   ```

2. **Apply FIQL comparison operators**: Use FIQL syntax for range and equality comparisons.

   | Operator                                  | Meaning                                 |
   | ----------------------------------------- | --------------------------------------- |
   | `==`                                      | Equal                                   |
   | `=lt=`                                    | Less than                               |
   | `=le=`                                    | Less than or equal                      |
   | `=gt=`                                    | Greater than                            |
   | `=ge=`                                    | Greater than or equal                   |
   | `=ne=`, `!=`                              | Not equal                               |
   | `=between=(low,high)`, `=gele=(low,high)` | At least `low` and at most `high`       |
   | `=gelt=(low,high)`                        | At least `low` and less than `high`     |
   | `=gtle=(low,high)`                        | Greater than `low` and at most `high`   |
   | `=gtlt=(low,high)`                        | Greater than `low` and less than `high` |
   | `=ct=`                                    | Contains (strings)                      |
   | `=sw=`, `==<value>*`                      | Starts with (strings)                   |
   | `=ew=`                                    | Ends with (strings)                     |
   | `=`, `===`                                | Strict equality (no type conversion)    |
   | `!==`                                     | Strict inequality (no type conversion)  |

   ```
   GET /Product/?price=gt=100
   GET /Product/?price=le=20
   GET /Product/?name==Keyboard*
   GET /Product/?category=software&price=gt=100&price=lt=200
   GET /Product/?price=between=(100,200)
   ```

   For date fields, URL-encode colons as `%3A`:

   ```
   GET /Product/?listDate=gt=2017-03-08T09%3A30%3A00.000Z
   ```

3. **Apply type conversion**: For FIQL comparators, Harper converts values automatically. Use explicit type prefixes when needed.

   | Syntax                                    | Behavior                                    |
   | ----------------------------------------- | ------------------------------------------- |
   | `name==null`                              | Converts to `null`                          |
   | `name==123`                               | Converts to number if attribute is untyped  |
   | `name==true`                              | Converts to boolean if attribute is untyped |
   | `name==number:123`                        | Explicit number conversion                  |
   | `name==boolean:true`                      | Explicit boolean conversion                 |
   | `name==string:some%20text`                | Keep as string with URL decode              |
   | `name==date:2024-01-05T20%3A07%3A27.955Z` | Explicit Date conversion                    |

   For strict operators (`=`, `===`, `!==`), no automatic type conversion is applied — the value is decoded as a URL-encoded string, and the attribute type (if declared in the schema) dictates type conversion.

4. **Query for null values**: Use `=null` to match records storing `null`. A record that omits the attribute matches neither `=null` nor `=ne=null`.

   ```
   GET /Product/?discount=null
   GET /Product/?discount=ne=null
   ```

5. **Chain range conditions**: Omit the attribute name on the second condition to chain it against the same attribute. Only `gt`/`ge` combined with `lt`/`le` is supported.

   ```
   GET /Product/?price=gt=100&lt=200
   ```

6. **Combine conditions with OR**: Use `|` instead of `&` for OR logic.

   ```
   GET /Product/?rating=5|featured=true
   ```

7. **Group conditions**: Use parentheses or square brackets to control order of operations. Use square brackets when constructing queries from user input.

   ```
   GET /Product/?rating=5|(price=gt=100&price=lt=200)
   GET /Product/?rating=5&[tag=fast|tag=scalable|tag=efficient]
   ```

   Constructing from JavaScript:

   ```javascript
   let url = `/Product/?rating=5&[${tags.map(encodeURIComponent).join('|')}]`;
   ```

8. **Select specific properties with `select()`**: Specify which properties to include in the response.

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

9. **Paginate with `limit(end)` or `limit(start,end)`**: Return records in the zero-based window from `start` (inclusive) to `end` (exclusive). `limit(end)` starts at zero.

   ```
   GET /Product/?rating=gt=3&inStock=true&select(rating,name)&limit(20)
   GET /Product/?rating=gt=3&limit(10,30)
   ```

10. **Sort with `sort(property)` or `sort(+property,-property,...)`**: Prefix `+` or no prefix = ascending; `-` = descending. Multiple properties break ties in order.

    ```
    GET /Product/?rating=gt=3&sort(+name)
    GET /Product/?sort(+rating,-price)
    ```

11. **Request total counts for pagination**: Send a `Prefer` header on `GET` or `HEAD` requests. Counting is opt-in; without the header, no count is computed. Counting requires a bounded `limit()` with page size (`end - start`, or `end` in the one-argument form) no larger than 10,000, and window end no larger than 1,000,000.

    | Value             | Meaning                                                                       |
    | ----------------- | ----------------------------------------------------------------------------- |
    | `count=exact`     | Exact number of matching records (requires `exactCount: true` in REST config) |
    | `count=estimated` | Fast planner/table estimate; cheap and approximate                            |

    ```
    GET /Product/?category=software&limit(0,25)
    Prefer: count=exact
    ```

    Response headers:

    ```
    HTTP/1.1 200 OK
    Content-Range: items 0-24/1234
    Range-Unit: items
    Preference-Applied: count=exact
    ```

    Enable exact counts in REST configuration:

    ```yaml
    rest:
      exactCount: true
    ```

12. **Query across relationships**: Use dot-syntax to filter by related table attributes. Relationships must be defined with `@relationship` in the schema.

    ```
    GET /Product/?brand.name=Microsoft
    GET /Brand/?products.name=Keyboard
    GET /Product/?brand.name=Microsoft&select(name,brand{name})
    ```

    Selecting a relationship without an outer dot-syntax filter behaves as a LEFT JOIN. An outer filter such as `products.price=ge=number:30` removes parents without a qualifying product (INNER JOIN behavior).

13. **Filter and page nested relationships**: Use square brackets inside `select()` to apply conditions, sort, and pagination to each parent's related records.

    ```
    GET /Brand/?select(id,name,products[price=ge=number:30&sort(price)&limit(1)&select(id,name,price)])
    ```

    An outer relationship filter also narrows that relationship's nested results — do not repeat the outer filter inside the brackets.

    | Nested option      | Behavior                                                     |
    | ------------------ | ------------------------------------------------------------ |
    | Conditions         | Qualify children; combine with `&`, `\|`, and groups         |
    | `sort(price)`      | Order eligible children before pagination                    |
    | `limit(end)`       | Return at most `end` children per parent                     |
    | `limit(start,end)` | Skip `start` eligible children, return at most `end - start` |
    | `select(id,price)` | Project fields from returned children                        |

14. **Use full-text operators**: For a `FullText` field carrying `@fullText`, use the field name as the query attribute with a full-text comparator. For full-text fields annotated with `@fullText`, use operators like `=matches=`, `=matches_phrase=`, `=matches_prefix=`, `=matches_fuzzy=`, and their `not_` negated forms. A negated full-text condition requires a non-negated condition on the same index.

    ```
    GET /Product/?catalogSearch=matches=waterproof%20trail
    GET /Product/?catalogSearch=matches_phrase=trail%20running
    GET /Product/?catalogSearch=matches_prefix=waterproof%20tra&limit(10)
    GET /Product/?catalogSearch=matches=waterproof&catalogSearch=not_matches=leather
    ```

    Supported operators: `matches`, `matches_all`, `matches_phrase`, `matches_prefix`, `matches_fuzzy`, `matches_fuzzy_prefix`, plus a `not_` form of each. A negated full-text condition requires a non-negated condition on the same index.

## Examples

### Range filter with type conversion and sorting

```
GET /Product/?category=software&price=gt=100&price=lt=200&sort(+price,-name)&limit(0,25)
```

### Null query

```
GET /Product/?discount=null
GET /Product/?discount=ne=null
```

### Select with nested relationship filter and pagination

```
GET /Brand/?products.price=ge=number:30&select(id,name,products[sort(price)&limit(1)&select(id,name,price)])
```

### OR grouping with square brackets

```
GET /Product/?rating=5&[tag=fast|tag=scalable|tag=efficient]
```

### Paginated request with exact count

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

### Many-to-many relationship query

```
GET /Product/?resellers.name=Cool Shop&select(id,name,resellers{name,id})
```

### Full-text search with pagination

```
GET /Product/?catalogSearch=matches_prefix=waterproof%20tra&limit(100,110)
```

### OR conditions inside nested relationship selection

```
GET /Brand/?sort(name,id)&limit(0,20)&select(id,name,products[[price=lt=number:30|price=ge=number:60]&sort(-price,id)&limit(1,2)&select(id,name,price)])
```

## Notes

- The queried attribute must be indexed for basic attribute filtering. For combined filters, only one attribute needs to be indexed.
- Null indexing requires indexes created in v4.3.0 or later. Rebuild existing indexes (remove and re-add) to support null queries.
- `=gt=` and `=lt=` (and all range comparators) never match `null` or omitted values. `=ne=` with a non-null value matches both null and omitted values.
- A `null` lower bound means no lower bound: `ge=null` matches every non-null value. A `null` upper bound (`lt=null`, `le=null`) matches nothing.
- Sorting puts null and omitted values first; `-` puts them last, with no guaranteed order between the two.
- `limit(start,end)` uses an exclusive end: `limit(10,30)` returns at most 20 records starting at index 10.
- `limit(0)` returns no children without reading them. Invalid nested bounds (negative or fractional values) return HTTP 400.
- `count=exact` requires `exactCount: true` in the REST configuration; without it, `count=exact` requests are served as estimates (`Preference-Applied: count=estimated`).
- Without `exactCount: true`, a `count=exact` request is served as an estimate. When the total cannot be produced, it is reported as `.../*` (e.g., `Content-Range: items 0-24/*`). `Preference-Applied` still echoes the requested mode, so an unavailable total (`.../*`) is distinct from a request that asked for no count.
- The response status for paginated results is always `200`; Harper does not use `206 Partial Content`. `Content-Range` is informational.
- When CORS is enabled, `Content-Range`, `Range-Unit`, and `Preference-Applied` are added to `Access-Control-Expose-Headers` so browser clients can read them cross-origin.
- Full-text queries cannot provide an exact total count; `Prefer: count=exact` returns `Content-Range: items <range>/*` for full-text queries.
- For JSON-array responses from full-text queries, check for a terminal error object shaped like `{ "error": "ErrorName: message" }` and treat the response as failed. A stream or JSON-parse error is also a failed page, not a record.
- Access a specific property of a record by appending it with dot syntax to the record id: `GET /MyTable/123.propertyName`. This only works for declared properties. The suffixes `.json`, `.cbor`, `.msgpack`, and `.csv` are reserved as content-type selectors and take precedence over a property of the same name.
- An outer relationship filter narrows nested relationship results. A nested filter inside `select(...,products[...])` only narrows projected products; it does not remove a parent.
- Keep relationship lookup fields and outer filter fields indexed. Keep parent pages small for large relationships.
- Nested filters inside `select()` require a table-backed relationship. Filters on plain JSON projections or full-text predicates inside a relationship selection return HTTP 400.
