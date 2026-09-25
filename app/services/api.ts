// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type {
	ApiKeyRecord,
	ApiKeySummary,
	Automation,
	Email,
	Folder,
	Mailbox,
} from "~/types";
import type { AutomationAction } from "shared/automations";

export type NewAutomation = {
	matchField: "from" | "subject" | "to";
	matchValue: string;
	actions: AutomationAction[];
};

const REQUEST_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
	status: number;
	body: Record<string, unknown>;

	constructor(status: number, body: Record<string, unknown>) {
		super((body.error as string) || `Request failed: ${status}`);
		this.name = "ApiError";
		this.status = status;
		this.body = body;
	}
}

async function request<T>(
	url: string,
	options: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
	const { timeoutMs = REQUEST_TIMEOUT_MS, ...init } = options;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	// Combine caller signal (e.g. TanStack Query abort) with our timeout signal
	const signal = options.signal
		? AbortSignal.any([options.signal, controller.signal])
		: controller.signal;

	try {
		const res = await fetch(url, {
			...init,
			signal,
			headers: {
				"Content-Type": "application/json",
				...(options.headers as Record<string, string>),
			},
		});

		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new ApiError(res.status, body as Record<string, unknown>);
		}

		if (res.status === 204) return undefined as T;

		const contentType = res.headers.get("content-type") ?? "";
		if (contentType.includes("application/json")) {
			return (await res.json()) as T;
		}
		return (await res.blob()) as unknown as T;
	} catch (error) {
		if (controller.signal.aborted && !options.signal?.aborted) {
			throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds. Check your connection before trying again. Nothing was automatically resent.`);
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}

function get<T>(url: string, opts?: { params?: Record<string, string>; responseType?: string; signal?: AbortSignal; headers?: Record<string, string> }) {
	const query = opts?.params ? `?${new URLSearchParams(opts.params)}` : "";
	return request<T>(`${url}${query}`, {
		method: "GET",
		signal: opts?.signal,
		headers: opts?.headers,
		...(opts?.responseType === "blob" ? { headers: { Accept: "*/*", ...opts?.headers } } : {}),
	});
}

function post<T>(url: string, body?: unknown, opts?: { signal?: AbortSignal; timeoutMs?: number; headers?: Record<string, string> }) {
	return request<T>(url, {
		method: "POST",
		signal: opts?.signal,
		timeoutMs: opts?.timeoutMs,
		headers: opts?.headers,
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

function put<T>(url: string, body?: unknown) {
	return request<T>(url, {
		method: "PUT",
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

function patch<T>(url: string, body?: unknown) {
	return request<T>(url, {
		method: "PATCH",
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

function del<T>(url: string) {
	return request<T>(url, { method: "DELETE" });
}

// ---------- Typed response shapes ----------

interface EmailListResponse {
	emails: Email[];
	totalCount: number;
}

// ---------- API client ----------

const api = {
	// Config
	getConfig: () =>
		get<{ domains: string[]; emailAddresses: string[] }>("/api/v1/config"),

	// Mailboxes
	listMailboxes: () => get<Mailbox[]>("/api/v1/mailboxes"),
	createMailbox: (email: string, name: string, settings?: unknown, forwardTo?: string) =>
		post<Mailbox>("/api/v1/mailboxes", { email, name, settings, forwardTo }),
	getMailbox: (mailboxId: string) =>
		get<Mailbox>(`/api/v1/mailboxes/${mailboxId}`),
	updateMailbox: (mailboxId: string, data: { name?: string; forwardTo?: string; settings?: unknown }) =>
		put<Mailbox>(`/api/v1/mailboxes/${mailboxId}`, data),
	deleteMailbox: (mailboxId: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}`),

	// Emails
	listEmails: (mailboxId: string, params: Record<string, string>, opts?: { signal?: AbortSignal }) =>
		get<EmailListResponse | Email[]>(`/api/v1/mailboxes/${mailboxId}/emails`, { params, signal: opts?.signal }),
	sendEmail: (mailboxId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails`, email),
	getEmail: (mailboxId: string, id: string, opts?: { signal?: AbortSignal }) =>
		get<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, { signal: opts?.signal }),
	updateEmail: (mailboxId: string, id: string, data: unknown) =>
		put<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, data),
	deleteEmail: (mailboxId: string, id: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`),
	moveEmail: (mailboxId: string, id: string, folderId: string) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${id}/move`, { folderId }),
	getThread: (mailboxId: string, threadId: string, opts?: { signal?: AbortSignal }) =>
		get<Email[]>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}`, { signal: opts?.signal }),
	markThreadRead: (mailboxId: string, threadId: string) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}/read`),
	getAttachment: (mailboxId: string, emailId: string, attachmentId: string) =>
		get<Blob>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/attachments/${attachmentId}`, { responseType: "blob" }),
	releaseAttachment: (attachmentId: string) => post<{ id: string; status: string }>(`/api/v1/attachments/${attachmentId}/release`, {}),
	saveDraft: (
		mailboxId: string,
		draft: {
			to?: string;
			cc?: string;
			bcc?: string;
			subject?: string;
			body: string;
			in_reply_to?: string;
			thread_id?: string;
			draft_id?: string;
		},
	) => post<{ draft_id: string }>(`/api/v1/mailboxes/${mailboxId}/drafts`, draft),
	approveDraft: (mailboxId: string, draftId: string) => post<{ draft_id: string; status: string }>(`/api/v1/mailboxes/${mailboxId}/drafts/${draftId}/approve`, {}),
	rejectDraft: (mailboxId: string, draftId: string) => post<{ draft_id: string; status: string }>(`/api/v1/mailboxes/${mailboxId}/drafts/${draftId}/reject`, {}),
	scheduleDraft: (mailboxId: string, draftId: string, scheduledAt: string) => post<{ draft_id: string; status: string; scheduled_at: string }>(`/api/v1/mailboxes/${mailboxId}/drafts/${draftId}/schedule`, { scheduledAt }),
	sendApprovedDraft: (mailboxId: string, draftId: string, idempotencyKey: string) => 		post<{ status: string; draftId: string; sentId?: string }>(`/api/v1/mailboxes/${mailboxId}/drafts/${draftId}/send`, { idempotencyKey }, { headers: { "Idempotency-Key": idempotencyKey } }),
	replyToEmail: (mailboxId: string, emailId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/reply`, email),
	summarizeEmail: (mailboxId: string, emailId: string, thread?: boolean) =>
		post<{ summary: string; model: string; isThread?: boolean }>(
			`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/summarize`,
			{ thread },
		),
	composeWithAi: async (
		mailboxId: string,
		payload: { instructions?: string; subject?: string; existingBody?: string },
	): Promise<{ draft: string; model: string }> => {
		const result = await post<unknown>(
			`/api/v1/mailboxes/${mailboxId}/ai/draft`,
			payload,
			// Allow the server's 60s generation deadline plus transport overhead.
			{ timeoutMs: 70_000 },
		);
		if (
			!result || typeof result !== "object" ||
			!("draft" in result) || typeof result.draft !== "string" || !result.draft.trim() ||
			!("model" in result) || typeof result.model !== "string"
		) {
			throw new Error("AI returned an invalid or empty draft. Please try again.");
		}
		return { draft: result.draft, model: result.model };
	},
	forwardEmail: (mailboxId: string, emailId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/forward`, email),

	// Folders
	listFolders: (mailboxId: string) =>
		get<Folder[]>(`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/folders`),
	createFolder: (mailboxId: string, name: string) =>
		post<Folder>(`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/folders`, { name }),
	updateFolder: (mailboxId: string, id: string, name: string) =>
		put<Folder>(`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/folders/${encodeURIComponent(id)}`, { name }),
	deleteFolder: (mailboxId: string, id: string) =>
		del<void>(`/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/folders/${encodeURIComponent(id)}`),

	// Automations
	listAutomations: (mailboxId: string) =>
		get<Automation[]>(`/api/v1/mailboxes/${mailboxId}/automations`),
	createAutomation: (mailboxId: string, rule: NewAutomation) =>
		post<Automation>(`/api/v1/mailboxes/${mailboxId}/automations`, rule),
	updateAutomation: (mailboxId: string, ruleId: string, patch: Partial<NewAutomation> & { enabled?: boolean }) =>
		put<Automation>(`/api/v1/mailboxes/${mailboxId}/automations/${ruleId}`, patch),
	deleteAutomation: (mailboxId: string, ruleId: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/automations/${ruleId}`),

	// Search
	searchEmails: (mailboxId: string, params: Record<string, string>) =>
		get<EmailListResponse | Email[]>(`/api/v1/mailboxes/${mailboxId}/search`, { params }),
	analyzeEmail: (mailboxId: string, emailId: string) =>
		post<Record<string, unknown>>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/analyze`, {}),
	applyEmailAnalysis: (mailboxId: string, emailId: string, analysisId: string) =>
		post<{ status: string; folder: string }>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/analysis/${analysisId}/apply`, {}),
	undoEmailAnalysis: (mailboxId: string, emailId: string, analysisId: string) =>
		post<{ status: string; folder: string }>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/analysis/${analysisId}/undo`, {}),
	getThreadMetadata: (mailboxId: string, threadId: string) =>
		get<Record<string, unknown>>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}/metadata`),
	updateThreadMetadata: (mailboxId: string, threadId: string, metadata: Record<string, unknown>) =>
		patch<Record<string, unknown>>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}/metadata`, metadata),
	listReminders: (mailboxId: string) =>
		get<Record<string, unknown>[]>(`/api/v1/mailboxes/${mailboxId}/reminders`),
	createReminder: (mailboxId: string, threadId: string, dueAt: string, message: string) =>
		post<Record<string, unknown>>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}/reminders`, { dueAt, message }),
	listSavedSearches: (mailboxId: string) =>
		get<Record<string, unknown>[]>(`/api/v1/mailboxes/${mailboxId}/saved-searches`),
	createSavedSearch: (mailboxId: string, name: string, query: string, filters: Record<string, unknown> = {}) =>
		post<Record<string, unknown>>(`/api/v1/mailboxes/${mailboxId}/saved-searches`, { name, query, filters }),
	getAuditEvents: () => get<{ events: Record<string, unknown>[] }>("/api/v1/audit"),
	getUsers: () => get<Record<string, unknown>[]>("/api/v1/users"),
	createUser: (email: string, password: string, role: string) => post<Record<string, unknown>>("/api/v1/users", { email, password, role }),
	rotateRecoveryCode: () => post<{ code: string; warning: string }>("/api/v1/users/recovery-code", {}),
	getAutomationRuns: (mailboxId: string) => get<Record<string, unknown>[]>(`/api/v1/mailboxes/${mailboxId}/automation-runs`),
	exportBackup: (passphrase: string) => get<Record<string, unknown>>("/api/v1/backup", { headers: { "X-Export-Passphrase": passphrase } }),
	validateBackup: (envelope: Record<string, unknown>, passphrase: string) => post<Record<string, unknown>>("/api/v1/backup/validate", envelope, { headers: { "X-Export-Passphrase": passphrase } }),
	restoreBackup: (envelope: Record<string, unknown>, passphrase: string, dryRun = true) => post<Record<string, unknown>>("/api/v1/backup/restore", { ...envelope, dryRun, confirm: dryRun ? "" : "RESTORE" }, { headers: { "X-Export-Passphrase": passphrase } }),

	// API Keys
	listApiKeys: (mailboxId: string) =>
		get<ApiKeySummary[]>(`/api/v1/mailboxes/${mailboxId}/api-keys`),
	createApiKey: (mailboxId: string, name: string) =>
		post<ApiKeyRecord>(`/api/v1/mailboxes/${mailboxId}/api-keys`, { name }),
	deleteApiKey: (mailboxId: string, keyId: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/api-keys/${keyId}`),

	// Auth
	getAuthMe: () =>
		get<{ authenticated: boolean; setupRequired: boolean; user: { id: string; email: string; role: string } | null }>("/api/v1/auth/me"),
	setupAdmin: (password: string) =>
		post<{ success: boolean }>("/api/v1/auth/setup", { password }),
	login: (password: string) =>
		post<{ success: boolean }>("/api/v1/auth/login", { password }),
	logout: () =>
		post<{ success: boolean }>("/api/v1/auth/logout"),
	logoutAll: () =>
		post<{ success: boolean }>("/api/v1/auth/logout-all"),
	changePassword: (currentPassword: string, newPassword: string) =>
		post<{ success: boolean }>("/api/v1/auth/change-password", { currentPassword, newPassword }),
};

export default api;
