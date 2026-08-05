// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { SignJWT, jwtVerify } from "jose";
import { hashPassword, generateSalt, verifyPassword, makePasswordHash } from "./lib/crypto";
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
import {
	handleSendEmail,
	handleReplyEmail,
	handleForwardEmail,
	handleSaveDraft,
	handleGetThread,
	handleMarkThreadRead,
} from "./routes/reply-forward";



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
		.map((d) => d.trim().toLowerCase().replace(/^[*.]+/g, ""))
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

app.onError((err, c) => {
	console.error("API Error:", err);
	return c.json({ error: err.message || "Internal Server Error" }, 500);
});

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

// -- Auth (D1) ------------------------------------------------------

app.get("/api/v1/auth/me", async (c) => {
	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });
	
	// Check if a user exists in the database
	const existingUsers = await db.select().from(schema.users).limit(1);
	const setupRequired = existingUsers.length === 0;

	// Check if already authenticated by looking at the session cookie
	const cookie = getCookie(c, "session");
	let authenticated = false;
	if (cookie) {
		try {
			const secret = new TextEncoder().encode(c.env.SESSION_SECRET || "default_session_secret_change_me");
			await jwtVerify(cookie, secret);
			authenticated = true;
		} catch {}
	}

	return c.json({ authenticated, setupRequired });
});

app.post("/api/v1/auth/setup", async (c) => {
	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });
	
	// Check if user table is already populated
	const existingUsers = await db.select().from(schema.users).limit(1);
	if (existingUsers.length > 0) {
		return c.json({ error: "Setup already completed" }, 400);
	}

	const body = await c.req.json().catch(() => ({}));
	const password = body.password;
	if (!password || typeof password !== "string" || password.length < 8) {
		return c.json({ error: "Password must be at least 8 characters long" }, 400);
	}

	const storedHash = await makePasswordHash(password);

	await db.insert(schema.users).values({
		id: "admin",
		password_hash: storedHash,
		created_at: new Date().toISOString(),
	});

	// Auto login on successful setup
	const secret = new TextEncoder().encode(c.env.SESSION_SECRET || "default_session_secret_change_me");
	const token = await new SignJWT({ id: "admin" })
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt()
		.setExpirationTime("7d")
		.sign(secret);

	setCookie(c, "session", token, {
		httpOnly: true,
		secure: true,
		sameSite: "Lax",
		path: "/",
		maxAge: 7 * 24 * 60 * 60, // 7 days
	});

	return c.json({ success: true });
});

app.post("/api/v1/auth/login", async (c) => {
	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });

	const body = await c.req.json().catch(() => ({}));
	const password = body.password;
	if (!password || typeof password !== "string") {
		return c.json({ error: "Password is required" }, 400);
	}

	const existingUsers = await db.select().from(schema.users).limit(1);
	if (existingUsers.length === 0) {
		return c.json({ error: "Setup required first" }, 400);
	}

	const admin = existingUsers[0];
	const { valid, needsUpgrade } = await verifyPassword(password, admin.password_hash);
	if (!valid) {
		return c.json({ error: "Invalid password" }, 401);
	}

	// Transparently upgrade legacy SHA-256 hashes to v2 SHA-512/600k on login
	if (needsUpgrade) {
		const upgraded = await makePasswordHash(password);
		await db.update(schema.users)
			.set({ password_hash: upgraded })
			.where(eq(schema.users.id, "admin"));
	}

	const secret = new TextEncoder().encode(c.env.SESSION_SECRET || "default_session_secret_change_me");
	const token = await new SignJWT({ id: "admin" })
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt()
		.setExpirationTime("7d")
		.sign(secret);

	setCookie(c, "session", token, {
		httpOnly: true,
		secure: true,
		sameSite: "Lax",
		path: "/",
		maxAge: 7 * 24 * 60 * 60, // 7 days
	});

	return c.json({ success: true });
});

app.post("/api/v1/auth/logout", (c) => {
	deleteCookie(c, "session", {
		path: "/",
		secure: true,
		sameSite: "Lax",
	});
	return c.json({ success: true });
});

