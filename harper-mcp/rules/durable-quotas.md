---
name: durable-quotas
description: >-
  Operator-pluggable durable quotas for MCP tools/call via the
  server.setMcpQuotaHandler registration hook, with a race-safe counter pattern.
metadata:
  mode: generate
  sources:
    - reference/v5/mcp/configuration.md#Durable quota handler
  sourceCommit: d7d2ddb120ce5f2ad39dc425f628f5a4f220c151
  inputHash: d2aa76fdfd4e3e7f
---

# Durable Quotas

Persisted, restart-surviving cost controls for `tools/call`, registered as a plain function in your component code (5.2.0+).

## When to Use

Use this skill when in-memory [rate limiting](rate-limiting.md) is not enough as a cost control — typically a public, unauthenticated, cost-bearing tool (an LLM-backed `answer`) where you need "N calls per identity per day" semantics that survive restarts and span workers.

## How It Works

1. **Register a handler function** with `server.setMcpQuotaHandler` at component load — the policy is a **function**, never an exposed Resource. It is opt-in: no handler registered means calls are allowed. The latest registration wins, so a reloaded component replaces the previous handler; pass `undefined` to clear it.
2. **The handler is called before each admitted `tools/call`** with `{ identity, tool, user, profile, sessionId }` (`identity` is the client identity from the rate-limit layer — socket IP or trusted-header value — and may be `undefined`). Return `true` (or any truthy non-object) to allow, or `{ allowed: false, message?, retryAfterSeconds? }` to deny; denials surface as `isError` tool results with `kind: 'quota_exceeded'` plus your `message`/`retryAfterSeconds`.
3. **Gate per profile in code.** The single handler receives `profile`, so branch on it (e.g. `if (profile !== 'application') return true`) rather than configuring per-profile hooks.
4. **Ordering.** The handler runs _after_ the in-memory buckets admit the call, so rate-limited clients cannot spam a table-backed handler.
5. **Fail-closed.** A handler that throws **denies** the call — the raw error goes to the server log only; the client sees a sanitized message. Cost protection that silently disables itself on a bug is worse than a hard failure. Harper calls the handler once per attempted tool call; whether you count on check or on success is your business.
6. **Race-safety is your handler's business.** It can run concurrently for the same identity — within a worker (interleavings across your own `await`s) and across workers. A naive `get` → `put used+1` counter undercounts under concurrency and admits calls past the limit; make the read-modify-write atomic (a transaction that serializes conflicting writers, a compare-and-set retry loop, or a store with native atomic increments).

## Examples

Persisted per-identity counter backed by an **internal** table (schema + registration):

```graphql
# schema.graphql — INTERNAL counter. No @export, so no client can read or reset it.
type QuotaCounter @table {
	id: ID @primaryKey
	used: Int
}
```

```javascript
// resources.js
const DAILY_LIMIT = 100;

// The cost-bearing tool clients call (exported — this is the public surface).
export class Answerer extends Resource {
	static mcpTools = [{ name: 'answer', description: 'Answer a question', method: 'doAnswer' }];
	async doAnswer(args) {
		return { answered: args?.q ?? '' };
	}
}

// Register the durable quota policy as a function, backed by the internal counter table.
server.setMcpQuotaHandler(async ({ identity, tool, user, profile, sessionId }) => {
	if (profile !== 'application') return true; // gate per profile in code
	const id = identity ?? 'unknown';
	// NOTE: naive get-then-put shown for shape; production code must make this
	// read-modify-write atomic (see Race-safety above).
	const existing = await tables.QuotaCounter.get(id);
	const used = (existing?.used ?? 0) + 1;
	await tables.QuotaCounter.put({ id, used });
	if (used > DAILY_LIMIT) {
		return { allowed: false, message: 'daily quota reached', retryAfterSeconds: 3600 };
	}
	return true;
});
```

Because the policy is a plain function and not a Resource, it exposes no `update_/delete_` MCP tools or REST surface — unlike an exported class, whose inherited CRUD would let a permitted client reset its own counter. Keep the storage table **unexported** (no `@export`) so it stays off every transport.

Also verify the handler actually runs (call the tool past the limit once): on Harper versions before 5.2.0 `server.setMcpQuotaHandler` is unavailable — see [Enabling MCP](enabling-mcp.md).
