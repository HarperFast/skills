---
name: custom-mcp-tools
description: >-
  How to expose custom instance methods as MCP tools via static mcpTools,
  including the anonymous-exposure security model.
metadata:
  mode: generate
  sources:
    - reference/v5/mcp/tools-and-resources.md#Custom `mcpTools` opt-in
  sourceCommit: 9e6ecf87dd25bb488ad44dc2876ca6439ccd682e
  inputHash: 692801362e747c73
---

# Custom MCP Tools

Instructions for the agent to follow when exposing custom instance methods as MCP tools via a static `mcpTools` array on a Resource class.

## When to Use

Apply this rule when a component needs to expose non-verb instance methods as callable MCP tools. Use it whenever you need custom business logic (e.g., reconciliation, aggregation, batch operations) accessible via the MCP transport beyond the auto-generated verb tools.

## How It Works

1. **Declare a static `mcpTools` array** on the Resource class. Each entry names the tool, maps it to an instance method, provides a description, and defines an `inputSchema`.

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

2. **Understand the security model.** Custom tools are exposed to **every** MCP session — including `anonymous`, unauthenticated ones. The MCP layer does **not**:
   - Run an `allow*` gate automatically.
   - Open a Resource transaction automatically.
   - Filter the tool from `tools/list` based on user role.

   Unlike auto-generated verb tools (which are RBAC-filtered per user at `tools/list` time and enforce table permissions on call), a custom tool is listed to every session and its method executes even when no user is logged in. `context.user` may be empty.

3. **Enforce access control inside the method.** Because the MCP layer performs no authentication or ACL check, the method itself is fully responsible. Check `context.user` at the top of the method and throw when the caller doesn't qualify:

   ```javascript
   async reconcileUnsettled({ since }) {
     if (!context.user || !context.user.roles.includes('admin')) {
       throw new Error('Unauthorized');
     }
     /* ... */
   }
   ```

4. **Delegate to static Resource operations correctly.** The MCP-created instance context carries the authenticated user and a one-shot `authorize` flag:
   - For the **first** delegated operation, pass `this.getContext()` directly — the `authorize` flag is consumed by that call:
     ```javascript
     const result = await Orders.get(target, this.getContext());
     ```
   - For **every subsequent** delegated operation, create a fresh `RequestTarget`, set `target.checkPermission = true` so authorization derives from `context.user`, and pass `this.getContext()`:
     ```javascript
     target.checkPermission = true;
     const next = await Orders.get(target, this.getContext());
     ```
   - **Never** accept `checkPermission` from tool arguments or other client input.

## Examples

Full class with a custom MCP tool that guards access via `context.user`:

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
		// Reject anonymous or unauthorized callers — the MCP layer does not do this.
		if (!context.user) {
			throw new Error('Authentication required');
		}

		// First delegated operation: use the one-shot authorize flag via this.getContext().
		const target = { since };
		const unsettled = await Orders.get(target, this.getContext());

		// Subsequent delegated operations: fresh RequestTarget with checkPermission = true.
		const updateTarget = { id: unsettled.id };
		updateTarget.checkPermission = true;
		await Orders.update(updateTarget, this.getContext());
	}
}
```

## Notes

- `mcpTools` is a **static** array — declare it on the class, not on instances.
- The `allow*` gates that protect auto-generated verb tools do **not** run for custom tools. All authorization logic must live inside the method.
- `context.user` is the canonical way to identify the caller; it may be empty for `anonymous` sessions, so always check before trusting it.
- Never derive `checkPermission` from client-supplied tool arguments — always set it explicitly in your method code.
- If your custom tool performs expensive or repeated operations, consider applying [rate limiting](rate-limiting.md) or [durable quotas](durable-quotas.md) inside the method to prevent abuse by unauthenticated callers.
