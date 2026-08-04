// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import * as schema from "../db/schema";
import type { Env } from "../types";
import { ensureDbInitialized } from "../db/init";

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
		key: apiKey,
		name,
		mailbox_id: mId,
		created_at: createdAt,
	});

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
		keyPreview: `${r.key.slice(0, 8)}...${r.key.slice(-4)}`,
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

	return true;
}

export async function validateApiKey(
	env: Env,
	apiKey: string,
): Promise<{ mailboxId: string; name: string } | null> {
	if (!apiKey || typeof apiKey !== "string") return null;
	await ensureDbInitialized(env.DB);
	const db = drizzle(env.DB, { schema });

	const rows = await db
		.select()
		.from(schema.apiKeys)
		.where(eq(schema.apiKeys.key, apiKey.trim()))
		.limit(1);

	if (rows.length === 0) return null;
	return {
		mailboxId: rows[0].mailbox_id,
		name: rows[0].name,
	};
}
