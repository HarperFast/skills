---
name: querying-rest-apis
description: 'How to use query parameters to filter, sort, and paginate Harper REST APIs.'
metadata:
  mode: generate
  sources:
    - reference/v5/rest/querying.md
  sourceCommit: bea4e62cb7efd809bb67e00cbda01a410c1177b1
  inputHash: 0b9da6602db6e2ba
---

# Querying REST APIs

Instructions for the agent to filter, sort, paginate, and project records through Harper's URL-based query language on REST collection endpoints.

## When to Use

Apply this rule whenever building or modifying code that constructs GET requests against Harper REST collection paths and needs to filter by attribute value, apply comparison operators, sort results, paginate, or select specific properties. See [automatic-apis.md](automatic-apis.md) for how Harper exposes tables as REST endpoints in the first place.

## How It Works

1. **Filter by attribute value**: Add query parameters matching attribute names. The queried attribute must be indexed.

   ```
   GET /Product/?category=software
   GET /Product/?category=software&inStock=true
   ```

   Query for null values with:

   ```
   GET /Product/?discount=null
   ```

2. **Apply FIQL comparison operators**: Use the operators below for range and string comparisons. The attribute must be indexed.

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

   For date fields, URL-encode colons as `%3A`:

   ```
   GET /Product/?listDate=gt=2017-03-08T09%3A30%3A00.000Z
   ```

3. **Chain conditions for range queries**: Omit the attribute name on the second condition to apply it to the same attribute. Only `gt`/`ge` combined with `lt`/`le` is supported.

   ```
   GET /Product/?price=gt=100&lt=200
   ```

4. **Apply type conversion**: For FIQL comparators, Harper converts values automatically or explicitly using type prefixes.

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

6. **Group conditions**: Use parentheses or square brackets to control order of operations. Prefer square brackets when constructing queries from user input, since standard URI encoding safely encodes `[` and `]`.

   ```
   GET /Product/?rating=5|(price=gt=100&price=lt=200)
   GET /Product/?rating=5&[tag=fast|tag=scalable|tag=efficient]
   ```

   Construct from JavaScript:

   ```javascript
   let url = `/Product/?rating=5&[${tags.map(encodeURIComponent).join('|')}]`;
   ```

7. **Select specific properties with `select()`**: Include `select()` as a query function to control which properties are returned.

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

8. **Paginate with `limit(end)`**: Return records in a zero-based window. `limit(end)` starts at zero; `limit(start,end)` returns at most `end - start` records.

   ```
   GET /Product/?rating=gt=3&inStock=true&select(rating,name)&limit(20)
   GET /Product/?rating=gt=3&limit(10,30)
   ```

9. **Sort with `sort(property)` or `sort(+property,-property,...)`**: Prefix `+` or no prefix = ascending; `-` = descending. Multiple properties break ties in order.

   ```
   GET /Product/?rating=gt=3&sort(+name)
   GET /Product/?sort(+rating,-price)
   ```

10. **Request a total count for pagination**: Send a `Prefer` header on `GET` or `HEAD` requests. Counting requires a bounded `limit()` with page size no larger than 10,000 and window end no larger than 1,000,000.

    | `Prefer` value    | Meaning                                  |
    | ----------------- | ---------------------------------------- |
    | `count=exact`     | Exact count of matching records (opt-in) |
    | `count=estimated` | Fast approximate estimate                |

    ```
    GET /Product/?category=software&limit(0,25)
    Prefer: count=exact
    ```

    Response headers:

    | Header               | Example           | Description                                            |
    | -------------------- | ----------------- | ------------------------------------------------------ |
    | `Content-Range`      | `items 0-24/1234` | 0-based inclusive range returned out of total matching |
    | `Range-Unit`         | `items`           | Unit used by `Content-Range`                           |
    | `Preference-Applied` | `count=exact`     | Count mode the server applied                          |

    Enable exact counts in REST configuration:

    ```yaml
    rest:
      exactCount: true
    ```

    Without `exactCount: true`, a `count=exact` request is served as an estimate. The response status is always `200`. When the total cannot be produced, it is reported as `*` (e.g., `Content-Range: items 0-24/*`). `Preference-Applied` still echoes the requested mode, so an unavailable total is distinct from a request that asked for no count.

