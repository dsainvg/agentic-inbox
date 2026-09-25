# Feature Proposals

Status: **In progress — server-side slices are implemented; the approval checklist below remains the rollout order.**

The current implementation now includes the P0 security foundation, draft state transitions and scheduled send processing, structured analysis, thread metadata/reminders, search facets and saved views, encrypted export/validation, automation run history, optional R2 attachment quarantine, and owner-managed users/roles/invitations. UI polish, malware scanning integration, owner recovery, and full multi-user aggregate isolation remain follow-up work.

The current product already has mailbox isolation, full-text search, folders, AI drafting, inbound auto-drafting, hierarchy memory, scoped automations, and a mailbox-scoped MCP server. These proposals prioritize the gaps that improve trust, daily usability, and operational safety without weakening the existing human-in-the-loop model.

## Prioritization

- **P0:** Security or data-loss risk; address before expanding AI autonomy.
- **P1:** High daily-value functionality with a bounded implementation.
- **P2:** Valuable larger investments that require infrastructure or product-model changes.
- **Effort:** S = small, M = medium, L = large, XL = architectural.

## Proposal table

| ID | Priority | Feature | User value | Effort | Main safety boundary |
| --- | --- | --- | --- | --- | --- |
| F1 | P0 | Session hardening and secret rotation | Prevents predictable or stale sessions from becoming an account takeover path. | M | Never fall back to a development secret; rotation invalidates existing sessions. |
| F2 | P0 | Protected external intake and spam quarantine | Makes contact-form and webhook intake safe to expose publicly. | M | Untrusted submissions are rate-limited and quarantined before entering the inbox. |
| F3 | P0 | Security and delivery audit trail | Makes key changes, logins, AI actions, and outbound mail explainable. | M | Store metadata and redact message bodies, tokens, and secrets. |
| F4 | P1 | Draft approval queue and scheduled send | Gives the owner a deliberate review boundary and supports follow-up timing. | M | Sending still requires an explicit approved action; drafts never auto-send. |
| F5 | P1 | AI triage, summaries, and extracted action items | Reduces first-pass inbox sorting and highlights what needs attention. | M | AI output is advisory; email content remains untrusted and cannot alter policy. |
| F6 | P1 | Thread follow-up, snooze, and reminders | Prevents promising conversations from disappearing into the inbox. | S | Reminders are owner-created and never trigger external actions automatically. |
| F7 | P1 | Search upgrades and saved views | Finds messages by meaning, sender history, status, and date combinations. | L | Search results remain mailbox-scoped; embeddings and indexes must be revocable. |
| F8 | P1 | Encrypted export, backup, and restore | Gives self-hosted operators portability and a recovery path. | M | Export is owner-only, encrypted, rate-limited, and never includes secrets by default. |
| F9 | P1 | Automation and AI reliability console | Makes failed rules, model fallbacks, and webhook failures actionable. | M | Expose operational metadata, not mailbox contents or credentials. |
| F10 | P2 | R2 attachment pipeline and safe previews | Adds useful attachments without inflating D1 rows. | L | MIME and size allowlists, malware scanning/quarantine, and short-lived signed URLs. |
| F11 | P2 | Multi-user workspaces and role-based access | Supports teams sharing a deployment without sharing one admin identity. | XL | Default deny; per-mailbox permissions, auditable role changes, and owner recovery controls. |

## Recommended delivery order

### 1. Trust foundation

**F1 — Session hardening and secret rotation**

- Remove any implicit development-secret behavior from authentication paths.
- Require `SESSION_SECRET` for login, setup, API sessions, and agent sessions.
- Pin accepted JWT algorithms to the algorithm used by this application and require `iat`/`exp` claims.
- Add a session version or secret generation so rotation can invalidate all existing cookies.
- Return generic 500 responses for unexpected failures while retaining detailed server-side logs.
- Add login throttling and a visible “sign out all sessions” control.

**Why first:** This protects every other feature and gives the owner a reliable recovery mechanism.

### 2. Safe intake and accountability

**F2 — Protected external intake and spam quarantine**

- Keep the current API-key-authenticated intake path for trusted integrations.
- Add per-mailbox intake keys or signed intake tokens for public forms.
- Apply request-size, rate, origin/referrer, and Turnstile or equivalent bot checks.
- Deliver untrusted submissions to a quarantine folder with a reason and timestamp.
- Let the owner approve, reject, or release a quarantined message into the normal inbox.
- Record the intake source without logging API keys or full message bodies.

**F3 — Security and delivery audit trail**

- Record login success/failure, secret/session rotation, API-key creation/revocation, hierarchy/memory edits, automation changes, draft creation, approval, send, and MCP actions.
- Include actor, mailbox, action, timestamp, result, and a correlation ID.
- Add filtering, retention controls, and CSV/JSON export.
- Keep message bodies, passwords, API keys, SMTP credentials, and owner memory out of audit records.

### 3. Human-in-the-loop productivity

**F4 — Draft approval queue and scheduled send**

- Represent drafts as `needs_review`, `approved`, `scheduled`, `sent`, `rejected`, or `failed`.
- Show the exact recipient, subject, body, attachments, and AI/tool receipt before approval.
- Require a fresh explicit confirmation immediately before sending.
- Add scheduled sends with timezone-aware display, cancel/reschedule, retry limits, and an idempotency key.
- Never let an AI action, automation, or saved draft silently transition to `sent`.