app.post("/api/v1/auth/change-password", async (c) => {
	// Session is already validated by the /api/v1/* middleware in app.ts
	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });

	const body = await c.req.json().catch(() => ({}));
	const { currentPassword, newPassword } = body;

	if (!currentPassword || typeof currentPassword !== "string") {
		return c.json({ error: "Current password is required" }, 400);
	}
	if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
		return c.json({ error: "New password must be at least 8 characters long" }, 400);
	}

	const existingUsers = await db.select().from(schema.users).limit(1);
	if (existingUsers.length === 0) {
		return c.json({ error: "No admin user found" }, 400);
	}

	const admin = existingUsers[0];
	const { valid } = await verifyPassword(currentPassword, admin.password_hash);
	if (!valid) {
		return c.json({ error: "Current password is incorrect" }, 401);
	}

	// Hash new password with post-quantum v2 format
	const newHash = await makePasswordHash(newPassword);
	await db.update(schema.users)
		.set({ password_hash: newHash })
		.where(eq(schema.users.id, "admin"));

	return c.json({ success: true });
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

	const finalName = name || "Durga Sai Gundubogula";
	const defaultSettings = {
		fromName: finalName,
		agentSystemPrompt: "",
	};
	const finalSettings = { ...defaultSettings, ...settings };
	const now = new Date().toISOString();

	await db.insert(schema.mailboxes).values({
		id: email,
		email,
		name: finalName,
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

// -- External POST API: Receive Message into Mailbox -----------------

async function handleExternalPostMessage(
	db: ReturnType<typeof drizzle<typeof schema>>,
	mailboxId: string,
	body: { name?: string; email?: string; message?: string },
) {
	const email = (body.email || "").trim().toLowerCase();
	const name = (body.name || "").trim();
	const message = body.message || "";

	if (!email) {
		return { error: "Email is required", statusCode: 400 };
	}

	const mailboxRows = await db
		.select()
		.from(schema.mailboxes)
		.where(eq(schema.mailboxes.id, mailboxId.toLowerCase()))
		.limit(1);

	if (mailboxRows.length === 0) {
		return { error: "Mailbox not found", statusCode: 404 };
	}

	const mailboxRecord = mailboxRows[0];
	const mailboxName = mailboxRecord.name || mailboxId;
	const subject = `a mail from ${email} in mailbox ${mailboxName}`;
	const sender = name ? `${name} <${email}>` : email;
	const messageId = crypto.randomUUID();

	await db.insert(schema.emails).values({
		id: messageId,
		mailbox_id: mailboxId.toLowerCase(),
		folder_id: Folders.INBOX,
		subject,
		sender,
		recipient: mailboxId.toLowerCase(),
		date: new Date().toISOString(),
		body: message,
		read: 0,
		starred: 0,
		raw_headers: JSON.stringify({ "Reply-To": email, "From-Name": name }),
	});

	return {
		success: true,
		id: messageId,
		mailbox: mailboxId.toLowerCase(),
		statusCode: 201,
	};
}

app.post("/api/v1/external/messages", async (c) => {
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

	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });
	const body = await c.req.json().catch(() => ({}));

	const res = await handleExternalPostMessage(db, validated.mailboxId, body);
	if ("error" in res) {
		return c.json({ error: res.error }, res.statusCode as any);
	}
	return c.json(res, 201);
});

app.post("/api/v1/external/mailboxes/:mailboxId/messages", async (c) => {
	const mailboxId = c.req.param("mailboxId");
	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });
	const body = await c.req.json().catch(() => ({}));

	const res = await handleExternalPostMessage(db, mailboxId, body);
	if ("error" in res) {
		return c.json({ error: res.error }, res.statusCode as any);
	}
	return c.json(res, 201);
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

