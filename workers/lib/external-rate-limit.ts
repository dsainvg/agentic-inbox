const WINDOW_MS = 60 * 1000;
const MAX_ATTEMPTS = 10;

async function hashKey(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getIntakeRateKey(request: Request): Promise<string> {
	const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
	const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || forwarded || "unknown";
	return hashKey(ip);
}

export async function enforceIntakeRateLimit(db: D1Database, key: string): Promise<{ allowed: boolean; retryAfter: number }> {
	const bucket = Math.floor(Date.now() / WINDOW_MS);
	const row = await db.prepare(`
		INSERT INTO intake_attempts (key_hash, bucket, attempt_count, updated_at)
		VALUES (?, ?, 1, ?)
		ON CONFLICT(key_hash, bucket) DO UPDATE SET
			attempt_count = attempt_count + 1,
			updated_at = excluded.updated_at
		RETURNING attempt_count
	`).bind(key, bucket, new Date().toISOString()).first<{ attempt_count: number }>();
	const count = row?.attempt_count ?? MAX_ATTEMPTS + 1;
	return {
		allowed: count <= MAX_ATTEMPTS,
		retryAfter: Math.max(1, WINDOW_MS - (Date.now() % WINDOW_MS)),
	};
}
