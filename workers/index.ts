// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import PostalMime from "postal-mime";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, like, or, count, desc, asc } from "drizzle-orm";

import { Folders } from "../shared/folders";
import type { Env } from "./types";
import { requireMailbox, type MailboxContext } from "./lib/mailbox";
import { ensureDbInitialized } from "./db/init";
import * as schema from "./db/schema";
import { generateApiKey, listApiKeys, revokeApiKey, validateApiKey } from "./lib/api-keys";

type AppContext = Context<MailboxContext>;

const CreateMailboxBody = z.object({
	email: z.string().email(),
	name: z.string().min(1),
	forwardTo: z.string().email().optional().or(z.literal("")),
	settings: z.record(z.any()).optional(),
});

function slugify(text: string) {
	return text
		.toString()
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^\w-]+/g, "")
		.replace(/--+/g, "-")
		.replace(/^-+/, "")
		.replace(/-+$/, "");
}

function intQuery(c: AppContext | Context, key: string): number | undefined {
	const v = c.req.query(key);
	if (!v) return undefined;
	const n = Number(v);
	return Number.isNaN(n) ? undefined : n;
}

function isDomainAllowed(email: string, envDomainsRaw?: string): boolean {
	if (!envDomainsRaw) return true;
	const allowed = envDomainsRaw
		.split(",")
		.map((d) => d.trim().toLowerCase())
		.filter(Boolean);
	if (allowed.length === 0) return true;

	const parts = email.toLowerCase().split("@");
	if (parts.length < 2) return false;
	const emailDomain = parts[1];

	return allowed.some(
		(domain) => emailDomain === domain || emailDomain.endsWith(`.${domain}`),
	);
}

const app = new Hono<MailboxContext>();

app.use(
	"/api/*",
	cors({
		origin: (origin) => {
			if (!origin) return origin;
			try {
				const url = new URL(origin);
				if (url.hostname === "localhost" || url.hostname === "127.0.0.1")
					return origin;
			} catch {}
			return undefined;
		},
	}),
);

app.use("/api/v1/mailboxes/:mailboxId/*", requireMailbox);

// -- Config ---------------------------------------------------------

app.get("/api/v1/config", (c) => {
	const domainsRaw = c.env.DOMAINS || "";
	const domains = domainsRaw
		.split(",")
		.map((d) => d.trim())
		.filter(Boolean);
	const emailAddresses = c.env.EMAIL_ADDRESSES ?? [];
	return c.json({ domains, emailAddresses });
});

// -- Mailboxes (D1) -------------------------------------------------

app.get("/api/v1/mailboxes", async (c) => {
	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });
	const rows = await db.select().from(schema.mailboxes);

	return c.json(
		rows.map((m) => ({
			id: m.id,
			email: m.email,
			name: m.name,
			forwardTo: m.forward_to,
			settings: m.settings ? JSON.parse(m.settings) : {},
		})),
	);
});

app.post("/api/v1/mailboxes", async (c) => {
	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });

	const { name, settings, email: rawEmail, forwardTo } = CreateMailboxBody.parse(
		await c.req.json(),
	);
	const email = rawEmail.toLowerCase();

	if (!isDomainAllowed(email, c.env.DOMAINS)) {
		return c.json({ error: "Email domain is not in configured DOMAINS list" }, 403);
	}

	const existing = await db
		.select()
		.from(schema.mailboxes)
		.where(eq(schema.mailboxes.id, email))
		.limit(1);

	if (existing.length > 0) {
		return c.json({ error: "Mailbox already exists" }, 409);
	}

	const defaultSettings = {
		fromName: name,
		agentSystemPrompt: "",
	};
	const finalSettings = { ...defaultSettings, ...settings };
	const now = new Date().toISOString();

	await db.insert(schema.mailboxes).values({
		id: email,
		email,
		name,
		forward_to: forwardTo || null,
		settings: JSON.stringify(finalSettings),
		created_at: now,
	});

	// Create default system folders
	const defaultFolders = [
		Folders.INBOX,
		Folders.SENT,
		Folders.DRAFT,
		Folders.ARCHIVE,
		Folders.TRASH,
	];
	for (const fName of defaultFolders) {
		await db.insert(schema.folders).values({
			id: `${email}:${fName}`,
			mailbox_id: email,
			name: fName,
			is_deletable: fName === Folders.INBOX ? 0 : 1,
		});
	}

	return c.json(
		{
			id: email,
			email,
			name,
			forwardTo: forwardTo || null,
			settings: finalSettings,
		},
		201,
	);
});

