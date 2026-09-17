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

import { Folders, SYSTEM_FOLDER_IDS } from "../shared/folders";
import type { Env } from "./types";
import { requireMailbox, type MailboxContext } from "./lib/mailbox";
import { ensureDbInitialized } from "./db/init";
import * as schema from "./db/schema";
import {
	cleanupRulesForFolder,
	retargetRulesForFolderRename,
	executeAutomations,
} from "./lib/automations";
import { runAiWithFallbacks, CLOUDFLARE_AI_MODELS } from "./lib/ai";
import { AUTOMATION_MATCH_FIELDS, isAutomationAction, parseAutomationActions, type AutomationAction } from "../shared/automations";
import { generateApiKey, listApiKeys, revokeApiKey, validateApiKey } from "./lib/api-keys";
import {
	handleSendEmail,
	handleReplyEmail,
	handleForwardEmail,
	handleSaveDraft,
	handleGetThread,
	handleMarkThreadRead,
} from "./routes/reply-forward";
import { stripHtmlToText, textToHtml } from "./lib/email-helpers";
import { hierarchyApi } from "./routes/hierarchy";
import { withOwnerMemory } from "./lib/hierarchy";



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

// Owner-only workspace settings. The router enforces its own session boundary.
app.route("/api/v1/settings", hierarchyApi);

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
			is_deletable: 0,
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

	if (mailboxId === "all") {
		return c.json({
			id: "all",
			email: "All Mailboxes",
			name: "All Mailboxes",
			forwardTo: null,
			settings: {},
		});
	}

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

// -- AI compose: generate email body text for the composer ------------

