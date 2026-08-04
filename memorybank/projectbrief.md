# Project Brief: Agentic Inbox

## Executive Summary
**Agentic Inbox** is an open-source, self-hosted, full-featured email client powered by an embedded AI Agent. The entire stack runs serverlessly on Cloudflare infrastructure, using Cloudflare Workers, Durable Objects (with SQLite storage), R2 Object Storage, Cloudflare Email Routing, Cloudflare Email Service, Workers AI, and Cloudflare Access.

## Core Goals
1. **Self-Hosted Email Infrastructure**: Provide an isolated, privacy-centric email solution where each mailbox operates in its own Durable Object with dedicated SQLite database storage and R2 blob storage.
2. **Autonomous AI Assistance**: Provide an integrated AI Email Agent that automatically parses incoming emails, builds thread context, and prepares draft replies for human operator review.
3. **External Agent Protocol (MCP)**: Expose a Model Context Protocol (MCP) server endpoint (`/mcp`) so external AI developer tools (Cursor, Claude Code, etc.) can query inboxes, search messages, and manage mailboxes seamlessly.
4. **Zero-Server Management**: Leverage Cloudflare's serverless edge primitives (Workers, Durable Objects, Workers AI, R2) to eliminate traditional database server maintenance and infrastructure overhead.

## Scope & Architectural Boundaries
- **Multi-Tenant / Per-Mailbox Isolation**: Each email address (e.g. `user@example.com`) maps to a separate Durable Object instance (`MailboxDO`), keeping mailbox data strictly isolated.
- **Human-in-the-Loop Safeguards**: The AI agent is restricted to *drafting* emails. The agent cannot directly transmit outbound emails to recipients. Outbound sending requires explicit user confirmation via the web app UI or API.
- **Unified Authentication**: Cloudflare Access serves as the single perimeter security boundary. Passing the Access policy grants access to all mailboxes within the deployed Worker instance.

## Primary Stakeholders & Target Audience
- Developers and power users seeking a self-hosted, private email client with agentic capabilities.
- AI workflow engineers looking for a reference architecture for Cloudflare Agents SDK (`AIChatAgent`), Vercel AI SDK v6, Workers AI, and MCP server deployment.
