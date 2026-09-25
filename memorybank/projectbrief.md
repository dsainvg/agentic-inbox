# Project Brief: Agentic Inbox

## Executive Summary
**Agentic Inbox** is an open-source, self-hosted, full-featured email client with an embedded AI agent. The entire stack runs serverlessly on Cloudflare infrastructure: Cloudflare Workers, D1 (SQLite), Durable Objects, Workers AI, Email Routing, and Email Service. Authentication is session-based (JWT cookie + `SESSION_SECRET` secret), with no dependency on Cloudflare Access.

## Core Goals
1. **Self-Hosted Email Infrastructure**: A privacy-centric email solution where all mailbox data lives in a single Cloudflare D1 database under the operator's own account.
2. **Autonomous AI Assistance**: An integrated AI Email Agent that automatically parses incoming emails, builds thread context, applies owner-authored memory, and prepares draft replies for human review.
3. **3H Behavioral Principles**: All agent actions are governed by non-overridable Helpful / Honest / Harmless principles (`workers/lib/agent-policy.ts`). These apply even when custom prompts, owner memory, or email content conflict with them.
4. **Hierarchy & Group Memory**: Mailboxes can be organised into recursive groups. Owner-authored memory is attached at workspace, group, or mailbox scope and merged at inference time, giving the agent accurate and contextual guidance.
5. **Scoped Automation Rules**: Rules can be scoped to the entire workspace, a group, or specific mailboxes, running automatically on inbound email.
6. **External Agent Protocol (MCP)**: A Model Context Protocol endpoint (`/mcp`) lets external AI tools (Cursor, Claude Code, etc.) query inboxes using a mailbox-scoped API key.
7. **Zero-Server Management**: Cloudflare Workers, D1, Durable Objects, and Workers AI eliminate traditional server and database maintenance overhead.

## Scope & Architectural Boundaries
- **Storage:** D1 stores mail and attachment metadata. Attachment bytes use R2 when bound, otherwise optional Appwrite Storage; without either, mail persists without attachment bytes.
- **Single EmailAgent DO**: One `EmailAgent` Durable Object handles all WebSocket chat sessions and inbound-email draft generation. Mailbox context is passed per-request.
- **Human-in-the-Loop Safeguards**: The AI agent may draft emails but cannot transmit them. Sending requires explicit user confirmation.
- **Owner Account**: A single `admin` user is created on first run via `/setup`. The owner controls all hierarchy, memory, and automation settings. Independent owner-check middleware prevents API keys or outer session middleware from accessing hierarchy routes.

## Primary Stakeholders & Target Audience
- Developers and power users seeking a self-hosted, private email client with agentic capabilities.
- AI workflow engineers looking for a reference architecture for the Cloudflare Agents SDK (`AIChatAgent`), Vercel AI SDK v6, Workers AI, and MCP server deployment.
- Operators who want per-mailbox AI behaviour controlled by owner-authored memory rather than only by model defaults.