app.post("/api/v1/mailboxes/:mailboxId/ai/draft", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();

	if (!c.env.AI) {
		return c.json({ error: "Cloudflare Workers AI is not configured" }, 500);
	}

	const bodyParams = (await c.req.json().catch(() => ({}))) as {
		instructions?: string;
		subject?: string;
		existingBody?: string;
	};

	const instructions = (bodyParams.instructions || "").trim().slice(0, 2000);
	const subject = (bodyParams.subject || "").trim().slice(0, 300);
	const existingText = bodyParams.existingBody
		? stripHtmlToText(bodyParams.existingBody).trim().slice(0, 4000)
		: "";

	const contextParts: string[] = [];
	if (subject) contextParts.push(`Subject line: ${subject}`);
	if (existingText) {
		contextParts.push(
			`Current draft text (continue or revise this — do not simply repeat it):\n${existingText}`,
		);
	}
	if (instructions) {
		contextParts.push(`Writer instructions: ${instructions}`);
	}

	if (contextParts.length === 0) {
		return c.json(
			{ error: "Add instructions or a subject line so the AI knows what to write." },
			400,
		);
	}

	const systemPrompt = `You are a writing assistant composing the text of a real email on behalf of the user.
Write like a real person: direct, warm, professional. Short paragraphs. No headings, no bullet lists unless asked, no markdown syntax, no placeholders like [Name].

Strict requirements:
- Output ONLY the email text itself. No preamble, no commentary, no "Here's a draft...", no subject line, no signature block.
- Plain prose suitable for email. Preserve any specific details, names, dates, or links the instructions mention.
- Keep it concise: usually 2-6 short paragraphs.`;

	try {
		await ensureDbInitialized(c.env.DB);
		const prompt = await withOwnerMemory(c.env.DB, mailboxId, systemPrompt);
		const { text, model } = await runAiWithFallbacks(c.env.AI, {
			messages: [
				{ role: "system", content: prompt },
				{ role: "user", content: contextParts.join("\n\n") },
			],
			max_tokens: 1024,
			temperature: 0.4,
		});

		const draft = textToHtml(text.trim());
		return c.json({ draft, model });
	} catch (e) {
		console.error("AI compose failed:", (e as Error).message);
		return c.json({ error: "AI generation failed across all models. Please try again." }, 502);
	}
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

	const filterCondition =
		folder === Folders.ALL_MAIL || folder === "all_mail" || folder === "all"
			? eq(schema.emails.mailbox_id, mailboxId.toLowerCase())
			: and(
					eq(schema.emails.mailbox_id, mailboxId.toLowerCase()),
					eq(schema.emails.folder_id, folder),
				);

	const emailRows = await db
		.select()
		.from(schema.emails)
		.where(filterCondition)
		.orderBy(desc(schema.emails.date))
		.limit(limit)
		.offset(offset);

	const totalCountResult = await db
		.select({ count: count() })
		.from(schema.emails)
		.where(filterCondition);

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
	env: Env,
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

	// Run automation rules (multi-folder filing, flags, auto-replies).
	let automationFolders: string[] = [];
	let automationRead = false;
	let automationStarred = false;
	try {
		const automation = await executeAutomations(db, env, mailboxId, {
			from: email,
			subject,
			recipient: mailboxId,
			body: message,
		});
		automationFolders = automation.folders;
		automationRead = automation.markRead;
		automationStarred = automation.starred;
	} catch (e) {
		console.error("Failed to execute automations:", (e as Error).message);
	}

	const targetFolders =
		automationFolders.length > 0 ? automationFolders.slice(0, 10) : [Folders.INBOX];
	const baseEmailRow = {
		mailbox_id: mailboxId.toLowerCase(),
		subject,
		sender,
		recipient: mailboxId.toLowerCase(),
		date: new Date().toISOString(),
		body: message,
		read: automationRead ? 1 : 0,
		starred: automationStarred ? 1 : 0,
		raw_headers: JSON.stringify({ "Reply-To": email, "From-Name": name }),
	};
	for (let i = 0; i < targetFolders.length; i++) {
		await db.insert(schema.emails).values({
			...baseEmailRow,
			id: i === 0 ? messageId : `${messageId}-c${i}`,
			folder_id: targetFolders[i],
		});
	}

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

	const res = await handleExternalPostMessage(db, c.env, validated.mailboxId, body);
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

	const res = await handleExternalPostMessage(db, c.env, mailboxId, body);
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

	const isAllMailFolder =
		folder === Folders.ALL_MAIL || folder === "all_mail" || folder === "all";

	const filterCondition =
		mailboxId === "all"
			? isAllMailFolder
				? undefined
				: eq(schema.emails.folder_id, folder)
			: isAllMailFolder
				? eq(schema.emails.mailbox_id, mailboxId)
				: and(
						eq(schema.emails.mailbox_id, mailboxId),
						eq(schema.emails.folder_id, folder),
					);

	let emailRows;
	let totalCountResult;

	if (filterCondition) {
		emailRows = await db
			.select()
			.from(schema.emails)
			.where(filterCondition)
			.orderBy(desc(schema.emails.date))
			.limit(limit)
			.offset(offset);

		totalCountResult = await db
			.select({ count: count() })
			.from(schema.emails)
			.where(filterCondition);
	} else {
		emailRows = await db
			.select()
			.from(schema.emails)
			.orderBy(desc(schema.emails.date))
			.limit(limit)
			.offset(offset);

		totalCountResult = await db
			.select({ count: count() })
			.from(schema.emails);
	}

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

	const matchCondition =
		mailboxId === "all"
			? eq(schema.emails.id, emailId)
			: and(
					eq(schema.emails.id, emailId),
					eq(schema.emails.mailbox_id, mailboxId),
				);

	const rows = await db
		.select()
		.from(schema.emails)
		.where(matchCondition)
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

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/summarize", async (c: AppContext) => {
	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();
	const emailId = c.req.param("id")!;

	if (!c.env.AI) {
		return c.json({ error: "Cloudflare Workers AI is not configured" }, 500);
	}

	let bodyParams: { thread?: boolean } = {};
	try {
		bodyParams = await c.req.json();
	} catch {}

	const wantThread = bodyParams.thread ?? (c.req.query("thread") === "true");

	const matchCondition =
		mailboxId === "all"
			? eq(schema.emails.id, emailId)
			: and(
					eq(schema.emails.id, emailId),
					eq(schema.emails.mailbox_id, mailboxId),
				);

	const rows = await db
		.select()
		.from(schema.emails)
		.where(matchCondition)
		.limit(1);

	if (rows.length === 0) return c.json({ error: "Email not found" }, 404);

	const email = rows[0];
	let contentToSummarize = "";
	let isThread = false;

	if (wantThread && email.thread_id) {
		const threadRows = await db
			.select()
			.from(schema.emails)
			.where(
				mailboxId === "all"
					? eq(schema.emails.thread_id, email.thread_id)
					: and(
							eq(schema.emails.thread_id, email.thread_id),
							eq(schema.emails.mailbox_id, mailboxId),
						),
			)
			.orderBy(asc(schema.emails.date));

		if (threadRows.length > 1) {
			isThread = true;
			contentToSummarize = threadRows
				.map((m) => {
					const text = m.body ? stripHtmlToText(m.body).trim() : "";
					return `[${m.date || "Unknown Date"}] From: ${m.sender} To: ${m.recipient}\n${text}`;
				})
				.join("\n\n---\n\n");
		}
	}

	if (!contentToSummarize) {
		contentToSummarize = email.body ? stripHtmlToText(email.body).trim() : "";
	}

	if (!contentToSummarize) {
		return c.json({
			summary: "This email contains no readable text content to summarize.",
			model: CLOUDFLARE_AI_MODELS.PRIMARY,
			isThread,
		});
	}

	const systemPrompt = `You are an expert AI email assistant.
Provide a clear, high-quality, concise executive summary of the following email${isThread ? " thread" : ""}.
Format using clean Markdown:
- **TL;DR**: 1-2 sentences capturing the essence.
- **Key Points**: 2-4 concise bullet points covering critical details, decisions, or context.
- **Action Items**: Any requests, questions asked, or next steps (or state "None" if purely informational).

Keep it objective, skimmable, and directly based on the provided email text.`;

	try {
		const { text: summaryText, model: usedModel } = await runAiWithFallbacks(
			c.env.AI,
			{
				messages: [
					{ role: "system", content: systemPrompt },
					{
						role: "user",
						content: `Subject: ${email.subject || "(no subject)"}\nFrom: ${email.sender}\nTo: ${email.recipient}\n\nEmail Content:\n${contentToSummarize}`,
					},
				],
				max_tokens: 800,
				temperature: 0.2,
			},
		);

		const summary = summaryText.trim() || "No summary could be generated.";
		return c.json({
			summary,
			model: usedModel,
			isThread,
		});
	} catch (err) {
		console.error("AI Summarize error:", (err as Error).message);
		return c.json({ error: (err as Error).message || "Failed to generate AI summary" }, 500);
	}
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

	const matchCondition =
		mailboxId === "all"
			? eq(schema.emails.id, emailId)
			: and(
					eq(schema.emails.id, emailId),
					eq(schema.emails.mailbox_id, mailboxId),
				);

	const existingRows = await db
		.select()
		.from(schema.emails)
		.where(matchCondition)
		.limit(1);

	if (existingRows.length === 0) return c.json({ error: "Email not found" }, 404);

	const updateData: Record<string, unknown> = {};
	if (read !== undefined) updateData.read = read ? 1 : 0;
	if (starred !== undefined) updateData.starred = starred ? 1 : 0;

	await db
		.update(schema.emails)
		.set(updateData)
		.where(matchCondition);

	const rows = await db
		.select()
		.from(schema.emails)
		.where(matchCondition)
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

	const matchCondition =
		mailboxId === "all"
			? eq(schema.emails.id, emailId)
			: and(
					eq(schema.emails.id, emailId),
					eq(schema.emails.mailbox_id, mailboxId),
				);

	await db
		.delete(schema.emails)
		.where(matchCondition);

	return c.body(null, 204);
});

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/move", async (c: AppContext) => {
	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();
	const emailId = c.req.param("id")!;
	const { folderId } = (await c.req.json()) as { folderId: string };

	const matchCondition =
		mailboxId === "all"
			? eq(schema.emails.id, emailId)
			: and(
					eq(schema.emails.id, emailId),
					eq(schema.emails.mailbox_id, mailboxId),
				);

	await db
		.update(schema.emails)
		.set({ folder_id: folderId })
		.where(matchCondition);

	return c.json({ status: "moved" });
});

