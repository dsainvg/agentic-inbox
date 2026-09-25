# Agentic Inbox agent instructions

## Commands

- Install with `npm install`; start local Vite + Wrangler with `npm run dev`.
- Use `npm run dev:remote` only when a test needs Cloudflare remote bindings.
- `npm run typecheck` is the repository typecheck: it runs Wrangler type generation, React Router type generation, and `tsc -b`. It regenerates ignored `worker-configuration.d.ts` and `.react-router/` output.
- `npm run build` builds the app; `npm run preview` builds then serves it locally; `npm run deploy` builds before deploying to Cloudflare.
- There is no configured `lint`, formatter, or `npm test` script. Run standalone tests with `node --test`:
  - `node --test tests/ui-regression.test.mjs`
  - `node --test tests/hierarchy-integration.mjs`
  - `node --test tests/draft-reporting.test.mjs`
  - `node --test tests/chat-regression.mjs`
  - `node --test tests/openrouter-regression.test.mjs`
  - `node --test tests/session-security.test.mjs`

## Code layout and execution flow

- `workers/app.ts` is the Wrangler entrypoint named by `wrangler.jsonc`. It mounts the Hono API, handles `/agents/*` before the React Router catch-all, serves `/mcp`, and falls through to SSR.
- `workers/index.ts` owns the main HTTP API and the inbound `email()` handler. `workers/agent/index.ts` is the `EmailAgent` Durable Object; `workers/mcp/index.ts` is the stateless MCP surface. The React UI is in `app/`; `shared/` contains code imported by both browser and Worker code.
- `workers/db/init.ts` initializes and upgrades D1 lazily on requests through `ensureDbInitialized`; there is no separate migration command. Keep `DB`, `AI`, and `EmailAgent` bindings and the Durable Object migration in `wrangler.jsonc` intact.

## Repository-specific safety and configuration

- `DOMAINS` and the production `SESSION_SECRET` are deployment configuration; set the secret with `wrangler secret put SESSION_SECRET`. Keep local secrets in ignored `.dev.vars` using `.dev.vars.example`; never commit credentials.
- OpenRouter is the optional primary AI provider: configure `OPENROUTER_API_KEY`; `OPENROUTER_MODEL` defaults to `openrouter/free` and the key remains server-side. Cloudflare AI is the fallback when OpenRouter is unavailable.
- Public intake requires `EXTERNAL_INTAKE_TOKEN` and `X-Intake-Token`; untrusted submissions are rate-limited, quarantined, and never run automations.
- Current outbound API/tool paths use optional `SMTP_USER`/`SMTP_PASS` through `workers/lib/smtp.ts`; `workers/email-sender.ts` is not wired into those paths, so do not assume its `send_email` binding is used.
- Attachment storage is optional: add the `ATTACHMENTS` R2 binding before relying on inbound attachment downloads; allowed MIME/size policy is enforced in `workers/lib/attachments.ts`.
- `/mcp` requires a mailbox-scoped API key in `Authorization: Bearer` or `X-API-Key` headers. Hierarchy/settings routes have their own owner-session check in `workers/routes/hierarchy.ts`; do not rely only on outer middleware for authorization.
- Agent behavior depends on `THREE_H_POLICY` and tool-receipt validation (`hasSavedDraft`): model prose is not proof that a draft was saved, and a saved draft is not a sent email. Preserve these boundaries when changing agent flows.

## Test isolation

- `tests/hierarchy-integration.mjs` uses Miniflare with local workerd/D1 and no deployed resources, AI calls, or SMTP delivery.
- `tests/ui-regression.test.mjs` is app-only and skips its browser assertion when Edge is unavailable; the other standalone tests stub model or email I/O.
