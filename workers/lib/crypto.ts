// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Post-quantum resistant password hashing using PBKDF2-SHA-512.
 *
 * Why this is post-quantum safe:
 * - Quantum computers (Grover's algorithm) give at most a √N speedup on hash
 *   preimage searches. SHA-512 has 512-bit output → 256-bit effective security
 *   even with Grover's speedup. That is considered unconditionally beyond
 *   quantum reach for the foreseeable future.
 * - 600,000 iterations is the OWASP 2024 minimum for PBKDF2-SHA-512, chosen
 *   to keep brute-force infeasible even on dedicated ASIC hardware.
 * - 32-byte (256-bit) random salt eliminates rainbow-table attacks entirely.
 *
 * Hash storage format (v2):  "v2:{hex-salt}:{hex-hash}"
 * Legacy format (v1):        "{hex-salt}:{hex-hash}"  (SHA-256 / 100k iters)
 */

const V2_ITERATIONS = 600_000;
const V2_HASH_ALG = "SHA-512";
const V2_BITS = 512;
const SALT_BYTES = 32; // 256-bit salt

export async function hashPassword(password: string, salt: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(password),
		{ name: "PBKDF2" },
		false,
		["deriveBits"],
	);

	const derivedBits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			salt: encoder.encode(salt),
			iterations: V2_ITERATIONS,
			hash: V2_HASH_ALG,
		},
		key,
		V2_BITS,
	);

	return Array.from(new Uint8Array(derivedBits))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** Legacy SHA-256 / 100k verifier — used only to verify old stored hashes. */
async function hashPasswordLegacy(password: string, salt: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(password),
		{ name: "PBKDF2" },
		false,
		["deriveBits"],
	);

	const derivedBits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", salt: encoder.encode(salt), iterations: 100_000, hash: "SHA-256" },
		key,
		256,
	);

	return Array.from(new Uint8Array(derivedBits))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Generates a cryptographically secure 256-bit random salt.
 * Returns a 64-character hex string.
 */
export function generateSalt(): string {
	const array = new Uint8Array(SALT_BYTES);
	crypto.getRandomValues(array);
	return Array.from(array)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Produces a v2 storage string: "v2:{salt}:{hash}"
 */
export async function makePasswordHash(password: string): Promise<string> {
	const salt = generateSalt();
	const hash = await hashPassword(password, salt);
	return `v2:${salt}:${hash}`;
}

/**
 * Verifies a password against a stored hash (supports both v1 and v2 formats).
 * Returns:
 *   { valid: boolean, needsUpgrade: boolean }
 *
 * If needsUpgrade is true the caller should re-hash the password with
 * makePasswordHash() and store the result (transparent upgrade on next login).
 */
export async function verifyPassword(
	password: string,
	storedHash: string,
): Promise<{ valid: boolean; needsUpgrade: boolean }> {
	if (storedHash.startsWith("v2:")) {
		// Format: "v2:{salt}:{hash}"
		const rest = storedHash.slice(3); // strip "v2:"
		const colonIdx = rest.indexOf(":");
		if (colonIdx === -1) return { valid: false, needsUpgrade: false };
		const salt = rest.slice(0, colonIdx);
		const hash = rest.slice(colonIdx + 1);
		const computed = await hashPassword(password, salt);
		return { valid: computed === hash, needsUpgrade: false };
	}

	// Legacy v1 format: "{salt}:{hash}"
	const parts = storedHash.split(":");
	if (parts.length !== 2) return { valid: false, needsUpgrade: false };
	const [salt, hash] = parts;
	const computed = await hashPasswordLegacy(password, salt);
	return { valid: computed === hash, needsUpgrade: true };
}