// -- Folders (D1) ---------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/folders", async (c: AppContext) => {
	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();

	if (mailboxId === "all") {
		const unreadCounts = await db
			.select({
				folder_id: schema.emails.folder_id,
				count: count(),
			})
			.from(schema.emails)
			.where(eq(schema.emails.read, 0))
			.groupBy(schema.emails.folder_id);
		const unreadMap = new Map(unreadCounts.map((u) => [u.folder_id, u.count]));

		return c.json([
			{ id: Folders.INBOX, name: Folders.INBOX, unreadCount: unreadMap.get(Folders.INBOX) || 0 },
			{ id: Folders.SENT, name: Folders.SENT, unreadCount: unreadMap.get(Folders.SENT) || 0 },
			{ id: Folders.DRAFT, name: Folders.DRAFT, unreadCount: unreadMap.get(Folders.DRAFT) || 0 },
			{ id: Folders.ARCHIVE, name: Folders.ARCHIVE, unreadCount: unreadMap.get(Folders.ARCHIVE) || 0 },
			{ id: Folders.TRASH, name: Folders.TRASH, unreadCount: unreadMap.get(Folders.TRASH) || 0 },
		]);
	}

	const [rows, unreadCounts] = await Promise.all([
		db
			.select()
			.from(schema.folders)
			.where(eq(schema.folders.mailbox_id, mailboxId)),
		db
			.select({
				folder_id: schema.emails.folder_id,
				count: count(),
			})
			.from(schema.emails)
			.where(and(eq(schema.emails.mailbox_id, mailboxId), eq(schema.emails.read, 0)))
			.groupBy(schema.emails.folder_id),
	]);

	const unreadMap = new Map(unreadCounts.map((u) => [u.folder_id, u.count]));
	const returnedFolderNames = new Set(rows.map((f) => f.name));
	const result = rows.map((f) => ({
		id: f.name,
		name: f.name,
		unreadCount: unreadMap.get(f.name) || 0,
	}));

	for (const sysFolder of [Folders.INBOX, Folders.SENT, Folders.DRAFT, Folders.ARCHIVE, Folders.TRASH]) {
		if (!returnedFolderNames.has(sysFolder)) {
			result.unshift({
				id: sysFolder,
				name: sysFolder,
				unreadCount: unreadMap.get(sysFolder) || 0,
			});
		}
	}

	return c.json(result);
});

