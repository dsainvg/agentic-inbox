// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared tool business logic for the Agent and MCP server.
 *
 * Each function takes an `env: Env` (or a DO stub) and tool-specific params,
 * performs the business logic (DO calls, data fetching, formatting), and
 * returns a plain object. The Agent and MCP server wrap these results in
 * their own response formats.
 *
 * Functions that already exist in email-helpers.ts (getFullEmail, getFullThread)
 * are reused directly — this module covers the remaining shared operations.
 */

import type { EmailFull } from "./schemas";
import {
	getMailboxStub,
	getFullEmail,
	getFullThread,
	buildQuotedReplyBlock,
	textToHtml,
	listMailboxes,
	generateMessageId,
	buildReferencesChain,
	buildThreadingHeaders,
} from "./email-helpers";
import { verifyDraft } from "./ai";
import { sendSmtpEmail } from "./smtp";
import { replySubject } from "./email-helpers";
import { Folders } from "../../shared/folders";
import type { Env } from "../types";

function smtpConfigurationError(env: Env): string | null {
	return env.SMTP_USER?.trim() && env.SMTP_PASS?.trim()
		? null : "SMTP_USER and SMTP_PASS are required for sending. No email was sent.";
}

// ── list_mailboxes ─────────────────────────────────────────────────

export async function toolListMailboxes(env: Env) {
	return listMailboxes(env.DB);
}

// ── list_emails ────────────────────────────────────────────────────

export async function toolListEmails(
	env: Env,
	mailboxId: string,
	params: { folder: string; limit: number; page: number },
) {
	const stub = getMailboxStub(env, mailboxId);
	return stub.getEmails({
		folder: params.folder,
		limit: params.limit,
		page: params.page,
		sortColumn: "date",
		sortDirection: "DESC",
	});
}

// ── get_email ──────────────────────────────────────────────────────

export async function toolGetEmail(
	env: Env,
	mailboxId: string,
	emailId: string,
) {
	const stub = getMailboxStub(env, mailboxId);
	const email = await getFullEmail(stub, emailId);
	if (!email) return { error: "Email not found" };
	return email;
}

// ── get_thread ─────────────────────────────────────────────────────

export async function toolGetThread(
	env: Env,
	mailboxId: string,
	threadId: string,
) {
	const stub = getMailboxStub(env, mailboxId);
	return getFullThread(stub, threadId);
}

// ── search_emails ──────────────────────────────────────────────────

export async function toolSearchEmails(
	env: Env,
	mailboxId: string,
	params: { query: string; folder?: string },
) {
	const stub = getMailboxStub(env, mailboxId);
	return stub.searchEmails({
		query: params.query,
		folder: params.folder,
	});
}

// ── draft_reply ────────────────────────────────────────────────────

/**
 * Shared draft-reply logic.
 *
 * @param bodyInput - The reply body text. Can be plain text or HTML.
 * @param options.isPlainText - If true, body is treated as plain text and
 *   converted to HTML. If false, body is treated as HTML.
 * @param options.runVerifyDraft - If true, runs AI verifyDraft on the body.
 *   The agent and MCP both do this, but the agent does it on plain text
 *   while MCP does it on HTML.
 */
export async function toolDraftReply(
	env: Env,
	mailboxId: string,
	params: {
		originalEmailId: string;
		to: string;
		subject: string;
		body: string;
		isPlainText?: boolean;
		runVerifyDraft?: boolean;
	},
): Promise<
	| { status: "draft_saved"; draftId: string; message: string; draft: Record<string, string> }
	| { error: string }
