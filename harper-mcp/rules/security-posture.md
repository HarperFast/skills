---
name: security-posture
description: The MCP security model - anonymous access, RBAC boundaries, origin validation, audit logging, and the hardening checklist for public instances.
metadata:
  mode: synthesized
---

# Security Posture

What is and is not protected on a Harper MCP endpoint, and the checklist for exposing one publicly.

## When to Use

Read this skill before exposing any MCP profile beyond localhost, and when reasoning about what an anonymous or low-privilege caller can reach.

## How It Works

1. **Authentication is Harper's, not MCP's.** The MCP layer adds no login gate. Sessions bind to whatever user Harper's auth pipeline resolves — which can be nobody: anonymous sessions initialize, list, and call successfully where the deployment allows unauthenticated requests.
2. **Two different tool trust models.** Auto-generated verb tools are RBAC-filtered per user and enforce table permissions (including per-record `allow*` predicates) on every call. Custom `mcpTools` / `mcpPrompts` / `mcpResources` are exposed to **every** session — access control is entirely the author's method's responsibility. Never assume a custom tool is login-gated.
3. **Origin validation (DNS-rebinding defense).** Browser-origin requests are validated against Harper's CORS configuration; a disallowed `Origin` gets 403. The secure default for anything browser-reachable beyond loopback: enable CORS with an explicit allow-list (`http.cors` + `http.corsAccessList` for the application profile; `operationsApi.network.*` for operations). CORS off means origin checks are off — appropriate only for localhost/non-browser clients.
4. **Error hygiene.** Tool and resource errors cross the wire as sanitized messages; stack traces and raw author errors stay in the server log.
5. **Audit.** Every `tools/call` (including rate-limited, quota-denied, and protocol-error outcomes) emits an audit entry — profile, session, tool, user, duration, status, with sensitive-looking argument keys redacted.
6. **Template safety.** Custom resource URI templates enforce their single-segment contract against encoded-separator smuggling, and custom URIs cannot claim reserved schemes — see [Custom MCP Resources](custom-mcp-resources.md).

## Examples

Hardening checklist for a public application-profile endpoint:

- [ ] Every custom tool/prompt/resource either tolerates anonymous callers or checks `context.user` and throws.
- [ ] `rateLimit.perClientPerSecond` set (session limits alone are cycle-evadable); `identityHeader` only if the proxy strips it.
- [ ] A durable `quota` hook backs any cost-bearing tool ([Durable Quotas](durable-quotas.md)), with an atomic counter.
- [ ] CORS allow-list configured if browsers will reach the endpoint.
- [ ] `allow`/`deny`/`maxTools` trim the verb-tool surface to what the AI needs.
- [ ] Audit log shipping somewhere you actually read.
