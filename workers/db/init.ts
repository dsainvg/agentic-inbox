// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

const initialized = new WeakMap<D1Database, Promise<void>>();

export function ensureDbInitialized(db: D1Database): Promise<void> {
	let pending = initialized.get(db);
	if (!pending) {
		pending = initialize(db).catch((error) => {
			initialized.delete(db);
			throw error;
		});
		initialized.set(db, pending);
	}
	return pending;
}

/** Upgrade old rules in place; never discard owner-authored rules. */
async function migrateAutomationRules(db: D1Database) {
	const columns = await db.prepare(`PRAGMA table_info(automation_rules)`).all<{ name: string }>();
	const names = new Set(columns.results.map((c) => c.name));
	if (names.has("actions")) return;
	const folder = names.has("target_folder") ? "target_folder" : "NULL";
	const read = names.has("mark_read") ? "mark_read" : "0";
	try {
		await db.batch([
			db.prepare(`ALTER TABLE automation_rules ADD COLUMN actions TEXT NOT NULL DEFAULT '[]'`),
			db.prepare(`UPDATE automation_rules SET actions = CASE
				WHEN ${folder} IS NOT NULL AND ${folder} <> '' THEN
					CASE WHEN ${read} = 1 THEN json_array(json_object('type','file','folder',${folder}),json_object('type','mark_read'))
					ELSE json_array(json_object('type','file','folder',${folder})) END
				WHEN ${read} = 1 THEN json_array(json_object('type','mark_read')) ELSE '[]' END`),
		]);
	} catch (error) {
		// Another isolate may have completed the same atomic migration.
		const current = await db.prepare(`PRAGMA table_info(automation_rules)`).all<{ name: string }>();
		if (!current.results.some((c) => c.name === "actions")) throw error;
	}
}

async function initialize(db: D1Database) {
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
			db.prepare(`
				CREATE TABLE IF NOT EXISTS automation_rules (
					id TEXT PRIMARY KEY,
					mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
					match_field TEXT NOT NULL,
					match_value TEXT NOT NULL,
					actions TEXT NOT NULL DEFAULT '[]',
					enabled INTEGER NOT NULL DEFAULT 1,
					created_at TEXT NOT NULL
				);
			`),
			db.prepare(`
				CREATE INDEX IF NOT EXISTS idx_automation_rules_mailbox ON automation_rules(mailbox_id);
			`),
		]);
		await migrateAutomationRules(db);
		// Ensure standard system folders exist for all mailboxes
		await db
			.prepare(
				`INSERT OR IGNORE INTO folders (id, mailbox_id, name, is_deletable)
				SELECT m.id || ':' || f.name, m.id, f.name, 0
				FROM mailboxes m
				CROSS JOIN (
					SELECT 'inbox' AS name UNION ALL
					SELECT 'sent' UNION ALL
					SELECT 'draft' UNION ALL
					SELECT 'archive' UNION ALL
					SELECT 'trash'
				) f`,
			)
			.run()
			.catch((e) => console.error("System folders seed failed:", (e as Error).message));
		await initializeHierarchy(db);
	} catch (e) {
		console.error("Failed to initialize D1 database schema:", e);
		throw e;
	}
}