> {
	const stub = getMailboxStub(env, mailboxId);

	// Verify/sanitize if requested
	let processedBody = params.body.trim();
	if (params.runVerifyDraft) {
		const sanitized = await verifyDraft(env.AI, processedBody);
		if (!sanitized) {
			return { error: "Draft verification failed — body could not be verified. Please try again." };
		}
		processedBody = sanitized;
	}

	// Convert plain text to HTML if needed
	if (params.isPlainText) {
		processedBody = textToHtml(processedBody);
	}

	const draftId = crypto.randomUUID();

	// Resolve only within this mailbox; never attach a draft to an unknown email.
	const original = await stub.getEmail(params.originalEmailId);
	if (!original) return { error: "Original email not found" };
	const threadId = original.thread_id || original.id;
	const subject = replySubject(params.subject || original.subject);

	// Append quoted original message
	const quotedBlock = original
		? buildQuotedReplyBlock({
				date: original.date,
				sender: original.sender || params.to,
				body: original.body ?? undefined,
			})
		: "";
	const bodyHtml = processedBody + quotedBlock;

	await stub.createEmail(
		Folders.DRAFT,
		{
			id: draftId,
			subject,
			sender: mailboxId.toLowerCase(),
			recipient: params.to.toLowerCase(),
			date: new Date().toISOString(),
			body: bodyHtml,
			in_reply_to: params.originalEmailId,
			email_references: null,
			thread_id: threadId,
		},
		[],
	);

	return {
		status: "draft_saved",
		draftId,
		message: "Draft saved to Drafts folder. Review it and confirm to send.",
		draft: {
			originalEmailId: params.originalEmailId,
			to: params.to,
			subject,
			body: bodyHtml,
			threadId,
		},
	};
}

// ── draft_email (new email, not a reply) ───────────────────────────

export async function toolDraftEmail(
	env: Env,
	mailboxId: string,
	params: {
		to: string;
		subject: string;
		body: string;
		isPlainText?: boolean;
		runVerifyDraft?: boolean;
		/** Optional in_reply_to for create_draft style */
		in_reply_to?: string;
		/** Optional thread_id for create_draft style */
		thread_id?: string;
	},
): Promise<
	| { status: string; draftId: string; threadId?: string; message: string; draft?: Record<string, string> }
	| { error: string }
> {
	const stub = getMailboxStub(env, mailboxId);

	let processedBody = params.body.trim();
	if (params.runVerifyDraft) {
		const sanitized = await verifyDraft(env.AI, processedBody);
		if (!sanitized) {
			return { error: "Draft verification failed — body could not be verified. Please try again." };
		}
		processedBody = sanitized;
	}

	if (params.isPlainText) {
		processedBody = textToHtml(processedBody);
	}

	const draftId = crypto.randomUUID();

	// Validate references against this mailbox, even when an explicit thread is given.
	let resolvedThreadId = params.thread_id;
	if (params.in_reply_to) {
		const original = await stub.getEmail(params.in_reply_to);
		if (!original) return { error: "Original email not found" };
		resolvedThreadId = original.thread_id || original.id;
	} else if (resolvedThreadId && !(await stub.getThreadEmails(resolvedThreadId)).length) {
		return { error: "Thread not found" };
	}
	resolvedThreadId ||= draftId;

	await stub.createEmail(
		Folders.DRAFT,
		{
			id: draftId,
			subject: params.subject,
			sender: mailboxId.toLowerCase(),
			recipient: (params.to || "").toLowerCase(),
			date: new Date().toISOString(),
			body: processedBody,
			in_reply_to: params.in_reply_to || null,
			email_references: null,
			thread_id: resolvedThreadId,
		},
		[],
	);

	return {
		status: "draft_saved",
		draftId,
		threadId: resolvedThreadId,
		message: "Draft saved to Drafts folder. Review it and confirm to send.",
		draft: {
			to: params.to,
			subject: params.subject,
			body: processedBody,
		},
	};
}

// ── update_draft ───────────────────────────────────────────────────

export async function toolUpdateDraft(
	env: Env,
	mailboxId: string,
	params: {
		draftId: string;
		to?: string;
		subject?: string;
		bodyHtml?: string;
	},
): Promise<
	| { status: string; newDraftId: string; oldDraftId: string; message: string }
	| { error: string }
