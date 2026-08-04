# Active Context: Agentic Inbox

## Current Repository State
- **Branch**: Initial workspace after clean `git clone` of `https://github.com/dsainvg/agentic-inbox.git`.
- **Environment**: Local Windows environment operating on node.js / wrangler tooling.
- **Repository Setup**: Full codebase structure verified with frontend React SPA in `app/`, Cloudflare Workers backend & Durable Objects in `workers/`, and shared utilities in `shared/`.

## Active Focus & Recent Observations
1. **Memory Bank Initialized**: Complete memory bank documentation created under `memorybank/`.
2. **Cloudflare Access Configuration Requirement**: Production deployment requires Cloudflare Access setup (`POLICY_AUD` and `TEAM_DOMAIN` Worker secrets). Local development (`npm run dev`) skips Access validation.
3. **MCP Endpoint Verification**: MCP endpoint located at `/mcp` using `EmailMCP` class for external LLM integrations.
4. **Auto-Draft Workflow**: Verified inbound email hook triggers `onNewEmail` event on `EmailAgent` DO via `ctx.waitUntil`.

## Immediate Considerations for Operators & Developers
- Before deploying with `npm run deploy`, ensure:
  1. An R2 bucket named `agentic-inbox` exists (`wrangler r2 bucket create agentic-inbox`).
  2. `DOMAINS` variable in `wrangler.jsonc` is populated with the targeted domain.
  3. Email Routing catch-all rule is pointing to the deployed Worker.
  4. Outbound `send_email` Workers binding is enabled in Cloudflare dashboard.
- For local dev, execute `npm run dev` to start Vite dev server and local Wrangler preview.