const MAX_FOLDER_NAME_LENGTH = 64;

function isSystemFolder(name: string): boolean {
	return (SYSTEM_FOLDER_IDS as readonly string[]).includes(name.toLowerCase());
}

function validateFolderName(raw: unknown): { name: string } | { error: string; status: number } {
	const name = typeof raw === "string" ? raw.trim() : "";
	if (!name) return { error: "Folder name is required", status: 400 };
	if (name.length > MAX_FOLDER_NAME_LENGTH) {
		return { error: `Folder name must be ${MAX_FOLDER_NAME_LENGTH} characters or fewer`, status: 400 };
	}
	if (isSystemFolder(name)) {
		return { error: "Folder name conflicts with a system folder", status: 409 };
	}
	return { name };
}

app.post("/api/v1/mailboxes/:mailboxId/folders", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();
	if (mailboxId === "all") {
		return c.json({ error: "Cannot create folders on the aggregated All Mailboxes view" }, 400);
	}

	const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
	const validated = validateFolderName(body.name);
	if ("error" in validated) {
		return c.json({ error: validated.error }, validated.status as any);
	}
	const { name } = validated;

	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });

	const existing = await db
		.select()
		.from(schema.folders)
		.where(and(eq(schema.folders.mailbox_id, mailboxId), eq(schema.folders.name, name)))
		.limit(1);
	if (existing.length > 0) {
		return c.json({ error: "Folder already exists" }, 409);
	}

	await db.insert(schema.folders).values({
		id: `${mailboxId}:${name}`,
		mailbox_id: mailboxId,
		name,
		is_deletable: 1,
	});

	return c.json({ id: name, name, unreadCount: 0 }, 201);
});

