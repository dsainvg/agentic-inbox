# System Patterns & Architecture: Agentic Inbox

## Core System Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 Cloudflare Edge Network                                │
│                                                                                        │
│  ┌───────────────────────┐             ┌────────────────────────────────────────────┐  │
│  │   Cloudflare Access   │────────────>│               Worker Entry                 │  │
│  │  (JWT Auth Perimeter) │             │             (workers/app.ts)               │  │
│  └───────────────────────┘             └──────────────────────┬─────────────────────┘  │
│                                                               │                        │
│          ┌───────────────────────┬────────────────────────────┼──────────────────┐     │
│          ▼                       ▼                            ▼                  ▼     │
│  ┌───────────────┐     ┌───────────────────┐        ┌───────────────────┐  ┌──────────┐│
│  │   Hono API    │     │  React Router SPA │        │  Inbound email()  │  │ External ││
│  │ (/api/v1/...) │     │ (Server / Client) │        │ Trigger & Forward │  │ GET API  ││
│  └───────┬───────┘     └───────────────────┘        └─────────┬─────────┘  └────┬─────┘│
│          │                                                    │                 │      │
│          └───────────────────────┬────────────────────────────┴─────────────────┘      │
│                                  ▼                                                     │
│                     ┌─────────────────────────┐                                        │
│                     │  Cloudflare D1 Database │                                        │
│                     │   (SQLite / DB Binding) │                                        │
│                     └─────────────────────────┘                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## Key Components & Responsibilities

### 1. Cloudflare D1 Database (`workers/db/schema.ts`, `workers/db/init.ts`)
- **Tables**:
  - `mailboxes`: Stores mailbox email, display name, forwarding address (`forward_to`), and settings JSON.
  - `api_keys`: Stores API keys (`ag_...`), key name, associated mailbox ID, and creation date.
  - `folders`: Stores folder records (`inbox`, `sent`, `draft`, `archive`, `trash`).
  - `emails`: Stores incoming/outgoing email messages including `sender` (`from`), `subject`, `body`, `date`, `read`, `starred`, `thread_id`. (No attachments stored).

### 2. Inbound Email Trigger & Forwarding (`receiveEmail` in `workers/index.ts`)
- Receives inbound email event from Cloudflare Email Routing.
- Parses raw email using `PostalMime`.
- Persists email metadata and text/HTML body directly into D1 `emails` table.
- Forwards incoming email via `event.forward(forwardAddress)` if a forwarding address is configured for the recipient mailbox.

### 3. External GET Email API (`GET /api/v1/external/messages`)
- Authenticates external clients via `apiKey` (query parameter, `X-API-Key` header, or `Authorization: Bearer`).
- Queries D1 `api_keys` table to resolve the authorized mailbox.
- Queries D1 `emails` table and returns JSON response containing:
  - `from`: Sender email/name
  - `subject`: Name of message
  - `body`: Content of mail message
  - `date`, `id`, `read`, `starred`, `recipient`

### 4. API Key Generator (`workers/lib/api-keys.ts`, `app/routes/settings.tsx`)
- Provides API key generation (`ag_` prefixed keys) per mailbox.
- Stores API keys in D1 `api_keys` table.
- Frontend Settings UI allows creating keys, copying new keys, and revoking existing keys.