> {
	const stub = getMailboxStub(env, mailboxId);

	const oldDraft = (await stub.getEmail(params.draftId)) as EmailFull | null;
	if (!oldDraft) {
		return { error: "Draft not found" };
	}

	if (oldDraft.folder_id !== Folders.DRAFT) {
		return { error: "Cannot update: email is not a draft" };
	}

	// Verify before atomically replacing the existing draft.
	const newDraftId = crypto.randomUUID();
	const rawBody = params.bodyHtml ?? oldDraft.body ?? "";
	const verifiedBody = await verifyDraft(env.AI, rawBody);

	if (!verifiedBody) {
		return { error: "Draft verification failed — keeping existing draft unchanged. Please try again." };
	}

	const updated = await stub.replaceDraft(params.draftId, {
		id: newDraftId,
		subject: params.subject ?? oldDraft.subject,
		sender: mailboxId.toLowerCase(),
		recipient: (params.to ?? oldDraft.recipient).toLowerCase(),
		date: new Date().toISOString(),
		body: verifiedBody,
		in_reply_to: oldDraft.in_reply_to || null,
		email_references: oldDraft.email_references || null,
		thread_id: oldDraft.thread_id || newDraftId,
	});
	if (!updated) return { error: "Draft not found or no longer a draft" };

	return {
		status: "draft_updated",
		newDraftId,
		oldDraftId: params.draftId,
		message: "Draft updated in Drafts folder.",
	};
}

// ── mark_email_read ────────────────────────────────────────────────

export async function toolMarkEmailRead(
	env: Env,
	mailboxId: string,
	emailId: string,
	read: boolean,
) {
	const stub = getMailboxStub(env, mailboxId);
	if (!await stub.updateEmail(emailId, { read })) return { error: "Email not found", emailId };
	return { status: "updated", emailId, read };
}

// ── move_email ─────────────────────────────────────────────────────

export async function toolMoveEmail(
	env: Env,
	mailboxId: string,
	emailId: string,
	folderId: string,
) {
	const stub = getMailboxStub(env, mailboxId);
	const success = await stub.moveEmail(emailId, folderId);
	if (success) {
		return { status: "moved", emailId, folder: folderId };
	}
	return { error: "Failed to move email" };
}

// ── discard_draft ──────────────────────────────────────────────────

export async function toolDiscardDraft(
	env: Env,
	mailboxId: string,
	draftId: string,
) {
	const stub = getMailboxStub(env, mailboxId);
	const email = (await stub.getEmail(draftId)) as { folder_id?: string } | null;
	if (!email) {
		return { error: "Draft not found" };
	}
	if (email.folder_id !== Folders.DRAFT) {
		return { error: "Cannot discard: email is not a draft" };
	}
	if (!await stub.deleteEmail(draftId, Folders.DRAFT)) {
		return { error: "Draft not found or no longer a draft" };
	}
	return { status: "discarded", draftId };
}

// ── delete_email ───────────────────────────────────────────────────

export async function toolDeleteEmail(
	env: Env,
	mailboxId: string,
	emailId: string,
) {
	const stub = getMailboxStub(env, mailboxId);
	const result = await stub.deleteEmail(emailId);
	if (result === null) {
		return { error: "Email not found", emailId };
	}
	return { status: "deleted", emailId };
}

// ── send_reply ─────────────────────────────────────────────────────

export async function toolSendReply(
	env: Env,
	mailboxId: string,
	params: {
		originalEmailId: string;
		to: string;
		subject: string;
		bodyHtml: string;
	},
): Promise<
	| { status: "sent"; messageId: string; message: string; warning?: string }
	| { error: string }
