# API Reference

All endpoints are relative to your Worker's base URL (e.g. `https://mail.example.com`).

## Authentication

Most `/api/v1/*` routes require a valid `session` JWT cookie (obtained via `/api/v1/auth/login`).

External endpoints accept a mailbox-scoped API key via:
- `X-API-Key: <key>` header
- `Authorization: Bearer <key>` header
- `?apiKey=<key>` query param (external deposit endpoints only)

---

## Auth endpoints

### `POST /api/v1/auth/setup`
Create the owner account on first run. Only works when no `admin` user exists.

**Body:**
```json
{ "password": "your-owner-password" }
```

**Response:** `200 OK` — sets `session` cookie.

---

### `POST /api/v1/auth/login`
Authenticate as the owner.

**Body:**
```json
{ "password": "your-owner-password" }
```

**Response:** `200 OK` — sets `session` cookie.

---

### `POST /api/v1/auth/logout`
Clear the session cookie.

---

### `GET /api/v1/auth/me`
Returns `{ loggedIn: true }` if a valid session cookie is present, otherwise `{ loggedIn: false }`.

---

## Mailbox endpoints

All require a valid session cookie.

### `GET /api/v1/mailboxes`
List all mailboxes.

### `POST /api/v1/mailboxes`
Create a new mailbox.

**Body:**
```json
{ "email": "hello@example.com", "name": "Hello" }
```

### `GET /api/v1/mailboxes/:mailboxId`
Get a single mailbox.

### `PATCH /api/v1/mailboxes/:mailboxId`
Update mailbox settings.

**Body** (all fields optional):
```json
{
  "name": "New name",
  "forwardTo": "other@example.com",
  "systemPrompt": "You are a helpful assistant for..."
}
```

### `DELETE /api/v1/mailboxes/:mailboxId`
Delete a mailbox and all associated data.

---

## Email endpoints

All require a valid session cookie.

### `GET /api/v1/mailboxes/:mailboxId/emails`
List emails in a folder.

Query params: `folder` (default `inbox`), `page`, `limit`.

### `GET /api/v1/mailboxes/:mailboxId/emails/:emailId`
Get a single email.

### `PATCH /api/v1/mailboxes/:mailboxId/emails/:emailId`
Update email flags.

**Body** (all optional):
```json
{ "read": true, "starred": false, "folder": "archive" }
```

### `DELETE /api/v1/mailboxes/:mailboxId/emails/:emailId`
Move to trash or permanently delete.

### `POST /api/v1/mailboxes/:mailboxId/send`
Send an outbound email.

**Body:**
```json
{
  "to": "recipient@example.com",
  "subject": "Subject line",
  "body": "<p>HTML body</p>",
  "inReplyTo": "optional-message-id",
  "references": "optional-references-header"
}
```

---

## Search endpoint

### `GET /api/v1/mailboxes/:mailboxId/search`
Search emails.

Query params: `q` (search query), `folder` (optional), `page`, `limit`.

The query supports field-scoped operators: `from:`, `subject:`, `to:`, `is:read`, `is:starred`.

---

## API key endpoints

All require a valid session cookie.

### `GET /api/v1/mailboxes/:mailboxId/api-keys`
List API keys for a mailbox.

### `POST /api/v1/mailboxes/:mailboxId/api-keys`
Generate a new API key.

**Body:**
```json
{ "name": "My integration" }
```

**Response:** Returns the key value once (not stored in plaintext — copy it).

### `DELETE /api/v1/mailboxes/:mailboxId/api-keys/:keyId`
Revoke an API key.

---

## Automation rule endpoints

All require a valid session cookie.

### `GET /api/v1/mailboxes/:mailboxId/automations`
List automation rules for a mailbox.

### `POST /api/v1/mailboxes/:mailboxId/automations`
Create an automation rule.

**Body:**
```json
{
  "matchField": "from",
  "matchValue": "newsletter@",
  "actions": [{ "type": "move", "folder": "archive" }],
  "enabled": true
}
```

### `PATCH /api/v1/mailboxes/:mailboxId/automations/:ruleId`
Update a rule.

### `DELETE /api/v1/mailboxes/:mailboxId/automations/:ruleId`
Delete a rule.

---

## Hierarchy endpoints

All require a valid session cookie **and** owner-level session (`id = 'admin'`). These routes perform an independent owner check — no API key can access them.

### `GET /api/v1/hierarchy/groups`
List all workspace groups.

### `POST /api/v1/hierarchy/groups`
Create a group.

**Body:**
```json
{ "name": "Support", "parentId": null, "members": ["hello@example.com"] }
```

### `PATCH /api/v1/hierarchy/groups/:groupId`
Update a group (name, parent, members).

### `DELETE /api/v1/hierarchy/groups/:groupId`
Delete a group.

### `GET /api/v1/hierarchy/memory`
List all owner memory blocks.

### `PUT /api/v1/hierarchy/memory`
Create or update a memory block.

**Body:**
```json
{
  "scopeType": "group",
  "scopeId": "support-group-id",
  "content": "Always reply in a formal tone. Include a ticket reference.",
  "revision": 0
}
```

`revision` is an optimistic-lock counter. Pass the current revision; the server increments it and rejects stale writes.

### `GET /api/v1/hierarchy/rules`
List scoped automation rules.

### `POST /api/v1/hierarchy/rules`
Create a scoped automation rule.

**Body:**
```json
{
  "name": "Archive newsletters for all mailboxes",
  "scopeType": "all",
  "scopeIds": ["all"],
  "matchField": "subject",
  "matchValue": "unsubscribe",
  "actions": [{ "type": "move", "folder": "archive" }],
  "enabled": true
}
```

### `PATCH /api/v1/hierarchy/rules/:ruleId`
Update a scoped rule.

### `DELETE /api/v1/hierarchy/rules/:ruleId`
Delete a scoped rule.

---

## External endpoints

These do not require a session cookie.

### `POST /api/v1/external/messages`
Deposit a message using a mailbox API key.

**Headers:** `X-API-Key: <key>` or `Authorization: Bearer <key>`

**Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "message": "Hello, I have a question."
}
```

**Response `201`:**
```json
{ "success": true, "id": "c1f7a4b2-...", "mailbox": "hello@example.com", "statusCode": 201 }
```

### `POST /api/v1/external/mailboxes/:mailboxId/messages`
Deposit a message into a specific mailbox (open — no key required).

Same body as above.

### `GET /api/v1/external/messages`
Fetch messages for the authenticated mailbox.

**Headers:** `X-API-Key: <key>` or `Authorization: Bearer <key>`

Query params: `folder` (default `inbox`), `page`, `limit`.

---

## MCP endpoint

### `* /mcp`
Model Context Protocol endpoint. Accepts all HTTP methods per the MCP spec.

**Authentication:** `X-API-Key: <key>` or `Authorization: Bearer <key>` (headers only — no URL param).

All operations are scoped to the authenticated mailbox. See [Agent & 3H Policy](./agent.md) for available MCP tools.
