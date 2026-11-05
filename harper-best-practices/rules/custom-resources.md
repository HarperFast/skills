---
name: custom-resources
description: How to define custom REST endpoints with JavaScript or TypeScript in Harper.
metadata:
  mode: generate
  sources:
    - reference/v5/resources/overview.md#Custom External Data Source
    - reference/v5/resources/overview.md#Exporting Resources as Endpoints
    - reference/v5/components/javascript-environment.md#Module Formats
  sourceCommit: 6cd8a2ea6372924486aac46a5d96ba00c10eff07
  inputHash: 01f0a9c7088b116a
---

# Custom Resources

Instructions for the agent to follow when defining custom REST endpoints with JavaScript or TypeScript in Harper.

**Instead of:** Express, Fastify, or Koa route handlers; serverless functions. Use this rule rather than adding that service. See `harper-architecture`.

## When to Use

Apply this rule when you need to create custom HTTP endpoints, wrap external APIs, or register routes programmatically in a Harper application. Use it any time business logic must live outside a standard table-backed resource.

## How It Works

1. **Import `Resource` from `harper`**: Pull in the base class before extending it.

   ```javascript
   import { tables, Resource } from 'harper';
   ```

   CommonJS is also supported:

   ```javascript
   const { tables, Resource } = require('harper');
   ```

2. **Define a class that `extends Resource`**: Declare HTTP handler methods as `static` methods matching the HTTP verb (`get`, `put`, `post`, etc.). Each method receives a `target` object representing the request.

   ```javascript
   export class CustomEndpoint extends Resource {
   	static get(target) {
   		return {
   			data: doSomething(),
   		};
   	}
   }
   ```

3. **Wrap external APIs** by making the `static` methods `async` and using `fetch` or any other async call inside them.

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

   // Use as a cache source for a local table
   tables.MyCache.sourcedFrom(MyExternalData);
   ```

4. **Control the URL by choosing an export form**: The shape of the export determines the resulting endpoint URL.

   | Export form                                 | URL             | Notes                                                           |
   | ------------------------------------------- | --------------- | --------------------------------------------------------------- |
   | `export class Foo extends Resource {}`      | `/Foo/`         | Class name becomes the path segment. Case-sensitive.            |
   | `export const Bar = { Foo };`               | `/Bar/Foo/`     | Nest under an object to add a path prefix.                      |
   | `export const bar = { 'foo-baz': Foo };`    | `/bar/foo-baz/` | Use object keys for lowercase, hyphens, or non-identifier URLs. |
   | `export { Foo as '/widget/:id' }`           | `/widget/:id`   | Rename the export to set the path directly.                     |
   | `static path = '/widget/:id'` (class field) | `/widget/:id`   | Declare path on the class; overrides the export name.           |
   | `server.resources.set('my-path', Foo);`     | `/my-path/`     | Programmatic registration; useful when the path is dynamic.     |

   URL path matching is case-sensitive — `/Foo/` and `/foo/` are different endpoints.

5. **Declare dynamic path segments** using `static path` on the class. Use `:name` for a single segment and `*name` as a catch-all for the rest of the path. Matched values are bound onto `target.<name>`.

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

   - A bare `*` (no name) binds under `target.wildcard`.
   - A wildcard must be the final segment of the path.
   - A leading `/` makes the path root-relative (top-level), independent of the file's location.
   - A leading `./` or a bare name resolves relative to the component directory.
   - `static path` takes precedence over the export name.

6. **Understand resolution order**: Exact and static paths always win over parameterized ones. Among parameterized routes, more specific paths win: a literal segment beats a `:param`, which beats a `*` wildcard, compared left to right.

7. **Register programmatically** using `server.resources.set(` when the path must be determined at runtime rather than statically.
   ```javascript
   server.resources.set('my-path', Foo);
   ```

## Examples

**Custom endpoint with a fixed path:**

```javascript
import { Resource } from 'harper';

export class CustomEndpoint extends Resource {
	static get(target) {
		return {
			data: doSomething(),
		};
	}
}
```

**External API wrapper used as a cache source:**

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

tables.MyCache.sourcedFrom(MyExternalData);
```

**Path parameters with `static path`:**

```javascript
import { Resource } from 'harper';

export class Widget extends Resource {
	static path = '/widget/:id/action/:action';
	static get(target) {
		return { id: target.id, action: target.action };
	}
}
```

**Programmatic registration:**

```javascript
server.resources.set('my-path', Foo);
```

## Notes

- Do not create conflicting exports between a schema definition and a JavaScript implementation when a resource extends an existing table.
- Parameterized routes surface in the generated OpenAPI document as templated paths (e.g., `/widget/{id}/action/{action}`) and in MCP `resources/templates/list` as `{param}` URI templates.
- When bundling for SSR with a tool like Vite, keep `harper` external so it resolves to the runtime: `ssr: { external: ['harper'] }`.
- Run `npm link harper` in a component's own directory to ensure typings match the running installation. All installed components have `harper` automatically linked.
