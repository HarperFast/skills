---
name: custom-mcp-prompts
description: How to publish reusable prompt templates to MCP clients via static mcpPrompts.
metadata:
  mode: synthesized
---

# Custom MCP Prompts

Publish parameterized prompt templates that MCP clients surface to their users (slash-command style).

## When to Use

Use this skill when your application wants to hand well-crafted, data-aware prompts to any connected AI client — "summarize this account", "draft a reply about order X" — instead of hoping each client writes a good one.

## How It Works

1. **Declare `static mcpPrompts`** on a Resource class. Each entry carries a `render` **function** (not a method name):

```javascript
export class Support extends tables.Ticket {
	static mcpPrompts = [
		{
			name: 'draft_reply',
			title: 'Draft support reply',
			description: 'Draft a support reply for a ticket',
			arguments: [{ name: 'ticketId', description: 'Ticket to reply to', required: true }],
			async render(args) {
				const ticket = await Support.get(args.ticketId);
				if (!ticket) throw new Error(`ticket not found: ${args.ticketId}`);
				return {
					messages: [
						{
							role: 'user',
							content: { type: 'text', text: `Draft a courteous reply to: ${ticket.body}` },
						},
					],
				};
			},
		},
	];
}
```

2. **Entry shape.** `name` and `render` are required (invalid entries are skipped with a warning); `title`, `description`, and `arguments` (`{ name, description?, required? }`) are optional metadata surfaced to clients.
3. **Render contract.** `render(args)` receives the client-supplied argument values (strings) and returns the MCP prompt result shape — a `messages` array of `{ role, content }` entries (`content.type`: `text`, `image`, `audio`, or `resource`). It runs server-side and can read tables, so prompts can embed live data.
4. **Surface.** Prompts appear in `prompts/list` and render via `prompts/get`; declared arguments are served through `completion/complete`. Connected sessions get `notifications/prompts/list_changed` when the set changes (reload/deploy).
5. **Exposure.** Like custom tools, prompts are listed to every session on the profile, including anonymous ones — keep secrets out of prompt text and gate inside `render` if needed.

## Examples

A data-aware prompt beats a static template: fetch current state (ticket, order, account) inside the render method so the client's LLM starts from live facts rather than asking for them turn by turn.
