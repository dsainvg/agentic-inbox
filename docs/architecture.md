# Architecture

## High-level overview

```
┌──────────────┐     ┌───────────────────────┐     ┌──────────────────────┐
│   Browser    │────>│  Hono Worker           │────>│  Cloudflare D1       │
│  React SPA   │     │  workers/app.ts        │     │  (SQLite, all data)  │
│  Agent Panel │     │                        │     └──────────────────────┘
└──────┬───────┘     │  /api/v1/* ────────────┼────>  D1 queries
       │             │                        │
       │ WebSocket   │  /agents/* ────────────┼────>┌──────────────────────┐
       └─────────────┤                        │     │  EmailAgent DO       │
                     │                        │     │  (AIChatAgent)       │
                     │  /mcp ─────────────────┼────>│  email tools         │
                     │  (API key per mailbox) │     │  Workers AI          │
                     │                        │     └──────────────────────┘
                     │  email() handler ──────┼────>  D1 + EmailAgent DO
                     └───────────────────────┘
```

## Components

### Worker entry (`workers/app.ts`)

The Hono application is the top-level request handler. It applies session JWT middleware to API routes, routes WebSocket upgrade requests to the `EmailAgent` Durable Object, validates API keys for the MCP endpoint, and falls through to the React Router SSR handler for all other paths.

### Cloudflare D1 (`workers/db/`)

One `DB` binding holds the entire application state. The schema is initialized automatically on first request via `ensureDbInitialized()`.

| Table | Purpose |
|---|---|
| `mailboxes` | Mailbox records (id = email address, name, forward_to, settings JSON) |
| `users` | Owner account (`id = 'admin'`, bcrypt password_hash) |
| `emails` | All email messages (headers, body, thread_id, read/starred flags) |
| `folders` | Per-mailbox folders (inbox, sent, draft, archive, trash) |
| `api_keys` | Mailbox-scoped API keys (`ag_` prefix) |
| `automation_rules` | Simple per-mailbox automation rules |
| `workspace_groups` | Recursive group tree nodes |
| `workspace_group_members` | Mailbox → group membership edges |
| `scoped_automation_rules` | Cross-mailbox/group automation rules |
| `owner_memory` | Owner-authored memory per scope (all / group / mailbox) |

### EmailAgent Durable Object (`workers/agent/index.ts`)

Extends `AIChatAgent` from `@cloudflare/agents`. Handles persistent WebSocket chat sessions and inbound-email draft generation. One instance per workspace; mailbox context is passed per-request.

At each inference call the agent:
1. Calls `withOwnerMemory()` to merge workspace → group → mailbox memory into the system prompt.
2. Prepends `THREE_H_POLICY` — non-overridable Helpful / Honest / Harmless principles.
3. Calls the LLM (`@cf/moonshotai/kimi-k2.5` via Workers AI).
4. Verifies tool receipts with `hasSavedDraft()` before reporting success.

See [Agent & 3H Policy](./agent.md) for full details.

### Inbound email handler (`workers/index.ts` — `receiveEmail`)

Triggered by Cloudflare Email Routing on every inbound email:

1. Parse with `PostalMime`.
2. Persist to D1 `emails` table.
3. Optional forward via `event.forward(forwardAddress)`.
4. Run applicable scoped automation rules.
5. Trigger `EmailAgent` `/onNewEmail` to generate a draft reply (saved to Drafts, never auto-sent).

### React SPA (`app/`)

React 19 + React Router v7 application served via SSR from the Worker. State management with Zustand v5 and TanStack React Query v5. Rich-text editing via TipTap v3.

## Auth model

| Surface | Mechanism |
|---|---|
| Web app (`/`) | Session JWT cookie (`SESSION_SECRET`) |
| API routes (`/api/v1/*`) | Session JWT cookie (except `/auth/*`, `/external/*`) |
| Agent WebSocket (`/agents/*`) | Session JWT cookie |
| Hierarchy/settings | Session JWT + owner-only DB check (`id = 'admin'`) |
| MCP (`/mcp`) | Mailbox-scoped API key (header only) |
| External deposit (`/external/*`) | API key or open |

The hierarchy router (`workers/routes/hierarchy.ts`) performs an **independent** owner check — API keys and the outer session middleware cannot elevate to owner access.

## Hierarchy & memory

```
Workspace memory (scope = "all")
    └── Group memory (scope = "group", one or more ancestor groups)
            └── Mailbox memory (scope = "mailbox")
```

`getEffectiveMemory(db, mailboxId)` resolves the full ancestor chain with a single recursive CTE, returning memory merged in priority order. Later, more specific scopes override earlier ones.

`withOwnerMemory()` prepends the merged memory and a trust-boundary statement to the agent system prompt. The agent cannot write to or modify memory.

## Scoped automation rules

Rules in `scoped_automation_rules` have `scope_type ∈ {all, group, mailboxes}`. `getApplicableScopedRules()` returns all rules applicable to a given mailbox (including its ancestor groups). Actions include: move folder, star, mark read/unread, forward, webhook, trigger agent draft.