app.put("/api/v1/mailboxes/:mailboxId/folders/:folderId", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();
	if (mailboxId === "all") {
		return c.json({ error: "Cannot rename folders on the aggregated All Mailboxes view" }, 400);
	}
	const folderId = decodeURIComponent(c.req.param("folderId")!);
	if (isSystemFolder(folderId)) {
		return c.json({ error: "System folders cannot be renamed" }, 400);
	}

	const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
	const validated = validateFolderName(body.name);
	if ("error" in validated) {
		return c.json({ error: validated.error }, validated.status as any);
	}
	const { name } = validated;

	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });

	const existing = await db
		.select()
		.from(schema.folders)
		.where(
			and(
				eq(schema.folders.mailbox_id, mailboxId),
				or(eq(schema.folders.name, folderId), eq(schema.folders.id, folderId)),
			),
		)
		.limit(1);
	if (existing.length === 0) {
		return c.json({ error: "Folder not found" }, 404);
	}

	const duplicate = await db
		.select()
		.from(schema.folders)
		.where(and(eq(schema.folders.mailbox_id, mailboxId), eq(schema.folders.name, name)))
		.limit(1);
	if (duplicate.length > 0) {
		return c.json({ error: "A folder with this name already exists" }, 409);
	}

	const oldName = existing[0].name;

	// Keep the stored row id in sync with the new name, and carry the
	// folder's emails over (emails reference folders by name).
	await db
		.update(schema.folders)
		.set({ id: `${mailboxId}:${name}`, name })
		.where(eq(schema.folders.id, existing[0].id));

	await db
		.update(schema.emails)
		.set({ folder_id: name })
		.where(and(eq(schema.emails.mailbox_id, mailboxId), eq(schema.emails.folder_id, oldName)));

	// Keep automation rules pointing at the renamed folder
	await retargetRulesForFolderRename(db, mailboxId, oldName, name);

	return c.json({ id: name, name, unreadCount: 0 });
});

app.delete("/api/v1/mailboxes/:mailboxId/folders/:folderId", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();
	if (mailboxId === "all") {
		return c.json({ error: "Cannot delete folders on the aggregated All Mailboxes view" }, 400);
	}
	const folderId = decodeURIComponent(c.req.param("folderId")!);
	if (isSystemFolder(folderId)) {
		return c.json({ error: "System folders cannot be deleted" }, 400);
	}

	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });

	const existing = await db
		.select()
		.from(schema.folders)
		.where(
			and(
				eq(schema.folders.mailbox_id, mailboxId),
				or(eq(schema.folders.name, folderId), eq(schema.folders.id, folderId)),
			),
		)
		.limit(1);
	if (existing.length === 0) {
		return c.json({ error: "Folder not found" }, 404);
	}

	const oldName = existing[0].name;

	// Preserve emails by moving them to Archive instead of orphaning them.
	await db
		.update(schema.emails)
		.set({ folder_id: Folders.ARCHIVE })
		.where(and(eq(schema.emails.mailbox_id, mailboxId), eq(schema.emails.folder_id, oldName)));

	// Drop automation rules that file into this folder
	await cleanupRulesForFolder(db, mailboxId, oldName);

	await db.delete(schema.folders).where(eq(schema.folders.id, existing[0].id));

	return c.body(null, 204);
});

