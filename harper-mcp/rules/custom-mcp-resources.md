---
name: custom-mcp-resources
description: How to serve custom content (docs pages, reports, binaries) as MCP resources via static mcpResources with URI templates and completions.
metadata:
  mode: synthesized
---

# Custom MCP Resources

Serve author-defined content — documentation pages, rendered reports, binary assets — under your own URIs (5.1.18+).

## When to Use

Use this skill to build a content surface for AI clients: a public docs server over MCP, per-entity report resources, or any read-oriented content the auto-generated descriptors can't express.

## How It Works

1. **Declare `static mcpResources`** on a Resource class. Each entry has exactly one of `uri` (fixed) or `uriTemplate`, plus a `method` naming the instance method that serves reads:

```javascript
export class DocsPages extends Resource {
	static mcpResources = [
		{
			uri: 'docs:///index',
			name: 'docs index',
			description: 'List of all documentation pages',
			mimeType: 'text/markdown',
			method: 'readIndex',
		},
		{
			uriTemplate: 'docs:///{+path}',
			name: 'docs page',
			mimeType: 'text/markdown',
			method: 'readPage',
			completions: { path: ['guides/install.md', 'guides/deploy.md'] },
		},
	];

	async readIndex() {
		return { text: '- docs:///guides/install.md\n…', mimeType: 'text/markdown' };
	}

	async readPage(params /* { path } */, context /* { user, profile, sessionId } */) {
		return { text: loadPage(params.path), mimeType: 'text/markdown' };
	}
}
```

2. **Templates.** `{name}` matches exactly one path segment; `{+name}` matches across segments (RFC-6570-style reserved expansion — how MCP clients expand templates). The single-segment contract is enforced through percent-decoding: a URI smuggling an encoded separator (`%2F`/`%5C`) into a `{name}` slot simply fails to match, so `{name}` is safe to use in path construction. Duplicate parameter names are rejected at registration.
3. **Schemes.** Pick a custom scheme (`docs:///…` above). The reserved schemes — `harper:`, `harper+rest:`, `http:`, `https:` — are rejected at registration (and a template cannot parameterize the scheme position), so custom entries can never shadow the built-in surfaces.
4. **Content shapes.** The read method returns a string (text), `{ text, mimeType? }`, `{ blob, mimeType? }` (base64 binary), or any other object (serialized as JSON). Read errors surface to the client as a sanitized JSON-RPC error; the raw error goes to the server log only.
5. **Listing and completion.** Fixed URIs appear in `resources/list`, templates in `resources/templates/list`; declared `completions` values serve `completion/complete` per template parameter. Custom URIs win over the discovered surfaces on `resources/read`.
6. **Anonymous by design.** Custom resources are served to any session — including unauthenticated ones (the public-docs case this feature targets). The MCP layer performs no auth check for them; gate inside the read method (`context.user`) if content is restricted.
7. **No tables required.** A tableless component's resources register reliably — the registry rebuilds lazily per request when component loading completes after boot.

## Examples

Public docs server: the two-entry declaration above plus `mcp.application.mountPath` is the whole server — clients browse `resources/list`, complete paths, and read pages, all anonymous. Pair with [Rate Limiting](rate-limiting.md) and [Durable Quotas](durable-quotas.md) if any companion tools bear cost.
