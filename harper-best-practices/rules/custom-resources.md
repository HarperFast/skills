---
name: custom-resources
description: How to define custom REST endpoints with JavaScript or TypeScript in Harper.
metadata:
  mode: generate
  sources:
    - reference/v5/resources/overview.md#Custom External Data Source
    - reference/v5/resources/overview.md#Exporting Resources as Endpoints
    - reference/v5/components/javascript-environment.md#Module Formats
  sourceCommit: e73e5efb2823cc52caf7a6458d67fbcff3bbff2c
  inputHash: b2f8749a92d64168
---

# Custom Resources

Instructions for the agent to follow when defining custom REST endpoints with JavaScript or TypeScript in Harper.

## When to Use

Apply this rule when you need to create custom HTTP endpoints, wrap external APIs, or register routes programmatically in a Harper application. Use it any time business logic must live outside a table-backed schema, or when you need fine-grained control over URL shape and path parameters.

## How It Works

1. **Import `Resource` from the `harper` package**: Always import explicitly rather than relying on globals.

   ```javascript
   import { tables, Resource } from 'harper';
   ```

   CommonJS alternative:

   ```javascript
   const { tables, Resource } = require('harper');
   ```

2. **Define a class that `extends Resource`**: Use `export class` so Harper exposes it as an endpoint. Implement HTTP methods as `static` methods on the class.

   ```javascript
   export class CustomEndpoint extends Resource {
   	static get(target) {
   		return {
   			data: doSomething(),
   		};
   	}
   }
   ```

3. **Use `static` async methods to call external services**: Each HTTP verb maps to a `static` method of the same lowercase name.

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

4. **Control the URL by choosing the export form**: The shape of the export determines the resulting URL path.

   | Export form                                 | URL             | Notes                                                           |
   | ------------------------------------------- | --------------- | --------------------------------------------------------------- |
   | `export class Foo extends Resource {}`      | `/Foo/`         | Class name becomes the path segment; case-sensitive.            |
   | `export const Bar = { Foo };`               | `/Bar/Foo/`     | Nest under an object to add a path prefix.                      |
   | `export const bar = { 'foo-baz': Foo };`    | `/bar/foo-baz/` | Use object keys for lowercase, hyphens, or non-identifier URLs. |
   | `export { Foo as '/widget/:id' }`           | `/widget/:id`   | Rename the export to set the path directly.                     |
   | `static path = '/widget/:id'` (class field) | `/widget/:id`   | Declare path on the class; overrides the export name.           |
   | `server.resources.set('my-path', Foo);`     | `/my-path/`     | Programmatic registration; useful when the path is dynamic.     |

   URL path matching is case-sensitive — `/Foo/` and `/foo/` are different endpoints.

5. **Declare dynamic path segments with `static path`**: Use `:name` for a single segment and `*name` as a catch-all. Matched values are bound onto `target.<name>`.

   ```javascript
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

   - A leading `/` in `static path` makes the path root-relative (top-level), independent of the file's location.
   - A leading `./` or bare name resolves relative to the component directory.
   - A bare `*` (no name) binds under `target.wildcard`. A wildcard must be the final segment.
   - `static path` takes precedence over the export name.
   - Exact and static paths always win over parameterized ones. Among parameterized routes, more specific paths win: a literal segment beats `:param`, which beats `*`, compared left to right.

6. **Register programmatically when the path is dynamic**: Use `server.resources.set(` with a path string and the resource class.

   ```javascript
   server.resources.set('my-path', Foo);
   ```

7. **Optionally use a resource as a cache source for a local table**: Call `sourcedFrom` on the target table.
   ```javascript
   tables.MyCache.sourcedFrom(MyExternalData);
   ```

## Examples

**Custom endpoint with external API wrapping:**

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

**Path parameters with `static path`:**

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

**Programmatic registration:**

```javascript
import { Resource } from 'harper';

export class Foo extends Resource {
	static get(target) {
		return { ok: true };
	}
}

server.resources.set('my-path', Foo);
```

## Notes

- Avoid conflicting exports between the schema and the JavaScript implementation when a resource `extends` an existing table.
- Parameterized routes appear in the generated OpenAPI document as templated paths (e.g. `/widget/{id}/action/{action}`) and in MCP `resources/templates/list` as `{param}` URI templates.
- When bundling for SSR with a tool like Vite, keep `harper` external so it resolves to the runtime: `ssr: { external: ['harper'] }`.
- For components in their own directory, run `npm link harper` to ensure typings match the running installation.