// -- Automations (auto-filing rules, D1) -----------------------------

function serializeAutomation(r: typeof schema.automationRules.$inferSelect) {
	return {
		id: r.id,
		matchField: r.match_field,
		matchValue: r.match_value,
		actions: parseAutomationActions(r.actions),
		enabled: r.enabled === 1,
		createdAt: r.created_at,
	};
}

/** Structural validation of a rule body (folder existence checked separately). */
function validateAutomationBody(body: {
	matchField?: unknown;
	matchValue?: unknown;
	actions?: unknown;
}):
	| { matchField: string; matchValue: string; actions: AutomationAction[] }
	| { error: string; status: number } {
	const matchField = typeof body.matchField === "string" ? body.matchField : "";
	if (!(AUTOMATION_MATCH_FIELDS as readonly string[]).includes(matchField)) {
		return { error: "matchField must be one of: from, subject, to", status: 400 };
	}

	const matchValue = typeof body.matchValue === "string" ? body.matchValue.trim() : "";
	if (!matchValue) return { error: "matchValue is required", status: 400 };
	if (matchValue.length > 200) {
		return { error: "matchValue must be 200 characters or fewer", status: 400 };
	}

	const rawActions = body.actions;
	if (!Array.isArray(rawActions) || rawActions.length === 0) {
		return { error: "actions must be a non-empty array", status: 400 };
	}
	if (rawActions.length > 20) {
		return { error: "A rule can have at most 20 actions", status: 400 };
	}

	for (const a of rawActions) {
		if (!isAutomationAction(a)) {
			return { error: "Invalid action entry", status: 400 };
		}
		if (a.type === "file" && a.folder.length > 64) {
			return { error: "File action folder name is too long", status: 400 };
		}
		if (a.type === "auto_reply") {
			const bodyText = a.body.trim();
			if (!bodyText) return { error: "Auto-reply action requires a reply body", status: 400 };
			if (bodyText.length > 5000) {
				return { error: "Auto-reply body must be 5000 characters or fewer", status: 400 };
			}
		}
		if (a.type === "ai_reply" && a.prompt) {
			if (a.prompt.length > 1000) {
				return { error: "AI reply guidance must be 1000 characters or fewer", status: 400 };
			}
		}
	}

	return {
		matchField,
		matchValue,
		actions: rawActions as AutomationAction[],
	};
}

/** Every folder id referenced by a rule's actions. */
function collectActionFolders(actions: AutomationAction[]): string[] {
	const out: string[] = [];
	for (const a of actions) {
		if (a.type === "file") out.push(a.folder);
		if (a.type === "auto_reply" || a.type === "ai_reply") {
			if (a.onSuccessFolder) out.push(a.onSuccessFolder);
			if (a.onFailureFolder) out.push(a.onFailureFolder);
		}
	}
	return out;
}

/** Verify every referenced folder exists for the mailbox. */
async function allFoldersExist(
	db: ReturnType<typeof drizzle<typeof schema>>,
	mailboxId: string,
	folders: string[],
): Promise<boolean> {
	if (folders.length === 0) return true;
	const rows = await db
		.select({ name: schema.folders.name })
		.from(schema.folders)
		.where(eq(schema.folders.mailbox_id, mailboxId));
	const known = new Set([...rows.map((r) => r.name), ...SYSTEM_FOLDER_IDS]);
	return folders.every((f) => known.has(f));
}

