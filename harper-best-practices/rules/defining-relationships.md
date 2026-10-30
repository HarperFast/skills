---
name: defining-relationships
description: How to define and use relationships between tables in Harper using GraphQL.
metadata:
  mode: generate
  sources:
    - reference/v5/database/schema.md#Relationships
    - reference/v5/rest/querying.md#Relationships and Joins
  sourceCommit: da68d8e45f5422321c128a0cd67694bd0b97b155
  inputHash: fbffe27f856daa3b
---

# Defining Relationships Between Tables in Harper

Instructions for the agent to follow when defining and querying relationships between tables in Harper using the `@relationship` directive.

**Instead of:** ORM relations and join tables (Prisma, Drizzle, Sequelize). Use this rule rather than adding that service. See `harper-architecture`.

## When to Use

Apply this rule when a schema requires join queries across tables, nested property access to related records, or any foreign-key association between two types. Use it whenever you need to express one-to-many, many-to-one, many-to-many, or foreign-key-to-foreign-key relationships.

## How It Works

1. **Choose the correct `@relationship` form** based on where the foreign key lives:

   | Form                                            | Foreign key location            | Typical cardinality         | Result type       |
   | ----------------------------------------------- | ------------------------------- | --------------------------- | ----------------- |
   | `@relationship(from: attribute)`                | This table                      | many-to-one or many-to-many | singular or array |
   | `@relationship(to: attribute)`                  | Target table                    | one-to-many or many-to-many | array (required)  |
   | `@relationship(from: attribute, to: attribute)` | Both sides use non-primary keys | foreign key to foreign key  | array (required)  |

2. **Declare `@relationship(from: attribute)` for many-to-one**: Place the directive on the relationship field in the table that holds the foreign key. The field type is the target table type (singular).

   ```graphql
   type RealityShow @table @export {
   	id: Long @primaryKey
   	networkId: Long @indexed # foreign key
   	network: Network @relationship(from: networkId) # many-to-one
   	title: String @indexed
   }

   type Network @table @export {
   	id: Long @primaryKey
   	name: String @indexed
   }
   ```

3. **Declare `@relationship(to: attribute)` for one-to-many**: Place the directive on the parent table. The result type must be an array. The named attribute is the foreign key in the target table.

   ```graphql
   type Network @table @export {
   	id: Long @primaryKey
   	name: String @indexed
   	shows: [RealityShow] @relationship(to: networkId) # one-to-many
   }
   ```

4. **Use an array foreign key for many-to-many**: When the foreign key field is an array, `@relationship(from: attribute)` establishes a many-to-many relationship. The result type must also be an array. Array order is preserved when resolving the relationship.

   ```graphql
   type RealityShow @table @export {
   	id: Long @primaryKey
   	networkIds: [Long] @indexed
   	networks: [Network] @relationship(from: networkIds)
   }
   ```

5. **Use `@relationship(from: attribute, to: attribute)` for foreign-key-to-foreign-key joins**: Specify both `from` and `to` when neither side uses the primary key. The result type must be an array.

   ```graphql
   type OrderItem @table @export {
   	id: Long @primaryKey
   	orderId: Long @indexed
   	productSku: Long @indexed
   	products: [Product] @relationship(from: productSku, to: sku) # matches products by sku, not primary key
   }

   type Product @table @export {
   	id: Long @primaryKey
   	sku: Long @indexed
   	name: String
   }
   ```

6. **Query across relationships using dot-syntax**: Filter by related attributes using `attribute.nestedAttribute=value`. This behaves as an INNER JOIN — only parents with a matching related record are returned.

   ```
   GET /RealityShow?network.name=Bravo
   GET /Product/?brand.name=Microsoft
   GET /Brand/?products.name=Keyboard
   ```

