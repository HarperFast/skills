---
name: custom-resources
description: How to define custom REST endpoints with JavaScript or TypeScript in Harper.
metadata:
  mode: synthesized
---

# Custom Resources

Instructions for the agent to follow when creating custom resources in Harper.

## When to Use

Use this skill when the automatic CRUD operations provided by `@table @export` are insufficient, and you need custom logic, third-party API integration, or specialized data handling for your REST endpoints.

## How It Works

1. **Check if a Custom Resource is Necessary**: Verify if [Automatic APIs](./automatic-apis.md) or [Extending Tables](./extending-tables.md) can satisfy the requirement first.
2. **Create the Resource File**: Create a `.ts` or `.js` file in the directory specified by `jsResource` in `config.yaml` (typically `resources/`).
3. **Define the Resource Class**: Export a class extending `Resource` from `harper` and define **static** methods for the HTTP verbs you handle. In Harper 5 the static methods are the HTTP handlers (mapped 1:1 to verbs); they receive a pre-parsed `RequestTarget`, and write handlers also receive the request body as an awaitable `data` argument:

   ```typescript
   import { Resource } from 'harper';

   export class MyResource extends Resource {
   	// v5 handlers are static and map 1:1 to HTTP verbs.
   	static async get(target: any) {
   		return { message: 'Hello from custom GET!' };
   	}
   }
   ```

4. **Implement HTTP Methods**: Add static methods (`get`, `post`, `put`, `patch`, or `delete`) to handle the corresponding requests. Read/delete handlers receive `(target)`; write handlers receive `(target, data)` where `data` is awaitable.
5. **Route Nesting and Naming**: You can control the URL structure by how you export your resources:
   - **Direct Class Export**: `export class Foo extends Resource` creates endpoints at `/Foo/`. Class names are case-sensitive in the URL.
   - **Nested Objects**: `export const Bar = { Foo };` creates endpoints at `/Bar/Foo/`.
   - **Lowercase and Hyphens**: Use object keys to define custom paths: `export const bar = { 'foo-baz': Foo };` exposes endpoints at `/bar/foo-baz/`.
6. **Access Tables (Optional)**: Import and use the `tables` object to interact with your data:
   ```typescript
   import { tables } from 'harper';
   // ... inside a method
   const results = await tables.MyTable.list();
   ```
7. **Configure Loading**: Ensure `config.yaml` points to your resource files (e.g., `jsResource: { files: 'resources/*.ts' }`).
