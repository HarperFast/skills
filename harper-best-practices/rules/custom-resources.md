---
name: custom-resources
description: How to define custom REST endpoints with JavaScript or TypeScript in Harper.
metadata:
  mode: generate
  sources:
    - reference/v5/resources/overview.md#Custom External Data Source
    - reference/v5/resources/overview.md#Exporting Resources as Endpoints
    - reference/v5/components/javascript-environment.md#Module Formats
  sourceCommit: 9e6ecf87dd25bb488ad44dc2876ca6439ccd682e
  inputHash: 86858206e33925f0
---

# Custom Resources

Instructions for the agent to follow when defining custom REST endpoints with JavaScript or TypeScript in Harper.

## When to Use

Apply this rule when creating custom HTTP endpoints, wrapping external APIs, or registering routes programmatically in a Harper application. Use it any time business logic must live outside a table-backed resource or when a specific URL shape is required.

## How It Works

1. **Import `Resource` from the `harper` package**: Always import explicitly rather than relying on globals.

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

3. **Use `async` static methods to call external services**: Return or forward the response directly.

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

4. **Export the class to expose it as an endpoint**: The export form controls the resulting URL. Choose the form that matches the URL shape you need.

   | Export form                                 | URL             | Notes                                                           |
   | ------------------------------------------- | --------------- | --------------------------------------------------------------- |
   | `export class Foo extends Resource {}`      | `/Foo/`         | Class name becomes the path segment. Case-sensitive.            |
   | `export const Bar = { Foo };`               | `/Bar/Foo/`     | Nest under an object to add a path prefix.                      |
   | `export const bar = { 'foo-baz': Foo };`    | `/bar/foo-baz/` | Use object keys for lowercase, hyphens, or non-identifier URLs. |
   | `export { Foo as '/widget/:id' }`           | `/widget/:id`   | Rename the export to set the path directly.                     |
   | `static path = '/widget/:id'` (class field) | `/widget/:id`   | Declare path on the class; overrides the export name.           |
   | `server.resources.set('my-path', Foo);`     | `/my-path/`     | Programmatic registration for dynamic paths.                    |

5. **Register programmatically when the path is dynamic**: Use `server.resources.set(` with a path string and the resource class.

   ```javascript
   server.resources.set('my-path', Foo);
   ```

6. **Declare dynamic path segments with `static path`**: Use `:name` for a single segment and `*name` as a catch-all. Matched values are bound onto `target.<name>`.

   ```javascript
   export class Widget extends Resource {
   	// GET /widget/10/action/jump  ->  target.id === '10', target.action === 'jump'
   	static path = '/widget/:id/action/:action';
   	static get(target) {
   		return { id: target.id, action: target.action };
   	}
   }
   ```

7. **Resolve path precedence correctly**: Exact and static paths always win over parameterized ones. Among parameterized routes, more specific paths win: a literal segment beats a `:param`, which beats a `*` wildcard, compared left to right.

## Examples

**Wrapping an external API and using it as a cache source:**

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

**Catch-all wildcard path:**

```javascript
export class Files extends Resource {
	// GET /files/a/b/c.txt  ->  target.rest === 'a/b/c.txt'
	static path = '/files/*rest';
	static get(target) {
		return { path: target.rest };
	}
}
```

**Root-relative fixed route:**

```javascript
export class AcmeChallenge extends Resource {
	static path = '/.well-known/acme-challenge/:token';
	static get(target) {
		return { token: target.token };
	}
}
```

## Notes

- URL path matching is case-sensitive — `/Foo/` and `/foo/` are different endpoints.
- A leading `/` in `static path` makes the path root-relative (top-level), independent of the file's location.
- A leading `./` or a bare name in `static path` resolves relative to the component directory.
- A bare `*` (no name) binds under `target.wildcard`. A wildcard must be the final segment of the path.
- `static path` takes precedence over the export name when both are present.
- Parameterized routes appear in the generated OpenAPI document as templated paths (e.g. `/widget/{id}/action/{action}`) and in MCP `resources/templates/list` as URI templates.
- When a resource `extends` an existing table, avoid conflicting exports between the schema and the JavaScript implementation.
- Link the `harper` package in your component directory to ensure correct typings: `npm link harper`. All installed components have `harper` automatically linked.
