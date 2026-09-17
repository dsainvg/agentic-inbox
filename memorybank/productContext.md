# Product Context: Agentic Inbox

## Value Proposition
Traditional email clients require manual reading, triage, and composition. **Agentic Inbox** embeds an autonomous AI copilot directly into the inbox experience. The agent monitors incoming traffic, applies owner-authored memory and 3H principles, and drafts replies automatically — reducing email response times and triage workload while keeping the human in control of what gets sent.

## Key Workflows

### 1. Inbound Email Processing & Auto-Drafting
```
Inbound Email
    │
    ▼
Cloudflare Email Routing ──> Worker email() handler
    │
    ├── PostalMime parse ──────────────> D1 emails table
    ├── event.forward() ───────────────> optional forwarding address
    ├── Scoped automation rules ───────> actions (move, star, webhook, …)
    │
    └── EmailAgent DO /onNewEmail
            │
            ├── withOwnerMemory() ─────> merge workspace/group/mailbox memory
            ├── THREE_H_POLICY ────────> injected, non-overridable
            ├── LLM inference ─────────> kimi-k2.5 via Workers AI
            └── draft_reply tool ──────> D1 draft saved (never auto-sent)
```

### 2. Interactive Web Application
- **Mailbox Management**: Create mailboxes for any address on configured domains; switch between mailboxes from the home screen.
- **Split View Layout**: Left sidebar for folder navigation and settings; centre list for emails; right pane for full email viewing and rich-text composition (TipTap editor).
- **Agent Side Panel**: Real-time WebSocket connection to `EmailAgent`. View live streaming, inspect tool calls (`list_emails`, `get_thread`, etc.), and prompt the agent manually.
- **Draft Review & Outbound Send**: Users inspect AI-generated drafts, edit in TipTap, and confirm before sending. Outbound delivery uses the `send_email` Workers binding.
- **Hierarchy Settings**: Owner can manage the group tree, attach memory at any scope, and configure scoped automation rules from the Settings UI.

### 3. MCP Server Integration (`/mcp`)
- Serves Model Context Protocol to external tools (Claude Code, Cursor).
- Requires a mailbox-scoped API key per request (header only).
- All tool operations are scoped to the authenticated mailbox.

## User Experience & Interface Design
- Built with React 19, React Router v7, Tailwind CSS v4, and `@cloudflare/kumo` component tokens.
- Responsive split-pane design with dark/light visual modes.
- State managed by Zustand v5 and TanStack React Query v5.

## Security Model
- **Session Auth**: JWT cookie signed with `SESSION_SECRET`. No Cloudflare Access dependency.
- **Owner Isolation**: Hierarchy and settings routes require an independent owner-session check. API keys and outer middleware cannot access them.
- **3H Agent Policy**: Non-overridable Helpful / Honest / Harmless principles applied at agent framework level. Email content, custom prompts, and owner memory cannot override them.
- **Memory Trust Boundary**: Owner memory is marked as trusted instructions in the agent prompt. Email bodies and tool results are explicitly marked as untrusted data. The agent cannot write to or modify memory.
- **Draft-Only Agent by Default**: The agent can draft emails but requires explicit user confirmation before any email is transmitted.
- **API Key Scoping**: MCP and external API keys are scoped to a single mailbox. Keys are accepted via headers only, never URL params, to prevent log leakage.
