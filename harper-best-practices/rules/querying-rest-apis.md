---
name: querying-rest-apis
description: 'How to use query parameters to filter, sort, and paginate Harper REST APIs.'
metadata:
  mode: generate
  sources:
    - reference/v5/rest/querying.md
  sourceCommit: 2cfb81318f17e0aca2d600109e6ad813d2d0443e
  inputHash: 25b9daabc0a28fd5
---

# Querying REST APIs

Instructions for the agent to filter, sort, select, and paginate records through Harper's URL-based REST query language.

## When to Use

Apply this rule whenever you need to construct or handle GET requests against Harper collection endpoints that require filtering by attribute value, comparison operators, sorting, field selection, or paginated results. This rule also covers type coercion syntax and relationship joins via dot notation. See [automatic-apis.md](automatic-apis.md) for how REST endpoints are generated from schemas.

## How It Works

1. **Filter by attribute**: Add query parameters matching attribute names and values. The queried attribute must be indexed.

   ```
   GET /Product/?category=software
   GET /Product/?category=software&inStock=true
   ```

   To filter for null values:

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

   For date fields, URL-encode colons as `%3A`:

   ```
   GET /Product/?listDate=gt=2017-03-08T09%3A30%3A00.000Z
   ```

3. **Chain conditions for range queries**: Omit the attribute name on the second condition to apply it to the same attribute. Only `gt`/`ge` combined with `lt`/`le` is supported.

   ```
   GET /Product/?price=gt=100&lt=200
   ```

4. **Apply type conversion**: For FIQL comparators (`==`, `!=`, `=gt=`, etc.), Harper converts values automatically. Use explicit type prefixes to force a specific type.

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

6. **Group conditions**: Use parentheses or square brackets to control evaluation order. Prefer square brackets when building queries from user input, since standard URI encoding safely encodes `[` and `]`.

   ```
   GET /Product/?rating=5|(price=gt=100&price=lt=200)
   GET /Product/?rating=5&[tag=fast|tag=scalable|tag=efficient]
   ```

   Build grouped queries in JavaScript:

   ```javascript
   let url = `/Product/?rating=5&[${tags.map(encodeURIComponent).join('|')}]`;
   ```

7. **Select specific properties with `select()`**: Append `select()` as a query function separated by `&`.

   | Syntax                                 | Returns                                     |
   | -------------------------------------- | ------------------------------------------- |
   | `?select(property)`                    | Values of a single property directly        |
   | `?select(property1,property2)`         | Objects with only the specified properties  |
   | `?select([property1,property2])`       | Arrays of property values                   |
   | `?select(property1,)`                  | Objects with a single specified property    |
   | `?select(property{subProp1,subProp2})` | Nested objects with specific sub-properties |

   ```
   GET /Product/?category=software&select(name)
   GET /Product/?brand.name=Microsoft&select(name,brand{name})
   ```

8. **Limit results with `limit(end)` or `limit(start,end)`**: Append as a query function.

   ```
   GET /Product/?rating=gt=3&inStock=true&select(rating,name)&limit(20)
   GET /Product/?rating=gt=3&limit(10,30)
   ```

9. **Sort results with `sort(property)` or `sort(+property,-property,...)`**: Prefix `+` or no prefix = ascending; `-` = descending. List multiple properties to break ties in order.

   ```
   GET /Product/?rating=gt=3&sort(+name)
   GET /Product/?sort(+rating,-price)
   ```

10. **Paginate with a total count**: Use `limit(start,end)` for paging and send a `Prefer` request header to receive a total match count.

    | `Prefer` value    | Meaning                                  |
    | ----------------- | ---------------------------------------- |
    | `count=exact`     | Exact count of matching records (opt-in) |
    | `count=estimated` | Fast approximate count                   |

    ```
    GET /Product/?category=software&limit(0,25)
    Prefer: count=exact
    ```

    The server responds with:

    | Header               | Example           | Description                                            |
    | -------------------- | ----------------- | ------------------------------------------------------ |
    | `Content-Range`      | `items 0-24/1234` | 0-based inclusive range out of total matching records  |
    | `Range-Unit`         | `items`           | Unit used by `Content-Range`                           |
    | `Preference-Applied` | `count=exact`     | Count mode the server applied (`exact` or `estimated`) |

    The response status is always `200`. When the total cannot be produced, it is reported as `*` (e.g., `Content-Range: items 0-24/*`).

    Enable exact counts in the application's REST configuration:

    ```yaml
    rest:
      exactCount: true
    ```

    Without this, a `count=exact` request is served as an estimate.

11. **Query across relationships using dot syntax**: Define relationships in the schema with `@relationship`, then filter and select across them.

    ```
    GET /Product/?brand.name=Microsoft
    GET /Brand/?products.name=Keyboard
    GET /Product/?brand.name=Microsoft&select(name,brand{name})
    ```

    Filtering on a related attribute produces INNER JOIN behavior. Selecting a relationship without filtering produces LEFT JOIN behavior — the property is omitted if the foreign key is null or references a non-existent record.

12. **Access a specific property by URL**: Append the property name with dot syntax to the record ID.

    ```
    GET /MyTable/123.propertyName
    ```

    This only works for declared schema properties. The suffixes `.json`, `.cbor`, `.msgpack`, and `.csv` are reserved as content-type selectors.

## Examples

**Range filter with select and sort:**

```
GET /Product/?category=software&price=gt=100&price=lt=200&select(name,price)&sort(+price)
```

**Paginated request with exact count:**

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

**Relationship schema and join query:**

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

**Many-to-many relationship:**

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

**OR grouping with user-supplied tags:**

```javascript
let url = `/Product/?rating=5&[${tags.map(encodeURIComponent).join('|')}]`;
```

## Notes

- The queried attribute must be indexed for basic attribute filtering to execute. For multi-attribute queries, only one attribute needs to be indexed.
- Null indexing requires indexes created after the feature was introduced. Rebuild existing indexes (remove and re-add) to support `name==null` queries.
- `limit()` must be a non-negative integer no larger than **10,000**, and the requested window (offset + limit) no larger than **1,000,000**, for count headers to be returned.
- A `HEAD` request with a `Prefer: count=exact` header returns count headers with no body — it saves bandwidth but still scans the matched set.
- When CORS is enabled, `Content-Range`, `Range-Unit`, and `Preference-Applied` are added to `Access-Control-Expose-Headers` automatically.
- Operators `!=` and `=ct=` (contains) do not produce cardinality estimates; the total is reported as `*` when these are used with `count=exact`.
