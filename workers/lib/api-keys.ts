// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { drizzle } from "drizzle-orm/d1";
import { eq, and, or } from "drizzle-orm";
import * as schema from "../db/schema";
import type { Env } from "../types";
import { ensureDbInitialized } from "../db/init";
import { recordAuditEvent } from "./audit";

export interface ApiKeyRecord {
	id: string;
	key: string;
	name: string;
	mailboxId: string;
	createdAt: string;
}

export interface ApiKeySummary {
	id: string;
	keyPreview: string;
	name: string;
	createdAt: string;
}

async function hashApiKey(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function generateApiKey(
	env: Env,
	mailboxId: string,
	name: string,
): Promise<ApiKeyRecord> {
	await ensureDbInitialized(env.DB);
	const db = drizzle(env.DB, { schema });

	const rawUuid = crypto.randomUUID().replace(/-/g, "");
	const apiKey = `ag_${rawUuid}`;
	const keyId = crypto.randomUUID();
	const createdAt = new Date().toISOString();
	const mId = mailboxId.toLowerCase();

	await db.insert(schema.apiKeys).values({
		id: keyId,
		key: `stored_${keyId}`,
		key_hash: await hashApiKey(apiKey),
		name,
		mailbox_id: mId,
		created_at: createdAt,
	});
	await recordAuditEvent(env.DB, { actorId: "admin", action: "api_key.create", mailboxId: mId, targetType: "api_key", targetId: keyId });

	return {
		id: keyId,
		key: apiKey,
		name,
		mailboxId: mId,
		createdAt,
	};
}

export async function listApiKeys(
	env: Env,
	mailboxId: string,
): Promise<ApiKeySummary[]> {
	await ensureDbInitialized(env.DB);
	const db = drizzle(env.DB, { schema });
	const mId = mailboxId.toLowerCase();

	const rows = await db
		.select()
		.from(schema.apiKeys)
		.where(eq(schema.apiKeys.mailbox_id, mId));

	return rows.map((r) => ({
		id: r.id,
		keyPreview: r.key_hash ? "stored (revoked value not recoverable)" : `${r.key.slice(0, 8)}...${r.key.slice(-4)}`,
		name: r.name,
		createdAt: r.created_at,
	}));
}

export async function revokeApiKey(
	env: Env,
	mailboxId: string,
	keyId: string,
): Promise<boolean> {
	await ensureDbInitialized(env.DB);
	const db = drizzle(env.DB, { schema });
	const mId = mailboxId.toLowerCase();

	const res = await db
		.delete(schema.apiKeys)
		.where(and(eq(schema.apiKeys.id, keyId), eq(schema.apiKeys.mailbox_id, mId)));
	if (res.meta.changes > 0) {
		await recordAuditEvent(env.DB, { actorId: "admin", action: "api_key.revoke", mailboxId: mId, targetType: "api_key", targetId: keyId });
	}

	return true;
}

export async function validateApiKey(
	env: Env,
	apiKey: string,
): Promise<{ mailboxId: string; name: string } | null> {
	if (!apiKey || typeof apiKey !== "string") return null;
	await ensureDbInitialized(env.DB);
	const db = drizzle(env.DB, { schema });

	const normalized = apiKey.trim();
	const keyHash = await hashApiKey(normalized);
	const rows = await db
		.select()
		.from(schema.apiKeys)
		.where(or(eq(schema.apiKeys.key_hash, keyHash), eq(schema.apiKeys.key, normalized)))
		.limit(1);

	if (rows.length === 0) return null;
	if (!rows[0].key_hash) {
		await db.update(schema.apiKeys).set({ key_hash: keyHash, key: `stored_${rows[0].id}` }).where(eq(schema.apiKeys.id, rows[0].id));
	}
	return {
		mailboxId: rows[0].mailbox_id,
		name: rows[0].name,
	};
}
