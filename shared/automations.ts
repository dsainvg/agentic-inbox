/**
 * Canonical automation-rule types shared by the worker and the frontend.
 *
 * A rule is "When <field> contains <value>" plus an ordered action list.
 * The first matching enabled rule wins for each inbound email.
 */

export const AUTOMATION_MATCH_FIELDS = ["from", "subject", "to"] as const;

export type AutomationMatchField = (typeof AUTOMATION_MATCH_FIELDS)[number];

/** File (a copy of) the email into a folder. Multiple file actions = multiple folders. */
export type FileAction = { type: "file"; folder: string };

export type MarkReadAction = { type: "mark_read" };

export type StarAction = { type: "star" };

/**
 * Send an automatic reply to the sender.
 * - `body`: reply text (plain text / HTML)
 * - `onSuccessFolder`: file the original email here when the reply is sent successfully
 * - `onFailureFolder`: file the original email here when the reply fails
 *   (either may be omitted — the email then stays wherever the other
 *   actions put it, e.g. Inbox).
 */
export type AutoReplyAction = {
	type: "auto_reply";
	body: string;
	onSuccessFolder?: string;
	onFailureFolder?: string;
};

/**
 * Send an AI-generated contextual reply using Cloudflare Workers AI free model.
 * - `prompt`: optional instructions / guidance for how AI should formulate the reply
 * - `onSuccessFolder`: file the original email here when the reply is sent successfully
 * - `onFailureFolder`: file the original email here when the reply fails
 */
export type AiReplyAction = {
	type: "ai_reply";
	prompt?: string;
	onSuccessFolder?: string;
	onFailureFolder?: string;
};

export type AutomationAction =
	| FileAction
	| MarkReadAction
	| StarAction
	| AutoReplyAction
	| AiReplyAction;

export const AUTOMATION_ACTION_TYPES = [
	"file",
	"mark_read",
	"star",
	"auto_reply",
	"ai_reply",
] as const;

export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];

/** Runtime type guard for untrusted JSON (from DB or API). */
export function isAutomationAction(v: unknown): v is AutomationAction {
	if (typeof v !== "object" || v === null) return false;
	const a = v as Record<string, unknown>;
	switch (a.type) {
		case "file":
			return typeof a.folder === "string" && a.folder.length > 0;
		case "mark_read":
		case "star":
			return true;
		case "auto_reply":
			return typeof a.body === "string";
		case "ai_reply":
			return a.prompt === undefined || typeof a.prompt === "string";
		default:
			return false;
	}
}

/** Parse an actions JSON string into validated actions, dropping invalid entries. */
export function parseAutomationActions(json: string | null | undefined): AutomationAction[] {
	if (!json) return [];
	try {
		const parsed = JSON.parse(json);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(isAutomationAction);
	} catch {
		return [];
	}
}