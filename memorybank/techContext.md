# Technical Context: Agentic Inbox

## Technology Stack

### Runtime & Infrastructure
- **Platform**: Cloudflare Workers
- **Compatibility Date**: `2025-11-28`
- **Compatibility Flags**: `["nodejs_compat"]`
- **Database**: Cloudflare D1 (`DB` binding) — all application data (SQLite via Drizzle ORM)
- **Inbound Email**: Cloudflare Email Routing (`email()` event listener)
- **Outbound Email**: `send_email` Workers binding
- **AI Model**: Workers AI (`AI` binding), model `@cf/moonshotai/kimi-k2.5`
- **Auth**: Session JWT cookie (`session`) signed with `SESSION_SECRET` Worker secret; `jose` library for JWT sign/verify

### Core Frontend Stack
- **Framework**: React 19 (`react`, `react-dom`)
- **SSR & Routing**: React Router v7 (`react-router`)
- **Build Tool**: Vite 6 (`vite`, `@cloudflare/vite-plugin`, `@react-router/dev`)
- **Styling**: Tailwind CSS v4 (`tailwindcss`, `@tailwindcss/vite`)
- **UI Kit**: `@cloudflare/kumo`, `@phosphor-icons/react`
- **Rich Text Editor**: TipTap v3
- **State & Data Fetching**: Zustand v5, TanStack React Query v5

### Backend & API Stack
- **HTTP Routing**: Hono v4 (`hono`)
- **Email Parser**: `postal-mime`
- **Validation**: `zod` v3
- **ORM**: Drizzle ORM (`drizzle-orm/d1`)
- **Crypto**: `bcryptjs` for password hashing

### AI Agent Stack
- **Agent SDK**: `@cloudflare/agents` (`AIChatAgent`)
- **AI SDK**: Vercel AI SDK v6 (`ai`)
- **Durable Object**: `EmailAgent` (single-instance, WebSocket + HTTP)
- **Model**: `@cf/moonshotai/kimi-k2.5` via Workers AI
- **Policy module**: `workers/lib/agent-policy.ts` — `THREE_H_POLICY`, `passesThreeHReview`, `hasSavedDraft`
- **Memory module**: `workers/lib/hierarchy.ts` — `getEffectiveMemory`, `withOwnerMemory`

## Configuration & Deployment Settings (`wrangler.jsonc`)

### Bindings Summary
| Binding | Type | Purpose |
|---|---|---|
| `DB` | D1 Database | All mailbox, email, user, and hierarchy data |
| `AI` | Workers AI | LLM inference for the email agent |
| `EmailAgent` | Durable Object | Persistent WebSocket chat agent |

### Environment Variables
- `DOMAINS`: Comma-separated receiving domain(s) (e.g. `example.com, mail.example.com`)
- `EMAIL_ADDRESSES`: (Optional) Allowlist of valid mailbox addresses for creation

### Secrets
- `SESSION_SECRET`: Signs/verifies all session JWT cookies. Must be set before production deployment.

### Not used (removed from this fork)
- `POLICY_AUD` / `TEAM_DOMAIN`: Cloudflare Access is not used; session auth replaces it.
- `R2`: Attachments are stored inline in D1; no R2 bucket is required.

## D1 Schema Tables

| Table | Purpose |
|---|---|
| `mailboxes` | Mailbox records (id = email, name, forward_to, settings JSON) |
| `users` | Owner account (`id = 'admin'`, bcrypt password_hash) |
| `api_keys` | Mailbox-scoped API keys (`ag_` prefix) |
| `folders` | Per-mailbox folders (inbox, sent, draft, archive, trash) |
| `emails` | All email messages (headers, body, thread_id, flags) |
| `automation_rules` | Per-mailbox simple automation rules |
| `workspace_groups` | Recursive group tree nodes |
| `workspace_group_members` | Mailbox → group membership edges |
| `scoped_automation_rules` | Cross-mailbox/group automation rules |
| `owner_memory` | Owner-authored memory per scope (all/group/mailbox) |

## Development & Build Commands

```bash
# Install dependencies
npm install

# Start development server (Vite + Wrangler)
npm run dev

# Clear Vite cache if dependency optimization issues occur
rmdir -r -fo node_modules\.vite

# TypeScript type check
npm run typecheck

# Deploy to Cloudflare Workers
npm run deploy
```
