<div align="center">
  <h1>Agentic Inbox</h1>
  <p><em>A self-hosted email client with an AI agent, running entirely on Cloudflare Workers</em></p>
</div>

Agentic Inbox lets you send, receive, and manage emails through a modern web interface — all powered by your own Cloudflare account. Incoming emails arrive via [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/), all mailbox data is stored in [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite), and the AI agent runs in its own [Durable Object](https://developers.cloudflare.com/durable-objects/).

An **AI-powered Email Agent** can read your inbox, search conversations, and draft replies — built with the [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) and [Workers AI](https://developers.cloudflare.com/workers-ai/).

![Agentic Inbox screenshot](./demo_app.png)

Read the blog post to learn more about Cloudflare Email Service and how to use it with the Agents SDK, MCP, and from the Wrangler CLI: [Email for Agents](https://blog.cloudflare.com/email-for-agents/).

## How to set up

### 1. Deploy

Deploy to Cloudflare. The flow provisions D1, Durable Objects, and Workers AI automatically. You'll be prompted for **DOMAINS** — the domain(s) you want to receive email for.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/agentic-inbox)

### 2. Set up Email Routing

In the Cloudflare dashboard go to your domain › Email Routing and create a catch-all rule that forwards to this Worker.

### 3. Enable outbound email

The Worker needs the `send_email` binding to send outbound emails. See the [Email Service docs](https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/).

### 4. First run — create the owner account

Visit your deployed app. You will be redirected to `/setup` where you set your owner password. This creates the `admin` session used to access all settings and mailboxes.

### 5. Create a mailbox

From the home screen, create a mailbox for any address on your configured domain (e.g. `hello@example.com`).

## Features

- **Full email client** — Send and receive emails via Cloudflare Email Routing with a rich-text composer, reply/forward threading, folder organisation, search, and attachments
- **Per-mailbox isolation** — All mailbox data lives in Cloudflare D1 (SQLite); each mailbox has its own rows, folders, and API keys
- **Built-in AI agent** — Side panel with email tools for reading, searching, drafting, and sending; real-time streaming via WebSocket
- **3H agent policy** — The agent is governed by non-overridable Helpful / Honest / Harmless principles that apply even when custom prompts or email content conflict with them
- **Auto-draft on new email** — Agent reads inbound emails and generates draft replies; explicit confirmation is always required before sending
- **Hierarchy & group memory** — Organise mailboxes into groups with a recursive tree structure; attach owner-authored memory at the workspace, group, or mailbox level that the agent inherits and applies in priority order
- **Scoped automation rules** — Define match-and-action rules scoped to all mailboxes, a group, or individual mailboxes; rules run automatically on inbound email
- **MCP server** — `/mcp` endpoint serves Model Context Protocol; external AI tools (Claude Code, Cursor, etc.) connect with a mailbox-scoped API key
- **Configurable and persistent** — Custom system prompts per mailbox, persistent chat history, streaming markdown responses, and tool-call visibility

## Stack

- **Frontend:** React 19, React Router v7, Tailwind CSS v4, Zustand, TipTap, `@cloudflare/kumo`
- **Backend:** Hono, Cloudflare Workers, D1 (SQLite), Email Routing / Email Service
- **AI Agent:** Cloudflare Agents SDK (`AIChatAgent`), AI SDK v6, Workers AI (`@cf/moonshotai/kimi-k2.5`), Durable Objects
- **Auth:** Session-based authentication (JWT cookie, `SESSION_SECRET`); owner-only hierarchy and settings routes use an independent session check

## Getting Started

```bash
npm install
npm run dev
```

### Configuration

1. Set your domain(s) in `wrangler.jsonc` under `vars.DOMAINS`
2. Set `SESSION_SECRET` as a Worker secret: `wrangler secret put SESSION_SECRET`
3. Ensure a D1 database is bound as `DB` in `wrangler.jsonc`

### Deploy

```bash
npm run deploy
```

## Prerequisites

- Cloudflare account with a domain
- [Email Routing](https://developers.cloudflare.com/email-routing/) enabled for receiving
- [Email Service](https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/) enabled for sending
- [Workers AI](https://developers.cloudflare.com/workers-ai/) enabled (for the agent)
- D1 database created and bound as `DB`

## External API

Agentic Inbox provides external API endpoints for website contact forms, webhooks, and integrations to deposit messages directly into a mailbox's INBOX or fetch stored messages via API keys.

### Deposit a message via API key — `POST /api/v1/external/messages`

Pass your mailbox's API key via `X-API-Key` header, `Authorization: Bearer <key>`, or `?apiKey=` query param.

```bash
curl -X POST "https://your-domain.com/api/v1/external/messages" \
  -H "X-API-Key: your_mailbox_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "message": "Hello! I would like to inquire about your services."
  }'
```

### Deposit via mailbox address — `POST /api/v1/external/mailboxes/:mailboxId/messages`

```bash
curl -X POST "https://your-domain.com/api/v1/external/mailboxes/hello@example.com/messages" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Smith",
    "email": "jane@example.com",
    "message": "New contact form message."
  }'
```

**Response (`201 Created`):**
```json
{
  "success": true,
  "id": "c1f7a4b2-...",
  "mailbox": "hello@example.com",
  "statusCode": 201
}
```

- Subject is formatted as `a mail from {email} in mailbox {mailbox name}`.
- Reply-To is injected so replies target the original sender.

## MCP Server

The `/mcp` endpoint serves the Model Context Protocol. Connect external AI tools using a mailbox-scoped API key:

```
Authorization: Bearer <mailbox_api_key>
```

or

```
X-API-Key: <mailbox_api_key>
```

The MCP server scopes all operations to the authenticated mailbox. API keys are created in Settings.

## Architecture

```
┌──────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
│   Browser    │────>│  Hono Worker          │────>│  Cloudflare D1       │
│  React SPA   │     │  workers/app.ts       │     │  (SQLite, all data)  │
│  Agent Panel │     │                       │     └──────────────────────┘
└──────┬───────┘     │  /api/v1/* ───────────┼────>  D1 + SMTP / send_email
       │             │                       │
       │ WebSocket   │  /agents/* ───────────┼────>┌──────────────────────┐
       └─────────────┤                       │     │  EmailAgent DO       │
                     │                       │     │  (AIChatAgent)       │
                     │  /mcp ────────────────┼────>│  email tools         │
                     │  (API key per mailbox)│     │  Workers AI          │
                     │                       │     └──────────────────────┘
                     │  email() handler ─────┼────>  D1 + EmailAgent DO
                     └──────────────────────┘
```

### Auth model

| Surface | Auth mechanism |
|---|---|
| Web app (`/`) | Session JWT cookie (`SESSION_SECRET`) |
| API routes (`/api/v1/*`) | Session JWT cookie (except `/auth/*` and `/external/*`) |
| Agent WebSocket (`/agents/*`) | Session JWT cookie |
| Hierarchy / settings | Session JWT cookie + owner-only `id = 'admin'` DB check |
| MCP (`/mcp`) | Mailbox-scoped API key (header only) |
| External deposit (`/external/*`) | Mailbox-scoped API key or open (public deposit endpoint) |

### Hierarchy & memory

Mailboxes can be organised into a recursive group tree. Owner-authored memory is attached at three scopes — workspace (`all`), `group`, and `mailbox` — and the agent merges them in priority order (workspace → group → mailbox) at inference time. Memory is read-only at runtime; only the owner can edit it in Settings.

### 3H Agent Policy

All agent actions are governed by non-overridable **Helpful / Honest / Harmless** principles enforced at the framework level (`workers/lib/agent-policy.ts`). These apply even when custom system prompts, owner memory, or incoming email content conflict with them.

## License

Apache 2.0 — see [LICENSE](LICENSE).
