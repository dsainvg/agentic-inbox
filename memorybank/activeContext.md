# Active Context: Agentic Inbox

## Current Repository State
- **Branch**: Initial workspace after clean `git clone` of `https://github.com/dsainvg/agentic-inbox.git`.
- **Environment**: Local Windows environment operating on Node.js / Wrangler / Vite tooling.
- **Repository Setup**: Full codebase structure verified with frontend React SPA in `app/`, Cloudflare Workers backend & D1 in `workers/`, and shared utilities in `shared/`.

## Active Focus & Recent Observations
1. **Memory Bank Initialized**: Complete memory bank documentation created under `memorybank/`.
2. **Cloudflare Access Configuration Requirement**: Production deployment requires Cloudflare Access setup (`POLICY_AUD` and `TEAM_DOMAIN` Worker secrets). Local development (`npm run dev`) skips Access validation.
3. **Vite SSR Pre-warming Configured**: Fixed the `Network connection lost` and `There is a new version of the pre-bundle` race condition in the Cloudflare workerd module runner by pre-optimizing all heavy dependencies (`@cloudflare/kumo`, `@phosphor-icons/react`, `zustand`, `@tiptap/react`, etc.) inside [`vite.config.ts`](file:///r:/Coding/Projects/agentic-inbox/vite.config.ts) for both client and `ssr`/`agentic_inbox` environments.
4. **React Duplication Fixed**: Added `resolve.dedupe: ["react", "react-dom"]` to prevent `useContext` null errors during dev hydration.

## Immediate Considerations for Operators & Developers
- For local dev, execute `npm run dev` to start Vite dev server and local Wrangler preview.
- If you make dependency or config changes, it is recommended to clear the Vite dev cache:
  ```powershell
  rmdir -r -fo node_modules\.vite
  ```
- Before deploying with `npm run deploy`, ensure:
  1. D1 Database binding `DB` is provisioned.
  2. `DOMAINS` variable in `wrangler.jsonc` is populated with the targeted domains.
  3. Email Routing catch-all rule is pointing to the deployed Worker.
