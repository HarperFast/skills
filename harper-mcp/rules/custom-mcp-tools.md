---
name: custom-mcp-tools
description: >-
  How to expose custom instance methods as MCP tools via static mcpTools,
  including the anonymous-exposure security model.
metadata:
  mode: generate
  sources:
    - reference/v5/mcp/tools-and-resources.md#Custom `mcpTools` opt-in
  sourceCommit: da68d8e45f5422321c128a0cd67694bd0b97b155
  inputHash: 9206d4f9fb192f88
---

# Custom MCP Tools

Instructions for the agent to follow when exposing custom instance methods as MCP tools via a static `mcpTools` array on a Resource class.

## When to Use

Apply this rule when a component needs to expose non-verb instance methods as callable MCP tools. Use it whenever you need to add custom business logic (e.g., reconciliation, aggregation, side-effecting operations) to the MCP tool surface beyond the auto-generated verb tools.

## How It Works

1. **Declare `mcpTools` on the Resource class**: Add a static `mcpTools` array to your Resource subclass. Each entry names the tool, maps it to an instance method, provides a description, and defines an `inputSchema`.

   ```javascript
   class Orders extends Tables.orders {
   	static mcpTools = [
   		{
   			name: 'reconcile_unsettled',
   			method: 'reconcileUnsettled',
   			description: 'Reconcile all orders flagged as unsettled and emit a summary',
   			inputSchema: {
   				type: 'object',
   				properties: { since: { type: 'string', description: 'ISO 8601 timestamp' } },
   			},
   		},
   	];

   	async reconcileUnsettled({ since }) {
   		/* ... */
   	}
   }
   ```

2. **Understand the security model — no automatic auth**: The MCP transport audits the `tools/call` but invokes the custom instance method directly. It does **not** open a Resource transaction or run an `allow*` gate automatically. Custom tools are exposed to any MCP session — including `anonymous`, unauthenticated ones. The tool is listed to every session and its method executes even when no user is logged in (`context.user` may be empty).

3. **Enforce access control inside the method**: Because no `allow*` gate runs automatically, access control is entirely the method's responsibility. Check `context.user` inside the method and throw when the caller doesn't qualify.

   ```javascript
   async reconcileUnsettled({ since }) {
     if (!context.user?.id) throw new Error('Authentication required');
     // role check example:
     if (!context.user.roles?.includes('finance')) throw new Error('Forbidden');
     /* ... */
   }
   ```

4. **Pass an armed context when delegating to static Resource operations**: The MCP-created instance context carries the authenticated user and a one-shot `authorize` flag. Use `this.getContext()` for the first delegated call:

   ```javascript
   const result = await Orders.get(target, this.getContext());
   ```

   For every subsequent delegated operation, set `target.checkPermission = true` on a `RequestTarget` so authorization derives from `context.user`, and pass `this.getContext()`:

   ```javascript
   target.checkPermission = true;
   const next = await Orders.get(target, this.getContext());
   ```

5. **Never accept `checkPermission` from tool arguments or client input**: Always set `target.checkPermission` in server-side code only. Do not read it from the tool's input arguments or any other client-supplied data.

## Examples

Full class with a custom MCP tool that enforces authentication and delegates with proper context:

```javascript
class Orders extends Tables.orders {
	static mcpTools = [
		{
			name: 'reconcile_unsettled',
			method: 'reconcileUnsettled',
			description: 'Reconcile all orders flagged as unsettled and emit a summary',
			inputSchema: {
				type: 'object',
				properties: { since: { type: 'string', description: 'ISO 8601 timestamp' } },
			},
		},
	];

	async reconcileUnsettled({ since }) {
		// Enforce auth — context.user may be empty for anonymous sessions
		if (!context.user?.id) throw new Error('Authentication required');

		// First delegated operation uses the one-shot authorize flag
		const target = { checkPermission: true, since };
		const unsettled = await Orders.get(target, this.getContext());

		// Subsequent delegated operations set checkPermission server-side
		target.checkPermission = true;
		// ... further operations
	}
}
```

## Notes

- Unlike auto-generated verb tools, which are RBAC-filtered per user at `tools/list` time and enforce table permissions on call, custom `mcpTools` entries bypass all of that — the method runs for any caller, including `anonymous` sessions.
- The `allow*` gates that protect standard verb operations do not apply to custom tools. All authorization logic must live inside the method itself, using `context.user`.
- The one-shot `authorize` flag on the MCP-created context is consumed by the first static Resource operation. Set `target.checkPermission = true` for every subsequent call.
- Consider applying [rate-limiting](rate-limiting.md) and [durable-quotas](durable-quotas.md) to custom tools that perform expensive or side-effecting operations, since no built-in throttling is applied automatically.
