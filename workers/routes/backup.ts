import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { ensureDbInitialized } from "../db/init";
import { recordAuditEvent } from "../lib/audit";
import { verifySessionToken } from "../lib/session";
import type { Env } from "../types";

type BackupEnv = { Bindings: Env };
type BackupData = {
	version: number;
	mailboxes?: any[];
	folders?: any[];
	emails?: any[];
	automations?: any[];
};

export const backupApi = new Hono<BackupEnv>();

async function requireOwner(c: Context<BackupEnv>) {
	const cookie = getCookie(c, "session");
	if (!cookie) return c.json({ error: "Unauthorized" }, 401);
	try {
		const payload = await verifySessionToken(cookie, c.env);
		if (payload.id !== "admin" || payload.role !== "owner") return c.json({ error: "Owner session required" }, 403);
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}
	return null;
}

function decodeBase64(value: string) {
	return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function decryptEnvelope(body: Record<string, unknown>, passphrase: string): Promise<BackupData> {
	if (body.format !== "aes-gcm" || body.kdf !== "PBKDF2-SHA-256" || typeof body.salt !== "string" || typeof body.iv !== "string" || typeof body.ciphertext !== "string") {
		throw new Error("Invalid backup envelope");
	}
	const encoder = new TextEncoder();
	const salt = decodeBase64(body.salt);
	const iv = decodeBase64(body.iv);
	const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
	const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: Number(body.iterations) || 120000, hash: "SHA-256" }, keyMaterial, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
	const plaintext = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, decodeBase64(body.ciphertext)));
	return JSON.parse(plaintext) as BackupData;
}

function passphraseFrom(c: Context<BackupEnv>) {
	const passphrase = c.req.header("x-export-passphrase") || "";
	return passphrase.length >= 12 ? passphrase : null;
}

backupApi.get("/api/v1/mailboxes/:mailboxId/export", async (c) => {
	const denied = await requireOwner(c);
	if (denied) return denied;
	const mailboxId = c.req.param("mailboxId")!.toLowerCase();
	await ensureDbInitialized(c.env.DB);
	const rows = await c.env.DB.prepare("SELECT id, mailbox_id, folder_id, subject, sender, recipient, cc, bcc, date, read, starred, body, thread_id, message_id, raw_headers FROM emails WHERE mailbox_id = ? ORDER BY date ASC").bind(mailboxId).all();
	return c.json({ version: 1, exportedAt: new Date().toISOString(), mailbox: mailboxId, emails: rows.results, includesSecrets: false, reconstructed: true });
});

backupApi.post("/api/v1/backup/validate", async (c) => {
	const denied = await requireOwner(c);
	if (denied) return denied;
	const passphrase = passphraseFrom(c);
	if (!passphrase) return c.json({ error: "X-Export-Passphrase must be at least 12 characters" }, 400);
	const envelope = await c.req.json().catch(() => null) as Record<string, unknown> | null;
	if (!envelope) return c.json({ error: "Invalid backup envelope" }, 400);
	try {
		const data = await decryptEnvelope(envelope, passphrase);
		if (data.version !== 1) return c.json({ valid: false, error: "Unsupported backup version" }, 400);
		return c.json({ valid: true, version: data.version, counts: { mailboxes: data.mailboxes?.length || 0, folders: data.folders?.length || 0, emails: data.emails?.length || 0, automations: data.automations?.length || 0 } });
	} catch {
		return c.json({ valid: false, error: "Backup could not be decrypted or validated" }, 400);
	}
});

