# Setup Guide

## Prerequisites

- Cloudflare account with a domain
- [Email Routing](https://developers.cloudflare.com/email-routing/) enabled for receiving
- [Workers AI](https://developers.cloudflare.com/workers-ai/) enabled
- Optional: an OpenRouter API key for primary inference
- Wrangler CLI installed (`npm install -g wrangler` or use `npx wrangler`)

## 1. Deploy to Cloudflare

Click the button to deploy via the Cloudflare dashboard. The flow provisions D1, Durable Objects, and Workers AI automatically. You will be prompted for `DOMAINS` — the domain(s) you want to receive email for.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/agentic-inbox)

Or deploy manually:

```bash
git clone https://github.com/cloudflare/agentic-inbox.git
cd agentic-inbox
npm install
npm run deploy
```

## 2. Create a D1 database (if not auto-created)

```bash
wrangler d1 create agentic-inbox-db
```

Copy the `database_id` output into `wrangler.jsonc` under `d1_databases`.

## 3. Set the SESSION_SECRET

```bash
wrangler secret put SESSION_SECRET
```

Enter a long random string (at least 32 characters). This signs all session JWT cookies.

To enable OpenRouter primary inference, set the API key as a secret:

```bash
wrangler secret put OPENROUTER_API_KEY
```

`OPENROUTER_MODEL` defaults to `openrouter/free`; override it only when you want a different OpenRouter model. Cloudflare AI remains the fallback when OpenRouter is unavailable.

For the public mailbox intake endpoint, set `EXTERNAL_INTAKE_TOKEN` as a secret and send it as `X-Intake-Token`. Public submissions are rate-limited and stored in the mailbox's `quarantine` folder until the owner moves them into the inbox.

## 4. Configure Email Routing

In the Cloudflare dashboard, go to your domain › Email Routing and create a **catch-all** rule that forwards to your deployed Worker.

## 5. Configure outbound email (SMTP)

Outbound API, tool, and automation sends use `workers/lib/smtp.ts`. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASS` in `.dev.vars` or your Worker environment. The current code does not use the `send_email` binding.

## 6. First run — create the owner account

Visit your deployed app. You will be redirected to `/setup`. Set your owner password. This creates the `admin` user in D1 and starts your session.

## 7. Create a mailbox

From the home screen, click **New Mailbox** and enter an address on your configured domain (e.g. `hello@example.com`).

---

## Local development

```bash
npm install
npm run dev
```

Vite starts on `http://localhost:5173` and Wrangler runs a local Worker with a local D1 instance. Session auth works locally with the `SESSION_SECRET` in `.dev.vars`.

### .dev.vars

Copy `.dev.vars.example` to `.dev.vars` and fill in:

```ini
SESSION_SECRET=your_local_secret_here
DOMAINS=example.com
```

### Clearing the Vite cache

If you encounter dependency pre-bundling issues:

```powershell
rmdir -r -fo node_modules\.vite
```

---

## Upgrading

After pulling new changes, run `npm run deploy`. The schema migration runs automatically on first request via `ensureDbInitialized()`, which is additive and safe to re-run.
