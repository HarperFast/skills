---
name: custom-resources
description: How to define custom REST endpoints with JavaScript or TypeScript in Harper.
metadata:
  mode: generate
  sources:
    - reference/v5/resources/overview.md#Custom External Data Source
    - reference/v5/resources/overview.md#Exporting Resources as Endpoints
    - reference/v5/components/javascript-environment.md#Module Loading
  sourceCommit: f37a8c4021e20d5c74c1d339a6b6c8c196b5603e
  inputHash: df69870433c0b3e5
---

# Custom Resources

Instructions for the agent to follow when defining custom REST endpoints with JavaScript or TypeScript in Harper.

## When to Use

Apply this rule when creating custom HTTP endpoints, wrapping external APIs, or registering routes programmatically in a Harper application. Use it any time business logic must live outside a table-backed schema, or when a specific URL shape is required.

## How It Works

1. **Import `Resource` from `harper`**: Always import from the `harper` package rather than relying on globals.

   ```javascript
   import { tables, Resource } from 'harper';
   ```

2. **Define a class that `extends Resource`**: Implement HTTP methods as `static` methods. Each method receives a `target` object.

   ```javascript
   export class CustomEndpoint extends Resource {
   	static get(target) {
   		return {
   			data: doSomething(),
   		};
   	}
   }
   ```

3. **Use `async` static methods for external calls**: Await fetch or other async operations inside `static` handlers.

   ```javascript
   export class MyExternalData extends Resource {
   	static async get(target) {
   		const response = await fetch(`https://api.example.com/${target.id}`);
   		return response.json();
   	}

   	static async put(target, data) {
   		return fetch(`https://api.example.com/${target.id}`, {
   			method: 'PUT',
   			body: JSON.stringify(await data),
   		});
   	}
   }
   ```

4. **Export the class to create an endpoint**: The export form controls the resulting URL. Choose the form that matches the URL shape you need.

   | Export form                                 | URL             | Notes                                                           |
   | ------------------------------------------- | --------------- | --------------------------------------------------------------- |
   | `export class Foo extends Resource {}`      | `/Foo/`         | Class name becomes the path segment. Case-sensitive.            |
   | `export const Bar = { Foo };`               | `/Bar/Foo/`     | Nest under an object to add a path prefix.                      |
   | `export const bar = { 'foo-baz': Foo };`    | `/bar/foo-baz/` | Use object keys for lowercase, hyphens, or non-identifier URLs. |
   | `export { Foo as '/widget/:id' }`           | `/widget/:id`   | Rename the export to set the path directly.                     |
   | `static path = '/widget/:id'` (class field) | `/widget/:id`   | Declare path on the class; overrides the export name.           |
   | `server.resources.set('my-path', Foo);`     | `/my-path/`     | Programmatic registration for dynamic paths.                    |

   URL path matching is case-sensitive — `/Foo/` and `/foo/` are different endpoints.

5. **Declare path parameters with `static path`**: Use `:name` for a single segment and `*name` as a catch-all. Matched values are bound onto `target.<name>`.

   ```javascript
   export class Widget extends Resource {
   	static path = '/widget/:id/action/:action';
   	static get(target) {
   		return { id: target.id, action: target.action };
   	}
   }
   ```

   A `static path` takes precedence over the export name. A leading `/` makes the path root-relative (top-level). A leading `./` or bare name resolves relative to the component directory.

6. **Register programmatically when the path is dynamic**: Use `server.resources.set(` when the path cannot be known at export time.

   ```javascript
   server.resources.set('my-path', Foo);
   ```

7. **Optionally source a table from a custom resource**: Use the resource as a caching layer for a local table.
   ```javascript
   tables.MyCache.sourcedFrom(MyExternalData);
   ```

## Examples

### External API wrapper with GET and PUT

```javascript
import { tables, Resource } from 'harper';

export class MyExternalData extends Resource {
	static async get(target) {
		const response = await fetch(`https://api.example.com/${target.id}`);
		return response.json();
	}

	static async put(target, data) {
		return fetch(`https://api.example.com/${target.id}`, {
			method: 'PUT',
			body: JSON.stringify(await data),
		});
	}
}

// Use as a cache source for a local table
tables.MyCache.sourcedFrom(MyExternalData);
```

### Path parameters with `static path`

```javascript
import { Resource } from 'harper';

export class Widget extends Resource {
	// GET /widget/10/action/jump  ->  target.id === '10', target.action === 'jump'
	static path = '/widget/:id/action/:action';
	static get(target) {
		return { id: target.id, action: target.action };
	}
}

export class Files extends Resource {
	// GET /files/a/b/c.txt  ->  target.rest === 'a/b/c.txt'
	static path = '/files/*rest';
	static get(target) {
		return { path: target.rest };
	}
}
```

### Programmatic registration

```javascript
import { Resource } from 'harper';

export class Foo extends Resource {
	static get(target) {
		return { data: doSomething() };
	}
}

server.resources.set('my-path', Foo);
```

## Notes

- A bare `*` wildcard (no name) binds under `target.wildcard`. A wildcard must be the final segment of the path.
- Resolution order: exact/static paths always win over parameterized ones. Among parameterized routes, more specific paths win — a literal segment beats `:param`, which beats `*`, compared left to right.
- Parameterized routes appear in the generated OpenAPI document as templated paths (e.g. `/widget/{id}/action/{action}`) and in MCP `resources/templates/list` as `{param}` URI templates.
- If a resource `extends` an existing table, avoid conflicting exports between the schema and the JavaScript implementation.
- Link the `harper` package in your component directory to ensure correct typings: `npm link harper`. All installed components have `harper` automatically linked.
- Harper runs as a single process — `tables`, `databases`, and other APIs are the same live, process-wide objects regardless of which component accesses them.
