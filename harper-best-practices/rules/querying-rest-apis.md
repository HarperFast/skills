---
name: querying-rest-apis
description: 'How to use query parameters to filter, sort, and paginate Harper REST APIs.'
metadata:
  mode: generate
  sources:
    - reference/v5/rest/querying.md
  sourceCommit: 0a29827da61afe7fff40ee8de87e1d4c2c286bea
  inputHash: 1455773ffb363a28
---

# Querying REST APIs

Instructions for the agent to filter, sort, select, and paginate Harper REST API collections using URL query parameters.

## When to Use

Apply this rule when building or modifying HTTP requests against Harper REST collection endpoints that need attribute filtering, comparison operators, sorting, field selection, or pagination. Use it whenever constructing query strings for `GET` requests against table-backed resources exposed via `@export`. See [automatic-apis.md](automatic-apis.md) for how those endpoints are created.

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

   If the attribute declares a type in the schema (e.g., `Float`), values are always converted to that type before searching. For strict operators (`=`, `===`, `!==`), no automatic type conversion is applied.

4. **Query for null values**: Use `=null` to match records storing `null`; use `=ne=null` to match records with a present, non-null value. A record that omits the attribute matches neither.

   ```
   GET /Product/?discount=null
   GET /Product/?discount=ne=null
   ```

5. **Understand null and omitted value behavior**: Comparators treat a null value and an omitted value the same way, except `==null`, which matches a stored `null` only.
   - No range comparator (`=lt=`, `=le=`, `=gt=`, `=ge=`, `=between=`, etc.) matches a null or omitted value.
   - `=ne=` with a non-null value matches null and omitted values.
   - A `null` lower bound means no lower bound: `ge=null` and `gt=null` match every non-null value, and `between=(null,10)` returns the same records as `le=10`. A `null` upper bound: `lt=null` and `le=null` match nothing.
   - Sorting puts null and omitted values first; `-` puts them last, with no guaranteed order between the two.

6. **Chain range conditions**: Omit the attribute name on the second condition to apply it to the same attribute.

   ```
   GET /Product/?price=gt=100&lt=200
   ```

   Chaining supports `gt`/`ge` combined with `lt`/`le` only.

7. **Combine conditions with OR**: Use `|` instead of `&` for OR logic. Use parentheses or square brackets to group conditions.

   ```
   GET /Product/?rating=5|featured=true
   GET /Product/?rating=5|(price=gt=100&price=lt=200)
   GET /Product/?rating=5&[tag=fast|tag=scalable|tag=efficient]
   ```

   Prefer square brackets when constructing queries from user input:

   ```javascript
   let url = `/Product/?rating=5&[${tags.map(encodeURIComponent).join('|')}]`;
   ```

8. **Select specific fields with `select()`**: Specify which properties to include in the response.

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

9. **Limit results with `limit(end)` or `limit(start,end)`**: Return records in the zero-based window from `start` (inclusive) to `end` (exclusive). `limit(end)` starts at zero.

   ```
   GET /Product/?rating=gt=3&inStock=true&select(rating,name)&limit(20)
   GET /Product/?rating=gt=3&limit(10,30)
   ```

10. **Sort results with `sort(property)` or `sort(+property,-property,...)`**: Prefix `+` or no prefix = ascending; `-` = descending. Multiple properties break ties in order.

    ```
    GET /Product/?rating=gt=3&sort(+name)
    GET /Product/?sort(+rating,-price)
    ```

