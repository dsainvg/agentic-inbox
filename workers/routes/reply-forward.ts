// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { MailboxContext } from "../lib/mailbox";
import { ensureDbInitialized } from "../db/init";
import { Folders } from "../../shared/folders";

type AppContext = Context<MailboxContext>;

export async function handleReplyEmail(c: AppContext) {
	const mailboxId = c.req.param("mailboxId") ?? "";
	const body = await c.req.json().catch(() => ({}));
	const { to, subject, html, text } = body;

	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });

	const messageId = crypto.randomUUID();
	await db.insert(schema.emails).values({
		id: messageId,
		mailbox_id: mailboxId.toLowerCase(),
		folder_id: Folders.SENT,
		subject: subject || "Re: Reply",
		sender: mailboxId.toLowerCase(),
		recipient: typeof to === "string" ? to : JSON.stringify(to || ""),
		date: new Date().toISOString(),
		body: html || text || "",
		read: 1,
		starred: 0,
	});

	return c.json({ id: messageId, status: "saved_in_d1", note: "Direct sending disabled. Saved to D1." }, 202);
}

export async function handleForwardEmail(c: AppContext) {
	const mailboxId = c.req.param("mailboxId") ?? "";
	const body = await c.req.json().catch(() => ({}));
	const { to, subject, html, text } = body;

	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });

	const messageId = crypto.randomUUID();
	await db.insert(schema.emails).values({
		id: messageId,
		mailbox_id: mailboxId.toLowerCase(),
		folder_id: Folders.SENT,
		subject: subject || "Fwd: Forwarded",
		sender: mailboxId.toLowerCase(),
		recipient: typeof to === "string" ? to : JSON.stringify(to || ""),
		date: new Date().toISOString(),
		body: html || text || "",
		read: 1,
		starred: 0,
	});

	return c.json({ id: messageId, status: "saved_in_d1", note: "Direct sending disabled. Saved to D1." }, 202);
}