app.get("/api/v1/mailboxes/:mailboxId", async (c) => {
	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();

	const rows = await db
		.select()
		.from(schema.mailboxes)
		.where(eq(schema.mailboxes.id, mailboxId))
		.limit(1);

	if (rows.length === 0) return c.json({ error: "Not found" }, 404);

	const m = rows[0];
	return c.json({
		id: m.id,
		email: m.email,
		name: m.name,
		forwardTo: m.forward_to,
		settings: m.settings ? JSON.parse(m.settings) : {},
	});
});

app.put("/api/v1/mailboxes/:mailboxId", async (c) => {
	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();

	const body = (await c.req.json()) as {
		name?: string;
		forwardTo?: string;
		settings?: Record<string, unknown>;
	};

	const rows = await db
		.select()
		.from(schema.mailboxes)
		.where(eq(schema.mailboxes.id, mailboxId))
		.limit(1);

	if (rows.length === 0) return c.json({ error: "Not found" }, 404);

	const existing = rows[0];
	const updatedSettings = body.settings
		? JSON.stringify(body.settings)
		: existing.settings;
	const updatedName = body.name || existing.name;
	const updatedForwardTo =
		body.forwardTo !== undefined ? body.forwardTo : existing.forward_to;

	await db
		.update(schema.mailboxes)
		.set({
			name: updatedName,
			forward_to: updatedForwardTo || null,
			settings: updatedSettings,
		})
		.where(eq(schema.mailboxes.id, mailboxId));

	return c.json({
		id: mailboxId,
		email: mailboxId,
		name: updatedName,
		forwardTo: updatedForwardTo || null,
		settings: updatedSettings ? JSON.parse(updatedSettings) : {},
	});
});

app.delete("/api/v1/mailboxes/:mailboxId", async (c) => {
	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();

	await db.delete(schema.mailboxes).where(eq(schema.mailboxes.id, mailboxId));
	return c.body(null, 204);
});

// -- API Key Management ---------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/api-keys", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const keys = await listApiKeys(c.env, mailboxId);
	return c.json(keys);
});

app.post("/api/v1/mailboxes/:mailboxId/api-keys", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const body = (await c.req.json().catch(() => ({}))) as { name?: string };
	const name = body.name?.trim();
	if (!name)
		return c.json({ error: "Key description / name is required" }, 400);

	const record = await generateApiKey(c.env, mailboxId, name);
	return c.json(record, 201);
});

app.delete("/api/v1/mailboxes/:mailboxId/api-keys/:keyId", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const keyId = c.req.param("keyId")!;
	const success = await revokeApiKey(c.env, mailboxId, keyId);
	if (!success) return c.json({ error: "API Key not found" }, 404);
	return c.body(null, 204);
});

// -- External GET API (Authenticated via API Key - D1) --------------

