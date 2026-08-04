# Product Context: Agentic Inbox

## Value Proposition
Traditional email clients require manual reading, triage, and composition. **Agentic Inbox** transforms email management by incorporating an autonomous AI copilot directly into the inbox experience. The agent monitors incoming traffic, parses context, and drafts replies automatically, reducing email response times and triage workload while maintaining human control.

## Key Workflows

### 1. Inbound Email Processing & Auto-Drafting
```
[Inbound Email] ──> Cloudflare Email Routing ──> Worker email() Handler
                                                          │
                                         ┌────────────────┴────────────────┐
                                         ▼                                 ▼
                               Parse Raw Email (PostalMime)       Store Attachments in R2
                                         │
                                         ▼
                               MailboxDO (SQLite Save)
                                         │
                                         ▼
                            Trigger EmailAgent DO (/onNewEmail)
                                         │
                                         ▼
                           Fetch Context & Generate Draft Reply
                                         │
                                         ▼
                            Save to Drafts Folder (MailboxDO)
```

### 2. Interactive Web Application
- **Mailbox Management**: Switch between or create new mailboxes registered to configured domain(s).
- **Split View Layout**: Left sidebar for folder navigation and settings; center list for emails; right pane for full email viewing & rich text composition (TipTap editor).
- **Agent Side Panel**: Real-time WebSocket connection to the mailbox's `EmailAgent` Durable Object. View live agent streaming, inspect agent tool calls (e.g. `list_emails`, `get_thread`), and prompt the agent manually.
- **Draft Review & Outbound Send**: Users inspect AI-generated drafts, make edits in TipTap editor, and click Send. Outbound delivery is dispatched via Cloudflare's `send_email` Workers binding.

### 3. MCP Server Integration (`/mcp`)
- Serves Model Context Protocol to external tools (Claude Code, Cursor, ProtoAgent).
- Supports tool-driven email queries, message retrieval, and draft generation across mailboxes using `mailboxId` routing.

## User Experience & Interface Design
- Built with React 19, React Router v7, Tailwind CSS v4, and `@cloudflare/kumo` component design tokens.
- Responsive, modern split-pane design with dark/light visual modes.
- Visual state updates powered by `@tanstack/react-query` and `zustand`.

## Safety & Security Features
- **Prompt Injection Defense**: Evaluates incoming email content using `isPromptInjection` guard and verifies draft integrity with `verifyDraft` LLM checks before saving drafts.
- **Strict Perimeter Auth**: Enforces Cloudflare Access JWT validation (`cf-access-jwt-assertion`) in non-development environments to keep inbox data private.
- **No Direct Send Agent Rule**: System prompt and agent tool definition strictly enforce that `EmailAgent` has no `send_email` capability—only `draft_reply` and `draft_email`.
