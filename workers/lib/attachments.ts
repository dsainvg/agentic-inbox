import type { Attachment } from "postal-mime";
import type { Env } from "../types";

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
	"application/pdf",
	"image/gif",
	"image/jpeg",
	"image/png",
	"image/webp",
	"text/plain",
]);

export type StoredAttachment = {
	id: string;
	filename: string;
	mimeType: string;
	mimetype?: string;
	size: number;
	content_id?: string | null;
	disposition?: string | null;
	scanStatus: "pending" | "available" | "quarantined" | "failed";
};

function toBytes(content: ArrayBuffer | string): Uint8Array {
	if (typeof content === "string") return new TextEncoder().encode(content);
	return new Uint8Array(content);
}

async function runScan(env: Env, bytes: Uint8Array, mimeType: string): Promise<"available" | "quarantined" | "pending"> {
	if (!env.ATTACHMENT_SCAN_ENDPOINT) return "pending";
	try {
		const response = await fetch(env.ATTACHMENT_SCAN_ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": mimeType, ...(env.ATTACHMENT_SCAN_TOKEN ? { Authorization: `Bearer ${env.ATTACHMENT_SCAN_TOKEN}` } : {}) },
			body: bytes.buffer as ArrayBuffer,
		});
		if (!response.ok) return "quarantined";
		const result = await response.json().catch(() => null) as { clean?: unknown } | null;
		return result?.clean === true ? "available" : "quarantined";
	} catch {
		return "quarantined";
	}
}

export async function storeAttachments(env: Env, mailboxId: string, emailId: string, attachments: Attachment[]): Promise<StoredAttachment[]> {
	if (!env.ATTACHMENTS) return [];
	const stored: StoredAttachment[] = [];
	for (const attachment of attachments.slice(0, 20)) {
		const bytes = toBytes(attachment.content);
		const id = crypto.randomUUID();
		const filename = (attachment.filename || "attachment").replace(/[\r\n]/g, "").slice(0, 200);
		const allowed = ALLOWED_MIME_TYPES.has(attachment.mimeType) && bytes.byteLength <= MAX_ATTACHMENT_SIZE;
		const r2Key = `${mailboxId}/${emailId}/${id}`;
		let scanStatus: StoredAttachment["scanStatus"] = allowed ? "pending" : "quarantined";
		if (allowed) {
			try {
				await env.ATTACHMENTS.put(r2Key, bytes, { httpMetadata: { contentType: attachment.mimeType, contentDisposition: `attachment; filename="${filename}"` } });
			} catch {
				await env.DB.prepare("INSERT INTO attachments (id, mailbox_id, email_id, filename, mime_type, size, r2_key, content_id, disposition, scan_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed', ?)").bind(id, mailboxId, emailId, filename, attachment.mimeType, bytes.byteLength, r2Key, attachment.contentId ?? null, attachment.disposition ?? null, new Date().toISOString()).run();
				stored.push({ id, filename, mimeType: attachment.mimeType, size: bytes.byteLength, content_id: attachment.contentId ?? null, disposition: attachment.disposition ?? null, scanStatus: "failed" });
				continue;
			}
			scanStatus = await runScan(env, bytes, attachment.mimeType);
		}
		await env.DB.prepare("INSERT INTO attachments (id, mailbox_id, email_id, filename, mime_type, size, r2_key, content_id, disposition, scan_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, mailboxId, emailId, filename, attachment.mimeType, bytes.byteLength, r2Key, attachment.contentId ?? null, attachment.disposition ?? null, scanStatus, new Date().toISOString()).run();
		stored.push({ id, filename, mimeType: attachment.mimeType, size: bytes.byteLength, content_id: attachment.contentId ?? null, disposition: attachment.disposition ?? null, scanStatus });
	}
	return stored;
}

export async function listAttachments(env: Env, mailboxId: string, emailId: string): Promise<StoredAttachment[]> {
	const result = await env.DB.prepare("SELECT id, filename, mime_type, size, content_id, disposition, scan_status FROM attachments WHERE mailbox_id = ? AND email_id = ? ORDER BY created_at ASC").bind(mailboxId, emailId).all<{ id: string; filename: string; mime_type: string; size: number; content_id: string | null; disposition: string | null; scan_status: StoredAttachment["scanStatus"] }>();
	return result.results.map((row) => ({ id: row.id, filename: row.filename, mimeType: row.mime_type, mimetype: row.mime_type, size: row.size, content_id: row.content_id, disposition: row.disposition, scanStatus: row.scan_status }));
}
