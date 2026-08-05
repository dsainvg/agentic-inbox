// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, asc } from "drizzle-orm";
import * as schema from "../db/schema";
import type { MailboxContext } from "../lib/mailbox";
import { ensureDbInitialized } from "../db/init";
import { Folders } from "../../shared/folders";

type AppContext = Context<MailboxContext>;

function parseRecipientString(rec: unknown): string {
	if (!rec) return "";
	if (typeof rec === "string") return rec;
	if (typeof rec === "object" && rec !== null && "email" in rec) {
		return (rec as { email: string }).email;
	}
	if (Array.isArray(rec)) {
		return rec
			.map((item) => (typeof item === "string" ? item : item?.email || ""))
			.filter(Boolean)
			.join(", ");
	}
	return String(rec);
}

export async function handleSendEmail(c: AppContext) {
	const mailboxId = (c.req.param("mailboxId") ?? "").toLowerCase();
	const body = await c.req.json().catch(() => ({}));
	const { to, cc, bcc, subject, html, text } = body;

	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });

	const recipientStr = parseRecipientString(to);
	const ccStr = parseRecipientString(cc);
	const bccStr = parseRecipientString(bcc);
	const messageId = crypto.randomUUID();

	await db.insert(schema.emails).values({
		id: messageId,
		mailbox_id: mailboxId,
		folder_id: Folders.SENT,
		subject: subject || "(no subject)",
		sender: mailboxId,
		recipient: recipientStr,
		cc: ccStr || null,
		bcc: bccStr || null,
		date: new Date().toISOString(),
		body: html || text || "",
		read: 1,
		starred: 0,
		thread_id: messageId,
		message_id: messageId,
	});

	return c.json({ id: messageId, status: "saved_in_d1", note: "Saved in D1 SENT folder." }, 201);
}

export async function handleReplyEmail(c: AppContext) {
	const mailboxId = (c.req.param("mailboxId") ?? "").toLowerCase();
	const originalEmailId = c.req.param("id") ?? "";
	const body = await c.req.json().catch(() => ({}));
	const { to, cc, bcc, subject, html, text } = body;

	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });

	const origRows = await db
		.select()
		.from(schema.emails)
		.where(
			and(
				eq(schema.emails.id, originalEmailId),
				eq(schema.emails.mailbox_id, mailboxId),
			),
		)
		.limit(1);

	const origEmail = origRows[0];
	const inReplyTo = origEmail?.message_id || origEmail?.id || originalEmailId;
	const threadId = origEmail?.thread_id || origEmail?.id || crypto.randomUUID();

	let references: string[] = [];
	if (origEmail?.email_references) {
		try {
			references = JSON.parse(origEmail.email_references);
		} catch {}
	}
	if (inReplyTo && !references.includes(inReplyTo)) {
		references.push(inReplyTo);
	}

	const recipientStr = parseRecipientString(to) || origEmail?.sender || "";
	const ccStr = parseRecipientString(cc);
	const bccStr = parseRecipientString(bcc);
	const messageId = crypto.randomUUID();

	await db.insert(schema.emails).values({
		id: messageId,
		mailbox_id: mailboxId,
		folder_id: Folders.SENT,
		subject: subject || `Re: ${origEmail?.subject || ""}`,
		sender: mailboxId,
		recipient: recipientStr,
		cc: ccStr || null,
		bcc: bccStr || null,
		date: new Date().toISOString(),
		body: html || text || "",
		read: 1,
		starred: 0,
		in_reply_to: inReplyTo,
		thread_id: threadId,
		email_references: JSON.stringify(references),
		message_id: messageId,
	});

	return c.json({ id: messageId, status: "saved_in_d1", note: "Saved in D1 SENT folder." }, 201);
}