> {
	const stub = getMailboxStub(env, mailboxId);

	const configError = smtpConfigurationError(env);
	if (configError) return { error: configError };

	const originalEmail = (await stub.getEmail(params.originalEmailId)) as EmailFull | null;
	if (!originalEmail) {
		return { error: "Original email not found" };
	}

	const subject = replySubject(params.subject || originalEmail.subject);
	const { originalMsgId, references, threadId } = buildReferencesChain(originalEmail);
	const fromDomain = mailboxId.split("@")[1];
	if (!fromDomain) throw new Error("Invalid mailbox email address");
	const { messageId } = generateMessageId(fromDomain);

	// Verify and append quoted original message
	const sanitizedBody = await verifyDraft(env.AI, params.bodyHtml);
	if (!sanitizedBody) {
		return { error: "Draft verification failed — refusing to send unverified content. Please try again." };
	}
	const quotedBlock = buildQuotedReplyBlock({
		date: originalEmail.date,
		sender: originalEmail.sender || params.to,
		body: originalEmail.body ?? undefined,
	});
	const fullBodyHtml = sanitizedBody + quotedBlock;

	let smtpMessageId: string;
	try {
		const rateLimitError = await stub.checkSendRateLimit();
		if (rateLimitError) return { error: rateLimitError };
		const sent = await sendSmtpEmail({
			host: env.SMTP_HOST, port: env.SMTP_PORT,
			user: env.SMTP_USER, pass: env.SMTP_PASS,
			to: params.to,
			from: mailboxId.toLowerCase(),
			replyTo: mailboxId.toLowerCase(),
			subject,
			html: fullBodyHtml,
			headers: buildThreadingHeaders(originalMsgId, references),
		});
		smtpMessageId = sent.messageId;
	} catch (e) {
		console.error("Email send failed:", (e as Error).message);
		return { error: `Failed to send reply: ${(e as Error).message}` };
	}

	let sentRecordWarning: string | undefined;
	try {
		await stub.createEmail(
			Folders.SENT,
			{
				id: messageId,
				subject,
				sender: mailboxId.toLowerCase(),
				recipient: params.to.toLowerCase(),
				date: new Date().toISOString(),
				body: fullBodyHtml,
				in_reply_to: originalMsgId,
				email_references:
					references.length > 0 ? JSON.stringify(references) : null,
				thread_id: threadId,
				message_id: smtpMessageId.replace(/^<|>$/g, ""),
			},
			[],
		);
	} catch (e) {
		// The email WAS delivered; do not report an error that invites a duplicate send.
		console.error("Failed to record sent reply in D1:", (e as Error).message);
		sentRecordWarning = `Reply was delivered, but saving it to the Sent folder failed: ${(e as Error).message}`;
	}

	return { status: "sent", messageId, message: `Reply sent to ${params.to}`, ...(sentRecordWarning ? { warning: sentRecordWarning } : {}) };
}

// ── send_email ─────────────────────────────────────────────────────

export async function toolSendEmail(
	env: Env,
	mailboxId: string,
	params: {
		to: string;
		subject: string;
		bodyHtml: string;
	},
): Promise<
	| { status: "sent"; messageId: string; message: string; warning?: string }
	| { error: string }
> {
	const stub = getMailboxStub(env, mailboxId);

	const configError = smtpConfigurationError(env);
	if (configError) return { error: configError };

	const fromDomain = mailboxId.split("@")[1];
	if (!fromDomain) throw new Error("Invalid mailbox email address");
	const { messageId } = generateMessageId(fromDomain);

	const sanitizedBody = await verifyDraft(env.AI, params.bodyHtml);
	if (!sanitizedBody) {
		return { error: "Draft verification failed — refusing to send unverified content. Please try again." };
	}

	let smtpMessageId: string;
	try {
		const rateLimitError = await stub.checkSendRateLimit();
		if (rateLimitError) return { error: rateLimitError };
		const sent = await sendSmtpEmail({
			host: env.SMTP_HOST, port: env.SMTP_PORT,
			user: env.SMTP_USER, pass: env.SMTP_PASS,
			to: params.to,
			from: mailboxId.toLowerCase(),
			replyTo: mailboxId.toLowerCase(),
			subject: params.subject,
			html: sanitizedBody,
		});
		smtpMessageId = sent.messageId;
	} catch (e) {
		console.error("Email send failed:", (e as Error).message);
		return { error: `Failed to send email: ${(e as Error).message}` };
	}

	let sentRecordWarning: string | undefined;
	try {
		await stub.createEmail(
			Folders.SENT,
			{
				id: messageId,
				subject: params.subject,
				sender: mailboxId.toLowerCase(),
				recipient: params.to.toLowerCase(),
				date: new Date().toISOString(),
				body: sanitizedBody,
				in_reply_to: null,
				email_references: null,
				thread_id: messageId,
				message_id: smtpMessageId.replace(/^<|>$/g, ""),
			},
			[],
		);
	} catch (e) {
		// The email WAS delivered; do not report an error that invites a duplicate send.
		console.error("Failed to record sent email in D1:", (e as Error).message);
		sentRecordWarning = `Email was delivered, but saving it to the Sent folder failed: ${(e as Error).message}`;
	}

	return { status: "sent", messageId, message: `Email sent to ${params.to}`, ...(sentRecordWarning ? { warning: sentRecordWarning } : {}) };
}
