import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import { verifySessionToken } from "../lib/session";
import { makePasswordHash } from "../lib/crypto";
import { ensureDbInitialized } from "../db/init";
import { recordAuditEvent } from "../lib/audit";
import type { Env } from "../types";

async function hashToken(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type UsersEnv = { Bindings: Env };
export const usersApi = new Hono<UsersEnv>();

usersApi.use("*", async (c, next) => {
	const origin = c.req.header("origin");
	if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "Forbidden origin" }, 403);
	const cookie = getCookie(c, "session");
	if (!cookie) return c.json({ error: "Unauthorized" }, 401);
	try {
		const payload = await verifySessionToken(cookie, c.env);
		if (payload.id !== "admin" || payload.role !== "owner") return c.json({ error: "Owner session required" }, 403);
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}
	await next();
});

usersApi.get("/", async (c) => {
	await ensureDbInitialized(c.env.DB);
	const users = await c.env.DB.prepare("SELECT id, email, role, status, created_at FROM users ORDER BY created_at ASC").all();
	return c.json(users.results);
});

usersApi.post("/invitations", async (c) => {
	const parsed = createSchema.pick({ email: true, role: true }).safeParse(await c.req.json().catch(() => ({})));
	if (!parsed.success) return c.json({ error: "Invalid invitation" }, 400);
	await ensureDbInitialized(c.env.DB);
	const token = `inv_${crypto.randomUUID().replaceAll("-", "")}`;
	const id = crypto.randomUUID();
	await c.env.DB.prepare("INSERT INTO user_invitations (id, email, role, token_hash, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'admin', ?)").bind(id, parsed.data.email.toLowerCase(), parsed.data.role, await hashToken(token), new Date(Date.now() + 86400000).toISOString(), new Date().toISOString()).run();
	await recordAuditEvent(c.env.DB, { actorId: "admin", action: "user.create", targetType: "invitation", targetId: id, metadata: { status: parsed.data.role } });
	return c.json({ id, email: parsed.data.email.toLowerCase(), role: parsed.data.role, token, expiresAt: new Date(Date.now() + 86400000).toISOString() }, 201);
});

usersApi.post("/recovery-code", async (c) => {
	await ensureDbInitialized(c.env.DB);
	const code = `rec_${crypto.randomUUID().replaceAll("-", "")}`;
	await c.env.DB.prepare("UPDATE users SET recovery_code_hash = ? WHERE id = 'admin'").bind(await hashToken(code)).run();
	await recordAuditEvent(c.env.DB, { actorId: "admin", action: "user.create", targetType: "recovery_code", targetId: "admin" });
	return c.json({ code, warning: "Store this code offline. It will not be shown again." });
});

const createSchema = z.object({ email: z.string().email().max(254), password: z.string().min(8).max(200), role: z.enum(["operator", "read_only"]).default("operator") });
usersApi.post("/", async (c) => {
	const parsed = createSchema.safeParse(await c.req.json().catch(() => ({})));
	if (!parsed.success) return c.json({ error: "Invalid user" }, 400);
	await ensureDbInitialized(c.env.DB);
	const id = crypto.randomUUID();
	try {
		await c.env.DB.prepare("INSERT INTO users (id, email, role, status, password_hash, created_at, session_version) VALUES (?, ?, ?, 'active', ?, ?, 0)").bind(id, parsed.data.email.toLowerCase(), parsed.data.role, await makePasswordHash(parsed.data.password), new Date().toISOString()).run();
	} catch {
		return c.json({ error: "Email already exists" }, 409);
	}
	await recordAuditEvent(c.env.DB, { actorId: "admin", action: "user.create", targetType: "user", targetId: id, metadata: { status: parsed.data.role } });
	return c.json({ id, email: parsed.data.email.toLowerCase(), role: parsed.data.role }, 201);
});

usersApi.put("/:userId/permissions/:mailboxId", async (c) => {
	const userId = c.req.param("userId")!;
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();
	const body = await c.req.json().catch(() => ({})) as { role?: unknown };
	const role = body.role === "operator" || body.role === "read_only" ? body.role : null;
	if (!role) return c.json({ error: "role must be operator or read_only" }, 400);
	await ensureDbInitialized(c.env.DB);
	await c.env.DB.prepare("INSERT INTO mailbox_permissions (user_id, mailbox_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, mailbox_id) DO UPDATE SET role = excluded.role").bind(userId, mailboxId, role, new Date().toISOString()).run();
	await recordAuditEvent(c.env.DB, { actorId: "admin", action: "permission.update", targetType: "mailbox_permission", targetId: `${userId}:${mailboxId}`, metadata: { status: role } });
	return c.json({ userId, mailboxId, role });
});

usersApi.delete("/:userId", async (c) => {
	const userId = c.req.param("userId")!;
	if (userId === "admin") return c.json({ error: "The owner cannot be deleted" }, 400);
	await ensureDbInitialized(c.env.DB);
	await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
	await recordAuditEvent(c.env.DB, { actorId: "admin", action: "user.delete", targetType: "user", targetId: userId });
	return c.body(null, 204);
});
