import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { verifySessionToken } from "../lib/session";
import { ensureDbInitialized } from "../db/init";
import type { Env } from "../types";
import {
	getEffectiveMemory, getMemory, HIERARCHY_LIMITS as LIMITS, serializeScopedRule,
	type GroupRow, type MemoryScope, type ScopedRuleRow,
} from "../lib/hierarchy";

type SettingsEnv = { Bindings: Env };
export const hierarchyApi = new Hono<SettingsEnv>();

hierarchyApi.onError((error, c) => {
	if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
	if (error instanceof z.ZodError) return c.json({ error: "Invalid request", issues: error.issues }, 400);
	if (String(error).includes("hierarchy:")) return c.json({ error: "Hierarchy conflict: limit, cycle, or referenced scope" }, 409);
	if (String(error).includes("FOREIGN KEY constraint failed")) return c.json({ error: "Referenced group or mailbox no longer exists" }, 409);
	console.error("Hierarchy API failed", error);
	return c.json({ error: "Unable to process settings request" }, 500);
});

// Independent owner boundary: API keys, tools and outer middleware cannot authorize this router.
hierarchyApi.use("*", async (c, next) => {
	const origin = c.req.header("origin");
	if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "Forbidden origin" }, 403);
	const cookie = getCookie(c, "session");
	if (!cookie) return c.json({ error: "Unauthorized" }, 401);
	try {
		const payload = await verifySessionToken(cookie, c.env, false);
		if (payload.id !== "admin") return c.json({ error: "Owner session required" }, 403);
		await ensureDbInitialized(c.env.DB);
		if (!await c.env.DB.prepare(`SELECT id FROM users WHERE id = 'admin'`).first()) return c.json({ error: "Owner session required" }, 403);
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}
	await next();
});
hierarchyApi.use("*", bodyLimit({ maxSize: LIMITS.requestBytes, onError: (c) => c.json({ error: "Request too large" }, 413) }));

const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const mailboxSchema = z.string().max(254).email().transform((s) => s.toLowerCase());
const nameSchema = z.string().trim().min(1).max(LIMITS.name);
const groupSchema = z.object({
	name: nameSchema, parentId: idSchema.nullable().optional(),
	members: z.array(mailboxSchema).max(LIMITS.members).optional(),
	mailboxIds: z.array(mailboxSchema).max(LIMITS.members).optional(),
}).strict();
const memorySchema = z.object({
	scopeType: z.enum(["all", "group", "mailbox"]), scopeId: z.string().max(254),
	content: z.string().max(LIMITS.memory), revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
}).strict();
const folder = z.enum(["inbox", "sent", "draft", "archive", "trash"]);
const branches = { onSuccessFolder: folder.optional(), onFailureFolder: folder.optional() };
const actionSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("file"), folder }).strict(),
	z.object({ type: z.literal("mark_read") }).strict(),
	z.object({ type: z.literal("star") }).strict(),
	z.object({ type: z.literal("auto_reply"), body: z.string().trim().min(1).max(5000), ...branches }).strict(),
	z.object({ type: z.literal("ai_reply"), prompt: z.string().max(1000).optional(), ...branches }).strict(),
]);
const ruleSchema = z.object({
	name: nameSchema, scopeType: z.enum(["all", "group", "mailboxes"]),
	scopeIds: z.array(z.string().min(1).max(254)).max(LIMITS.scopeIds),
	matchField: z.enum(["from", "subject", "to"]), matchValue: z.string().trim().min(1).max(200),
	actions: z.array(actionSchema).min(1).max(LIMITS.actions), enabled: z.boolean().optional(),
}).strict();

async function jsonBody(c: Context<SettingsEnv>): Promise<unknown> {
	try { return await c.req.json(); } catch (error) {
		// Preserve streamed body-limit failures instead of reporting malformed JSON.
		if (error instanceof Error && error.name === "BodyLimitError") {
			throw new HTTPException(413, { message: "Request too large" });
		}
		throw new HTTPException(400, { message: "Invalid JSON body" });
	}
}
async function requireIds(db: D1Database, table: "mailboxes" | "workspace_groups", ids: string[]) {
	if (!ids.length) return;
	const result = await db.prepare(`SELECT id FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`)
		.bind(JSON.stringify(ids)).all<{ id: string }>();
	const known = new Set(result.results.map((r) => r.id));
	if (ids.some((id) => !known.has(id))) throw new HTTPException(404, { message: `${table === "mailboxes" ? "Mailbox" : "Group"} not found` });
}
async function memoryScope(db: D1Database, type: unknown, id: unknown): Promise<{ scopeType: MemoryScope; scopeId: string }> {
	const scopeType = z.enum(["all", "group", "mailbox"]).parse(type);
	const scopeId = scopeType === "all" ? z.literal("all").parse(id)
		: scopeType === "group" ? idSchema.parse(id) : mailboxSchema.parse(id);
	if (scopeType !== "all") await requireIds(db, scopeType === "group" ? "workspace_groups" : "mailboxes", [scopeId]);
	return { scopeType, scopeId };
}


