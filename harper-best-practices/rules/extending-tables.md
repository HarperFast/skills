---
name: extending-tables
description: How to add custom logic to automatically generated table resources in Harper.
metadata:
  mode: synthesized
---

# Extending Tables

Instructions for the agent to follow when extending table resources in Harper.

## When to Use

Use this skill when you need to add custom validation, side effects (like webhooks), data transformation, or custom access control to the standard CRUD operations of a Harper table.

## How It Works

1. **Define the Table in GraphQL**: In your `.graphql` schema, define the table using the `@table` directive. **Do not** use `@export` if you plan to extend it.
   ```graphql
   type MyTable @table {
   	id: ID @primaryKey
   	name: String
   }
   ```
2. **Create the Extension File**: Create a `.ts` file in your `resources/` directory.
3. **Extend the Table Resource**: Export a class that extends `tables.YourTableName`. **Write-method overrides receive the incoming record as the FIRST argument** — `post(data, target)`, `put(data, target)`, `patch(data, target)`; `delete` receives `(target)`. To return a specific HTTP status from a thrown error, set **`.statusCode`** (e.g. `400`) on the error — a plain `.status` property is ignored.

   ```typescript
   import { tables } from 'harper';

   export class MyTable extends tables.MyTable {
   	// POST/PUT/PATCH overrides receive (data, target) — the record is FIRST.
   	async post(data: any, target: any) {
   		// Validate or transform the incoming record before persisting.
   		if (!data?.name) {
   			const error: any = new Error('Name is required');
   			error.statusCode = 400; // HTTP status (use statusCode, NOT status)
   			throw error;
   		}
   		return super.post(data, target); // pass the arguments through unchanged
   	}
   }
   ```

4. **Override Methods**: Override `get`, `post`, `put`, `patch`, or `delete` as needed. Always call `super[method](...)` with the same arguments to maintain default Harper functionality unless you intend to replace it entirely.
5. **Implement Logic**: Use overrides for validation, side effects, or transforming data before/after database operations.
