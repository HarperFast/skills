---
name: delegating-to-the-built-in-agent
description: How to delegate tasks to Harper's built-in agent via the CLI and the agent operations API.
metadata:
  mode: synthesized
---

# Delegating to the Built-in Agent

Harper 5.2+ ships with a **built-in agent** that runs _inside_ the server, on the main thread
adjacent to the operations API. Because it runs in-process, it can do things a remote client
cannot: call the operations API as RBAC-filtered tools, read and write component files under the
instance's components root, attach the V8 inspector to worker threads to debug and profile them,
schedule follow-up work, and consult the Harper best-practices skill. You send it a natural-language
task; it runs a tool-using loop under a super_user identity and reports back.

## When to Use

Delegate to the built-in agent when the work is best done **on the instance itself** rather than
from your local client:

- Operating on a deployed instance in place — inspect the schema, build or adjust a component,
  restart, run an operation.
- Debugging or profiling a running instance — attach to a worker thread, capture a CPU profile,
  set a logpoint.
- Handing off a larger, multi-step task to an agent that already has the instance's tools,
  filesystem, and credentials in context.

Do the work in your own client instead when it's purely local (editing source before deploy) or
when you don't want a server-side agent making changes.

**Prerequisites:** the target instance must have the agent enabled (an `agent:` config block with
`enabled: true`) and a configured generative model backend. All agent operations require
**super_user**.

## How It Works

The lifecycle assumes you have already deployed to and authenticated with the target instance (see
[deploying-to-harper-fabric.md](deploying-to-harper-fabric.md) — `harper login` stores a token so
you don't repeat credentials). Delegation reuses that same target and credentials.

There are two equivalent ways to drive the agent.

### Option A — the `harper agent` CLI (simplest)

A thin client over the agent operations API that reuses your stored `harper login` credentials, so
no connector setup is needed:

```bash
# One-shot: send a task, print the reply, exit
harper agent "Describe the schema, then add a price index to the Product table."

# Interactive session (REPL)
harper agent

# Against a specific remote instead of the logged-in default
harper agent --target <Application URL> "List the databases and tables."
```

The CLI polls the run to completion and renders the transcript (tool calls, results, and the
agent's reply). When a run needs approval for a destructive action, it prompts you inline.

### Option B — the agent operations API (programmatic)

Call the operations API directly (HTTP POST to the ops endpoint, super_user auth). This is the path
to use from scripts and services.

1. **Start a task** with `agent_prompt`. Returns a `session_id` and a `status`.

   ```bash
   curl -s -u <user>:<pass> <ops-endpoint> \
     -H 'Content-Type: application/json' \
     -d '{"operation":"agent_prompt","message":"Build a Customer table (id, email, name) exported over REST."}'
   ```

2. **Poll for progress** with `get_agent_session`, passing the `session_id`. The returned session
   carries the `status`, the `messages` transcript, and any `pendingApprovals`.

   ```bash
   curl -s -u <user>:<pass> <ops-endpoint> \
     -H 'Content-Type: application/json' \
     -d '{"operation":"get_agent_session","session_id":"<id>"}'
   ```

   Poll until `status` leaves `running` — terminal states are `completed`, `aborted`, and `error`;
   `awaiting_approval` means it is paused for an approval decision (see step 3).

3. **Approve or deny a paused action.** When the agent enabled configuration has `autoApprove:false`,
   a destructive tool call pauses the run with a `pendingApprovals[]` entry. Resolve it with
   `approve_agent_action`, then poll again — approval executes the saved call, denial hands the
   rejection back to the agent so it can adjust.

   ```bash
   curl -s -u <user>:<pass> <ops-endpoint> \
     -H 'Content-Type: application/json' \
     -d '{"operation":"approve_agent_action","session_id":"<id>","approval_id":"<approval-id>","approved":true}'
   ```

4. **Continue the conversation** by passing the same `session_id` back into `agent_prompt` with a
   new `message`. Omit `session_id` to start a fresh session.

Supporting operations: `list_agent_sessions` (recent sessions), `cancel_agent_run` (terminate a
running or paused session), and `set_agent_config` (adjust `autoApprove`, `allowDestructive`,
`model`, and related settings on a running instance).

## Examples

**Delegate a build to a deployed Fabric instance and wait for the result:**

```bash
harper login <Application URL>
harper agent --target <Application URL> \
  "Create a Product table (id, name, price) exported over REST, then confirm the endpoint responds."
```

**Programmatic start-and-poll loop:**

```bash
SID=$(curl -s -u <user>:<pass> <ops-endpoint> -H 'Content-Type: application/json' \
  -d '{"operation":"agent_prompt","message":"Add a vector index to the Document.embedding field."}' \
  | jq -r .session_id)

while [ "$(curl -s -u <user>:<pass> <ops-endpoint> -H 'Content-Type: application/json' \
  -d "{\"operation\":\"get_agent_session\",\"session_id\":\"$SID\"}" | jq -r .status)" = "running" ]; do
  sleep 3
done
```

## Notes

- **All agent operations require super_user.** Authenticate with `harper login`, which stores a
  short-lived JWT (operation token) plus a refresh token rather than your password — prefer that
  over passing credentials inline, and never embed a raw password in scripts or client config.
- **Approvals are your safety gate.** With `autoApprove:false`, the agent pauses before destructive
  tools (writing files, deploying, restarting) so an operator decides. Set `autoApprove:true` only
  when you want unattended runs.
- **Sessions are single-active.** A session that is `running` or `awaiting_approval` rejects a new
  `agent_prompt`; resolve the approval or cancel the run first.
- **MCP alternative.** For MCP-native clients, an instance with MCP enabled exposes the agent as
  curated MCP tools (`agent_prompt`, `get_agent_session`, `list_agent_sessions`) at the ops API's
  `/mcp` endpoint — the same delegation loop over the MCP transport instead of raw operations.