function groupMembers(body: { members?: string[]; mailboxIds?: string[] }) {
	if (body.members !== undefined && body.mailboxIds !== undefined) throw new HTTPException(400, { message: "Use members or mailboxIds, not both" });
	const ids = body.members ?? body.mailboxIds;
	return ids === undefined ? undefined : [...new Set(ids)].sort();
}
async function groupResponse(db: D1Database, id: string) {
	const group = await db.prepare(`SELECT * FROM workspace_groups WHERE id = ?`).bind(id).first<GroupRow>();
	if (!group) throw new HTTPException(404, { message: "Group not found" });
	const members = await db.prepare(`SELECT mailbox_id FROM workspace_group_members WHERE group_id = ? ORDER BY mailbox_id`)
		.bind(id).all<{ mailbox_id: string }>();
	return { id: group.id, name: group.name, parentId: group.parent_id, mailboxIds: members.results.map((m) => m.mailbox_id) };
}

hierarchyApi.get("/groups", async (c) => {
	const [groups, members] = await c.env.DB.batch([
		c.env.DB.prepare(`SELECT * FROM workspace_groups ORDER BY id`),
		c.env.DB.prepare(`SELECT group_id, mailbox_id FROM workspace_group_members ORDER BY mailbox_id`),
	]);
	return c.json({ groups: (groups.results as GroupRow[]).map((g) => ({
		id: g.id, name: g.name, parentId: g.parent_id,
		mailboxIds: (members.results as Array<{ group_id: string; mailbox_id: string }>).filter((m) => m.group_id === g.id).map((m) => m.mailbox_id),
	})) });
});

hierarchyApi.post("/groups", async (c) => {
	const body = groupSchema.parse(await jsonBody(c));
	const db = c.env.DB;
	const members = groupMembers(body) ?? [];
	await requireIds(db, "mailboxes", members);
	if (body.parentId) await requireIds(db, "workspace_groups", [body.parentId]);
	const id = crypto.randomUUID();
	await db.batch([
		db.prepare(`INSERT INTO workspace_groups(id,name,parent_id) VALUES(?,?,?)`).bind(id, body.name, body.parentId ?? null),
		db.prepare(`INSERT INTO workspace_group_members(group_id,mailbox_id) SELECT ?,value FROM json_each(?)`).bind(id, JSON.stringify(members)),
	]);
	return c.json(await groupResponse(db, id), 201);
});

hierarchyApi.put("/groups/:id", async (c) => {
	const id = idSchema.parse(c.req.param("id"));
	const body = groupSchema.partial().parse(await jsonBody(c));
	if (!Object.keys(body).length) throw new HTTPException(400, { message: "No group changes supplied" });
	const db = c.env.DB;
	const members = groupMembers(body);
	await requireIds(db, "workspace_groups", [id]);
	if (body.parentId === id) throw new HTTPException(400, { message: "Group cycle rejected" });
	if (body.parentId) await requireIds(db, "workspace_groups", [body.parentId]);
	if (members) await requireIds(db, "mailboxes", members);
	const statements = [db.prepare(`UPDATE workspace_groups SET name = COALESCE(?,name),
		parent_id = CASE WHEN ? = 1 THEN ? ELSE parent_id END WHERE id = ?`)
		.bind(body.name ?? null, body.parentId !== undefined ? 1 : 0, body.parentId ?? null, id)];
	if (members !== undefined) statements.push(
		db.prepare(`DELETE FROM workspace_group_members WHERE group_id = ?`).bind(id),
		db.prepare(`INSERT INTO workspace_group_members(group_id,mailbox_id) SELECT ?,value FROM json_each(?)`).bind(id, JSON.stringify(members)),
	);
	await db.batch(statements);
	return c.json(await groupResponse(db, id));
});

hierarchyApi.delete("/groups/:id", async (c) => {
	const id = idSchema.parse(c.req.param("id"));
	const result = await c.env.DB.prepare(`DELETE FROM workspace_groups WHERE id = ?`).bind(id).run();
	if (!result.meta.changes) throw new HTTPException(404, { message: "Group not found" });
	return c.body(null, 204);
});

hierarchyApi.get("/memory", async (c) => {
	const scope = await memoryScope(c.env.DB, c.req.query("scopeType"), c.req.query("scopeId"));
	return c.json(await getMemory(c.env.DB, scope.scopeType, scope.scopeId));
});

