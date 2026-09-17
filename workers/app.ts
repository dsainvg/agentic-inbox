// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { jwtVerify } from "jose";
import { createRequestHandler } from "react-router";
import { routeAgentRequest } from "agents";
import { app as apiApp, receiveEmail, type InboundEmailEvent } from "./index";
import { serveMcp } from "./mcp/index";
import { validateApiKey } from "./lib/api-keys";
import type { Env } from "./types";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

// Main app that wraps the API and adds React Router fallback
const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
	console.error("Worker App Error:", err);
	return c.json({ error: err.message || "Internal Server Error", stack: String(err.stack || err) }, 500);
});

// Session-based authentication middleware for API routes
app.use("/api/v1/*", async (c, next) => {
	const path = c.req.path;

	// Bypass authentication for public API endpoints
	if (
		path === "/api/v1/auth/me" ||
		path === "/api/v1/auth/login" ||
		path === "/api/v1/auth/setup" ||
		path === "/api/v1/auth/logout" ||
		path.startsWith("/api/v1/external/")
	) {
		return next();
	}

	const cookie = getCookie(c, "session");
	if (!cookie) {
		return c.json({ error: "Unauthorized" }, 401);
	}

	try {
		const secret = new TextEncoder().encode(c.env.SESSION_SECRET || "default_session_secret_change_me");
		await jwtVerify(cookie, secret);
		return next();
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}
});

// Mount the API routes
app.route("/", apiApp);

// Agents (EmailAgent Durable Object): WebSocket + HTTP entry points.
// MUST be handled before the React Router catch-all — otherwise the SPA's
// index.html (HTTP 200) is returned and WebSocket handshakes fail.
app.all("/agents/*", async (c) => {
	const origin = c.req.header("origin");
	if (origin && origin !== new URL(c.req.url).origin) {
		return c.json({ error: "Forbidden origin" }, 403);
	}
	const cookie = getCookie(c, "session");
	if (!cookie || !c.env.SESSION_SECRET) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	try {
		await jwtVerify(cookie, new TextEncoder().encode(c.env.SESSION_SECRET));
	} catch {
		return c.json({ error: "Unauthorized" }, 401);
	}
	// Only expose the chat agent here, not the separately authenticated MCP DO.
	const res = await routeAgentRequest(c.req.raw, { EmailAgent: c.env.EmailAgent });
	return res ?? c.json({ error: "Agent route not found" }, 404);
});

// Stateless MCP: validate a mailbox-scoped key on every request. Keys are
// headers only so they do not leak through URLs, browser history or logs.
app.all("/mcp", async (c) => {
	const origin = c.req.header("origin");
	if (origin && origin !== new URL(c.req.url).origin) {
		return c.json({ error: "Forbidden origin" }, 403);
	}
	const authHeader = c.req.header("authorization") || "";
	const bearerKey = authHeader.toLowerCase().startsWith("bearer ")
		? authHeader.substring(7).trim() : undefined;
	const apiKey = c.req.header("x-api-key") || bearerKey;
	if (!apiKey) return c.json({ error: "Provide a mailbox API key using Authorization: Bearer or X-API-Key." }, 401);
	const validated = await validateApiKey(c.env, apiKey);
	if (!validated) return c.json({ error: "Invalid API Key" }, 401);
	return serveMcp(c.req.raw, c.env, c.executionCtx as ExecutionContext, validated.mailboxId.toLowerCase());
});

// React Router catch-all: serves the SPA index.html for all non-API routes
app.all("*", (c) => {
	return requestHandler(c.req.raw, {
		cloudflare: { env: c.env, ctx: c.executionCtx as ExecutionContext },
	});
});

// Export the chat Durable Object. MCP is request-scoped.
export { EmailAgent } from "./agent/index";

// Export the Hono app as default export with email trigger handler
export default {
	fetch: app.fetch,
	async email(
		event: InboundEmailEvent,
		env: Env,
		ctx: ExecutionContext,
	) {
		try {
			await receiveEmail(event, env, ctx);
		} catch (e) {
			console.error("Failed to process incoming email:", (e as Error).message, (e as Error).stack);
		}
	},
};