11. **Query across relationships**: Use dot-syntax to filter by related table attributes. Relationships must be defined with `@relationship` in the schema.

    ```
    GET /Product/?brand.name=Microsoft
    GET /Brand/?products.name=Keyboard
    ```

    Include relationship attributes in the response using `select()`:

    ```
    GET /Product/?brand.name=Microsoft&select(name,brand{name})
    ```

12. **Filter and page nested relationships**: Use square brackets inside `select()` to apply conditions, sort, and pagination to each parent's related records. An outer relationship filter also narrows that relationship's nested results — do not repeat the outer filter inside `[...]`.

    ```
    GET /Brand/?products.price=ge=number:30&select(id,name,products[sort(price)&limit(1)&select(id,name,price)])
    ```

    Nested option reference:

    | Nested option      | Behavior                                                        |
    | ------------------ | --------------------------------------------------------------- |
    | Conditions         | Qualify children; combine with `&` (AND), `\|` (OR), and groups |
    | `sort(price)`      | Order eligible children before pagination                       |
    | `limit(end)`       | Return at most `end` children per parent                        |
    | `limit(start,end)` | Skip `start` eligible children, return at most `end - start`    |
    | `select(id,price)` | Project fields from returned children                           |

13. **Access a specific property via URL**: Append the property name with dot syntax to the record id.

    ```
    GET /MyTable/123.propertyName
    ```

    This only works for declared schema properties. The suffixes `.json`, `.cbor`, `.msgpack`, and `.csv` are reserved as content-type selectors and take precedence over a property of the same name.

## Examples

### Range filter with sort and limit

```
GET /Product/?category=software&price=gt=100&price=lt=200&sort(+price)&limit(0,25)
```

### Select with nested relationship projection

```
GET /Product/?brand.name=Microsoft&select(name,brand{name,id})
```

### Paginated count request

```
GET /Product/?category=software&limit(0,25)
Prefer: count=exact
```

```
HTTP/1.1 200 OK
Content-Range: items 0-24/1234
Range-Unit: items
Preference-Applied: count=exact
```

### Nested relationship filter with OR grouping, sort, and pagination

```
GET /Brand/?sort(name,id)&limit(0,20)&select(id,name,products[[price=lt=number:30|price=ge=number:60]&sort(-price,id)&limit(1,2)&select(id,name,price)])
```

### Many-to-many relationship query

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

### Stable paginated parent + child query

```
GET /Brand/?products.price=ge=number:30&sort(name,id)&limit(0,20)&select(id,name,products[sort(price,id)&limit(1)&select(id,name,price)])
```

## Notes

- Queried attributes must be indexed for filtering to execute. Keep relationship lookup fields and outer filter fields indexed.
- Null indexing requires indexes created or rebuilt after the feature was introduced; existing indexes must be removed and re-added.
- `select()` brackets inside a relationship selection (e.g., `select(id,products[limit(1)])`) apply nested query options, not grouping logic.
- Selecting a relationship without an outer dot-syntax filter behaves as a LEFT JOIN; an outer filter behaves as an INNER JOIN.
- A nested condition narrows projected children but does not remove a parent from results; only an outer relationship filter removes parents.
- Invalid nested bounds (negative or fractional values) return HTTP 400. `limit(0)` returns no children without reading them.
- Nested filters require a table-backed relationship. Filters on plain JSON projections or custom non-table resources return HTTP 400.
- The response status for paginated requests is always `200`; Harper does not use `206 Partial Content`.
- When CORS is enabled, `Content-Range`, `Range-Unit`, and `Preference-Applied` are added to `Access-Control-Expose-Headers`.
- Use a unique field as the final sort key (e.g., `sort(name,id)`) to ensure deterministic ordering when values are equal.