app.get("/api/v1/external/messages", async (c) => {
	const authHeader = c.req.header("authorization") || "";
	const bearerKey = authHeader.toLowerCase().startsWith("bearer ")
		? authHeader.substring(7).trim()
		: undefined;
	const apiKey = c.req.query("apiKey") || c.req.header("x-api-key") || bearerKey;

	if (!apiKey) {
		return c.json(
			{
				error:
					"Missing API Key. Provide via ?apiKey= query parameter, X-API-Key header, or Authorization: Bearer <key>",
			},
			401,
		);
	}

	const validated = await validateApiKey(c.env, apiKey);
	if (!validated) {
		return c.json({ error: "Invalid API Key" }, 401);
	}

	const { mailboxId } = validated;
	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });

	const emailId = c.req.query("id");
	const folder = c.req.query("folder") || Folders.INBOX;
	const page = Math.max(Number(c.req.query("page")) || 1, 1);
	const limit = Math.min(Math.max(Number(c.req.query("limit")) || 10, 1), 50);

	if (emailId) {
		const rows = await db
			.select()
			.from(schema.emails)
			.where(
				and(
					eq(schema.emails.id, emailId),
					eq(schema.emails.mailbox_id, mailboxId.toLowerCase()),
				),
			)
			.limit(1);

		if (rows.length === 0) return c.json({ error: "Email not found" }, 404);

		const email = rows[0];
		return c.json({
			mailbox: mailboxId,
			email: {
				id: email.id,
				from: email.sender,
				subject: email.subject,
				body: email.body,
				date: email.date,
				read: Boolean(email.read),
				starred: Boolean(email.starred),
				recipient: email.recipient,
			},
		});
	}

	const offset = (page - 1) * limit;

	const emailRows = await db
		.select()
		.from(schema.emails)
		.where(
			and(
				eq(schema.emails.mailbox_id, mailboxId.toLowerCase()),
				eq(schema.emails.folder_id, folder),
			),
		)
		.orderBy(desc(schema.emails.date))
		.limit(limit)
		.offset(offset);

	const totalCountResult = await db
		.select({ count: count() })
		.from(schema.emails)
		.where(
			and(
				eq(schema.emails.mailbox_id, mailboxId.toLowerCase()),
				eq(schema.emails.folder_id, folder),
			),
		);

	const totalCount = totalCountResult[0]?.count || 0;

	return c.json({
		mailbox: mailboxId,
		totalCount,
		page,
		limit,
		emails: emailRows.map((e) => ({
			id: e.id,
			from: e.sender,
			subject: e.subject,
			body: e.body,
			date: e.date,
			read: Boolean(e.read),
			starred: Boolean(e.starred),
			recipient: e.recipient,
		})),
	});
});

// -- Emails (D1) ----------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();

	const folder = c.req.query("folder") || Folders.INBOX;
	const page = Math.max(intQuery(c, "page") || 1, 1);
	const limit = Math.min(intQuery(c, "limit") || 25, 100);
	const offset = (page - 1) * limit;

	const emailRows = await db
		.select()
		.from(schema.emails)
		.where(
			and(
				eq(schema.emails.mailbox_id, mailboxId),
				eq(schema.emails.folder_id, folder),
			),
		)
		.orderBy(desc(schema.emails.date))
		.limit(limit)
		.offset(offset);

	const totalCountResult = await db
		.select({ count: count() })
		.from(schema.emails)
		.where(
			and(
				eq(schema.emails.mailbox_id, mailboxId),
				eq(schema.emails.folder_id, folder),
			),
		);

	const totalCount = totalCountResult[0]?.count || 0;

	return c.json({
		emails: emailRows.map((e) => ({
			...e,
			read: Boolean(e.read),
			starred: Boolean(e.starred),
		})),
		totalCount,
	});
});

app.get("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();
	const emailId = c.req.param("id")!;

	const rows = await db
		.select()
		.from(schema.emails)
		.where(
			and(
				eq(schema.emails.id, emailId),
				eq(schema.emails.mailbox_id, mailboxId),
			),
		)
		.limit(1);

	if (rows.length === 0) return c.json({ error: "Email not found" }, 404);

	const email = rows[0];
	return c.json({
		...email,
		read: Boolean(email.read),
		starred: Boolean(email.starred),
		attachments: [],
	});
});

