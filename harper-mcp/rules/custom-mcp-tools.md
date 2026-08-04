---
name: custom-mcp-tools
description: >-
  How to expose custom instance methods as MCP tools via static mcpTools,
  including the anonymous-exposure security model.
metadata:
  mode: generate
  sources:
    - reference/v5/mcp/tools-and-resources.md#Custom `mcpTools` opt-in
  sourceCommit: d7d2ddb120ce5f2ad39dc425f628f5a4f220c151
  inputHash: 84a2ffac9bb7b66a
---

# Custom MCP Tools

Expose non-CRUD operations — an LLM-backed `answer`, a domain action, a report generator — as first-class MCP tools.

## When to Use

Use this skill when the auto-generated verb tools aren't enough: the AI should invoke _behavior_, not just CRUD. Also read it before shipping any custom tool on a publicly reachable instance — the security model differs from verb tools.

## How It Works

1. **Declare `static mcpTools`** on a Resource class (typically in `resources.js`/`resources.ts`):

```javascript
export class Orders extends tables.Orders {
	static mcpTools = [
		{
			name: 'reconcile_unsettled',
			description: 'Reconcile all unsettled orders and return a summary',
			method: 'reconcileUnsettled',
			inputSchema: {
				type: 'object',
				properties: { since: { type: 'string', description: 'ISO 8601 timestamp' } },
			},
		},
	];

	async reconcileUnsettled(args, context) {
		// context: { user, profile, sessionId, signal, progress?, serverRequest? }
		return { reconciled: 12 };
	}
}
```

2. **Dispatch is live-class.** Calls construct an instance of the class currently in the Resource registry, so an exported subclass (and its access-control overrides) always wins after a reload/deploy.
3. **Per-call context.** The second argument carries `user`, `profile`, `sessionId`, an `AbortSignal` (`signal`) wired to MCP cancellation, and — on streaming calls — `progress()` and `serverRequest()`. Guard optional members (`context.progress?.(…)`).
4. **Results and errors.** Return values are wrapped into MCP tool results (objects become structured content). Thrown errors surface as `isError: true` tool results with the message only — stack traces stay in the server log.
5. **Security: custom tools are exposed to ANY session, including anonymous ones.** Unlike verb tools (RBAC-filtered per user), a custom tool is listed to every session and its method executes even with no logged-in user (`context.user` may be empty). The method runs inside the normal `transactional()` envelope, so data access it performs still hits per-record `allow*` predicates — but the _tool itself_ has no gate. To restrict one:

```javascript
async reconcileUnsettled(args, context) {
	if (!context.user?.username) {
		throw new Error('authentication required');
	}
	// ...
}
```

6. **Cost control for public tools.** A cost-bearing anonymous tool needs more than auth checks — see [Rate Limiting](rate-limiting.md) (per-client buckets survive session cycling) and [Durable Quotas](durable-quotas.md) (persisted per-identity limits).

## Examples

Warn-worthy anti-pattern — a public instance with an expensive tool and no gating:

```javascript
static mcpTools = [{ name: 'answer', method: 'llmAnswer', ... }];
async llmAnswer(args) { return await callExpensiveModel(args.q); } // anonymous callers burn your budget
```

Fixed: check `context.user` (or accept anonymity deliberately) _and_ configure `rateLimit.perClientPerSecond` + a `quota` hook.
