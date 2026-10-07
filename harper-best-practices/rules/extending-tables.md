---
name: extending-tables
description: How to add custom logic to automatically generated table resources in Harper.
metadata:
  mode: generate
  sources:
    - reference/v5/resources/overview.md#Extending a Table
    - reference/v5/resources/resource-api.md#Throwing Errors
  sourceCommit: 2cfb81318f17e0aca2d600109e6ad813d2d0443e
  inputHash: 925aa3c817b6c9f1
---

# Extending Tables

Instructions for the agent to follow when adding custom logic to automatically generated table resources in Harper.

## When to Use

Apply this rule when you need to override or augment the default HTTP handler behavior (GET, POST, PUT, PATCH, DELETE) for a Harper table resource. Use it when a table needs computed properties, input transformation, authorization checks, or custom error responses.

## How It Works

1. **Define the table schema without `@export`**: In `schema.graphql`, declare the table type but omit the `@export` directive. Leaving `@export` on the schema while also exporting a subclass with the same name produces conflicting endpoints.

   ```graphql
   # Omit the `@export` directive
   type MyTable @table {
   	id: Long @primaryKey
   	# ...
   }
   ```

2. **Extend the generated table class in `resources.js`**: Use `extends tables.<TableName>` to subclass the auto-generated resource. The exported JavaScript class owns the URL instead of the schema type.

   ```javascript
   export class MyTable extends tables.MyTable {
   	static async get(target) {
   		const record = await super.get(target);
   		return { ...record, computedField: 'value' };
   	}

   	static async post(target, data) {
   		return this.create({ ...(await data), status: 'pending' });
   	}
   }
   ```

3. **Call `super` with the correct argument form per operation**: When delegating to the default behavior, match arguments to the operation type:
   - Reads and deletes: `super.get(target)` / `super.delete(target)`
   - Collection create: `super.post(target, record)` — target carries no id
   - Updates: `super.put(target, data)` / `super.patch(target, data)`

4. **Set `statusCode` on thrown errors to control HTTP status**: A plain `.status` property is ignored. Use `.statusCode` on the error object:

   ```javascript
   const error = new Error('Name is required');
   error.statusCode = 400; // use statusCode, NOT status
   throw error;
   ```

   Uncaught errors are caught by the protocol handler and produce error responses for REST.

5. **Configure Harper to load both files**: Ensure your configuration references the schema and resource files:

   ```yaml
   rest: true
   graphqlSchema:
     files: schema.graphql
   jsResource:
     files: resources.js
   ```

## Examples

Full example extending a table with a computed GET response, a custom POST, and a guarded handler that throws a typed error:

```javascript
export class MyTable extends tables.MyTable {
	static async get(target) {
		// get the record from the database
		const record = await super.get(target);
		// add a computed property before returning
		return { ...record, computedField: 'value' };
	}

	static async post(target, data) {
		// custom action on POST; return the write so the response waits for the commit
		return this.create({ ...(await data), status: 'pending' });
	}

	static async delete(target) {
		if (!authorized) {
			const error = new Error('Forbidden');
			error.statusCode = 403;
			throw error;
		}
		return super.delete(target);
	}
}
```

## Notes

- Always omit `@export` from the schema type when you export a subclass with the same name in JavaScript. The exported class owns the endpoint registration.
- Call `super.get/post/put/patch/delete` to preserve Harper's default behavior unless you intend to replace it entirely.
- `statusCode` on an error object controls the HTTP response status for REST. A `.status` property is ignored.
- See [`Database / Schema`](/reference/v5/database/schema.md) for full schema API details.