export async function handleForwardEmail(c: AppContext) {
	const mailboxId = (c.req.param("mailboxId") ?? "").toLowerCase();
	const originalEmailId = c.req.param("id") ?? "";
	const body = await c.req.json().catch(() => ({}));
	const { to, cc, bcc, subject, html, text } = body;

	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });

	const origRows = await db
		.select()
		.from(schema.emails)
		.where(
			and(
				eq(schema.emails.id, originalEmailId),
				eq(schema.emails.mailbox_id, mailboxId),
			),
		)
		.limit(1);

	const origEmail = origRows[0];
	const recipientStr = parseRecipientString(to);
	const ccStr = parseRecipientString(cc);
	const bccStr = parseRecipientString(bcc);
	const messageId = crypto.randomUUID();

	await db.insert(schema.emails).values({
		id: messageId,
		mailbox_id: mailboxId,
		folder_id: Folders.SENT,
		subject: subject || `Fwd: ${origEmail?.subject || ""}`,
		sender: mailboxId,
		recipient: recipientStr,
		cc: ccStr || null,
		bcc: bccStr || null,
		date: new Date().toISOString(),
		body: html || text || "",
		read: 1,
		starred: 0,
		thread_id: messageId,
		message_id: messageId,
	});

	return c.json({ id: messageId, status: "saved_in_d1", note: "Saved in D1 SENT folder." }, 201);
}

export async function handleSaveDraft(c: AppContext) {
	const mailboxId = (c.req.param("mailboxId") ?? "").toLowerCase();
	const body = await c.req.json().catch(() => ({}));
	const { draft_id, to, cc, bcc, subject, body: emailBody, in_reply_to, thread_id } = body;

	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });

	const recipientStr = parseRecipientString(to);
	const ccStr = parseRecipientString(cc);
	const bccStr = parseRecipientString(bcc);
	const targetDraftId = draft_id || crypto.randomUUID();

	const existing = await db
		.select()
		.from(schema.emails)
		.where(
			and(
				eq(schema.emails.id, targetDraftId),
				eq(schema.emails.mailbox_id, mailboxId),
			),
		)
		.limit(1);

	if (existing.length > 0) {
		await db
			.update(schema.emails)
			.set({
				recipient: recipientStr,
				cc: ccStr || null,
				bcc: bccStr || null,
				subject: subject || "",
				body: emailBody || "",
				date: new Date().toISOString(),
				in_reply_to: in_reply_to || existing[0].in_reply_to,
				thread_id: thread_id || existing[0].thread_id,
			})
			.where(
				and(
					eq(schema.emails.id, targetDraftId),
					eq(schema.emails.mailbox_id, mailboxId),
				),
			);
	} else {
		await db.insert(schema.emails).values({
			id: targetDraftId,
			mailbox_id: mailboxId,
			folder_id: Folders.DRAFT,
			subject: subject || "",
			sender: mailboxId,
			recipient: recipientStr,
			cc: ccStr || null,
			bcc: bccStr || null,
			date: new Date().toISOString(),
			body: emailBody || "",
			read: 1,
			starred: 0,
			in_reply_to: in_reply_to || null,
			thread_id: thread_id || targetDraftId,
		});
	}

	return c.json({ draft_id: targetDraftId }, 201);
}

export async function handleGetThread(c: AppContext) {
	const mailboxId = (c.req.param("mailboxId") ?? "").toLowerCase();
	const threadId = c.req.param("threadId") ?? "";

	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });

	const rows = await db
		.select()
		.from(schema.emails)
		.where(
			and(
				eq(schema.emails.mailbox_id, mailboxId),
				eq(schema.emails.thread_id, threadId),
			),
		)
		.orderBy(asc(schema.emails.date));

	return c.json(
		rows.map((e) => ({
			...e,
			read: Boolean(e.read),
			starred: Boolean(e.starred),
		})),
	);
}

export async function handleMarkThreadRead(c: AppContext) {
	const mailboxId = (c.req.param("mailboxId") ?? "").toLowerCase();
	const threadId = c.req.param("threadId") ?? "";

	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });

	await db
		.update(schema.emails)
		.set({ read: 1 })
		.where(
			and(
				eq(schema.emails.mailbox_id, mailboxId),
				eq(schema.emails.thread_id, threadId),
			),
		);

	return c.json({ status: "ok" });
}
