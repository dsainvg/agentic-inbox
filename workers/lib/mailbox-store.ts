// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { and, asc, desc, eq, getTableColumns, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Separate from editable mailbox settings: concurrent settings saves cannot reset quotas.
const sendQuota = sqliteTable("mailbox_tool_send_quota", {
	mailbox_id: text("mailbox_id").primaryKey(),
	minute: integer("minute").notNull(),
	minute_count: integer("minute_count").notNull(),
	day: integer("day").notNull(),
	day_count: integer("day_count").notNull(),
});
const SENDS_PER_MINUTE = 10;
const SENDS_PER_DAY = 100;
import { ensureDbInitialized } from "../db/init";
import { emails, folders, mailboxes } from "../db/schema";
import { Folders } from "../../shared/folders";
import type { EmailFull } from "./schemas";

type EmailRow = typeof emails.$inferSelect;
type EmailInput = Omit<typeof emails.$inferInsert, "mailbox_id" | "folder_id">;
type EmailUpdate = Partial<Pick<EmailInput, "subject" | "recipient" | "body">> & {
	read?: boolean;
	starred?: boolean;
};

function fullEmail(row: EmailRow): EmailFull {
	return {
		...row,
		subject: row.subject ?? "",
		sender: row.sender ?? "",
		recipient: row.recipient ?? "",
		date: row.date ?? "",
		read: Boolean(row.read),
		starred: Boolean(row.starred),
		attachments: [], // D1 currently has no attachment storage.
	};
}

export async function listD1Mailboxes(binding: D1Database) {
	await ensureDbInitialized(binding);
	return drizzle(binding).select({ id: mailboxes.id, email: mailboxes.email })
		.from(mailboxes).orderBy(asc(mailboxes.email));
}

/** A repository is always scoped to one real mailbox, never the UI's "all" view. */
export class MailboxStore {
	readonly mailboxId: string;
	private readonly db;

	constructor(private readonly binding: D1Database, mailboxId: string) {
		this.mailboxId = mailboxId.trim().toLowerCase();
		if (!this.mailboxId || this.mailboxId === "all") {
			throw new Error("A specific mailbox is required");
		}
		this.db = drizzle(binding);
	}

	private scope(emailId?: string) {
		return and(eq(emails.mailbox_id, this.mailboxId),
			emailId === undefined ? undefined : eq(emails.id, emailId));
	}

	async getSettings(): Promise<Record<string, unknown>> {
		await ensureDbInitialized(this.binding);
		const [mailbox] = await this.db.select().from(mailboxes)
			.where(eq(mailboxes.id, this.mailboxId)).limit(1);
		if (!mailbox) throw new Error("Mailbox not found");
		try {
			const value: unknown = JSON.parse(mailbox.settings || "{}");
			return value && typeof value === "object" && !Array.isArray(value)
				? value as Record<string, unknown> : {};
		} catch {
			return {};
		}
	}

	private async folderName(folder: string): Promise<string | null> {
		const [row] = await this.db.select({ name: folders.name }).from(folders)
			.where(and(eq(folders.mailbox_id, this.mailboxId),
				or(eq(folders.name, folder), eq(folders.id, folder)))).limit(1);
		return row?.name ?? null;
	}

