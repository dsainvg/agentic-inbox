// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { jwtVerify } from "jose";
import { createRequestHandler } from "react-router";
import { app as apiApp, receiveEmail, type InboundEmailEvent } from "./index";
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

// React Router catch-all: serves the SPA index.html for all non-API routes
app.all("*", (c) => {
	return requestHandler(c.req.raw, {
		cloudflare: { env: c.env, ctx: c.executionCtx as ExecutionContext },
	});
});

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
			throw e;
		}
	},
};
