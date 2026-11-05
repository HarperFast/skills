---
name: defining-relationships
description: How to define and use relationships between tables in Harper using GraphQL.
metadata:
  mode: generate
  sources:
    - reference/v5/database/schema.md#Relationships
    - reference/v5/rest/querying.md#Relationships and Joins
  sourceCommit: 0a29827da61afe7fff40ee8de87e1d4c2c286bea
  inputHash: 0e622617a8b5c196
---

# Defining Relationships Between Tables in Harper

Instructions for the agent to follow when defining and querying relationships between tables in Harper using the `@relationship` directive.

**Instead of:** ORM relations and join tables (Prisma, Drizzle, Sequelize). Use this rule rather than adding that service. See `harper-architecture`.

## When to Use

Apply this rule when adding foreign-key relationships between schema tables, enabling join queries, or selecting nested related records in query results. Use it any time a schema type needs to reference records in another table via a `@relationship` directive.

## How It Works

1. **Use `@relationship(from: attribute)` for many-to-one or many-to-many**: Place this on the field whose table holds the foreign key. The `from` argument names the attribute in this table that stores the foreign key referencing the target table's primary key.

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

   If the foreign key attribute is an array, the relationship becomes many-to-many:

   ```graphql
   type RealityShow @table @export {
   	id: Long @primaryKey
   	networkIds: [Long] @indexed
   	networks: [Network] @relationship(from: networkIds)
   }
   ```

2. **Use `@relationship(to: attribute)` for one-to-many or many-to-many**: Place this on the field whose table holds the primary key. The `to` argument names the attribute in the _target_ table that stores the foreign key. The result type must be an array.

   ```graphql
   type Network @table @export {
   	id: Long @primaryKey
   	name: String @indexed
   	shows: [RealityShow] @relationship(to: networkId) # one-to-many
   }
   ```

3. **Use `@relationship(from: attribute, to: attribute)` for foreign-key-to-foreign-key joins**: Specify both `from` and `to` when neither side uses the primary key. The result type must be an array. Harper resolves the relationship by searching the target table's `to` attribute for matches using this record's `from` attribute value.

   ```graphql
   type OrderItem @table @export {
   	id: Long @primaryKey
   	orderId: Long @indexed
   	productSku: Long @indexed
   	products: [Product] @relationship(from: productSku, to: sku)
   }

   type Product @table @export {
   	id: Long @primaryKey
   	sku: Long @indexed
   	name: String
   }
   ```

4. **Query across relationships using dot-syntax**: Filter by related table attributes using dot-chained paths. This behaves as an INNER JOIN — only parents with a matching related record are returned.

   ```
   GET /RealityShow?network.name=Bravo
   GET /Product/?brand.name=Microsoft
   GET /Brand/?products.name=Keyboard
   ```

5. **Include relationship fields in results using `select()`**: Relationship attributes are not included by default. Use `select()` to project them. Selecting a relationship without an outer dot-syntax filter behaves as a LEFT JOIN.

   ```
   GET /Product/?brand.name=Microsoft&select(name,brand)
   GET /Product/?brand.name=Microsoft&select(name,brand{name})
   GET /Product/?name=Keyboard&select(name,brand{name,id})
   ```

6. **Apply conditions, sort, and pagination to nested related records using bracket syntax inside `select()`**: Use square brackets after the relationship name inside `select()` to filter, sort, and page each parent's related records independently.

   | Nested option      | Behavior                                                                   |
   | ------------------ | -------------------------------------------------------------------------- |
   | Conditions         | Qualify children; combine with `&` (AND), `\|` (OR), and groups.           |
   | `sort(price)`      | Order eligible children before pagination.                                 |
   | `limit(end)`       | Return at most `end` children per parent.                                  |
   | `limit(start,end)` | Skip `start` eligible children and return at most `end - start`.           |
   | `select(id,price)` | Project fields from returned children; omit to return whole child records. |

   Invalid `limit()` bounds (negative or fractional values) return HTTP 400. `limit(0)` returns no children without reading them.

