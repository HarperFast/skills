---
name: defining-relationships
description: How to define and use relationships between tables in Harper using GraphQL.
metadata:
  mode: generate
  sources:
    - reference/v5/database/schema.md#Relationships
    - reference/v5/rest/querying.md#Relationships and Joins
  sourceCommit: 3749d0c54be457a2a65d9a63c738a5dc88989ecd
  inputHash: fd399fd81a88f13e
---

# Defining Relationships Between Tables in Harper

Instructions for the agent to follow when defining and querying relationships between tables in Harper using the `@relationship` directive.

## When to Use

Apply this rule when adding foreign key relationships between schema tables, enabling join queries, or returning nested related records in query results. Use it any time a schema type needs to reference records in another table via a foreign key attribute.

## How It Works

1. **Use `@relationship(from: attribute)` for many-to-one or many-to-many**: Place this on the field in the table that holds the foreign key. The `from` parameter names the attribute on this table that stores the foreign key referencing the target table's primary key.

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

2. **Use `@relationship(to: attribute)` for one-to-many or many-to-many**: Place this on the table whose primary key is referenced by the foreign key in the target table. The `to` parameter names the attribute on the target table that holds the foreign key. The result type **must** be an array.

   ```graphql
   type Network @table @export {
   	id: Long @primaryKey
   	name: String @indexed
   	shows: [RealityShow] @relationship(to: networkId) # one-to-many
   }
   ```

3. **Use `@relationship(from: attribute, to: attribute)` for foreign key to foreign key joins**: Specify both `from` and `to` when neither side uses the primary key. Harper resolves the relationship by searching the target table's `to` attribute for matches using this record's `from` attribute value. The result type must be an array.

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

4. **Query across relationships using dot-syntax**: Filter records by related table attributes using chained dot notation. This behaves as an INNER JOIN — only records with a matching related record are returned.

   ```
   GET /Product/?brand.name=Microsoft
   GET /Brand/?products.name=Keyboard
   ```

5. **Include relationship fields in results using `select()`**: Relationship attributes are not returned by default. Use `select()` to include them, optionally specifying nested fields with `{}`.

   ```
   GET /Product/?brand.name=Microsoft&select(name,brand)
   GET /Product/?brand.name=Microsoft&select(name,brand{name})
   GET /Product/?name=Keyboard&select(name,brand{name,id})
   ```

   When selecting a relationship without filtering on it, Harper performs a LEFT JOIN — the relationship property is omitted if the foreign key is null or references a non-existent record.

6. **Model many-to-many without a junction table**: Store an array of foreign key values and use `@relationship(from: ...)` pointing to that array attribute. The array order of the foreign key values is preserved when resolving the relationship.

   ```graphql
   type Product @table @export {
   	id: Long @primaryKey
   	name: String
   	resellerIds: [Long] @indexed
   	resellers: [Reseller] @relationship(from: "resellerIds")
   }
   ```

7. **Define self-referential relationships** for parent-child hierarchies by pointing `@relationship` back at the same table type.

## Examples

**Full schema with bidirectional relationships:**

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

**Querying with joins and nested select:**

```
GET /Product/?brand.name=Microsoft&select(name,brand{name,id})
GET /Brand/?products.name=Keyboard
```

**Many-to-many query with nested select:**

```
GET /Product/?resellers.name=Cool Shop&select(id,name,resellers{name,id})
```

## Notes

- Every attribute named in `from` or `to` must exist on the respective table and be annotated with `@indexed` to support join queries.
- The `to`-only and `from`+`to` forms both require the result field type to be an array (e.g., `[RealityShow]`).
- The `from`-only form on a non-array attribute produces a many-to-one relationship; on an array attribute it produces many-to-many.
- Self-referential relationships are supported for hierarchical data within a single table.
