---
name: durable-quotas
description: Operator-pluggable durable quotas for MCP tools/call via the config-named quota Resource hook, with a race-safe counter pattern.
metadata:
  mode: synthesized
---

# Durable Quotas

Persisted, restart-surviving cost controls for `tools/call`, implemented by your code behind a config hook (5.2.0+).

## When to Use

Use this skill when in-memory [rate limiting](rate-limiting.md) is not enough as a cost control — typically a public, unauthenticated, cost-bearing tool (an LLM-backed `answer`) where you need "N calls per identity per day" semantics that survive restarts and span workers.

## How It Works

1. **Name a quota Resource in config:**

```yaml
mcp:
  application:
    quota:
      resource: McpQuota # exported Resource path
      # method: allowMcpCall   # optional; this is the default
```

2. **Implement the static method.** Before each admitted `tools/call`, Harper calls it with `{ identity, tool, user, profile, sessionId }` (`identity` is the client identity from the rate-limit layer — socket IP or trusted-header value — and may be `undefined`). Return `true` to allow, or `{ allowed: false, message?, retryAfterSeconds? }` to deny; denials surface as `isError` tool results with `kind: 'quota_exceeded'` plus your message.
3. **Ordering.** The hook runs _after_ the in-memory buckets admit the call, so rate-limited clients cannot spam a table-backed hook.
4. **Fail-closed.** A hook that throws — or a configured `resource`/`method` that doesn't resolve — **denies** the call (sanitized `quota policy unavailable` / `quota check failed`; raw error in the server log). Cost protection that silently disables itself on a bug is worse than a hard failure. The blast radius is `tools/call` only; list/read surfaces stay up.
5. **Race-safety is your hook's business.** It can run concurrently for the same identity — within a worker (interleavings across your own `await`s) and across workers. A naive `get` → `put used+1` counter undercounts under concurrency; make the read-modify-write atomic (a transaction that serializes conflicting writers, a compare-and-set retry loop, or a store with native atomic increments).

## Examples

Persisted per-identity daily counter (schema + hook):

```graphql
type QuotaCounter @table {
	id: ID @primaryKey # identity
	used: Int
	day: String
}
```

```javascript
const DAILY_LIMIT = 100;

export class McpQuota extends tables.QuotaCounter {
	// The hook class must be exported to be config-addressable — which would
	// also surface update_/delete_McpQuota verb tools and a REST endpoint,
	// letting a permitted client RESET ITS OWN COUNTER. Keep the quota table
	// off the MCP surface and lock down its REST permissions.
	static exportTypes = { mcp: false };
	static async allowMcpCall({ identity, tool }) {
		const id = identity ?? 'unknown';
		const today = new Date().toISOString().slice(0, 10);
		// NOTE: naive get-then-put shown for shape; production code must make
		// this read-modify-write atomic (see Race-safety above).
		const existing = await McpQuota.get(id);
		const used = existing?.day === today ? existing.used + 1 : 1;
		await McpQuota.put({ id, used, day: today });
		if (used > DAILY_LIMIT) {
			return { allowed: false, message: 'daily quota reached', retryAfterSeconds: 3600 };
		}
		return true;
	}
}
```

The counter is a real table: operators can inspect or reset it over REST (subject to the permissions you set), and it survives restarts — an attacker who exhausted their quota stays exhausted after the process bounces.

Also verify the hook actually runs (call the tool past the limit once): on Harper versions before 5.2.0 the `quota.*` config keys are accepted and silently ignored — see [Enabling MCP](enabling-mcp.md).