app.post("/api/v1/mailboxes/:mailboxId/emails", handleSendEmail);
app.post("/api/v1/mailboxes/:mailboxId/emails/:id/reply", handleReplyEmail);
app.post("/api/v1/mailboxes/:mailboxId/emails/:id/forward", handleForwardEmail);
app.post("/api/v1/mailboxes/:mailboxId/drafts", handleSaveDraft);
app.get("/api/v1/mailboxes/:mailboxId/threads/:threadId", handleGetThread);
app.post("/api/v1/mailboxes/:mailboxId/threads/:threadId/read", handleMarkThreadRead);

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

	const existingRows = await db
		.select()
		.from(schema.emails)
		.where(
			and(
				eq(schema.emails.id, emailId),
				eq(schema.emails.mailbox_id, mailboxId),
			),
		)
		.limit(1);

	if (existingRows.length === 0) return c.json({ error: "Email not found" }, 404);
	const existing = existingRows[0];

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

async function streamToArrayBuffer(stream: ReadableStream): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let totalLength = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			chunks.push(value);
			totalLength += value.length;
			if (totalLength > MAX_EMAIL_SIZE) {
				reader.cancel();
				throw new Error(`Email size exceeds ${MAX_EMAIL_SIZE} byte limit`);
			}
		}
	}
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}

export interface InboundEmailEvent {
	from?: string;
	to?: string;
	headers?: Headers;
	raw: ReadableStream;
	rawSize?: number;
	forward?: (rcptTo: string) => Promise<void>;
}

async function receiveEmail(
	event: InboundEmailEvent,
	env: Env,
	ctx: ExecutionContext,
) {
	try {
		await ensureDbInitialized(env.DB);
		const db = drizzle(env.DB, { schema });

		const mailboxId = (event.to || "").toLowerCase().trim();

		let mailboxRecord: typeof schema.mailboxes.$inferSelect | undefined;
		if (mailboxId) {
			const mailboxRows = await db
				.select()
				.from(schema.mailboxes)
				.where(eq(schema.mailboxes.id, mailboxId))
				.limit(1);
			if (mailboxRows.length > 0) {
				mailboxRecord = mailboxRows[0];
			}
		}

		// 1. Email Forwarding via Cloudflare Email Routing event.forward()
		// Perform forwarding FIRST while event.raw stream is pristine
		const forwardAddress = mailboxRecord?.forward_to || env.SMTP_USER;
		if (forwardAddress && typeof event.forward === "function") {
			try {
				await event.forward(forwardAddress);
				console.log(`Forwarded incoming email for ${mailboxId || "unknown"} to ${forwardAddress}`);
			} catch (e) {
				console.error(`Failed to forward email to ${forwardAddress}:`, (e as Error).message);
			}
		}

		// 2. Read raw stream for D1 storage
		let rawEmail: Uint8Array;
		try {
			rawEmail = await streamToArrayBuffer(event.raw);
		} catch (e) {
			console.error("Failed to read email raw stream:", (e as Error).message);
			return;
		}

		let parsedEmail;
		try {
			parsedEmail = await new PostalMime().parse(rawEmail);
		} catch (e) {
			console.error("Failed to parse MIME email:", (e as Error).message);
			return;
		}

		const parsedRecipients = (parsedEmail.to || [])
			.map((t) => t.address?.toLowerCase())
			.filter(Boolean) as string[];

		const targetMailboxId = mailboxId || parsedRecipients[0];
		if (!targetMailboxId) {
			console.log("Ignoring email: no valid recipient found");
			return;
		}

		if (!mailboxRecord) {
			const mailboxRows = await db
				.select()
				.from(schema.mailboxes)
				.where(eq(schema.mailboxes.id, targetMailboxId))
				.limit(1);
			if (mailboxRows.length > 0) {
				mailboxRecord = mailboxRows[0];
			} else {
				console.log(`Ignoring email for ${targetMailboxId}: mailbox does not exist in D1`);
				return;
			}
		}

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

		const allRecipients = Array.from(new Set([targetMailboxId, ...parsedRecipients]));

		await db.insert(schema.emails).values({
			id: messageId,
			mailbox_id: targetMailboxId,
			folder_id: Folders.INBOX,
			subject: parsedEmail.subject || "(no subject)",
			sender: (parsedEmail.from?.address || event.from || "").toLowerCase(),
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

		console.log(`Stored email ${messageId} in D1 for mailbox ${targetMailboxId}`);
	} catch (e) {
		console.error("Unhandled exception in receiveEmail:", (e as Error).message, (e as Error).stack);
	}
}

export { app, receiveEmail };




