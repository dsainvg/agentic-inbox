# Active Context: Agentic Inbox

## Current Repository State
- **Environment**: Local Windows environment operating on Node.js / Wrangler / Vite tooling.
- **Auth**: Session-based JWT cookie authentication (`SESSION_SECRET`). Owner account created on first run via `/setup`. No Cloudflare Access dependency.
- **Storage**: Cloudflare D1 (`DB` binding) holds all application data — mailboxes, emails, folders, api_keys, users, automation_rules, workspace_groups, workspace_group_members, scoped_automation_rules, owner_memory.
- **AI Agent**: `EmailAgent` Durable Object (single instance, `AIChatAgent` from Cloudflare Agents SDK). WebSocket connection from the agent side panel, model `@cf/moonshotai/kimi-k2.5` via Workers AI.

## Active Features & Components
1. **Session Auth**: JWT cookie (`session`) signed with `SESSION_SECRET`. The `/api/v1/hierarchy/*` router performs an independent owner check (`payload.id === 'admin'` and DB lookup) — API keys and outer middleware cannot elevate to owner access.
2. **Hierarchy & Group Memory**: Mailboxes can be placed in a recursive group tree (`workspace_groups` + `workspace_group_members`). Owner-authored memory is stored in `owner_memory` at three scopes: `all` (workspace), `group`, `mailbox`. `getEffectiveMemory()` in `workers/lib/hierarchy.ts` merges them in priority order at inference time.
3. **3H Agent Policy**: `workers/lib/agent-policy.ts` defines `THREE_H_POLICY` — non-overridable Helpful / Honest / Harmless principles injected into every agent invocation. `passesThreeHReview()` validates structured approval. `hasSavedDraft()` verifies tool receipts rather than model prose.
4. **Scoped Automation Rules**: `scoped_automation_rules` table stores rules with `scope_type ∈ {all, group, mailboxes}`. `getApplicableScopedRules()` returns rules applicable to a mailbox. `workers/lib/automations.ts` executes actions (move folder, star, mark read, webhook, etc.) on inbound email.
5. **MCP Server**: `/mcp` endpoint, stateless, validates a mailbox-scoped API key on every request. Keys via `Authorization: Bearer` or `X-API-Key` header only.
6. **Setup Flow**: First visit redirects to `/setup`. Creates the `admin` user in the `users` table with a bcrypt-hashed password. Subsequent logins via `/login`.

## Immediate Considerations for Operators & Developers
- Set `SESSION_SECRET` as a Worker secret before deploying: `wrangler secret put SESSION_SECRET`.
- Populate `DOMAINS` in `wrangler.jsonc` with your receiving domain(s).
- For local dev, run `npm run dev`. Access validation is not required in dev.
- If you make dependency or config changes, clear the Vite dev cache:
  ```powershell
  rmdir -r -fo node_modules\.vite
  ```
- Before deploying with `npm run deploy`, ensure:
  1. D1 Database binding `DB` is provisioned and bound in `wrangler.jsonc`.
  2. `EmailAgent` Durable Object migration (`v1` / `new_sqlite_classes`) is present in `wrangler.jsonc`.
  3. Email Routing catch-all rule points to the deployed Worker.
  4. `send_email` binding is enabled for outbound mail.

## Known Active Limitations
- Attachments are stored inline in D1 body fields; large attachments may increase D1 row size.
- The `admin` user is a singleton; multi-owner setups are not currently supported.
- Agent memory is per-inference (D1 read at call time); there is no background memory-learning loop.