app.put("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();
	const emailId = c.req.param("id")!;

	const { read, starred } = (await c.req.json()) as {
		read?: boolean;
		starred?: boolean;
	};

	const updateData: Record<string, unknown> = {};
	if (read !== undefined) updateData.read = read ? 1 : 0;
	if (starred !== undefined) updateData.starred = starred ? 1 : 0;

	await db
		.update(schema.emails)
		.set(updateData)
		.where(
			and(
				eq(schema.emails.id, emailId),
				eq(schema.emails.mailbox_id, mailboxId),
			),
		);

	const rows = await db
		.select()
		.from(schema.emails)
		.where(
			and(
				eq(schema.emails.id, emailId),
				eq(schema.emails.mailbox_id, mailboxId),
			),
		)
		.limit(1);

	if (rows.length === 0) return c.json({ error: "Email not found" }, 404);
	const email = rows[0];
	return c.json({
		...email,
		read: Boolean(email.read),
		starred: Boolean(email.starred),
	});
});

app.delete("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();
	const emailId = c.req.param("id")!;

	await db
		.delete(schema.emails)
		.where(
			and(
				eq(schema.emails.id, emailId),
				eq(schema.emails.mailbox_id, mailboxId),
			),
		);

	return c.body(null, 204);
});

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/move", async (c: AppContext) => {
	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();
	const emailId = c.req.param("id")!;
	const { folderId } = (await c.req.json()) as { folderId: string };

	await db
		.update(schema.emails)
		.set({ folder_id: folderId })
		.where(
			and(
				eq(schema.emails.id, emailId),
				eq(schema.emails.mailbox_id, mailboxId),
			),
		);

	return c.json({ status: "moved" });
});

// -- Folders (D1) ---------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/folders", async (c: AppContext) => {
	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();

	const rows = await db
		.select()
		.from(schema.folders)
		.where(eq(schema.folders.mailbox_id, mailboxId));

	return c.json(
		rows.map((f) => ({
			id: f.name,
			name: f.name,
			unreadCount: 0,
		})),
	);
});

// -- Search (D1) ----------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/search", async (c: AppContext) => {
	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();

	const queryStr = c.req.query("query") || "";
	const page = Math.max(intQuery(c, "page") || 1, 1);
	const limit = Math.min(intQuery(c, "limit") || 25, 100);
	const offset = (page - 1) * limit;

	const searchFilter = and(
		eq(schema.emails.mailbox_id, mailboxId),
		or(
			like(schema.emails.subject, `%${queryStr}%`),
			like(schema.emails.body, `%${queryStr}%`),
			like(schema.emails.sender, `%${queryStr}%`),
		),
	);

	const emailRows = await db
		.select()
		.from(schema.emails)
		.where(searchFilter)
		.orderBy(desc(schema.emails.date))
		.limit(limit)
		.offset(offset);

	const totalCountResult = await db
		.select({ count: count() })
		.from(schema.emails)
		.where(searchFilter);

	const totalCount = totalCountResult[0]?.count || 0;

	return c.json({
		emails: emailRows.map((e) => ({
			...e,
			read: Boolean(e.read),
			starred: Boolean(e.starred),
		})),
		totalCount,
	});
});

// -- Inbound Email Handler with Forwarding & D1 Persistence ---------

const MAX_EMAIL_SIZE = 25 * 1024 * 1024;

async function streamToArrayBuffer(
	stream: ReadableStream,
	streamSize: number,
) {
	if (streamSize > MAX_EMAIL_SIZE)
		throw new Error(
			`Email too large: ${streamSize} bytes exceeds ${MAX_EMAIL_SIZE} byte limit`,
		);
	if (streamSize <= 0) throw new Error(`Invalid stream size: ${streamSize}`);
	const result = new Uint8Array(streamSize);
	let bytesRead = 0;
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (bytesRead + value.length > streamSize) {
			reader.cancel();
			throw new Error(`Stream exceeds declared size`);
		}
		result.set(value, bytesRead);
		bytesRead += value.length;
	}
	return result;
}