11. **Request total counts for pagination**: Send a `Prefer` header on `GET` or `HEAD` requests. Counting is opt-in; without the header, no count is computed. Counting requires a bounded `limit()` with page size (`end - start`, or `end` in the one-argument form) no larger than **10,000** and window end no larger than **1,000,000**.

    ```
    GET /Product/?category=software&limit(0,25)
    Prefer: count=exact
    ```

    | `Prefer` value    | Meaning                                                     |
    | ----------------- | ----------------------------------------------------------- |
    | `count=exact`     | Exact count of matching records; scans the full matched set |
    | `count=estimated` | Fast planner/table estimate; cheap and approximate          |

    Response headers:

    ```
    HTTP/1.1 200 OK
    Content-Range: items 0-24/1234
    Range-Unit: items
    Preference-Applied: count=exact
    ```

    | Header               | Example           | Description                                                               |
    | -------------------- | ----------------- | ------------------------------------------------------------------------- |
    | `Content-Range`      | `items 0-24/1234` | 0-based inclusive range of records returned out of the total matching set |
    | `Range-Unit`         | `items`           | The unit used by `Content-Range`                                          |
    | `Preference-Applied` | `count=exact`     | The count mode the server applied                                         |
    - The response status for paginated results is always `200`; Harper does not use `206 Partial Content`. `Content-Range` is informational.
    - Without `exactCount: true`, a `count=exact` request is served as an estimate (`Preference-Applied: count=estimated`). When the total cannot be produced, it is reported as `.../*` (e.g., `Content-Range: items 0-24/*`). `Preference-Applied` still echoes the requested mode, so an unavailable total (`.../*`) is distinct from a request that asked for no count.
    - Exact counting is off by default. Enable it in REST configuration:
      ```yaml
      rest:
        exactCount: true
      ```
    - When CORS is enabled, `Content-Range`, `Range-Unit`, and `Preference-Applied` are added to `Access-Control-Expose-Headers`.
    - Full-text queries cannot provide an exact total count; `Prefer: count=exact` returns `Content-Range: items <range>/*` for full-text indexes.
    - For JSON-array responses from full-text queries, check for a terminal error object shaped like `{ "error": "ErrorName: message" }` and treat the response as failed. A stream or JSON-parse error is also a failed page, not a record.

12. **Use full-text operators**: For a `FullText` field carrying `@fullText`, use the field name as the query attribute with a full-text comparator.

    ```
    GET /Product/?catalogSearch=matches=waterproof%20trail
    GET /Product/?catalogSearch=matches_phrase=trail%20running
    GET /Product/?catalogSearch=matches_prefix=waterproof%20tra&limit(10)
    ```

    Supported operators: `matches`, `matches_all`, `matches_phrase`, `matches_prefix`, `matches_fuzzy`, `matches_fuzzy_prefix`, plus a `not_` form of each. A negated full-text condition requires a non-negated condition on the same index. Repeat the parameter to provide both:

    ```
    GET /Product/?catalogSearch=matches=waterproof&catalogSearch=not_matches=leather
    ```

    Use operators like `=matches=`, `=matches_phrase=`, `=matches_prefix=`, and `=matches_fuzzy=` with the full-text field name. The REST URL syntax searches every source field in the index, so the caller must be allowed to read every source field.

13. **Query across relationships**: Use dot-syntax to filter by related table attributes. Relationships must be defined with `@relationship` in the schema.

    ```
    GET /Product/?brand.name=Microsoft
    GET /Product/?brand.name=Microsoft&select(name,brand{name})
    ```

    Selecting a relationship without an outer dot-syntax filter behaves as a LEFT JOIN. An outer filter joined with `&` removes parents without a qualifying related record. An outer relationship filter narrows nested relationship results. A nested filter inside `select(...,products[...])` only narrows projected products; it does not remove a parent.

14. **Apply conditions one related record must meet**: Use square brackets after the relationship name to require one related record to satisfy all enclosed conditions.

    ```
    GET /Brand/?products[name=Cable&price=ge=30]
    GET /Brand/?products[name=Keyboard&price=ge=30]
    ```

    Inside the brackets, name attributes of the related table directly (e.g., `price`, not `products.price`). Conditions combine with `&`, `|`, and groups.

15. **Filter and page nested relationships**: Use square brackets inside `select()` to apply conditions, sort, and pagination to each parent's related records.

    ```
    GET /Brand/?select(id,name,products[price=ge=number:30&sort(price)&limit(1)&select(id,name,price)])
    ```

    | Nested option      | Behavior                                                        |
    | ------------------ | --------------------------------------------------------------- |
    | Conditions         | Qualify children of the selected relationship                   |
    | `sort(price)`      | Order eligible children before pagination                       |
    | `limit(end)`       | Return at most `end` children per parent                        |
    | `limit(start,end)` | Skip `start` eligible children and return at most `end - start` |
    | `select(id,price)` | Project fields from returned children                           |
    - `limit(0)` returns no children without reading them. Invalid nested bounds (negative or fractional values) return HTTP 400.
    - Nested filters require a table-backed relationship. Filters on plain JSON projections or full-text predicates inside a relationship selection return HTTP 400.