backupApi.post("/api/v1/backup/restore", async (c) => {
	const denied = await requireOwner(c);
	if (denied) return denied;
	const passphrase = passphraseFrom(c);
	if (!passphrase) return c.json({ error: "X-Export-Passphrase must be at least 12 characters" }, 400);
	const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
	if (!body) return c.json({ error: "Invalid backup envelope" }, 400);
	if (body.dryRun === false && body.confirm !== "RESTORE") return c.json({ error: "Set confirm to RESTORE for an actual restore" }, 400);
	try {
		const data = await decryptEnvelope(body, passphrase);
		if (data.version !== 1) return c.json({ error: "Unsupported backup version" }, 400);
		const counts = { mailboxes: data.mailboxes?.length || 0, folders: data.folders?.length || 0, emails: data.emails?.length || 0, automations: data.automations?.length || 0 };
		if (body.dryRun !== false) return c.json({ dryRun: true, valid: true, counts });
		const statements = [
			c.env.DB.prepare("DELETE FROM email_analyses"),
			c.env.DB.prepare("DELETE FROM attachments"),
			c.env.DB.prepare("DELETE FROM reminders"),
			c.env.DB.prepare("DELETE FROM thread_metadata"),
			c.env.DB.prepare("DELETE FROM saved_searches"),
			c.env.DB.prepare("DELETE FROM automation_runs"),
			c.env.DB.prepare("DELETE FROM emails"),
			c.env.DB.prepare("DELETE FROM folders"),
			c.env.DB.prepare("DELETE FROM automation_rules"),
			c.env.DB.prepare("DELETE FROM mailbox_permissions"),
			c.env.DB.prepare("DELETE FROM api_keys"),
			c.env.DB.prepare("DELETE FROM mailboxes"),
		];
		for (const row of data.mailboxes || []) statements.push(c.env.DB.prepare("INSERT INTO mailboxes (id,email,name,forward_to,settings,created_at) VALUES (?,?,?,?,?,?)").bind(row.id, row.email, row.name, row.forward_to ?? null, row.settings ?? null, row.created_at));
		for (const row of data.folders || []) statements.push(c.env.DB.prepare("INSERT INTO folders (id,mailbox_id,name,is_deletable) VALUES (?,?,?,?)").bind(row.id, row.mailbox_id, row.name, row.is_deletable ?? 1));
		for (const row of data.emails || []) statements.push(c.env.DB.prepare("INSERT INTO emails (id,mailbox_id,folder_id,subject,sender,recipient,cc,bcc,date,read,starred,body,in_reply_to,email_references,thread_id,message_id,raw_headers,draft_status,send_attempts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(row.id, row.mailbox_id, row.folder_id, row.subject, row.sender, row.recipient, row.cc, row.bcc, row.date, row.read ?? 0, row.starred ?? 0, row.body, row.in_reply_to, row.email_references, row.thread_id, row.message_id, row.raw_headers, row.draft_status ?? null, row.send_attempts ?? 0));
		for (const row of data.automations || []) statements.push(c.env.DB.prepare("INSERT INTO automation_rules (id,mailbox_id,match_field,match_value,actions,enabled,created_at) VALUES (?,?,?,?,?,?,?)").bind(row.id, row.mailbox_id, row.match_field, row.match_value, row.actions, row.enabled ?? 1, row.created_at));
		if (statements.length > 1000) return c.json({ error: "Backup is too large for a single D1 batch; split the restore by mailbox" }, 413);
		await c.env.DB.batch(statements);
		await recordAuditEvent(c.env.DB, { actorId: "admin", action: "user.create", targetType: "backup_restore", targetId: "restore", metadata: { status: "restored" } });
		return c.json({ dryRun: false, restored: true, counts });
	} catch {
		return c.json({ error: "Backup could not be decrypted or restored" }, 400);
	}
});

backupApi.get("/api/v1/backup", async (c) => {
	const denied = await requireOwner(c);
	if (denied) return denied;
	const passphrase = passphraseFrom(c);
	if (!passphrase) return c.json({ error: "X-Export-Passphrase must be at least 12 characters" }, 400);
	await ensureDbInitialized(c.env.DB);
	const data = {
		version: 1,
		exportedAt: new Date().toISOString(),
		mailboxes: (await c.env.DB.prepare("SELECT id, email, name, forward_to, settings, created_at FROM mailboxes").all()).results,
		folders: (await c.env.DB.prepare("SELECT id, mailbox_id, name, is_deletable FROM folders").all()).results,
		emails: (await c.env.DB.prepare("SELECT id, mailbox_id, folder_id, subject, sender, recipient, cc, bcc, date, read, starred, body, in_reply_to, email_references, thread_id, message_id, raw_headers FROM emails").all()).results,
		automations: (await c.env.DB.prepare("SELECT id, mailbox_id, match_field, match_value, actions, enabled, created_at FROM automation_rules").all()).results,
		includesSecrets: false,
	};
	const encoder = new TextEncoder();
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
	const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" }, keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
	const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(data))));
	const toBase64 = (bytes: Uint8Array) => { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); };
	return c.json({ version: 1, format: "aes-gcm", kdf: "PBKDF2-SHA-256", iterations: 120000, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(ciphertext), includesSecrets: false });
});
