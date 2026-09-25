import { jwtVerify, type JWTPayload } from "jose";
import { ensureDbInitialized } from "../db/init";
import type { Env } from "../types";

const DEVELOPMENT_SECRETS = new Set([
	"default_session_secret_change_me",
	"session-secret",
	"replace-with-a-long-random-secret",
]);

export function getSessionSecret(env: Pick<Env, "SESSION_SECRET">): Uint8Array {
	if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32 || DEVELOPMENT_SECRETS.has(env.SESSION_SECRET)) {
		throw new Error("SESSION_SECRET is not configured securely");
	}
	return new TextEncoder().encode(env.SESSION_SECRET);
}

export async function verifySessionToken(token: string, env: Pick<Env, "SESSION_SECRET" | "DB">, requireUser = true): Promise<JWTPayload & { role: string }> {
	const { payload } = await jwtVerify(token, getSessionSecret(env), {
		algorithms: ["HS256"],
		requiredClaims: ["exp", "iat"],
	});
	if (!requireUser) return { ...payload, role: "owner" };
	await ensureDbInitialized(env.DB);
	const user = await env.DB.prepare("SELECT session_version, role, status FROM users WHERE id = ?").bind(String(payload.id)).first<{ session_version: number; role: string; status: string }>();
	if (!user || user.status !== "active" || Number(payload.ver ?? 0) !== Number(user.session_version ?? 0)) {
		throw new Error("Session revoked");
	}
	return { ...payload, role: user.role };
}