## Examples

### Range filter with type conversion

```
GET /Product/?price=gt=100&price=lt=200
GET /Product/?price=between=(100,200)
```

### Null query

```
GET /Product/?discount=null
GET /Product/?discount=ne=null
```

### Select with sort and limit

```
GET /Product/?rating=gt=3&inStock=true&select(rating,name)&limit(20)
GET /Product/?sort(+rating,-price)
```

### Paginated request with exact count

```
GET /Product/?category=software&limit(0,25)
Prefer: count=exact
```

Response headers:

```
Content-Range: items 0-24/1234
Range-Unit: items
Preference-Applied: count=exact
```

### Relationship query with nested selection and pagination

```
GET /Brand/?products.price=ge=number:30&select(id,name,products[sort(price)&limit(1)&select(id,name,price)])
```

### OR grouping with nested relationship filter and pagination

```
GET /Brand/?sort(name,id)&limit(0,20)&select(id,name,products[[price=lt=number:30|price=ge=number:60]&sort(-price,id)&limit(1,2)&select(id,name,price)])
```

### Conditions through several relationship hops

```
GET /Company/?departments[employees[tag=oncall&level=ge=3]]
GET /Company/?departments.employees[tag=oncall&level=ge=3]
```

### Many-to-many relationship query

```
GET /Product/?resellers.name=Cool Shop&select(id,name,resellers{name,id})
```

## Notes

- Only indexed attributes can lead a filter query; at least one attribute in a multi-attribute query must be indexed.
- Null indexing requires indexes created in v4.3.0 or later. Existing indexes must be removed and re-added to support `discount=null` queries.
- For strict operators (`=`, `===`, `!==`), no automatic type conversion is applied — the value is decoded as a URL-encoded string.
- No range comparator (`=lt=`, `=le=`, `=gt=`, `=ge=`, `=between=`, etc.) matches a null or omitted value.
- `=ne=` with a non-null value matches null and omitted values.
- A `null` lower bound means no lower bound: `ge=null` and `gt=null` match every non-null value, and `between=(null,10)` returns the same records as `le=10`. A `null` upper bound: `lt=null` and `le=null` match nothing.
- Sorting puts null and omitted values first; `-` puts them last, with no guaranteed order between the two.
- A `HEAD` request with a `count` preference returns count headers with no body.
- The response status for paginated results is always `200`; Harper does not use `206 Partial Content`. `Content-Range` is informational.
- Without `exactCount: true`, a `count=exact` request is served as an estimate (`Preference-Applied: count=estimated`). When the total cannot be produced, it is reported as `.../*` (e.g., `Content-Range: items 0-24/*`). `Preference-Applied` still echoes the requested mode, so an unavailable total (`.../*`) is distinct from a request that asked for no count.
- When CORS is enabled, `Content-Range`, `Range-Unit`, and `Preference-Applied` are added to `Access-Control-Expose-Headers`.
- Full-text queries cannot provide an exact total count; with exact counting enabled, `Prefer: count=exact` returns an unavailable total (`.../*`).
- For JSON-array responses from full-text queries, check for a terminal error object shaped like `{ "error": "ErrorName: message" }` and treat the response as failed. A stream or JSON-parse error is also a failed page, not a record.
- Access a specific property of a record by appending it with dot syntax to the record id: `GET /MyTable/123.propertyName`. This only works for declared properties. The suffixes `.json`, `.cbor`, `.msgpack`, and `.csv` are reserved as content-type selectors and take precedence over a property of the same name.
- Querying through a relationship requires read permission on the related table and each related attribute named in a condition; without it, Harper returns HTTP 403.
- Nested filters require a table-backed relationship. Filters on plain JSON projections or full-text predicates inside a relationship selection return HTTP 400.
- `limit(0)` returns no children without reading them. Invalid nested bounds (negative or fractional values) return HTTP 400.