/** Constraints also protect against concurrent requests in different isolates. */
async function initializeHierarchy(db: D1Database) {
	const statements = [
		`CREATE TABLE IF NOT EXISTS workspace_groups (
			id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
			parent_id TEXT REFERENCES workspace_groups(id) ON DELETE RESTRICT,
			CHECK(parent_id IS NULL OR parent_id <> id))`,
		`CREATE INDEX IF NOT EXISTS idx_workspace_groups_parent ON workspace_groups(parent_id)`,
		`CREATE TABLE IF NOT EXISTS workspace_group_members (
			group_id TEXT NOT NULL REFERENCES workspace_groups(id) ON DELETE CASCADE,
			mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
			PRIMARY KEY(group_id, mailbox_id))`,
		`CREATE INDEX IF NOT EXISTS idx_workspace_members_mailbox ON workspace_group_members(mailbox_id)`,
		`CREATE TABLE IF NOT EXISTS owner_memory (
			scope_type TEXT NOT NULL CHECK(scope_type IN ('all','group','mailbox')),
			scope_id TEXT NOT NULL, content TEXT NOT NULL CHECK(length(content) <= 4000),
			revision INTEGER NOT NULL CHECK(revision >= 1), updated_at TEXT NOT NULL,
			PRIMARY KEY(scope_type, scope_id), CHECK(scope_type <> 'all' OR scope_id = 'all'))`,
		`CREATE TABLE IF NOT EXISTS scoped_automation_rules (
			id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
			scope_type TEXT NOT NULL CHECK(scope_type IN ('all','group','mailboxes')),
			scope_ids TEXT NOT NULL CHECK(json_valid(scope_ids) AND json_type(scope_ids) = 'array'),
			match_field TEXT NOT NULL CHECK(match_field IN ('from','subject','to')),
			match_value TEXT NOT NULL CHECK(length(match_value) BETWEEN 1 AND 200),
			actions TEXT NOT NULL CHECK(json_valid(actions) AND json_type(actions) = 'array'),
			enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), created_at TEXT NOT NULL)`,
		`CREATE INDEX IF NOT EXISTS idx_scoped_automations_enabled ON scoped_automation_rules(enabled,created_at,id)`,
		`CREATE TRIGGER IF NOT EXISTS hierarchy_group_limit BEFORE INSERT ON workspace_groups
			WHEN (SELECT count(*) FROM workspace_groups) >= 64
			BEGIN SELECT RAISE(ABORT, 'hierarchy: group limit'); END`,
		`CREATE TRIGGER IF NOT EXISTS hierarchy_rule_limit BEFORE INSERT ON scoped_automation_rules
			WHEN (SELECT count(*) FROM scoped_automation_rules) >= 500
			BEGIN SELECT RAISE(ABORT, 'hierarchy: automation limit'); END`,
		`CREATE TRIGGER IF NOT EXISTS hierarchy_group_cycle BEFORE UPDATE OF parent_id ON workspace_groups
			WHEN NEW.parent_id IS NOT NULL BEGIN
			SELECT RAISE(ABORT, 'hierarchy: group cycle') WHERE NEW.id IN (
				WITH RECURSIVE ancestors(id) AS (SELECT NEW.parent_id UNION
				SELECT g.parent_id FROM workspace_groups g JOIN ancestors a ON g.id = a.id WHERE g.parent_id IS NOT NULL)
				SELECT id FROM ancestors); END`,
		`CREATE TRIGGER IF NOT EXISTS hierarchy_group_delete BEFORE DELETE ON workspace_groups BEGIN
			SELECT RAISE(ABORT, 'hierarchy: group has children or automation references')
			WHERE EXISTS(SELECT 1 FROM workspace_groups WHERE parent_id = OLD.id)
			OR EXISTS(SELECT 1 FROM scoped_automation_rules r, json_each(r.scope_ids) s WHERE r.scope_type = 'group' AND s.value = OLD.id);
			DELETE FROM owner_memory WHERE scope_type = 'group' AND scope_id = OLD.id;
			DELETE FROM workspace_group_members WHERE group_id = OLD.id; END`,
		`CREATE TRIGGER IF NOT EXISTS hierarchy_mailbox_memory_delete AFTER DELETE ON mailboxes BEGIN
			DELETE FROM owner_memory WHERE scope_type = 'mailbox' AND scope_id = OLD.id;
			DELETE FROM workspace_group_members WHERE mailbox_id = OLD.id;
			DELETE FROM scoped_automation_rules WHERE scope_type = 'mailboxes' AND json_array_length(scope_ids) = 1
				AND EXISTS(SELECT 1 FROM json_each(scope_ids) WHERE value = OLD.id);
			UPDATE scoped_automation_rules SET scope_ids = (SELECT json_group_array(value) FROM json_each(scope_ids) WHERE value <> OLD.id)
				WHERE scope_type = 'mailboxes' AND EXISTS(SELECT 1 FROM json_each(scope_ids) WHERE value = OLD.id); END`,
	];
	for (const event of ["INSERT", "UPDATE"] as const) {
		statements.push(`CREATE TRIGGER IF NOT EXISTS hierarchy_memory_${event.toLowerCase()} BEFORE ${event} ON owner_memory BEGIN
			SELECT RAISE(ABORT, 'hierarchy: memory scope not found') WHERE
			(NEW.scope_type = 'group' AND NOT EXISTS(SELECT 1 FROM workspace_groups WHERE id = NEW.scope_id)) OR
			(NEW.scope_type = 'mailbox' AND NOT EXISTS(SELECT 1 FROM mailboxes WHERE id = NEW.scope_id)); END`);
		statements.push(`CREATE TRIGGER IF NOT EXISTS hierarchy_rule_${event.toLowerCase()} BEFORE ${event} ON scoped_automation_rules BEGIN
			SELECT RAISE(ABORT, 'hierarchy: invalid automation scope') WHERE
			(NEW.scope_type = 'all' AND json_array_length(NEW.scope_ids) <> 0) OR
			(NEW.scope_type <> 'all' AND json_array_length(NEW.scope_ids) NOT BETWEEN 1 AND 256) OR
			EXISTS(SELECT 1 FROM json_each(NEW.scope_ids) s WHERE s.type <> 'text' OR
			(NEW.scope_type = 'group' AND NOT EXISTS(SELECT 1 FROM workspace_groups WHERE id = s.value)) OR
			(NEW.scope_type = 'mailboxes' AND NOT EXISTS(SELECT 1 FROM mailboxes WHERE id = s.value))); END`);
	}
	await db.batch(statements.map((sql) => db.prepare(sql)));
}
