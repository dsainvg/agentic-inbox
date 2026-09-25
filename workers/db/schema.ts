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
	key_hash: text("key_hash"),
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
	draft_status: text("draft_status"),
	approved_at: text("approved_at"),
	scheduled_at: text("scheduled_at"),
	sent_at: text("sent_at"),
	send_attempts: integer("send_attempts").notNull().default(0),
	last_send_error: text("last_send_error"),
	idempotency_key: text("idempotency_key"),
	draft_receipt: text("draft_receipt"),
});

export const attachments = sqliteTable("attachments", {
	id: text("id").primaryKey(),
	mailbox_id: text("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
	email_id: text("email_id").notNull(),
	filename: text("filename").notNull(),
	mime_type: text("mime_type").notNull(),
	size: integer("size").notNull(),
	r2_key: text("r2_key").notNull().unique(),
	storage_backend: text("storage_backend").notNull().default("r2"),
	content_id: text("content_id"),
	disposition: text("disposition"),
	scan_status: text("scan_status").notNull().default("pending"),
	created_at: text("created_at").notNull(),
});

export const emailAnalyses = sqliteTable("email_analyses", {
	id: text("id").primaryKey(),
	mailbox_id: text("mailbox_id").notNull().references(() => mailboxes.id, { onDelete: "cascade" }),
	email_id: text("email_id").notNull(),
	thread_id: text("thread_id"),
	model: text("model").notNull(),
	classification: text("classification").notNull(),
	confidence: text("confidence").notNull(),
	summary: text("summary").notNull(),
	action_items: text("action_items").notNull().default("[]"),
	evidence: text("evidence").notNull().default("[]"),
	suggested_folder: text("suggested_folder"),
	previous_folder: text("previous_folder"),
	applied_folder: text("applied_folder"),
	applied_at: text("applied_at"),
	created_at: text("created_at").notNull(),
});

export const users = sqliteTable("users", {
	id: text("id").primaryKey(), // "admin"
	password_hash: text("password_hash").notNull(),
	email: text("email").notNull().unique(),
	role: text("role").notNull().default("owner"),
	status: text("status").notNull().default("active"),
	session_version: integer("session_version").notNull().default(0),
	recovery_code_hash: text("recovery_code_hash"),
	created_at: text("created_at").notNull(),
});

export const automationRules = sqliteTable("automation_rules", {
	id: text("id").primaryKey(),
	mailbox_id: text("mailbox_id")
		.notNull()
		.references(() => mailboxes.id, { onDelete: "cascade" }),
	match_field: text("match_field").notNull(), // "from" | "subject" | "to"
	match_value: text("match_value").notNull(), // case-insensitive "contains" text
	actions: text("actions").notNull().default("[]"), // JSON AutomationAction[]
	enabled: integer("enabled").notNull().default(1),
	created_at: text("created_at").notNull(),
});

