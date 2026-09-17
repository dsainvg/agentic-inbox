# Progress Status: Agentic Inbox

## Completed & Functional Features

### Core Infrastructure
- [x] Session-based authentication: JWT cookie (`session`) signed with `SESSION_SECRET`, bcrypt-hashed owner password, `/setup` first-run flow, `/login` / `/logout`.
- [x] All data persisted in Cloudflare D1 (`DB` binding) — mailboxes, users, emails, folders, API keys, automation rules, hierarchy, memory.
- [x] Automated D1 schema initialization (`ensureDbInitialized`) covering all tables including hierarchy and automation tables.
- [x] Inbound MIME parsing via `PostalMime` in `email()` event listener with D1 message persistence.
- [x] Inbound email forwarding via `event.forward(forwardAddress)`.
- [x] Outbound email sending via `send_email` Workers binding.
- [x] Reply and forward threading with `In-Reply-To` / `References` headers.

### AI Agent
- [x] `EmailAgent` Durable Object (`AIChatAgent`) with persistent WebSocket chat.
- [x] Real-time streaming responses with tool-call visibility in the agent side panel.
- [x] Auto-draft on inbound email (`/onNewEmail`) — drafts saved to D1, never auto-sent.
- [x] Email tools: `list_emails`, `get_email`, `get_thread`, `search_emails`, `draft_reply`, `draft_email`, `send_email_tool`, `list_mailboxes`, `get_mailbox`.
- [x] Custom system prompt per mailbox (stored in mailbox `settings` JSON).
- [x] Persistent chat history in the Durable Object's SQLite storage.
- [x] 3H policy (`THREE_H_POLICY`) injected at inference time — non-overridable Helpful / Honest / Harmless.
- [x] `passesThreeHReview()` — structured approval gate for automated replies.
- [x] `hasSavedDraft()` — tool-receipt verification (not model prose) before reporting success.

### Hierarchy & Group Memory
- [x] Recursive group tree (`workspace_groups`, `workspace_group_members`).
- [x] Owner-authored memory at three scopes: workspace (`all`), group, mailbox (`owner_memory` table).
- [x] `getEffectiveMemory()` — single CTE query merges ancestor memory in priority order.
- [x] `withOwnerMemory()` — prepends merged memory + trust-boundary statement to the agent prompt.
- [x] Memory is read-only at agent runtime; owner-only write access via Settings UI.
- [x] Hierarchy Settings UI (`HierarchySettings.tsx`) — group CRUD, member management, memory editing, rule management.
- [x] Limits enforced: 64 group depth, 256 members, 500 rules, 4000 chars/memory block.

### Scoped Automation Rules
- [x] `scoped_automation_rules` table with `scope_type ∈ {all, group, mailboxes}`.
- [x] Per-mailbox `automation_rules` table for simple local rules.
- [x] `getApplicableScopedRules()` — resolves applicable rules for a mailbox including ancestor groups.
- [x] Actions: move folder, star, mark read/unread, forward, webhook, trigger agent draft.
- [x] Automations run on every inbound email.

### External API & MCP
- [x] `POST /api/v1/external/messages` — API-key-authenticated message deposit.
- [x] `POST /api/v1/external/mailboxes/:mailboxId/messages` — open contact-form deposit.
- [x] `GET /api/v1/external/messages` — API-key-authenticated message fetch.
- [x] `/mcp` endpoint — stateless MCP server, mailbox-scoped API key per request, header-only key acceptance.
- [x] API key generation and revocation in Settings UI.

### Web Application UI
- [x] Mailbox split-view layout (sidebar, folder nav, email list, email panel).
- [x] Rich-text composer with TipTap, attachments, CC/BCC.
- [x] Email dark-mode CSS injection for rendered HTML bodies.
- [x] Search with parser (`app/lib/search-parser.ts`) supporting field-scoped queries.
- [x] Folder management (inbox, sent, draft, archive, trash).
- [x] Settings page: mailbox settings, API key management, forwarding, system prompt, hierarchy, automations.
- [x] MCP connection panel.

## Known Limitations
- Single owner account (`id = 'admin'`); multi-owner is not supported.
- `EmailAgent` is a single workspace-scoped DO instance; very high concurrent chat volume is not yet load-balanced.
- Attachments stored inline in D1 body; very large attachments may approach D1 row-size limits.
- Agent memory is read fresh from D1 at each inference call; there is no background memory-learning or update loop.