app.get("/api/v1/mailboxes/:mailboxId/automations", async (c: AppContext) => {
	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();

	if (mailboxId === "all") return c.json([]);

	const rows = await db
		.select()
		.from(schema.automationRules)
		.where(eq(schema.automationRules.mailbox_id, mailboxId))
		.orderBy(asc(schema.automationRules.created_at));

	return c.json(rows.map(serializeAutomation));
});

app.post("/api/v1/mailboxes/:mailboxId/automations", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();
	if (mailboxId === "all") {
		return c.json({ error: "Automations must belong to a specific mailbox" }, 400);
	}

	const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
	const validated = validateAutomationBody(body);
	if ("error" in validated) {
		return c.json({ error: validated.error }, validated.status as any);
	}

	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });

	const referencedFolders = collectActionFolders(validated.actions);
	if (!(await allFoldersExist(db, mailboxId, referencedFolders))) {
		return c.json({ error: "One or more target folders do not exist for this mailbox" }, 400);
	}

	const rule = {
		id: crypto.randomUUID(),
		mailbox_id: mailboxId,
		match_field: validated.matchField,
		match_value: validated.matchValue,
		actions: JSON.stringify(validated.actions),
		enabled: 1,
		created_at: new Date().toISOString(),
	};

	await db.insert(schema.automationRules).values(rule);

	return c.json(serializeAutomation(rule), 201);
});

app.put("/api/v1/mailboxes/:mailboxId/automations/:ruleId", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();
	if (mailboxId === "all") {
		return c.json({ error: "Automations must belong to a specific mailbox" }, 400);
	}
	const ruleId = c.req.param("ruleId")!;

	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });

	const existing = await db
		.select()
		.from(schema.automationRules)
		.where(and(eq(schema.automationRules.id, ruleId), eq(schema.automationRules.mailbox_id, mailboxId)))
		.limit(1);
	if (existing.length === 0) {
		return c.json({ error: "Automation not found" }, 404);
	}

	const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

	// Partial updates: the enabled-only toggle is the common UI case.
	const updateData: Partial<typeof schema.automationRules.$inferInsert> = {};

	if (body.matchField !== undefined || body.matchValue !== undefined || body.actions !== undefined) {
		const validated = validateAutomationBody({
			matchField: body.matchField ?? existing[0].match_field,
			matchValue: body.matchValue ?? existing[0].match_value,
			actions: body.actions ?? parseAutomationActions(existing[0].actions),
		});
		if ("error" in validated) {
			return c.json({ error: validated.error }, validated.status as any);
		}
		const referencedFolders = collectActionFolders(validated.actions);
		if (!(await allFoldersExist(db, mailboxId, referencedFolders))) {
			return c.json({ error: "One or more target folders do not exist for this mailbox" }, 400);
		}
		updateData.match_field = validated.matchField;
		updateData.match_value = validated.matchValue;
		updateData.actions = JSON.stringify(validated.actions);
	}

	if (body.enabled !== undefined) {
		updateData.enabled = body.enabled === true ? 1 : 0;
	}

	await db
		.update(schema.automationRules)
		.set(updateData)
		.where(eq(schema.automationRules.id, ruleId));

	const updated = await db
		.select()
		.from(schema.automationRules)
		.where(eq(schema.automationRules.id, ruleId))
		.limit(1);

	return c.json(serializeAutomation(updated[0]));
});

