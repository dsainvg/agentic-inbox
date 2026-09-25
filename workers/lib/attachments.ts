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

type StorageBackend = "r2" | "appwrite";
type StorageAdapter = {
	name: StorageBackend;
	put: (key: string, bytes: Uint8Array, filename: string, mimeType: string) => Promise<void>;
};

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

function appwriteConfig(env: Env) {
	if (!env.APPWRITE_ENDPOINT || !env.APPWRITE_PROJECT_ID || !env.APPWRITE_API_KEY || !env.APPWRITE_BUCKET_ID) return null;
	return {
		endpoint: env.APPWRITE_ENDPOINT.replace(/\/+$/, ""),
		projectId: env.APPWRITE_PROJECT_ID,
		apiKey: env.APPWRITE_API_KEY,
		bucketId: env.APPWRITE_BUCKET_ID,
	};
}

function getStorageAdapters(env: Env): StorageAdapter[] {
	const adapters: StorageAdapter[] = [];
	if (env.ATTACHMENTS) {
		adapters.push({
			name: "r2",
			put: async (key, bytes, _filename, mimeType) => {
				await env.ATTACHMENTS!.put(key, bytes, { httpMetadata: { contentType: mimeType } });
			},
		});
	}
	const appwrite = appwriteConfig(env);
	if (appwrite) {
		adapters.push({
			name: "appwrite",
			put: async (key, bytes, filename, mimeType) => {
				const form = new FormData();
				form.append("file", new Blob([bytes.buffer as ArrayBuffer], { type: mimeType }), filename);
				const response = await fetch(`${appwrite.endpoint}/storage/buckets/${encodeURIComponent(appwrite.bucketId)}/files`, {
					method: "POST",
					headers: { "X-Appwrite-Project": appwrite.projectId, "X-Appwrite-Key": appwrite.apiKey },
					body: form,
				});
				if (!response.ok) throw new Error(`Appwrite upload failed with ${response.status}`);
			},
		});
	}
	return adapters;
}

export async function getAttachmentObject(env: Env, backend: StorageBackend, key: string): Promise<ReadableStream | null> {
	if (backend === "r2") return env.ATTACHMENTS?.get(key).then((object) => object?.body ?? null) ?? null;
	const appwrite = appwriteConfig(env);
	if (!appwrite) return null;
	const response = await fetch(`${appwrite.endpoint}/storage/buckets/${encodeURIComponent(appwrite.bucketId)}/files/${encodeURIComponent(key)}/download`, {
		headers: { "X-Appwrite-Project": appwrite.projectId, "X-Appwrite-Key": appwrite.apiKey },
	});
	if (!response.ok) return null;
	return response.body;
}

async function runScan(env: Env, endpoint: string, bytes: Uint8Array, mimeType: string): Promise<"available" | "quarantined"> {
	try {
		const response = await fetch(endpoint, {
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
	const adapters = getStorageAdapters(env);
	if (adapters.length === 0) return [];
	const stored: StoredAttachment[] = [];
	for (const attachment of attachments.slice(0, 20)) {
		const bytes = toBytes(attachment.content);
		const id = crypto.randomUUID();
		const filename = (attachment.filename || "attachment").replace(/[\r\n]/g, "").slice(0, 200);
		const allowed = ALLOWED_MIME_TYPES.has(attachment.mimeType) && bytes.byteLength <= MAX_ATTACHMENT_SIZE;
		const pathKey = `${mailboxId}/${emailId}/${id}`;
		let backend: StorageBackend | "none" = "none";
		let objectKey = pathKey;
		let scanStatus: StoredAttachment["scanStatus"] = allowed ? "pending" : "quarantined";
		if (allowed) {
			for (const adapter of adapters) {
				try {
					objectKey = adapter.name === "appwrite" ? id : pathKey;
					await adapter.put(objectKey, bytes, filename, attachment.mimeType);
					backend = adapter.name;
					break;
				} catch {
					continue;
				}
			}
			if (backend === "none") {
				await env.DB.prepare("INSERT INTO attachments (id, mailbox_id, email_id, filename, mime_type, size, r2_key, storage_backend, content_id, disposition, scan_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'none', ?, ?, 'failed', ?)").bind(id, mailboxId, emailId, filename, attachment.mimeType, bytes.byteLength, objectKey, attachment.contentId ?? null, attachment.disposition ?? null, new Date().toISOString()).run();
				stored.push({ id, filename, mimeType: attachment.mimeType, size: bytes.byteLength, content_id: attachment.contentId ?? null, disposition: attachment.disposition ?? null, scanStatus: "failed" });
				continue;
			}
			const scanEndpoint = env.ATTACHMENT_SCAN_ENDPOINT;
			scanStatus = scanEndpoint ? await runScan(env, scanEndpoint, bytes, attachment.mimeType) : "available";
		}
		await env.DB.prepare("INSERT INTO attachments (id, mailbox_id, email_id, filename, mime_type, size, r2_key, storage_backend, content_id, disposition, scan_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, mailboxId, emailId, filename, attachment.mimeType, bytes.byteLength, objectKey, backend, attachment.contentId ?? null, attachment.disposition ?? null, scanStatus, new Date().toISOString()).run();
		stored.push({ id, filename, mimeType: attachment.mimeType, size: bytes.byteLength, content_id: attachment.contentId ?? null, disposition: attachment.disposition ?? null, scanStatus });
	}
	return stored;
}

export async function listAttachments(env: Env, mailboxId: string, emailId: string): Promise<StoredAttachment[]> {
	const result = await env.DB.prepare("SELECT id, filename, mime_type, size, content_id, disposition, scan_status FROM attachments WHERE mailbox_id = ? AND email_id = ? ORDER BY created_at ASC").bind(mailboxId, emailId).all<{ id: string; filename: string; mime_type: string; size: number; content_id: string | null; disposition: string | null; scan_status: StoredAttachment["scanStatus"] }>();
	return result.results.map((row) => ({ id: row.id, filename: row.filename, mimeType: row.mime_type, mimetype: row.mime_type, size: row.size, content_id: row.content_id, disposition: row.disposition, scanStatus: row.scan_status }));
}
