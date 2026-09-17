# System Patterns & Architecture: Agentic Inbox

## Core System Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 Cloudflare Edge Network                                │
│                                                                                        │
│  ┌────────────────────────────────────────────────────────────────────────────────┐    │
│  │                           Worker Entry (workers/app.ts)                        │    │
│  │                                                                                │    │
│  │   Session JWT ──> /api/v1/*   ────────────────────────────────> Hono API app   │    │
│  │                  /agents/*   ──(Session JWT)──────────────────> EmailAgent DO  │    │
│  │                  /mcp        ──(Mailbox API Key)──────────────> MCP handler    │    │
│  │                  email()     ──────────────────────────────────> receiveEmail  │    │
│  │                  /*          ──────────────────────────────────> React Router  │    │
│  └─────────────────────────────────────────┬──────────────────────────────────────┘    │
│                                            │                                           │
│               ┌────────────────────────────┼───────────────────────┐                  │
│               ▼                            ▼                       ▼                  │
│  ┌────────────────────┐     ┌───────────────────────────┐  ┌────────────────────┐     │
│  │  Cloudflare D1     │     │  EmailAgent Durable Object│  │  Workers AI (AI)   │     │
│  │  (SQLite / DB)     │     │  workers/agent/index.ts   │  │  kimi-k2.5         │     │
│  │                    │     │  AIChatAgent               │  └────────────────────┘     │
│  │  mailboxes         │     │  WebSocket chat            │           ▲                 │
│  │  emails            │     │  email tools               │───────────┘                 │
│  │  folders           │     │  3H policy enforced        │                             │
│  │  api_keys          │     │  owner memory injected     │                             │
│  │  users             │     └───────────────────────────┘                             │
│  │  automation_rules  │                                                                │
│  │  workspace_groups  │                                                                │
│  │  owner_memory      │                                                                │
│  │  scoped_auto_rules │                                                                │
│  └────────────────────┘                                                                │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## Key Components & Responsibilities

### 1. Session Authentication (`workers/app.ts`)
- All `/api/v1/*` routes (except `/auth/*` and `/external/*`) require a valid `session` JWT cookie.
- `/agents/*` routes verify the session JWT before routing to the `EmailAgent` Durable Object.
- The hierarchy/settings router (`workers/routes/hierarchy.ts`) performs an **independent** owner check: JWT must decode to `payload.id === 'admin'` and a DB lookup confirms the admin user exists. API keys and outer session middleware cannot elevate to owner access.

### 2. Cloudflare D1 Database (`workers/db/schema.ts`, `workers/db/init.ts`)
- Single `DB` binding holds all application state.
- Schema is auto-initialized on first request via `ensureDbInitialized()`.
- Core tables: `mailboxes`, `users`, `emails`, `folders`, `api_keys`, `automation_rules`.
- Hierarchy tables: `workspace_groups`, `workspace_group_members`, `scoped_automation_rules`, `owner_memory`.

### 3. EmailAgent Durable Object (`workers/agent/index.ts`)
- Extends `AIChatAgent` from `@cloudflare/agents`.
- Single instance per workspace (not per-mailbox); mailbox is passed as context at call time.
- Maintains persistent WebSocket connection from the browser agent side panel.
- On each inference:
  1. Injects `THREE_H_POLICY` (see §6 below).
  2. Calls `withOwnerMemory()` to prepend workspace/group/mailbox memory to the system prompt.
  3. Calls the LLM with the merged prompt and available tools.
  4. `hasSavedDraft()` verifies tool receipts before reporting success to the user.

### 4. Inbound Email Trigger (`receiveEmail` in `workers/index.ts`)
- Receives inbound email event from Cloudflare Email Routing.
- Parses raw email using `PostalMime`.
- Persists email into D1 `emails` table for the matching mailbox.
- Forwards via `event.forward(forwardAddress)` if a forwarding address is configured.
- Triggers the `EmailAgent` DO via `/onNewEmail` to generate a draft reply (saved to Drafts, not sent automatically).
- Runs applicable `scoped_automation_rules` via `getApplicableScopedRules()` + automation executor.

### 5. Hierarchy & Group Memory (`workers/lib/hierarchy.ts`)
- **Groups**: `workspace_groups` stores a recursive tree; `workspace_group_members` maps mailboxes to groups.
- **Memory scopes**: `owner_memory` rows have `scope_type ∈ {all, group, mailbox}`.
- `getEffectiveMemory(db, mailboxId)` resolves the full ancestor chain with a single recursive CTE query and returns merged memory ordered workspace → group → mailbox.
- `withOwnerMemory(db, mailboxId, basePrompt)` prepends the merged memory and a trust-boundary statement to the agent system prompt at inference time.
- Memory is **read-only at runtime** — the agent has no memory-writing tool. Only the owner can edit memory via the Settings UI (`/api/v1/hierarchy/memory`).
- Limits: groups ≤ 64 depth, 500 rules, 4000 chars per memory block, 32768 chars total prompt.

### 6. 3H Agent Policy (`workers/lib/agent-policy.ts`)
- `THREE_H_POLICY` string defines non-overridable Helpful / Honest / Harmless principles.
- Injected at the agent framework level; cannot be overridden by custom system prompts, owner memory, or email content.
- `passesThreeHReview(text)`: validates that an automated review step returned `{helpful:true, honest:true, harmless:true}` — the only structured approval for automated AI replies.
- `hasSavedDraft(steps)`: inspects tool result objects to confirm a draft was actually saved, rather than trusting model prose claims.

### 7. Scoped Automation Rules (`workers/lib/automations.ts`, `shared/automations.ts`)
- Rules in `scoped_automation_rules` have `scope_type ∈ {all, group, mailboxes}`.
- `getApplicableScopedRules(db, mailboxId)` returns all matching rules for a mailbox, including rules scoped to its ancestor groups or the entire workspace.
- Actions include: move to folder, star, mark read/unread, forward, webhook call, trigger agent reply.
- Per-mailbox simple rules also exist in `automation_rules` for mailbox-local logic.

### 8. MCP Server (`workers/mcp/index.ts`)
- `/mcp` endpoint is stateless; a mailbox-scoped API key is validated on every request.
- Keys accepted via `Authorization: Bearer` or `X-API-Key` header only (not URL params, to avoid log leakage).
- All MCP tool operations are scoped to the authenticated mailbox.

### 9. External Deposit API
- `POST /api/v1/external/messages` — API key authenticated; deposits a message into the key's mailbox.
- `POST /api/v1/external/mailboxes/:mailboxId/messages` — open endpoint; deposits a contact-form message into the specified mailbox.
- Both inject a `Reply-To` header targeting the original sender.

## Data Flow: Inbound Email → Draft Reply

```
Cloudflare Email Routing
        │
        ▼
Worker email() handler
        │
        ├── PostalMime parse ──> D1 emails table (persist)
        ├── event.forward() ───> optional forwarding address
        ├── scoped_automation_rules ──> execute actions (move, star, webhook, …)
        │
        └── EmailAgent DO /onNewEmail
                │
                ├── withOwnerMemory() ──> merge workspace/group/mailbox memory
                ├── THREE_H_POLICY injected
                ├── LLM inference (kimi-k2.5)
                └── draft_reply tool ──> D1 draft saved
                                         (never auto-sent)
```

## Auth Model Summary

| Surface | Mechanism |
|---|---|
| Web app (`/`) | Session JWT cookie (`SESSION_SECRET`) |
| API routes (`/api/v1/*`) | Session JWT cookie (except `/auth/*`, `/external/*`) |
| Agent WebSocket (`/agents/*`) | Session JWT cookie |
| Hierarchy/settings (`/api/v1/hierarchy/*`) | Session JWT + owner-only DB check (`id = 'admin'`) |
| MCP (`/mcp`) | Mailbox-scoped API key (header only) |
| External deposit (`/external/*`) | API key or open |