app.delete("/api/v1/mailboxes/:mailboxId/automations/:ruleId", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();
	if (mailboxId === "all") {
		return c.json({ error: "Automations must belong to a specific mailbox" }, 400);
	}
	const ruleId = c.req.param("ruleId")!;

	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });

	const existing = await db
		.select()
		.from(schema.automationRules)
		.where(and(eq(schema.automationRules.id, ruleId), eq(schema.automationRules.mailbox_id, mailboxId)))
		.limit(1);
	if (existing.length === 0) {
		return c.json({ error: "Automation not found" }, 404);
	}

	await db.delete(schema.automationRules).where(eq(schema.automationRules.id, ruleId));

	return c.body(null, 204);
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

	const searchFilter =
		mailboxId === "all"
			? or(
					like(schema.emails.subject, `%${queryStr}%`),
					like(schema.emails.body, `%${queryStr}%`),
					like(schema.emails.sender, `%${queryStr}%`),
				)
			: and(
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

		// 3. Run automation rules (multi-folder filing, flags, auto-replies).
		const subjLower = (parsedEmail.subject || "").toLowerCase();
		const headerList = (parsedEmail.headers ?? []) as Array<{ key?: string; value?: string }>;
		const hasAutoHeader = headerList.some((h) => {
			const k = (h.key || "").toLowerCase();
			if (k !== "auto-submitted" && k !== "x-autoreply" && k !== "auto-reply") return false;
			return !/^no$/i.test(h.value || "");
		});
		const looksAutoReply = hasAutoHeader || subjLower.startsWith("re:") || subjLower.startsWith("fwd:");

		let automationFolders: string[] = [];
		let automationRead = false;
		let automationStarred = false;
		try {
			const automation = await executeAutomations(db, env, targetMailboxId, {
				from: (parsedEmail.from?.address || event.from || "").toLowerCase(),
				subject: parsedEmail.subject || "(no subject)",
				recipient: allRecipients.join(", "),
				threadId,
				inReplyTo: originalMessageId || undefined,
				references: emailReferences,
				isAutoReply: looksAutoReply,
				body: parsedEmail.text || parsedEmail.html || "",
			});
			automationFolders = automation.folders;
			automationRead = automation.markRead;
			automationStarred = automation.starred;
			if (automation.matchedRuleId) {
				console.log(
					`Automation ${automation.matchedRuleId} filed email ${messageId} into [${automationFolders.join(", ") || "inbox"}] for ${targetMailboxId}`,
				);
			}
		} catch (e) {
			console.error("Failed to execute automations:", (e as Error).message);
		}

		// File the email into every resolved folder (first is the primary
		// copy that keeps the original id; the rest are duplicates).
		const targetFolders =
			automationFolders.length > 0 ? automationFolders.slice(0, 10) : [Folders.INBOX];
		const baseEmailRow = {
			id: messageId,
			mailbox_id: targetMailboxId,
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
			read: automationRead ? 1 : 0,
			starred: automationStarred ? 1 : 0,
			in_reply_to: inReplyTo,
			email_references:
				emailReferences.length > 0 ? JSON.stringify(emailReferences) : null,
			thread_id: threadId,
			message_id: originalMessageId,
			raw_headers: JSON.stringify(parsedEmail.headers),
		};
		for (let i = 0; i < targetFolders.length; i++) {
			await db.insert(schema.emails).values({
				...baseEmailRow,
				id: i === 0 ? messageId : `${messageId}-c${i}`,
				folder_id: targetFolders[i],
			});
		}

		console.log(`Stored email ${messageId} in D1 for mailbox ${targetMailboxId}`);

		// Trigger EmailAgent DO for auto-drafting if DO binding is available
		if (env.EmailAgent) {
			try {
				const id = env.EmailAgent.idFromName(targetMailboxId);
				const stub = env.EmailAgent.get(id);
				ctx.waitUntil(
					stub.fetch(
						new Request("https://agent/onNewEmail", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								mailboxId: targetMailboxId,
								emailId: messageId,
								sender: (parsedEmail.from?.address || event.from || "").toLowerCase(),
								subject: parsedEmail.subject || "(no subject)",
								threadId,
							}),
						}),
					).catch((e) => console.error("Failed to notify EmailAgent DO:", (e as Error).message)),
				);
			} catch (e) {
				console.error("Failed to fetch EmailAgent DO:", (e as Error).message);
			}
		}
	} catch (e) {
		console.error("Unhandled exception in receiveEmail:", (e as Error).message, (e as Error).stack);
	}

}

export { app, receiveEmail };




