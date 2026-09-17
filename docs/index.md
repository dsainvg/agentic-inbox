# Agentic Inbox — Documentation

Welcome to the Agentic Inbox documentation. Use the table below to find what you need.

| Document | What it covers |
|---|---|
| [Architecture](./architecture.md) | System overview, component roles, data flows, auth model |
| [Setup Guide](./setup.md) | Deploy, configure, first-run walkthrough |
| [Configuration Reference](./configuration.md) | All environment variables, secrets, bindings, and limits |
| [API Reference](./api-reference.md) | Every HTTP endpoint — auth, mailboxes, emails, external, hierarchy |
| [Agent & 3H Policy](./agent.md) | EmailAgent internals, 3H policy, hierarchy memory, tools |

## Quick start

```bash
npm install
npm run dev        # local Wrangler + Vite dev server
npm run deploy     # deploy to Cloudflare Workers
```

## At a glance

- All data lives in **Cloudflare D1** (one `DB` binding).
- Auth is **session-based** — a JWT cookie signed with `SESSION_SECRET`. No Cloudflare Access required.
- The AI agent (`EmailAgent` Durable Object) is governed by the non-overridable **3H policy** (Helpful / Honest / Harmless) and uses **owner-authored memory** at workspace, group, or mailbox scope.
- External tools connect via the **MCP server** at `/mcp` using a mailbox-scoped API key.
