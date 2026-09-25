import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { Folders } from "../../shared/folders";
import { sendSmtpEmail } from "./smtp";
import { recordAuditEvent } from "./audit";
import { ensureDbInitialized } from "../db/init";
import type { Env } from "../types";

export async function sendApprovedDraft(env: Env, mailboxId: string, draftId: string, idempotencyKey: string) {
	if (!idempotencyKey || idempotencyKey.length > 200) throw new Error("A valid idempotency key is required");
	const db = drizzle(env.DB, { schema });
	const existing = await db.select().from(schema.emails).where(and(eq(schema.emails.id, draftId), eq(schema.emails.mailbox_id, mailboxId), eq(schema.emails.folder_id, Folders.DRAFT))).limit(1);
	const draft = existing[0];
	if (!draft) throw new Error("Draft not found");
	if (draft.draft_status === "sent" && draft.idempotency_key === idempotencyKey) return { status: "sent", draftId };
	if (draft.draft_status !== "approved" && draft.draft_status !== "scheduled") throw new Error("Draft must be approved before sending");
	if (!draft.recipient) throw new Error("Draft has no recipient");
	const attempts = draft.send_attempts + 1;
	try {
		const result = await sendSmtpEmail({
			host: env.SMTP_HOST,
			port: env.SMTP_PORT,
			user: env.SMTP_USER,
			pass: env.SMTP_PASS,
			from: draft.sender || mailboxId,
			to: draft.recipient,
			cc: draft.cc || undefined,
			bcc: draft.bcc || undefined,
			subject: draft.subject || "",
			html: draft.body || "",
			headers: { "X-Agentic-Inbox-Draft": draftId },
		});
		const sentId = crypto.randomUUID();
		await db.transaction(async (tx) => {
			await tx.insert(schema.emails).values({
				id: sentId,
				mailbox_id: mailboxId,
				folder_id: Folders.SENT,
				subject: draft.subject,
				sender: draft.sender,
				recipient: draft.recipient,
				cc: draft.cc,
				bcc: draft.bcc,
				date: new Date().toISOString(),
				body: draft.body,
				read: 1,
				starred: 0,
				in_reply_to: draft.in_reply_to,
				thread_id: draft.thread_id || draftId,
				message_id: result.messageId,
				raw_headers: JSON.stringify({ draftId, idempotencyKey }),
				draft_status: "sent",
				sent_at: new Date().toISOString(),
				send_attempts: attempts,
				idempotency_key: idempotencyKey,
			});
			await tx.update(schema.emails).set({ draft_status: "sent", sent_at: new Date().toISOString(), send_attempts: attempts, last_send_error: null, idempotency_key: idempotencyKey }).where(and(eq(schema.emails.id, draftId), eq(schema.emails.mailbox_id, mailboxId), eq(schema.emails.folder_id, Folders.DRAFT)));
		});
		await recordAuditEvent(env.DB, { actorId: "admin", action: "draft.sent", mailboxId, targetType: "email", targetId: draftId, metadata: { status: "sent" } });
		return { status: "sent", draftId, sentId, messageId: result.messageId };
	} catch (error) {
		await db.update(schema.emails).set({ draft_status: "failed", send_attempts: attempts, last_send_error: "SMTP delivery failed" }).where(and(eq(schema.emails.id, draftId), eq(schema.emails.mailbox_id, mailboxId), eq(schema.emails.folder_id, Folders.DRAFT)));
		await recordAuditEvent(env.DB, { actorId: "admin", action: "draft.sent", mailboxId, targetType: "email", targetId: draftId, result: "failure", metadata: { status: "failed" } });
		throw error;
	}
}

export async function processScheduledDrafts(env: Env): Promise<void> {
	await ensureDbInitialized(env.DB);
	const rows = await env.DB.prepare("SELECT id, mailbox_id FROM emails WHERE folder_id = 'draft' AND draft_status = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 50").bind(new Date().toISOString()).all<{ id: string; mailbox_id: string }>();
	for (const row of rows.results) {
		try {
			await sendApprovedDraft(env, row.mailbox_id, row.id, `scheduled:${row.id}`);
		} catch (error) {
			console.error("Scheduled draft send failed", { mailboxId: row.mailbox_id, draftId: row.id, message: error instanceof Error ? error.message : String(error) });
		}
	}
}
