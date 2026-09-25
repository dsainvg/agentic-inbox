# Configuration Reference

## wrangler.jsonc — top-level settings

| Key | Description |
|---|---|
| `name` | Worker name (`agentic-inbox`) |
| `main` | Entry point (`./workers/app.ts`) |
| `compatibility_date` | `2025-11-28` |
| `compatibility_flags` | `["nodejs_compat"]` |

## Environment variables (`vars`)

| Variable | Required | Description |
|---|---|---|
| `DOMAINS` | Yes | Comma-separated list of domains to receive email for (e.g. `example.com, mail.example.com`) |
| `EMAIL_ADDRESSES` | No | Comma-separated allowlist of specific mailbox addresses. If set, only these addresses can be created as mailboxes. |
| `OPENROUTER_MODEL` | No | OpenRouter model used when `OPENROUTER_API_KEY` is configured; defaults to `openrouter/free`. |
| `OPENROUTER_BASE_URL` | No | Optional OpenRouter API base URL override for compatible gateways. |
| `EXTERNAL_INTAKE_TOKEN` | Yes for public intake | Secret token required by `POST /api/v1/external/mailboxes/:mailboxId/messages`; public submissions are quarantined by default. |
| `ATTACHMENT_SCAN_ENDPOINT` | No | Optional HTTP malware scanner endpoint. Attachments remain pending/quarantined when unset. |
| `ATTACHMENT_SCAN_TOKEN` | No | Optional bearer token sent to the attachment scanner. |

## Secrets

Set secrets with `wrangler secret put <NAME>`:

| Secret | Required | Description |
|---|---|---|
| `SESSION_SECRET` | Yes | Signs and verifies all session JWT cookies. Use a long random string (≥ 32 chars). Rotate by setting a new value (existing sessions will be invalidated). |
| `OPENROUTER_API_KEY` | No | Enables OpenRouter as the primary AI provider; Workers AI remains the fallback. Keep it in `.dev.vars` locally or as a Wrangler secret; never expose it to the browser. |
| `EXTERNAL_INTAKE_TOKEN` | No | Enables the public intake endpoint when set; use a random secret and send it as `X-Intake-Token`. |

## Bindings (`wrangler.jsonc`)

| Binding | Type | Name in code | Description |
|---|---|---|---|
| `DB` | D1 Database | `env.DB` | Primary data store — all mailbox, email, user, and hierarchy data |
| `AI` | Workers AI | `env.AI` | LLM inference for the email agent |
| `EmailAgent` | Durable Object | `env.EmailAgent` | Persistent WebSocket chat agent |
| `ATTACHMENTS` | R2 Bucket (optional) | `env.ATTACHMENTS` | Stores inbound attachment bytes; create the bucket and add this binding to enable downloads. |

### D1 database binding example

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "agentic-inbox-db",
    "database_id": "<your-database-id>"
  }
]
```

### Durable Object binding example

```jsonc
"durable_objects": {
  "bindings": [
    { "name": "EmailAgent", "class_name": "EmailAgent" }
  ]
},
"migrations": [
  { "tag": "v1", "new_sqlite_classes": ["EmailAgent"] }
]
```

### Workers AI binding example

```jsonc
"ai": { "binding": "AI" }
```

### R2 attachment binding example

```jsonc
"r2_buckets": [
  { "binding": "ATTACHMENTS", "bucket_name": "agentic-inbox-attachments" }
]
```

Create the bucket before deploying:

```bash
wrangler r2 bucket create agentic-inbox-attachments
```

## Hierarchy & agent limits

These are hardcoded in `workers/lib/hierarchy.ts` as `HIERARCHY_LIMITS`:

| Limit | Value | Description |
|---|---|---|
| `groups` | 64 | Maximum group tree depth |
| `members` | 256 | Maximum mailboxes per group |
| `rules` | 500 | Maximum scoped automation rules |
| `memory` | 4000 chars | Maximum content per memory block |
| `prompt` | 32768 chars | Maximum total merged prompt length |
| `name` | 100 chars | Maximum name length for groups/rules |
| `actions` | 20 | Maximum actions per automation rule |
| `requestBytes` | 131072 (128 KB) | Maximum request body size for hierarchy API |

## Per-mailbox settings (stored as JSON in `mailboxes.settings`)

| Key | Description |
|---|---|
| `systemPrompt` | Custom system prompt prepended to the agent's base prompt for this mailbox |
| `forwardTo` | Email address to forward all inbound mail to |

These are managed via the Settings UI or the `/api/v1/mailboxes/:id/settings` endpoint.
