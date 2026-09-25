import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { recordAuditEvent } from "../lib/audit";
import { getAttachmentObject } from "../lib/attachments";
import { verifySessionToken } from "../lib/session";
import type { Env } from "../types";

type AttachmentEnv = { Bindings: Env };
export const attachmentsApi = new Hono<AttachmentEnv>();

async function requireOwner(c: Context<AttachmentEnv>, ownerOnly = false) {
	const cookie = getCookie(c, "session");
	if (!cookie) return c.json({ error: "Unauthorized" }, 401);
	try {
		const payload = await verifySessionToken(cookie, c.env);
		if (payload.id !== "admin" || (ownerOnly && payload.role !== "owner")) return c.json({ error: "Owner session required" }, 403);
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}
	return null;
}

function storageConfigured(env: Env) {
	return Boolean(env.ATTACHMENTS || (env.APPWRITE_ENDPOINT && env.APPWRITE_PROJECT_ID && env.APPWRITE_API_KEY && env.APPWRITE_BUCKET_ID));
}

function attachmentResponse(object: ReadableStream, mimeType: string, filename: string) {
	return new Response(object, {
		headers: {
			"Content-Type": mimeType,
			"Content-Disposition": `attachment; filename="${filename.replaceAll('"', "")}"`,
			"X-Content-Type-Options": "nosniff",
		},
	});
}

attachmentsApi.get("/api/v1/mailboxes/:mailboxId/emails/:emailId/attachments/:attachmentId", async (c) => {
	const denied = await requireOwner(c);
	if (denied) return denied;
	if (!storageConfigured(c.env)) return c.json({ error: "Attachment storage is not configured" }, 503);
	const row = await c.env.DB.prepare("SELECT r2_key, storage_backend, filename, mime_type, scan_status FROM attachments WHERE id = ? AND mailbox_id = ? AND email_id = ?").bind(c.req.param("attachmentId")!, c.req.param("mailboxId")!.toLowerCase(), c.req.param("emailId")!).first<{ r2_key: string; storage_backend: string; filename: string; mime_type: string; scan_status: string }>();
	if (!row || row.scan_status !== "available") return c.json({ error: "Attachment not found" }, 404);
	const object = await getAttachmentObject(c.env, row.storage_backend === "appwrite" ? "appwrite" : "r2", row.r2_key);
	return object ? attachmentResponse(object, row.mime_type, row.filename) : c.json({ error: "Attachment not found" }, 404);
});

attachmentsApi.post("/api/v1/attachments/:attachmentId/release", async (c) => {
	const denied = await requireOwner(c, true);
	if (denied) return denied;
	const id = c.req.param("attachmentId")!;
	const row = await c.env.DB.prepare("SELECT id, scan_status FROM attachments WHERE id = ?").bind(id).first<{ id: string; scan_status: string }>();
	if (!row) return c.json({ error: "Attachment not found" }, 404);
	if (row.scan_status !== "available") {
		await c.env.DB.prepare("UPDATE attachments SET scan_status = 'available' WHERE id = ?").bind(id).run();
		await recordAuditEvent(c.env.DB, { actorId: "admin", action: "attachment.release", targetType: "attachment", targetId: id, metadata: { status: "released" } });
	}
	return c.json({ id, status: "available" });
});

attachmentsApi.get("/api/v1/attachments/:attachmentId", async (c) => {
	const denied = await requireOwner(c);
	if (denied) return denied;
	if (!storageConfigured(c.env)) return c.json({ error: "Attachment storage is not configured" }, 503);
	const row = await c.env.DB.prepare("SELECT r2_key, storage_backend, filename, mime_type, scan_status FROM attachments WHERE id = ?").bind(c.req.param("attachmentId")!).first<{ r2_key: string; storage_backend: string; filename: string; mime_type: string; scan_status: string }>();
	if (!row || row.scan_status !== "available") return c.json({ error: "Attachment not found" }, 404);
	const object = await getAttachmentObject(c.env, row.storage_backend === "appwrite" ? "appwrite" : "r2", row.r2_key);
	return object ? attachmentResponse(object, row.mime_type, row.filename) : c.json({ error: "Attachment not found" }, 404);
});