7. **Use bracket syntax on the relationship name in the query string to require one related record to meet multiple conditions**: This is distinct from separate `&`-joined conditions, which may be satisfied by different related records.

   ```
   GET /Brand/?products[name=Keyboard&price=ge=30]
   ```

   Inside brackets, name attributes of the related table directly (e.g., `price`, not `products.price`). Values convert to the attribute's schema type, so `price=ge=30` needs no `number:` prefix inside brackets.

8. **Combine OR filters with child sorting and pagination**: Group OR conditions inside the relationship selection with `[condition1|condition2]`, then append `sort()`, `limit()`, and `select()` with `&`.

   ```
   GET /Brand/?sort(name,id)&limit(0,20)&select(id,name,products[[price=lt=number:30|price=ge=number:60]&sort(-price,id)&limit(1,2)&select(id,name,price)])
   ```

9. **Index foreign key and filter fields**: Keep relationship lookup fields and outer filter fields indexed. The `from` or `to` attribute referenced in `@relationship` should carry `@indexed`.

## Examples

### Many-to-one with join query

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
GET /Brand/?products.name=Keyboard
```

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

### Nested filtering and pagination

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

Keep every brand; show its cheapest product costing at least 30 (LEFT JOIN behavior — Budget Basics remains with an empty product list):

```
GET /Brand/?select(id,name,products[price=ge=number:30&sort(price)&limit(1)&select(id,name,price)])
```

Return only qualifying brands; inherit the outer price filter into nested results:

```
GET /Brand/?products.price=ge=number:30&select(id,name,products[sort(price)&limit(1)&select(id,name,price)])
```

Page through each brand's qualifying products (offset applies independently per brand):

```
GET /Brand/?products.price=ge=number:30&select(id,name,products[sort(price)&limit(1,2)&select(id,name,price)])
```

Bound parent pages with stable sorting:

```
GET /Brand/?products.price=ge=number:30&sort(name,id)&limit(0,20)&select(id,name,products[sort(price,id)&limit(1)&select(id,name,price)])
```

### Conditions through several relationships

```graphql
type Company @table @export {
	id: ID @primaryKey
	departments: [Department] @relationship(to: "companyId")
}

type Department @table @export {
	id: ID @primaryKey
	companyId: ID @indexed
	employees: [Employee] @relationship(to: "departmentId")
}

type Employee @table @export {
	id: ID @primaryKey
	departmentId: ID @indexed
	tag: String @indexed
	level: Int @indexed
}
```

| Query                                                                      | Matches    | Why                                                         |
| -------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------- |
| `departments.employees.tag=oncall&departments.employees.level=ge=number:3` | c1, c2, c3 | each condition may be met by a different department         |
| `departments[employees.tag=oncall&employees.level=ge=number:3]`            | c1, c2     | one department must meet both, possibly by different people |
| `departments[employees[tag=oncall&level=ge=3]]`                            | c2         | one employee must meet both                                 |
| `departments.employees[tag=oncall&level=ge=3]`                             | c2         | same as the previous row                                    |

## Notes

- `@relationship(from: ...)` — the foreign key is in **this** table; result type can be singular or array.
- `@relationship(to: ...)` — the foreign key is in the **target** table; result type **must** be an array.
- `@relationship(from: attribute, to: attribute)` — foreign-key-to-foreign-key join; result type **must** be an array.
- Selecting a relationship without an outer dot-syntax filter is a LEFT JOIN; parents without matching related records are retained.
- An outer filter joined with `&` (e.g., `products.price=ge=number:30`) removes parents without a qualifying related record **and** narrows the related records returned by `select()`. A condition inside an OR only decides which parents match; it does not narrow selected related records.
- A nested filter inside `select(...,products[...])` only narrows projected children; it does not remove the parent.
- Separate `&`-joined conditions on a one-to-many relationship may each be satisfied by a **different** related record. Use `relationship[cond1&cond2]` bracket syntax to require one related record to meet all conditions.
- Self-referential relationships (a table referencing itself) are supported for parent-child hierarchies.
- Nested filters require a table-backed relationship. Filters on plain JSON projections or full-text predicates inside a relationship selection return HTTP 400.
- Keep parent pages small using outer `limit()`; a nested `limit()` bounds children per parent, not the number of parents.
