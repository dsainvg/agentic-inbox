// Local-only integration entry point. Never mounted by the production worker.
import { app } from "../workers/index";
import { ensureDbInitialized } from "../workers/db/init";
import { executeAutomations } from "../workers/lib/automations";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../workers/db/schema";
import type { Env } from "../workers/types";

export default {
	async fetch(request: Request, env: Env & { LEGACY: D1Database }, ctx: ExecutionContext) {
		const url = new URL(request.url);
		if (url.pathname === "/__test/init") {
			await Promise.all([ensureDbInitialized(env.DB), ensureDbInitialized(env.DB)]);
			return new Response("ok");
		}
		if (url.pathname === "/__test/migrate") {
			await ensureDbInitialized(env.LEGACY);
			return new Response("ok");
		}
		if (url.pathname === "/__test/execute") {
			return Response.json(await executeAutomations(drizzle(env.DB, { schema }), env,
				url.searchParams.get("mailbox")!, {
					from: "sender@example.com", subject: "Monthly REPORT", recipient: "a@example.com",
				}));
		}
		return app.fetch(request, env, ctx);
	},
};
