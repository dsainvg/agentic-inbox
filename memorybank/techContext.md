# Technical Context: Agentic Inbox

## Technology Stack

### Runtime & Infrastructure
- **Platform**: Cloudflare Workers
- **Compatibility Date**: `2025-11-28`
- **Compatibility Flags**: `["nodejs_compat"]`
- **Database**: Cloudflare D1 (`DB` binding) + Drizzle ORM (`drizzle-orm/d1`)
- **Inbound Email**: Cloudflare Email Routing (`email()` event listener)
- **Email Forwarding**: `event.forward(forwardAddress)`
- **Auth Perimeter**: Cloudflare Access JWT Assertion Header (`jose`)

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
- **ORM**: Drizzle ORM (`drizzle-orm`)

## Configuration & Deployment Settings (`wrangler.jsonc`)

### Environment Variables & Bindings
- `DOMAINS`: Comma-separated list of allowed email domain(s).
- `EMAIL_ADDRESSES`: (Optional) Restrict valid mailbox email creation to explicit addresses.
- `POLICY_AUD`: Cloudflare Access Application Audience Tag (required in production).
- `TEAM_DOMAIN`: Cloudflare Access Team URL or certs endpoint (required in production).
- `d1_databases`:
  - `binding`: `DB` -> `agentic-inbox-db`

## Development & Build Commands

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run TypeScript type check
npx -p typescript tsc --noEmit

# Deploy to Cloudflare Workers
npm run deploy
```