export interface InboundEmailEvent {
	raw: ReadableStream;
	rawSize: number;
	forward?: (rcptTo: string) => Promise<void>;
}

async function receiveEmail(
	event: InboundEmailEvent,
	env: Env,
	ctx: ExecutionContext,
) {
	await ensureDbInitialized(env.DB);
	const db = drizzle(env.DB, { schema });

	const rawEmail = await streamToArrayBuffer(event.raw, event.rawSize);
	const parsedEmail = await new PostalMime().parse(rawEmail);

	if (!parsedEmail.to?.length || !parsedEmail.to[0].address)
		throw new Error("received email with empty to");

	const allowedAddresses = (
		(env.EMAIL_ADDRESSES ?? []) as string[]
	).map((a) => a.toLowerCase());
	const allRecipients = parsedEmail.to
		.map((t) => t.address?.toLowerCase())
		.filter(Boolean) as string[];

	let mailboxId: string | undefined;
	if (allowedAddresses.length > 0) {
		mailboxId = allRecipients.find((addr) => allowedAddresses.includes(addr));
		if (!mailboxId) {
			console.log(`Ignoring email: no recipient matches EMAIL_ADDRESSES.`);
			return;
		}
	} else {
		mailboxId = allRecipients[0];
	}
	if (!mailboxId)
		throw new Error("received email with no valid recipient address");

	// Verify mailbox exists in D1
	const mailboxRows = await db
		.select()
		.from(schema.mailboxes)
		.where(eq(schema.mailboxes.id, mailboxId))
		.limit(1);

	if (mailboxRows.length === 0) {
		console.log(
			`Ignoring email for ${mailboxId}: mailbox does not exist in D1`,
		);
		return;
	}

	const mailboxRecord = mailboxRows[0];
	const messageId = crypto.randomUUID();

	const extractMsgId = (s: string) => {
		const m = s.match(/<([^>]+)>/);
		return m ? m[1] : s.trim().split(/\s+/)[0];
	};
	const inReplyTo = parsedEmail.inReplyTo
		? extractMsgId(parsedEmail.inReplyTo)
		: null;
	const emailReferences = parsedEmail.references
		? parsedEmail.references.split(/\s+/).filter(Boolean).map(extractMsgId)
		: [];
	const threadId = emailReferences[0] || inReplyTo || messageId;
	const originalMessageId = parsedEmail.messageId
		? extractMsgId(parsedEmail.messageId)
		: null;

	// 1. Store email in D1 (NO ATTACHMENTS stored)
	await db.insert(schema.emails).values({
		id: messageId,
		mailbox_id: mailboxId,
		folder_id: Folders.INBOX,
		subject: parsedEmail.subject || "",
		sender: (parsedEmail.from?.address || "").toLowerCase(),
		recipient: allRecipients.join(", "),
		cc:
			(parsedEmail.cc || [])
				.map((e) => e.address?.toLowerCase())
				.filter(Boolean)
				.join(", ") || null,
		bcc:
			(parsedEmail.bcc || [])
				.map((e) => e.address?.toLowerCase())
				.filter(Boolean)
				.join(", ") || null,
		date: new Date().toISOString(),
		body: parsedEmail.html || parsedEmail.text || "",
		read: 0,
		starred: 0,
		in_reply_to: inReplyTo,
		email_references:
			emailReferences.length > 0 ? JSON.stringify(emailReferences) : null,
		thread_id: threadId,
		message_id: originalMessageId,
		raw_headers: JSON.stringify(parsedEmail.headers),
	});

	// 2. Email Forwarding: forward if forward_to is configured or forward event is available
	const forwardAddress = mailboxRecord.forward_to;
	if (forwardAddress && typeof event.forward === "function") {
		try {
			await event.forward(forwardAddress);
			console.log(`Forwarded incoming email for ${mailboxId} to ${forwardAddress}`);
		} catch (e) {
			console.error(`Failed to forward email to ${forwardAddress}:`, (e as Error).message);
		}
	}
}

export { app, receiveEmail };