7. **Include relationship fields in results using `select()`**: Relationship attributes are not included by default. Use `select()` to project them. Selecting a relationship without an outer dot-syntax filter behaves as a LEFT JOIN.

   ```
   GET /Product/?brand.name=Microsoft&select(name,brand)
   GET /Product/?brand.name=Microsoft&select(name,brand{name})
   GET /Product/?name=Keyboard&select(name,brand{name,id})
   ```

8. **Apply nested filters, sort, and pagination per relationship using square brackets**: Use `select(...,relationship[conditions&sort()&limit()&select()])` to qualify, order, and page each parent's related records independently.

   | Nested option      | Behavior                                                                  |
   | ------------------ | ------------------------------------------------------------------------- |
   | Conditions         | Qualify children; combine with `&` (AND), `\|` (OR), and groups           |
   | `sort(price)`      | Order that parent's eligible children before pagination                   |
   | `limit(end)`       | Return at most `end` children per parent                                  |
   | `limit(start,end)` | Skip `start` eligible children and return at most `end - start`           |
   | `select(id,price)` | Project fields from returned children; omit to return whole child records |

   An outer relationship filter (e.g., `products.price=ge=number:30`) removes parents without a qualifying child and also narrows the children available to the nested selection. A filter inside `select(...,products[...])` only narrows projected children; it does not remove a parent.

9. **Index foreign key and filter fields**: Keep relationship lookup fields and outer filter fields indexed. Use `@indexed` on foreign key attributes and any attribute used in dot-syntax filters.

## Examples

### Schema with bidirectional relationships

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

### Keep every parent; filter children inside the selection (LEFT JOIN behavior)

```
GET /Brand/?select(id,name,products[price=ge=number:30&sort(price)&limit(1)&select(id,name,price)])
```

All brands are returned. Brands with no qualifying products receive an empty `products` array.

### Return only qualifying parents; inherit the outer filter into nested results

```
GET /Brand/?products.price=ge=number:30&select(id,name,products[sort(price)&limit(1)&select(id,name,price)])
```

Only brands with at least one product costing ≥ 30 are returned. The price filter is inherited by the nested selection; repeating it inside `[...]` is unnecessary.

### Page through each parent's qualifying children

```
GET /Brand/?products.price=ge=number:30&select(id,name,products[sort(price)&limit(1,2)&select(id,name,price)])
```

`limit(1,2)` skips the first eligible product and returns the second for each qualifying brand. The offset applies independently per brand.

### Stable parent and child pagination

```
GET /Brand/?products.price=ge=number:30&sort(name,id)&limit(0,20)&select(id,name,products[sort(price,id)&limit(1)&select(id,name,price)])
```

Outer `sort(name,id)` orders brands; nested `sort(price,id)` orders products within each brand. Use a unique field as the final sort key for deterministic ordering.

### OR conditions inside nested selection

```
GET /Brand/?sort(name,id)&limit(0,20)&select(id,name,products[[price=lt=number:30|price=ge=number:60]&sort(-price,id)&limit(1,2)&select(id,name,price)])
```

Group OR conditions inside the relationship selection with `[condition1|condition2]`, then append `sort()`, `limit()`, and `select()` with `&`.

### Many-to-many with array foreign key

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

## Notes

- The result type for `@relationship(to: attribute)` and `@relationship(from: attribute, to: attribute)` **must** be an array.
- Schemas can define self-referential relationships to enable parent-child hierarchies within a single table.
- A singular foreign key that is null or references a missing record causes the relationship property to be omitted from the result.
- For array-valued foreign keys, pagination alone preserves missing target positions; adding conditions or a sort drops missing targets.
- Nested filters require a table-backed relationship. Filters on plain JSON projections or full-text predicates inside a relationship selection return HTTP 400.
- Invalid `limit()` bounds (negative or fractional values) return HTTP 400. `limit(0)` returns no children without reading them.
- A condition that traverses another relationship qualifies the immediate child only; it does not narrow that child's projected descendants. Put grandchild constraints on the grandchild's own bracket selection.
- Keep parent pages small and consider a separately paginated child endpoint for very large relationships.
