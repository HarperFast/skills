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

1. **Declare `static mcpPrompts`** on a Resource class:

```javascript
export class Support extends tables.Ticket {
	static mcpPrompts = [
		{
			name: 'draft_reply',
			description: 'Draft a support reply for a ticket',
			arguments: [{ name: 'ticketId', description: 'Ticket to reply to', required: true }],
			method: 'draftReplyPrompt',
		},
	];

	async draftReplyPrompt(args) {
		const ticket = await Support.get(args.ticketId);
		return {
			messages: [
				{
					role: 'user',
					content: { type: 'text', text: `Draft a courteous reply to: ${ticket.body}` },
				},
			],
		};
	}
}
```

2. **Surface.** Prompts appear in `prompts/list` and render via `prompts/get`; argument completion is served through `completion/complete` when declared. Connected sessions get `notifications/prompts/list_changed` when the set changes (reload/deploy).
3. **Render method contract.** The method receives the client-supplied arguments and returns the MCP prompt shape (`messages` array; a bare string is wrapped as a single user text message). It can read tables — it runs server-side with the same live-class dispatch as custom tools.
4. **Exposure.** Like custom tools, prompts are listed to every session on the profile, including anonymous ones — keep secrets out of prompt text and gate inside the method if needed.

## Examples

A data-aware prompt beats a static template: fetch current state (ticket, order, account) inside the render method so the client's LLM starts from live facts rather than asking for them turn by turn.
