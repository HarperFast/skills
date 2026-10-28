---
name: querying-rest-apis
description: 'How to use query parameters to filter, sort, and paginate Harper REST APIs.'
metadata:
  mode: generate
  sources:
    - reference/v5/rest/querying.md
  sourceCommit: 6c3e29dd9149201364b0d74642725c30f0305e3e
  inputHash: e034fdc191f2cdc0
---

# Querying Harper REST APIs

Instructions for the agent to filter, sort, select, and paginate records using Harper's URL-based query language on REST collection endpoints.

## When to Use

Apply this rule whenever building or modifying REST requests against Harper collection paths that need attribute filtering, comparison operators, sorting, field selection, pagination, or relationship joins. This rule covers all query parameter construction for Harper's automatic REST APIs (see [automatic-apis.md](automatic-apis.md)).

## How It Works

1. **Filter by attribute**: Add query parameters matching attribute name to value. The queried attribute must be indexed.

   ```
   GET /Product/?category=software
   GET /Product/?category=software&inStock=true
   GET /Product/?discount=null
   ```

2. **Apply comparison operators (FIQL syntax)**: Use FIQL operators in the query string for range and string comparisons.

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

6. **Group conditions**: Use parentheses or square brackets to control order of operations. Prefer square brackets when constructing queries from user input.

   ```
   GET /Product/?rating=5|(price=gt=100&price=lt=200)
   GET /Product/?rating=5&[tag=fast|tag=scalable|tag=efficient]
   ```

   Construct from JavaScript:

   ```javascript
   let url = `/Product/?rating=5&[${tags.map(encodeURIComponent).join('|')}]`;
   ```

7. **Select specific properties with `select()`**: Specify which properties to include in the response.

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

8. **Limit results with `limit(end)` or `limit(start,end)`**: Return records in a zero-based window from `start` (inclusive) to `end` (exclusive). `limit(end)` starts at zero.

   ```
   GET /Product/?rating=gt=3&inStock=true&select(rating,name)&limit(20)
   GET /Product/?rating=gt=3&limit(10,30)
   ```

9. **Sort results with `sort(property)` or `sort(+property,-property,...)`**: Prefix `+` or no prefix = ascending; `-` = descending. Multiple properties break ties in order.

   ```
   GET /Product/?rating=gt=3&sort(+name)
   GET /Product/?sort(+rating,-price)
   ```

10. **Request a total count for pagination**: Send a `Prefer` header on `GET` or `HEAD` requests. Counting requires a bounded `limit()` with page size no larger than 10,000 and window end no larger than 1,000,000.

    | `Prefer` value    | Meaning                                                                                       |
    | ----------------- | --------------------------------------------------------------------------------------------- |
    | `count=exact`     | Exact number of matching records. Off by default; requires `exactCount: true` in REST config. |
    | `count=estimated` | Fast approximate count. Does not require `exactCount`.                                        |

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

    - The response status for paginated requests is always `200`; Harper does not use `206 Partial Content`.
    - A `HEAD` request with a `count` preference returns the count headers with no body.
    - When CORS is enabled, `Content-Range`, `Range-Unit`, and `Preference-Applied` are added to `Access-Control-Expose-Headers`.
    - Without `exactCount: true`, a `count=exact` request is served as an estimate. When the total cannot be produced, it is reported as `*` (e.g., `Content-Range: items 0-24/*`). `Preference-Applied` still echoes the requested mode, so an unavailable total (`.../*`) is distinct from a request that asked for no count.

11. **Query across relationships**: Use dot-syntax on attributes defined with `@relationship` in the schema.

    ```
    GET /Product/?brand.name=Microsoft
    GET /Brand/?products.name=Keyboard
    GET /Product/?brand.name=Microsoft&select(name,brand{name})
    ```

    Selecting a relationship without an outer dot-syntax filter behaves as a LEFT JOIN. An outer filter such as `products.price=ge=number:30` removes parents without a qualifying product and also narrows the selected products.

12. **Filter and page nested relationships**: Use square brackets inside `select()` to apply conditions, sort, and pagination to each parent's related records.

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
    - Invalid nested bounds (negative or fractional values) return HTTP 400. `limit(0)` returns no children without reading them.

## Examples

### Range filter with sort and limit

```
GET /Product/?category=software&price=gt=100&price=lt=200&sort(+price)&limit(0,25)
```

### Relationship join with nested selection

```
GET /Product/?brand.name=Microsoft&select(name,brand{name,id})
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

### Nested relationship filter with OR, sort, and pagination

```
GET /Brand/?sort(name,id)&limit(0,20)&select(id,name,products[[price=lt=number:30|price=ge=number:60]&sort(-price,id)&limit(1,2)&select(id,name,price)])
```

### Outer filter inheriting into nested selection

```
GET /Brand/?products.price=ge=number:30&select(id,name,products[sort(price)&limit(1)&select(id,name,price)])
```

### Many-to-many relationship query

Schema:

```graphql
type Product @table @export {
	id: Long @primaryKey
	name: String
	resellerIds: [Long] @indexed
	resellers: [Reseller] @relationship(from: "resellerIds")
}
```

Query:

```
GET /Product/?resellers.name=Cool Shop&select(id,name,resellers{name,id})
```

## Notes

- Queried attributes must be indexed for filtering to execute; only one attribute in a multi-attribute query needs to be indexed.
- URL-encode colons in date values as `%3A` (e.g., `listDate=gt=2017-03-08T09%3A30%3A00.000Z`).
- Square brackets are preferred over parentheses when constructing queries programmatically because standard URI encoding safely encodes `[` and `]`.
- Brackets inside `select()` after a relationship name (e.g., `select(id,products[limit(1)])`) form a nested relationship query, not a grouping expression.
- For full-text fields marked `@fullText`, use operators such as `=matches=`, `=matches_phrase=`, `=matches_prefix=`, `=matches_fuzzy=`, and their `=not_*=` negated forms. Full-text queries cannot provide an exact total count.
- `limit(end)` and `limit(start,end)` inside a nested relationship selection apply per parent, not to the total result set.
- Always add a unique field as the final sort key (e.g., `sort(name,id)`) to ensure deterministic ordering across pages.
- Nested filters require a table-backed relationship; filters on plain JSON projections or full-text predicates inside a relationship selection return HTTP 400.
- For streaming JSON-array responses, check for a terminal object shaped like `{ "error": "ErrorName: message" }` and treat the response as failed.
- Access a specific property of a record using dot syntax on the record ID: `GET /MyTable/123.propertyName`. This only works for declared schema properties. The suffixes `.json`, `.cbor`, `.msgpack`, and `.csv` are reserved as content-type selectors and take precedence over a property of the same name.
