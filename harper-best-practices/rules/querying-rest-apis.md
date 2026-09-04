---
name: querying-rest-apis
description: 'How to use query parameters to filter, sort, and paginate Harper REST APIs.'
metadata:
  mode: generate
  sources:
    - reference/v5/rest/querying.md
  sourceCommit: 677ad213d67822e109c83619e181ca23a59823db
  inputHash: 0f8efee293628a52
---

# Querying REST APIs

Instructions for the agent to filter, sort, select, and paginate Harper REST API collections using URL query parameters.

## When to Use

Apply this rule whenever building or modifying code that queries Harper REST collection endpoints. Use it when you need to filter records by attribute values, apply comparison operators, sort or paginate results, or join across related tables. See [automatic-apis.md](automatic-apis.md) for how Harper exposes tables as REST endpoints.

## How It Works

1. **Filter by attribute**: Add query parameters matching attribute names and values. The queried attribute must be indexed.

   ```
   GET /Product/?category=software
   GET /Product/?category=software&inStock=true
   ```

2. **Apply comparison operators (FIQL syntax)**: Use FIQL operators in the query string for numeric, string, and date comparisons.

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

4. **Apply type conversion**: For FIQL comparators, Harper converts values automatically. Use explicit prefixes to force a type.

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

7. **Select specific properties with `select(`**: Append `select(...)` as a query function separated by `&`.

   | Syntax                                 | Returns                                     |
   | -------------------------------------- | ------------------------------------------- |
   | `?select(property)`                    | Values of a single property directly        |
   | `?select(property1,property2)`         | Objects with only the specified properties  |
   | `?select([property1,property2])`       | Arrays of property values                   |
   | `?select(property1,)`                  | Objects with a single specified property    |
   | `?select(property{subProp1,subProp2})` | Nested objects with specific sub-properties |

8. **Paginate with `limit(`**: Use `limit(end)` or `limit(start,end)` to control result count and offset.

9. **Sort with `sort(`**: Use `sort(property)` or `sort(+property,-property,...)`. Prefix `+` or no prefix = ascending; `-` = descending.

10. **Query across relationships**: Use dot-syntax to filter by related table attributes. Relationships must be defined in the schema using `@relationship`. Relationship attributes are not included by default — use `select()` to include them.

    ```
    GET /Product/?brand.name=Microsoft&select(name,brand{name})
    ```

11. **Query for null values**: Use `=null` as the value to match null or non-null records.
    ```
    GET /Product/?discount=null
    ```

## Examples

**Filter with comparison operators and select:**

```
GET /Product/?category=software&price=gt=100&price=lt=200&select(name,price)
```

**Paginate and sort:**

```
GET /Product/?rating=gt=3&inStock=true&select(rating,name)&limit(20)
GET /Product/?rating=gt=3&limit(10,30)
GET /Product/?rating=gt=3&sort(+name)
GET /Product/?sort(+rating,-price)
```

**OR logic with grouping:**

```
GET /Product/?price=lt=100|[rating=5&[tag=fast|tag=scalable|tag=efficient]&inStock=true]
```

**Relationship join with nested select:**

Define the schema:

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

Query with join:

```
GET /Product/?brand.name=Microsoft&select(name,brand{name,id})
GET /Brand/?products.name=Keyboard
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

**Access a specific property by record ID:**

```
GET /MyTable/123.propertyName
```

## Notes

- Only indexed attributes can be used as the primary filter attribute; when combining multiple attributes, only one needs to be indexed.
- Relationship attributes are excluded from responses by default. Always use `select(` to include them.
- When selecting a related attribute without filtering on it, the behavior is a LEFT JOIN — the property is omitted if the foreign key is null or references a non-existent record.
- The suffixes `.json`, `.cbor`, `.msgpack`, and `.csv` in URL paths are reserved as content-type selectors and take precedence over a property of the same name.
- Square brackets are preferred over parentheses when building grouped queries programmatically, because `[` and `]` are safely URL-encoded by standard encoding functions while `(` is not.
