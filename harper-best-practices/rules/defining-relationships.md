---
name: defining-relationships
description: How to define and use relationships between tables in Harper using GraphQL.
metadata:
  mode: generate
  sources:
    - reference/v5/database/schema.md#Relationships
    - reference/v5/rest/querying.md#Relationships and Joins
  sourceCommit: bea4e62cb7efd809bb67e00cbda01a410c1177b1
  inputHash: 58ffc789fa71ffe6
---

# Defining Relationships Between Tables in Harper

Instructions for the agent to define and query relationships between Harper tables using the `@relationship` directive in GraphQL schemas.

## When to Use

Apply this rule when writing Harper schemas that require join queries across tables, or when query results must include related records as nested properties. Use it whenever a foreign key exists in one table that references another, or when modeling one-to-many, many-to-one, or many-to-many associations.

## How It Works

1. **Declare a many-to-one relationship with `from`**: Place `@relationship(from: attribute)` on a field when the foreign key lives in the current table and references the primary key of the target table. The result type is a single object.

   ```graphql
   type RealityShow @table @export {
   	id: Long @primaryKey
   	networkId: Long @indexed
   	network: Network @relationship(from: networkId) # many-to-one
   	title: String @indexed
   }

   type Network @table @export {
   	id: Long @primaryKey
   	name: String @indexed
   }
   ```

2. **Declare a one-to-many relationship with `to`**: Place `@relationship(to: attribute)` on a field when the foreign key lives in the target table and references the primary key of the current table. The result type **must** be an array.

   ```graphql
   type Network @table @export {
   	id: Long @primaryKey
   	name: String @indexed
   	shows: [RealityShow] @relationship(to: networkId) # one-to-many
   }
   ```

3. **Declare a foreign-key-to-foreign-key relationship with `@relationship(from: attribute, to: attribute)`**: Specify both `from` and `to` when neither side uses the primary key. Harper resolves the relationship by searching the target table's `to` attribute for matches using the current record's `from` attribute value. The result type must be an array.

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

4. **Declare a many-to-many relationship using an array foreign key with `from`**: When the foreign key field is an array, `@relationship(from: attribute)` establishes a many-to-many relationship. The result type must be an array.

   ```graphql
   type RealityShow @table @export {
   	id: Long @primaryKey
   	networkIds: [Long] @indexed
   	networks: [Network] @relationship(from: networkIds)
   }
   ```

5. **Query across relationships using dot-syntax**: Filter records by related table attributes using dot-chained attribute names. This behaves as an INNER JOIN — only parents with a qualifying related record are returned.

   ```
   GET /RealityShow?network.name=Bravo
   GET /Product/?brand.name=Microsoft
   GET /Brand/?products.name=Keyboard
   ```

6. **Include relationship fields in results using `select()`**: Relationship attributes are not included by default. Use `select()` to project them, optionally with a nested field list using `{}`.

   ```
   GET /Product/?brand.name=Microsoft&select(name,brand)
   GET /Product/?brand.name=Microsoft&select(name,brand{name})
   GET /Product/?name=Keyboard&select(name,brand{name,id})
   ```

   Selecting a relationship without an outer dot-syntax filter on it behaves as a LEFT JOIN: parents remain even when there are no related records.

7. **Filter and page nested relationship results using `[]` inside `select()`**: Apply conditions, sort, and pagination to each parent's related records by placing them inside square brackets in the `select()` expression.

   ```
   GET /Brand/?select(id,name,products[price=ge=number:30&sort(price)&limit(1)&select(id,name,price)])
   ```

   An outer relationship filter (e.g., `products.price=ge=number:30`) removes parents without a qualifying child **and** narrows the nested candidates. A filter inside `products[...]` only narrows projected children without removing their parent.

   | Nested option      | Behavior                                                                   |
   | ------------------ | -------------------------------------------------------------------------- |
   | Conditions         | Qualify children; combine with `&` (AND), `\|` (OR), and groups.           |
   | `sort(price)`      | Order eligible children before pagination.                                 |
   | `limit(end)`       | Return at most `end` children per parent.                                  |
   | `limit(start,end)` | Skip `start` eligible children and return at most `end - start`.           |
   | `select(id,price)` | Project fields from returned children; omit to return whole child records. |

## Examples

### Schema with bidirectional relationships

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

### Many-to-many without a junction table

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

The array order of `resellerIds` is preserved when resolving the relationship.

### Nested filtering and pagination scenarios

Schema for the following examples:

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

**Keep every brand; show its cheapest product costing at least 30** (LEFT JOIN behavior — Budget Basics returns with an empty product list):

```
GET /Brand/?select(id,name,products[price=ge=number:30&sort(price)&limit(1)&select(id,name,price)])
```

**Return only qualifying brands; inherit the outer price filter** (INNER JOIN behavior — Budget Basics is removed):

```
GET /Brand/?products.price=ge=number:30&select(id,name,products[sort(price)&limit(1)&select(id,name,price)])
```

**Page through each brand's qualifying products** (offset applies independently per brand):

```
GET /Brand/?products.price=ge=number:30&select(id,name,products[sort(price)&limit(1,2)&select(id,name,price)])
```

**Bound parent pages with stable sorting**:

```
GET /Brand/?products.price=ge=number:30&sort(name,id)&limit(0,20)&select(id,name,products[sort(price,id)&limit(1)&select(id,name,price)])
```

**Combine OR filters with child sorting and pagination**:

```
GET /Brand/?sort(name,id)&limit(0,20)&select(id,name,products[[price=lt=number:30|price=ge=number:60]&sort(-price,id)&limit(1,2)&select(id,name,price)])
```

## Notes

- Index all foreign key fields (e.g., `brandId`, `price`) and outer filter fields to support efficient join queries.
- Use a unique field as the final sort key (e.g., `sort(price,id)`) to ensure deterministic ordering when values are equal.
- A nested `limit()` bounds children per parent, not the number of parents. Apply a separate outer `limit()` to bound the parent result set.
- Nested filters require a table-backed relationship. Filters on plain JSON projections or full-text predicates inside a relationship selection return HTTP 400.
- Invalid `limit()` bounds (negative or fractional values) return HTTP 400. `limit(0)` returns no children without reading them.
- A condition traversing another relationship qualifies the immediate child only; it does not narrow that child's projected descendants. Place grandchild constraints in the grandchild's own bracket selection.
- Schemas can define self-referential relationships to enable parent-child hierarchies within a single table.