	async getEmails(options: {
		folder?: string; limit?: number; page?: number; thread_id?: string;
		sortColumn?: "date"; sortDirection?: "ASC" | "DESC";
	} = {}) {
		await ensureDbInitialized(this.binding);
		const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(100, Math.floor(options.limit!))) : 20;
		const page = Number.isFinite(options.page) ? Math.max(1, Math.min(1000000, Math.floor(options.page!))) : 1;
		const folder = options.folder && ![Folders.ALL_MAIL, "all"].includes(options.folder)
			? await this.folderName(options.folder) : undefined;
		if (folder === null) return [];
		const { body, ...metadata } = getTableColumns(emails);
		const rows = await this.db.select({ ...metadata, snippet: sql<string>`substr(${body}, 1, 200)` })
			.from(emails).where(and(this.scope(),
				folder ? eq(emails.folder_id, folder) : undefined,
				options.thread_id ? eq(emails.thread_id, options.thread_id) : undefined))
			.orderBy(options.sortDirection === "ASC" ? asc(emails.date) : desc(emails.date), asc(emails.id))
			.limit(limit).offset((page - 1) * limit);
		return rows.map(row => ({ ...row, subject: row.subject ?? "", sender: row.sender ?? "",
			recipient: row.recipient ?? "", date: row.date ?? "", read: Boolean(row.read), starred: Boolean(row.starred) }));
	}

	async getEmail(emailId: string) {
		await ensureDbInitialized(this.binding);
		const [row] = await this.db.select().from(emails).where(this.scope(emailId)).limit(1);
		return row ? fullEmail(row) : null;
	}

	async getThreadEmails(threadId: string) {
		await ensureDbInitialized(this.binding);
		const rows = await this.db.select().from(emails)
			.where(and(this.scope(), or(eq(emails.thread_id, threadId), eq(emails.id, threadId))))
			.orderBy(asc(emails.date), asc(emails.id));
		return rows.map(fullEmail);
	}

	async createEmail(folder: string, data: EmailInput, attachments: unknown[] = []) {
		await ensureDbInitialized(this.binding);
		if (attachments.length) throw new Error("Attachments are not supported by D1 storage");
		const folderName = await this.folderName(folder);
		if (!folderName) throw new Error("Folder not found in mailbox");
		const [row] = await this.db.insert(emails).values({
			...data, mailbox_id: this.mailboxId, folder_id: folderName,
			read: data.read ?? (folderName === Folders.INBOX ? 0 : 1),
			starred: data.starred ?? 0,
		}).returning();
		return fullEmail(row);
	}

	async updateEmail(emailId: string, changes: EmailUpdate) {
		await ensureDbInitialized(this.binding);
		const { read, starred, ...content } = changes;
		const update = { ...content, ...(read === undefined ? {} : { read: Number(read) }),
			...(starred === undefined ? {} : { starred: Number(starred) }) };
		if (!Object.keys(update).length) return this.getEmail(emailId);
		const [row] = await this.db.update(emails).set(update).where(this.scope(emailId)).returning();
		return row ? fullEmail(row) : null;
	}

	/** Keep the legacy newDraftId output, but replace in one atomic statement. */
	async replaceDraft(emailId: string, data: EmailInput) {
		await ensureDbInitialized(this.binding);
		const [row] = await this.db.update(emails).set(data)
			.where(and(this.scope(emailId), eq(emails.folder_id, Folders.DRAFT))).returning();
		return row ? fullEmail(row) : null;
	}

	async deleteEmail(emailId: string, requiredFolder?: string) {
		await ensureDbInitialized(this.binding);
		const [row] = await this.db.delete(emails)
			.where(and(this.scope(emailId), requiredFolder ? eq(emails.folder_id, requiredFolder) : undefined))
			.returning({ id: emails.id });
		return row ?? null;
	}

	async moveEmail(emailId: string, folder: string) {
		await ensureDbInitialized(this.binding);
		const folderName = await this.folderName(folder);
		if (!folderName || folderName === Folders.ALL_MAIL) return false;
		const rows = await this.db.update(emails).set({ folder_id: folderName })
			.where(this.scope(emailId)).returning({ id: emails.id });
		return rows.length > 0;
	}

	/**
	 * Atomically reserve an SMTP attempt before delivery (10/minute, 100/UTC day).
	 * Failed/ambiguous sends consume quota too. Never a read-then-count check:
	 * separate MCP instances share this durable counter, even if Sent is deleted.
	 * Kept here because this migration is limited to the repository's files.
	 */
	async checkSendRateLimit(): Promise<string | null> {
		await ensureDbInitialized(this.binding);
		await this.db.run(sql`CREATE TABLE IF NOT EXISTS mailbox_tool_send_quota (
			mailbox_id TEXT PRIMARY KEY REFERENCES mailboxes(id) ON DELETE CASCADE,
			minute INTEGER NOT NULL, minute_count INTEGER NOT NULL,
			day INTEGER NOT NULL, day_count INTEGER NOT NULL
		)`);
		const now = Date.now();
		const minute = Math.floor(now / 60000);
		const day = Math.floor(now / 86400000);
		const rows = await this.db.insert(sendQuota).values({
			mailbox_id: this.mailboxId, minute, minute_count: 1, day, day_count: 1,
		}).onConflictDoUpdate({
			target: sendQuota.mailbox_id,
			set: {
				minute, day,
				minute_count: sql`CASE WHEN ${sendQuota.minute} = ${minute} THEN ${sendQuota.minute_count} + 1 ELSE 1 END`,
				day_count: sql`CASE WHEN ${sendQuota.day} = ${day} THEN ${sendQuota.day_count} + 1 ELSE 1 END`,
			},
			setWhere: and(
				or(sql`${sendQuota.minute} < ${minute}`, sql`${sendQuota.minute_count} < ${SENDS_PER_MINUTE}`),
				or(sql`${sendQuota.day} < ${day}`, sql`${sendQuota.day_count} < ${SENDS_PER_DAY}`),
			),
		}).returning({ id: sendQuota.mailbox_id });
		return rows.length ? null : "Send rate limit exceeded (10 per minute, 100 per day). Please try later.";
	}

	async searchEmails(options: { query: string; folder?: string }) {
		await ensureDbInitialized(this.binding);
		const folder = options.folder && ![Folders.ALL_MAIL, "all"].includes(options.folder)
			? await this.folderName(options.folder) : undefined;
		if (folder === null) return [];
		// instr treats user input literally, including SQL wildcard characters.
		const rows = await this.db.select().from(emails).where(and(this.scope(),
			folder ? eq(emails.folder_id, folder) : undefined,
			or(sql`instr(lower(coalesce(${emails.subject}, '')), lower(${options.query})) > 0`,
				sql`instr(lower(coalesce(${emails.body}, '')), lower(${options.query})) > 0`)))
			.orderBy(desc(emails.date), asc(emails.id)).limit(100);
		return rows.map(row => {
			const { body, attachments, ...metadata } = fullEmail(row);
			return { ...metadata, snippet: (body ?? "").slice(0, 200) };
		});
	}
}
