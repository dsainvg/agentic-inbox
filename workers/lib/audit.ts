export type AuditAction =
	| "auth.login"
	| "auth.logout"
	| "auth.logout_all"
	| "auth.setup"
	| "api_key.create"
	| "api_key.revoke"
	| "user.create"
	| "permission.update"
	| "user.delete"
	| "attachment.release"
	| "intake.received"
	| "draft.saved"
	| "draft.sent"
	| "email.sent"
	| "automation.run";

export type AuditEvent = {
	actorId?: string | null;
	action: AuditAction;
	mailboxId?: string | null;
	targetType?: string | null;
	targetId?: string | null;
	result?: "success" | "failure" | "denied";
	metadata?: Record<string, string | number | boolean | null>;
};

const SAFE_METADATA_KEYS = new Set([
	"source",
	"reason",
	"model",
	"provider",
	"folder",
	"status",
	"count",
	"latencyMs",
	"ruleId",
	"draftId",
	"messageId",
]);

export async function recordAuditEvent(db: D1Database, event: AuditEvent): Promise<void> {
	const metadata = Object.fromEntries(
		Object.entries(event.metadata ?? {}).filter(([key, value]) => SAFE_METADATA_KEYS.has(key) && typeof value !== "object"),
	);
	await db.prepare(`
		INSERT INTO audit_events (id, actor_id, action, mailbox_id, target_type, target_id, result, metadata, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).bind(
		crypto.randomUUID(),
		event.actorId ?? null,
		event.action,
		event.mailboxId ?? null,
		event.targetType ?? null,
		event.targetId ?? null,
		event.result ?? "success",
		JSON.stringify(metadata),
		new Date().toISOString(),
	).run();
}