**F5 — AI triage, summaries, and extracted action items**

- Classify messages such as urgent, personal, transactional, newsletter, and low priority.
- Produce a short summary, suggested folder, and action items without moving or sending anything.
- Show confidence and the evidence used; allow one-click apply with undo where safe.
- Run prompt-injection scanning and the 3H policy before presenting or acting on extracted content.
- Keep classification and summaries separate from the existing draft-generation path.

**F6 — Thread follow-up, snooze, and reminders**

- Add thread-level `snoozed_until`, `follow_up_at`, `pinned`, and `next_action` fields.
- Surface “waiting for” versus “waiting on me” separately.
- Create reminders from an explicit owner command in chat or the UI.
- Respect mailbox scope and keep reminders local to the selected mailbox unless explicitly shared.

### 4. Portability and scale

**F7 — Search upgrades and saved views**

- Add indexed search facets for mailbox, folder, sender, date range, read/starred state, thread, and attachment status.
- Evaluate semantic search with a revocable index; do not make embeddings a source of authorization.
- Add saved searches that store query, scope, sort order, and refresh policy.
- Return citations to the matching messages and keep every result inside the authorized mailbox scope.

**F8 — Encrypted export, backup, and restore**

- Export individual mailboxes as EML/MBOX plus a manifest, and provide a full encrypted workspace archive.
- Include settings, folders, messages, hierarchy, memory, automations, and API-key metadata; exclude raw secrets by default.
- Encrypt archives with a user-supplied passphrase that is never stored by the Worker.
- Add restore validation, dry-run mode, conflict handling, and a recovery checklist.

**F9 — Automation and AI reliability console**

- Show rule match counts, last-run status, action failures, and dead-lettered webhook events.
- Track AI model, latency, fallback count, timeout, and policy-review failures without logging prompts or email bodies by default.
- Add bounded retries with exponential backoff and a manual replay action.
- Require owner approval before replaying an action that could send, forward, or mutate mailbox data.

**F10 — R2 attachment pipeline and safe previews**

- Store attachment bytes in R2 and metadata in D1 instead of embedding payloads in email rows.
- Enforce per-mailbox and per-message size limits plus MIME allowlists.
- Quarantine unknown or unsafe types until an owner releases them.
- Use short-lived, mailbox-scoped signed URLs; never expose an R2 bucket publicly.
- Show scanning status and preserve the original filename/type metadata for auditability.

**F11 — Multi-user workspaces and role-based access**

- Add users, invitations, roles, and per-mailbox permissions without removing the owner boundary.
- Start with `owner`, `operator`, and `read-only` roles, then expand only if needed.
- Require re-authentication or owner approval for secret changes, key creation, sends, and destructive actions.
- Log every permission change and provide an emergency owner-recovery path.

## Non-negotiable product rules

- The agent may propose and draft, but sending remains an explicit owner action.
- Email bodies, subjects, sender names, and tool results remain untrusted data.
- Owner memory and policy remain read-only to the agent.
- Mailbox, group, and API-key scope checks run server-side for every operation.
- Missing security configuration must fail closed rather than use a development fallback.
- New AI features must expose uncertainty and preserve an auditable explanation of what happened.

## Approval checklist

Mark each item **Approve**, **Defer**, or **Modify** before implementation begins.

- [ ] F1 — Session hardening and secret rotation
- [ ] F2 — Protected external intake and spam quarantine
- [ ] F3 — Security and delivery audit trail
- [ ] F4 — Draft approval queue and scheduled send
- [ ] F5 — AI triage, summaries, and extracted action items
- [ ] F6 — Thread follow-up, snooze, and reminders
- [ ] F7 — Search upgrades and saved views
- [ ] F8 — Encrypted export, backup, and restore
- [ ] F9 — Automation and AI reliability console
- [ ] F10 — R2 attachment pipeline and safe previews
- [ ] F11 — Multi-user workspaces and role-based access

## Current implementation status

- [x] F1 — Session fail-closed verification, secure secret validation, login throttling, origin checks, session versioning, sign-out-all, and internal agent callback auth
- [x] F2 — Intake token, body/rate limits, quarantine folder, no public automations, and header-only external API keys
- [x] F3 — Audit table, redacted event writer, owner-only listing/export, and key action instrumentation
- [x] F4 — Draft state machine, owner approval, idempotent send service, scheduled cron processing, and UI send gating
- [x] F5 — Structured advisory analysis, injection gate, persistence, apply, and undo
- [x] F6 — Thread metadata, snooze/follow-up/pin fields, reminders, and due-listing API
- [x] F7 — Server-side search facets, snippets, saved searches, and scoped citations
- [x] F8 — Mailbox export, encrypted workspace backup, and decrypt/validate endpoint
- [x] F9 — Automation run history and owner-only reliability data API
- [x] F10 — Optional R2 binding, MIME/size policy, quarantine/manual release, and authorized download route
- [x] F11 — Users, roles, invitations, mailbox permissions, aggregate blocking, and hashed API keys

Remaining hardening work is tracked explicitly: malware scanner integration, owner recovery, MCP capability migration, full UI surfaces, and destructive restore semantics.