hierarchyApi.put("/memory", async (c) => {
	const body = memorySchema.parse(await jsonBody(c));
	const { scopeType, scopeId } = await memoryScope(c.env.DB, body.scopeType, body.scopeId);
	const db = c.env.DB;
	// Revision 0 is create-only. All later writes are compare-and-swap, never an upsert.
	const statement = body.revision === 0
		? db.prepare(`INSERT INTO owner_memory(scope_type,scope_id,content,revision,updated_at) VALUES(?,?,?,1,?)
			ON CONFLICT(scope_type,scope_id) DO NOTHING RETURNING revision`)
			.bind(scopeType, scopeId, body.content, new Date().toISOString())
		: db.prepare(`UPDATE owner_memory SET content = ?, revision = revision + 1, updated_at = ?
			WHERE scope_type = ? AND scope_id = ? AND revision = ? RETURNING revision`)
			.bind(body.content, new Date().toISOString(), scopeType, scopeId, body.revision);
	const updated = await statement.first<{ revision: number }>();
	if (!updated) return c.json({ error: "Memory revision conflict", memory: await getMemory(db, scopeType, scopeId) }, 409);
	return c.json({ scopeType, scopeId, content: body.content, revision: updated.revision });
});

hierarchyApi.get("/effective-memory/:mailboxId", async (c) => {
	const mailboxId = mailboxSchema.parse(c.req.param("mailboxId"));
	await requireIds(c.env.DB, "mailboxes", [mailboxId]);
	return c.json(await getEffectiveMemory(c.env.DB, mailboxId));
});

async function validateRule(db: D1Database, value: unknown) {
	const body = ruleSchema.parse(value);
	const ids = body.scopeIds.map((id) => body.scopeType === "mailboxes" ? mailboxSchema.parse(id) : idSchema.parse(id));
	if (body.scopeType === "all" ? ids.length !== 0 : ids.length === 0) throw new HTTPException(400, { message: "all requires empty scopeIds; other scopes require at least one ID" });
	const scopeIds = [...new Set(ids)].sort();
	if (body.scopeType !== "all") await requireIds(db, body.scopeType === "group" ? "workspace_groups" : "mailboxes", scopeIds);
	return { ...body, scopeIds, enabled: body.enabled ?? true };
}
async function requireRule(db: D1Database, id: string) {
	const rule = await db.prepare(`SELECT * FROM scoped_automation_rules WHERE id = ?`).bind(id).first<ScopedRuleRow>();
	if (!rule) throw new HTTPException(404, { message: "Automation not found" });
	return rule;
}

hierarchyApi.get("/automations", async (c) => {
	const rows = await c.env.DB.prepare(`SELECT * FROM scoped_automation_rules ORDER BY created_at,id`).all<ScopedRuleRow>();
	return c.json({ automations: rows.results.map(serializeScopedRule) });
});

hierarchyApi.post("/automations", async (c) => {
	const body = await validateRule(c.env.DB, await jsonBody(c));
	const id = crypto.randomUUID();
	const createdAt = new Date().toISOString();
	await c.env.DB.prepare(`INSERT INTO scoped_automation_rules
		(id,name,scope_type,scope_ids,match_field,match_value,actions,enabled,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
		.bind(id, body.name, body.scopeType, JSON.stringify(body.scopeIds), body.matchField, body.matchValue,
			JSON.stringify(body.actions), body.enabled ? 1 : 0, createdAt).run();
	return c.json({ id, ...body, createdAt }, 201);
});

hierarchyApi.put("/automations/:id", async (c) => {
	const id = idSchema.parse(c.req.param("id"));
	const old = serializeScopedRule(await requireRule(c.env.DB, id));
	const patch = ruleSchema.partial().parse(await jsonBody(c));
	if (!Object.keys(patch).length) throw new HTTPException(400, { message: "No automation changes supplied" });
	const { id: _id, createdAt: _createdAt, ...previous } = old;
	const body = await validateRule(c.env.DB, { ...previous, ...patch });
	const result = await c.env.DB.prepare(`UPDATE scoped_automation_rules SET name=?,scope_type=?,scope_ids=?,match_field=?,match_value=?,actions=?,enabled=? WHERE id=?`)
		.bind(body.name, body.scopeType, JSON.stringify(body.scopeIds), body.matchField, body.matchValue,
			JSON.stringify(body.actions), body.enabled ? 1 : 0, id).run();
	if (!result.meta.changes) throw new HTTPException(404, { message: "Automation not found" });
	return c.json({ id, ...body, createdAt: old.createdAt });
});

hierarchyApi.delete("/automations/:id", async (c) => {
	const id = idSchema.parse(c.req.param("id"));
	const result = await c.env.DB.prepare(`DELETE FROM scoped_automation_rules WHERE id=?`).bind(id).run();
	if (!result.meta.changes) throw new HTTPException(404, { message: "Automation not found" });
	return c.body(null, 204);
});
