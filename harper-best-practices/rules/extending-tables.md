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
3. **Extend the Table Resource**: Export a class that extends `tables.YourTableName` and override the relevant **static** methods. In Harper 5 resource handlers are static and map 1:1 to HTTP verbs: `get(target)`, `post(target, data)`, `put(target, data)`, `patch(target, data)`, `delete(target)`. `target` is a pre-parsed `RequestTarget`; for writes, `data` is the request body and is **awaitable** (`await data`). Delegate to `super` to keep Harper's default behavior — a collection create passes just the record (`super.post(record)`), updates pass the target (`super.put(target, data)` / `super.patch(target, data)`), and reads/deletes pass the target (`super.get(target)`). To return a specific HTTP status from a thrown error, set **`.statusCode`** (e.g. `400`) on the error — a plain `.status` property is ignored.

   ```typescript
   import { tables } from 'harper';

   export class MyTable extends tables.MyTable {
   	// Static handler; receives (target, data) — data is awaitable.
   	static async post(target: any, data: any) {
   		const record = await data;
   		if (!record?.name) {
   			const error: any = new Error('Name is required');
   			error.statusCode = 400; // HTTP status (use statusCode, NOT status)
   			throw error;
   		}
   		return super.post(record); // create delegates with the record (no id)
   	}
   }
   ```

4. **Override Methods**: Override the static `get`, `post`, `put`, `patch`, or `delete` as needed, delegating to `super.<method>` (see the argument forms above) to preserve Harper's default behavior unless you intend to replace it entirely.
5. **Implement Logic**: Use overrides for validation, side effects, or transforming data before/after database operations.
