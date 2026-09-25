import PostalMime from "postal-mime";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { ensureDbInitialized } from "../db/init";
import { Folders } from "../../shared/folders";
import { executeAutomations } from "../lib/automations";
import { storeAttachments } from "../lib/attachments";
import type { Env } from "../types";

const MAX_EMAIL_SIZE = 25 * 1024 * 1024;

async function streamToArrayBuffer(stream: ReadableStream): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let totalLength = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			chunks.push(value);
			totalLength += value.length;
			if (totalLength > MAX_EMAIL_SIZE) {
				await reader.cancel();
				throw new Error(`Email size exceeds ${MAX_EMAIL_SIZE} byte limit`);
			}
		}
	}
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}

export interface InboundEmailEvent {
	from?: string;
	to?: string;
	headers?: Headers;
	raw: ReadableStream;
	rawSize?: number;
	forward?: (rcptTo: string) => Promise<void>;
}

export async function receiveEmail(event: InboundEmailEvent, env: Env, ctx: ExecutionContext) {
	try {
		await ensureDbInitialized(env.DB);
		const db = drizzle(env.DB, { schema });
		const mailboxId = (event.to || "").toLowerCase().trim();
		let mailboxRecord: typeof schema.mailboxes.$inferSelect | undefined;
		if (mailboxId) {
			const mailboxRows = await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.id, mailboxId)).limit(1);
			if (mailboxRows.length > 0) mailboxRecord = mailboxRows[0];
		}

		const forwardAddress = mailboxRecord?.forward_to || env.SMTP_USER;
		if (forwardAddress && typeof event.forward === "function") {
			try {
				await event.forward(forwardAddress);
				console.log(`Forwarded incoming email for ${mailboxId || "unknown"} to ${forwardAddress}`);
			} catch (error) {
				console.error(`Failed to forward email to ${forwardAddress}:`, (error as Error).message);
			}
		}

		let rawEmail: Uint8Array;
		try {
			rawEmail = await streamToArrayBuffer(event.raw);
		} catch (error) {
			console.error("Failed to read email raw stream:", (error as Error).message);
			return;
		}

		let parsedEmail;
		try {
			parsedEmail = await new PostalMime({ attachmentEncoding: "arraybuffer" }).parse(rawEmail);
		} catch (error) {
			console.error("Failed to parse MIME email:", (error as Error).message);
			return;
		}

		const parsedRecipients = (parsedEmail.to || []).map((to) => to.address?.toLowerCase()).filter(Boolean) as string[];
		const targetMailboxId = mailboxId || parsedRecipients[0];
		if (!targetMailboxId) {
			console.log("Ignoring email: no valid recipient found");
			return;
		}
		if (!mailboxRecord) {
			const mailboxRows = await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.id, targetMailboxId)).limit(1);
			if (mailboxRows.length > 0) mailboxRecord = mailboxRows[0];
			else {
				console.log(`Ignoring email for ${targetMailboxId}: mailbox does not exist in D1`);
				return;
			}
		}

		const messageId = crypto.randomUUID();
		const extractMsgId = (value: string) => {
			const match = value.match(/<([^>]+)>/);
			return match ? match[1] : value.trim().split(/\s+/)[0];
		};
		const inReplyTo = parsedEmail.inReplyTo ? extractMsgId(parsedEmail.inReplyTo) : null;
		const emailReferences = parsedEmail.references ? parsedEmail.references.split(/\s+/).filter(Boolean).map(extractMsgId) : [];
		const threadId = emailReferences[0] || inReplyTo || messageId;
		const originalMessageId = parsedEmail.messageId ? extractMsgId(parsedEmail.messageId) : null;
		const allRecipients = Array.from(new Set([targetMailboxId, ...parsedRecipients]));

		const subjectLower = (parsedEmail.subject || "").toLowerCase();
		const headerList = (parsedEmail.headers ?? []) as Array<{ key?: string; value?: string }>;
		const hasAutoHeader = headerList.some((header) => {
			const key = (header.key || "").toLowerCase();
			if (key !== "auto-submitted" && key !== "x-autoreply" && key !== "auto-reply") return false;
			return !/^no$/i.test(header.value || "");
		});
		const looksAutoReply = hasAutoHeader || subjectLower.startsWith("re:") || subjectLower.startsWith("fwd:");
		let automationFolders: string[] = [];
		let automationRead = false;
		let automationStarred = false;
		try {
			const automation = await executeAutomations(db, env, targetMailboxId, {
				from: (parsedEmail.from?.address || event.from || "").toLowerCase(),
				subject: parsedEmail.subject || "(no subject)",
				recipient: allRecipients.join(", "),
				threadId,
				inReplyTo: originalMessageId || undefined,
				references: emailReferences,
				isAutoReply: looksAutoReply,
				body: parsedEmail.text || parsedEmail.html || "",
			});
			automationFolders = automation.folders;
			automationRead = automation.markRead;
			automationStarred = automation.starred;
		} catch (error) {
			console.error("Failed to execute automations:", (error as Error).message);
		}

		const targetFolders = automationFolders.length > 0 ? automationFolders.slice(0, 10) : [Folders.INBOX];
		const baseEmailRow = {
			id: messageId,
			mailbox_id: targetMailboxId,
			subject: parsedEmail.subject || "(no subject)",
			sender: (parsedEmail.from?.address || event.from || "").toLowerCase(),
			recipient: allRecipients.join(", "),
			cc: (parsedEmail.cc || []).map((cc) => cc.address?.toLowerCase()).filter(Boolean).join(", ") || null,
			bcc: (parsedEmail.bcc || []).map((bcc) => bcc.address?.toLowerCase()).filter(Boolean).join(", ") || null,
			date: new Date().toISOString(),
			body: parsedEmail.html || parsedEmail.text || "",
			read: automationRead ? 1 : 0,
			starred: automationStarred ? 1 : 0,
			in_reply_to: inReplyTo,
			email_references: emailReferences.length > 0 ? JSON.stringify(emailReferences) : null,
			thread_id: threadId,
			message_id: originalMessageId,
			raw_headers: JSON.stringify(parsedEmail.headers),
		};
		for (let index = 0; index < targetFolders.length; index++) {
			await db.insert(schema.emails).values({ ...baseEmailRow, id: index === 0 ? messageId : `${messageId}-c${index}`, folder_id: targetFolders[index] });
		}
		if (parsedEmail.attachments?.length) await storeAttachments(env, targetMailboxId, messageId, parsedEmail.attachments);
		console.log(`Stored email ${messageId} in D1 for mailbox ${targetMailboxId}`);

		if (env.EmailAgent) {
			try {
				const id = env.EmailAgent.idFromName(targetMailboxId);
				const stub = env.EmailAgent.get(id);
				ctx.waitUntil(stub.fetch(new Request("https://agent/onNewEmail", {
					method: "POST",
					headers: { "Content-Type": "application/json", "X-Agent-Internal-Token": env.SESSION_SECRET || "" },
					body: JSON.stringify({ mailboxId: targetMailboxId, emailId: messageId, sender: (parsedEmail.from?.address || event.from || "").toLowerCase(), subject: parsedEmail.subject || "(no subject)", threadId }),
				})).catch((error) => console.error("Failed to notify EmailAgent DO:", (error as Error).message)));
			} catch (error) {
				console.error("Failed to fetch EmailAgent DO:", (error as Error).message);
			}
		}
	} catch (error) {
		console.error("Unhandled exception in receiveEmail:", (error as Error).message, (error as Error).stack);
	}
}
