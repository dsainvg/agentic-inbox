import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { verifySessionToken } from "../lib/session";
import type { Env } from "../types";

type AuditEnv = { Bindings: Env };
export const auditApi = new Hono<AuditEnv>();

auditApi.use("*", async (c, next) => {
	const origin = c.req.header("origin");
	if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "Forbidden origin" }, 403);
	const cookie = getCookie(c, "session");
	if (!cookie) return c.json({ error: "Unauthorized" }, 401);
	try {
		const payload = await verifySessionToken(cookie, c.env);
		if (payload.id !== "admin") return c.json({ error: "Owner session required" }, 403);
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}
	await next();
});

function csvCell(value: unknown): string {
	return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

auditApi.get("/", async (c) => {
	const limit = Math.min(Math.max(Number(c.req.query("limit")) || 100, 1), 500);
	const result = await c.env.DB.prepare(`
		SELECT id, actor_id, action, mailbox_id, target_type, target_id, result, metadata, created_at
		FROM audit_events ORDER BY created_at DESC LIMIT ?
	`).bind(limit).all<Record<string, string>>();
	return c.json({
		events: result.results.map((row) => ({ ...row, metadata: JSON.parse(row.metadata || "{}") })),
	});
});

auditApi.get("/export", async (c) => {
	const result = await c.env.DB.prepare(`
		SELECT id, actor_id, action, mailbox_id, target_type, target_id, result, metadata, created_at
		FROM audit_events ORDER BY created_at DESC LIMIT 10000
	`).all<Record<string, string>>();
	const header = ["id", "actor_id", "action", "mailbox_id", "target_type", "target_id", "result", "metadata", "created_at"];
	const lines = [header.join(","), ...result.results.map((row) => header.map((key) => csvCell(row[key])).join(","))];
	return c.body(lines.join("\n"), 200, {
		"Content-Type": "text/csv; charset=utf-8",
		"Content-Disposition": "attachment; filename=agentic-inbox-audit.csv",
	});
});
