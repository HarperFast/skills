---
name: connecting-clients
description: How MCP clients connect to Harper - the initialize handshake, session and protocol-version headers, and authentication.
metadata:
  mode: synthesized
---

# Connecting Clients

The wire-level contract an MCP client (or your own HTTP code) must follow against a Harper MCP endpoint.

## When to Use

Use this skill when configuring an MCP client against Harper, writing integration tests that drive `/mcp` directly, or debugging 400/404 responses from the endpoint.

## How It Works

Harper implements MCP **Streamable HTTP** (spec rev 2025-06-18; rev 2025-03-26 also accepted):

1. **Initialize.** POST a JSON-RPC `initialize` to the mount path with `Accept: application/json, text/event-stream`. The response carries the negotiated `protocolVersion`, the server's capabilities, and — critically — an `Mcp-Session-Id` response header.
2. **Session header.** Every subsequent request MUST send that `Mcp-Session-Id` back. Missing/unknown ids get 400/404 (a 404 means re-initialize — sessions idle out after `mcp.session.idleTimeoutSeconds`, default 30 minutes).
3. **Protocol-version header.** Requests after initialize should send `MCP-Protocol-Version: <negotiated version>`. A header naming a _different_ supported version than the session negotiated is rejected (400). A **missing** header is accepted as the session's own negotiated version (5.2.0+, patched into 5.1.x; older 5.1 releases treated a missing header as `2025-03-26` and rejected it as a mismatch on `2025-06-18` sessions).
4. **Server-push SSE.** A GET on the mount path (with `Accept: text/event-stream`) opens the server→client stream used for `notifications/*/list_changed`, resource-update notifications, progress, and server-initiated requests. Some flows require it: `resources/subscribe` is rejected until the session has an open SSE stream.
5. **Authentication.** Standard Harper authentication applies (Basic auth, tokens, mTLS — whatever the instance is configured with). Anonymous sessions are accepted when the deployment allows them; see the [Security Posture](security-posture.md) skill for what anonymous callers can reach.

## Examples

Full curl handshake:

```bash
# 1. initialize — capture the session id from the response headers
curl -si http://localhost:9926/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -u admin:password \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-06-18","capabilities":{},
        "clientInfo":{"name":"my-client","version":"1.0"}}}'
# → 200, header: Mcp-Session-Id: <uuid>

# 2. subsequent calls carry the session + protocol headers
curl -s http://localhost:9926/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'mcp-session-id: <uuid>' \
  -H 'mcp-protocol-version: 2025-06-18' \
  -u admin:password \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

Claude Desktop / MCP-client configuration is just the URL (plus auth): point a Streamable HTTP transport at `http://<host>:9926/mcp`.

Debugging cheat sheet:

- `400 missing Mcp-Session-Id header` — you skipped step 2.
- `404` on a previously working session — idle timeout; re-initialize.
- `400 MCP-Protocol-Version mismatch` — you sent a header naming a different version than the session negotiated.
- `406` — missing the required `Accept` media type (JSON for POST, `text/event-stream` for GET).
- `403 origin_not_allowed` — browser-origin request rejected by CORS-tied origin validation; see [Security Posture](security-posture.md).
