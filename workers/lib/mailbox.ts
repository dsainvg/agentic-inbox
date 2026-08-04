// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { createMiddleware } from "hono/factory";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { Env } from "../types";
import { ensureDbInitialized } from "../db/init";

export type MailboxContext = {
	Bindings: Env;
	Variables: {
		mailboxId: string;
	};
};

export const requireMailbox = createMiddleware<MailboxContext>(async (c, next) => {
	const rawId = c.req.param("mailboxId");
	if (!rawId) return c.json({ error: "Mailbox ID required" }, 400);
	const mailboxId = decodeURIComponent(rawId).toLowerCase();

	await ensureDbInitialized(c.env.DB);
	const db = drizzle(c.env.DB, { schema });

	const rows = await db
		.select()
		.from(schema.mailboxes)
		.where(eq(schema.mailboxes.id, mailboxId))
		.limit(1);

	if (rows.length === 0) {
		return c.json({ error: "Mailbox not found" }, 404);
	}

	c.set("mailboxId", mailboxId);
	await next();
});
