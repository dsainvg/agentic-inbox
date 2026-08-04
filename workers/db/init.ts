// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

let dbInitialized = false;

export async function ensureDbInitialized(db: D1Database) {
	if (dbInitialized) return;
	try {
		await db.batch([
			db.prepare(`
				CREATE TABLE IF NOT EXISTS mailboxes (
					id TEXT PRIMARY KEY,
					email TEXT NOT NULL UNIQUE,
					name TEXT NOT NULL,
					forward_to TEXT,
					settings TEXT,
					created_at TEXT NOT NULL
				);
			`),
			db.prepare(`
				CREATE TABLE IF NOT EXISTS api_keys (
					id TEXT PRIMARY KEY,
					key TEXT NOT NULL UNIQUE,
					name TEXT NOT NULL,
					mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
					created_at TEXT NOT NULL
				);
			`),
			db.prepare(`
				CREATE TABLE IF NOT EXISTS folders (
					id TEXT PRIMARY KEY,
					mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
					name TEXT NOT NULL,
					is_deletable INTEGER NOT NULL DEFAULT 1
				);
			`),
			db.prepare(`
				CREATE TABLE IF NOT EXISTS emails (
					id TEXT PRIMARY KEY,
					mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
					folder_id TEXT NOT NULL,
					subject TEXT,
					sender TEXT,
					recipient TEXT,
					cc TEXT,
					bcc TEXT,
					date TEXT,
					read INTEGER DEFAULT 0,
					starred INTEGER DEFAULT 0,
					body TEXT,
					in_reply_to TEXT,
					email_references TEXT,
					thread_id TEXT,
					message_id TEXT,
					raw_headers TEXT
				);
			`),
			db.prepare(`
				CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
			`),
			db.prepare(`
				CREATE INDEX IF NOT EXISTS idx_emails_mailbox_folder ON emails(mailbox_id, folder_id);
			`),
			db.prepare(`
				CREATE TABLE IF NOT EXISTS users (
					id TEXT PRIMARY KEY,
					password_hash TEXT NOT NULL,
					created_at TEXT NOT NULL
				);
			`),
		]);
		dbInitialized = true;
	} catch (e) {
		console.error("Failed to initialize D1 database schema:", e);
	}
}
