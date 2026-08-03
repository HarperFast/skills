---
name: querying-rest-apis
description: 'How to use query parameters to filter, sort, and paginate Harper REST APIs.'
metadata:
  mode: generate
  sources:
    - reference/v5/rest/querying.md
  sourceCommit: 3749d0c54be457a2a65d9a63c738a5dc88989ecd
  inputHash: d5ed0e937cd2d7e0
---

# Querying Harper REST APIs

Instructions for the agent to filter, sort, select, and paginate records using Harper's URL-based query language on REST collection endpoints.

## When to Use

Apply this rule when building or debugging REST API calls against Harper tables that require filtering by attribute values, comparison ranges, sorting, field selection, or result pagination. This rule also covers OR logic, grouping, and querying across related tables via dot-syntax joins. See [automatic-apis.md](automatic-apis.md) for how Harper exposes tables as REST endpoints.

## How It Works

1. **Filter by attribute**: Add query parameters matching attribute names and values. The queried attribute must be indexed.

   ```
   GET /Product/?category=software
   GET /Product/?category=software&inStock=true
   ```

2. **Filter for null values**: Use `=null` as the value to match null or non-null records.

   ```
   GET /Product/?discount=null
   ```

3. **Apply comparison operators (FIQL syntax)**: Use FIQL operators in query parameters for range and string matching.

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

4. **Chain conditions for range queries**: Omit the attribute name on the second condition to apply it to the same attribute. Only `gt`/`ge` combined with `lt`/`le` is supported for chaining.

   ```
   GET /Product/?price=gt=100&lt=200
   ```

5. **Apply type conversion**: For FIQL comparators, Harper converts values automatically. Use explicit prefixes to force a type.

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

6. **Combine conditions with OR logic**: Use `|` instead of `&` to express OR between conditions.

   ```
   GET /Product/?rating=5|featured=true
   ```

7. **Group conditions**: Use parentheses or square brackets to control evaluation order. Prefer square brackets when building queries from user input, since `[` and `]` are safely URI-encoded.

   ```
   GET /Product/?rating=5|(price=gt=100&price=lt=200)
   GET /Product/?rating=5&[tag=fast|tag=scalable|tag=efficient]
   ```

   Build grouped queries in JavaScript:

   ```javascript
   let url = `/Product/?rating=5&[${tags.map(encodeURIComponent).join('|')}]`;
   ```

   Nest groups for complex conditions:

   ```
   GET /Product/?price=lt=100|[rating=5&[tag=fast|tag=scalable|tag=efficient]&inStock=true]
   ```

8. **Select specific properties with `select(`**: Append `select(...)` as a query function separated by `&` to control which fields are returned.

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

9. **Paginate results with `limit(`**: Use `limit(end)` or `limit(start,end)` to restrict the number of records returned.

   ```
   GET /Product/?rating=gt=3&inStock=true&select(rating,name)&limit(20)
   GET /Product/?rating=gt=3&limit(10,30)
   ```

10. **Sort results with `sort(`**: Use `sort(property)` or `sort(+property,-property,...)` to order results. Prefix `+` or no prefix = ascending; `-` = descending.

    ```
    GET /Product/?rating=gt=3&sort(+name)
    GET /Product/?sort(+rating,-price)
    ```

11. **Query across relationships using dot-syntax**: Filter on related table attributes using dot-chained property names. Relationships must be defined in the schema with `@relationship`.

    ```
    GET /Product/?brand.name=Microsoft
    GET /Brand/?products.name=Keyboard
    ```

    Use `select()` to include relationship attributes in the response (they are excluded by default):

    ```
    GET /Product/?brand.name=Microsoft&select(name,brand)
    GET /Product/?brand.name=Microsoft&select(name,brand{name})
    ```

12. **Access a specific property by URL**: Append `.propertyName` to a record ID in the URL path. Only works for properties declared in the schema.
    ```
    GET /MyTable/123.propertyName
    ```

## Examples

**Range filter with select and limit**:

```
GET /Product/?category=software&price=gt=100&price=lt=200&select(name,price)&limit(20)
```

**Sort and paginate**:

```
GET /Product/?rating=gt=3&sort(+rating,-price)&limit(10,30)
```

**OR with grouping**:

```
GET /Product/?price=lt=100|[rating=5&[tag=fast|tag=scalable|tag=efficient]&inStock=true]
```

**Join query with nested select** — schema first:

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

Then query:

```
GET /Product/?brand.name=Microsoft&select(name,brand{name,id})
```

**Many-to-many relationship** — schema:

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

**Date range with URL-encoded colons**:

```
GET /Product/?listDate=gt=2017-03-08T09%3A30%3A00.000Z
```

## Notes

- All filtered attributes must be indexed unless at least one other attribute in the same query is indexed.
- Null queries (`?attr=null`) require indexes created after null indexing support was added. Rebuild existing indexes (remove and re-add) to enable null queries on them.
- When selecting a related attribute without filtering on it, the join behaves as a LEFT JOIN — the relationship property is omitted if the foreign key is null or references a non-existent record.
- The array order of foreign key values (e.g., `resellerIds`) is preserved when resolving many-to-many relationships.
- Square brackets (`[`, `]`) are preferred over parentheses for grouping when constructing queries programmatically, because standard URI encoding safely encodes them.
- `directURLMapping: true` can be set on a resource to change URL path handling semantics; see your schema configuration for details.
