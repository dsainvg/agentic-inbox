// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const mailboxes = sqliteTable("mailboxes", {
	id: text("id").primaryKey(), // mailbox email e.g. hello@example.com
	email: text("email").notNull().unique(),
	name: text("name").notNull(),
	forward_to: text("forward_to"),
	settings: text("settings"), // JSON string
	created_at: text("created_at").notNull(),
});

export const apiKeys = sqliteTable("api_keys", {
	id: text("id").primaryKey(),
	key: text("key").notNull().unique(),
	name: text("name").notNull(),
	mailbox_id: text("mailbox_id")
		.notNull()
		.references(() => mailboxes.id, { onDelete: "cascade" }),
	created_at: text("created_at").notNull(),
});

export const folders = sqliteTable("folders", {
	id: text("id").primaryKey(),
	mailbox_id: text("mailbox_id")
		.notNull()
		.references(() => mailboxes.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	is_deletable: integer("is_deletable").notNull().default(1),
});

export const emails = sqliteTable("emails", {
	id: text("id").primaryKey(),
	mailbox_id: text("mailbox_id")
		.notNull()
		.references(() => mailboxes.id, { onDelete: "cascade" }),
	folder_id: text("folder_id").notNull(),
	subject: text("subject"),
	sender: text("sender"),
	recipient: text("recipient"),
	cc: text("cc"),
	bcc: text("bcc"),
	date: text("date"),
	read: integer("read").default(0),
	starred: integer("starred").default(0),
	body: text("body"),
	in_reply_to: text("in_reply_to"),
	email_references: text("email_references"),
	thread_id: text("thread_id"),
	message_id: text("message_id"),
	raw_headers: text("raw_headers"),
});
