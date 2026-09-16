// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Input, Loader, Select, useKumoToastManager } from "@cloudflare/kumo";
import {
	RobotIcon,
	ArrowCounterClockwiseIcon,
	KeyIcon,
	TrashIcon,
	CopyIcon,
	CheckIcon,
	CodeIcon,
	LightningIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMailbox, useUpdateMailbox } from "~/queries/mailboxes";
import { useApiKeys, useCreateApiKey, useDeleteApiKey } from "~/queries/api-keys";
import { useFolders } from "~/queries/folders";
import {
	useAutomations,
	useCreateAutomation,
	useDeleteAutomation,
	useUpdateAutomation,
} from "~/queries/automations";
import { Folders as FOLDER_CONSTS, FOLDER_DISPLAY_NAMES, SYSTEM_FOLDER_IDS } from "shared/folders";
import type { AutomationMatchField } from "~/types";
import type { AutomationAction } from "shared/automations";
import api from "~/services/api";

// Placeholder shown in the textarea when no custom prompt is set.
// The authoritative default prompt lives in workers/agent/index.ts (DEFAULT_SYSTEM_PROMPT).
const PROMPT_PLACEHOLDER = `You are an email assistant that helps manage this inbox. You read emails, draft replies, and help organize conversations.\n\nWrite like a real person. Short, direct, flowing prose. Plain text only.\n\n(Leave empty to use the full built-in default prompt)`;

/** "from" -> "From" etc. for rule descriptions. */
const matchFieldLabel = (f: string) => f.charAt(0).toUpperCase() + f.slice(1);

/** Human-readable description of a rule action. */
function describeAction(
	action: AutomationAction,
	folderDisplayName: (id: string) => string,
): string {
	switch (action.type) {
		case "file":
			return `File into "${folderDisplayName(action.folder)}"`;
		case "mark_read":
			return "Mark as read";
		case "star":
			return "Star the email";
		case "auto_reply": {
			const parts = ["Auto-reply to the sender"];
			if (action.onSuccessFolder)
				parts.push(`on success file into "${folderDisplayName(action.onSuccessFolder)}"`);
			if (action.onFailureFolder)
				parts.push(`on failure file into "${folderDisplayName(action.onFailureFolder)}"`);
			return parts.join(", ");
		}
		case "ai_reply": {
			const parts = ["Reply with AI"];
			if (action.prompt?.trim())
				parts.push(`instruction: "${action.prompt.trim()}"`);
			if (action.onSuccessFolder)
				parts.push(`on success file into "${folderDisplayName(action.onSuccessFolder)}"`);
			if (action.onFailureFolder)
				parts.push(`on failure file into "${folderDisplayName(action.onFailureFolder)}"`);
			return parts.join(", ");
		}
		default:
			return "Action";
	}
}

interface FolderTargetSelectProps {
	value?: string;
	onChange: (folder: string | undefined) => void;
	systemFolders: string[];
	customFolders: { id: string; name: string }[];
	allowEmpty?: boolean;
	emptyLabel?: string;
	ariaLabel: string;
}

/** Shared folder picker for action targets (system + custom folders). */
function FolderTargetSelect({
	value,
	onChange,
	systemFolders,
	customFolders,
	allowEmpty,
	emptyLabel,
	ariaLabel,
}: FolderTargetSelectProps) {
	return (
		<Select
			aria-label={ariaLabel}
			value={value ?? ""}
			onValueChange={(v) => onChange(v || undefined)}
		>
			{allowEmpty && <Select.Option value="">{emptyLabel ?? "(don't file)"}</Select.Option>}
			{systemFolders.map((f) => (
				<Select.Option key={f} value={f}>
					{FOLDER_DISPLAY_NAMES[f] || f}
				</Select.Option>
			))}
			{customFolders.map((f) => (
				<Select.Option key={f.id} value={f.id}>
					{f.name}
				</Select.Option>
			))}
		</Select>
	);
}

export default function SettingsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();
	const { data: mailbox } = useMailbox(mailboxId);
	const updateMailboxMutation = useUpdateMailbox();

	const { data: apiKeys, isLoading: isLoadingKeys } = useApiKeys(mailboxId);
	const createApiKeyMutation = useCreateApiKey();
	const deleteApiKeyMutation = useDeleteApiKey();

	const [displayName, setDisplayName] = useState("");
	const [forwardTo, setForwardTo] = useState("");
	const [agentPrompt, setAgentPrompt] = useState("");
	const [isSaving, setIsSaving] = useState(false);

	const [keyDescription, setKeyDescription] = useState("");
	const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	// Change password state
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmNewPassword, setConfirmNewPassword] = useState("");
	const [isChangingPassword, setIsChangingPassword] = useState(false);
	const [passwordError, setPasswordError] = useState("");

	// Automations state
	const { data: automations = [], isLoading: isLoadingAutomations } = useAutomations(mailboxId);
	const createAutomationMutation = useCreateAutomation();
	const updateAutomationMutation = useUpdateAutomation();
	const deleteAutomationMutation = useDeleteAutomation();
	const { data: folders = [] } = useFolders(mailboxId);
	const [matchField, setMatchField] = useState<AutomationMatchField>("from");
	const [matchValue, setMatchValue] = useState("");
	const [draftActions, setDraftActions] = useState<AutomationAction[]>([]);

	// Folder options for the automation target selects
	const customFolders = folders.filter(
		(f) => !(SYSTEM_FOLDER_IDS as readonly string[]).includes(f.id),
	);
	const systemFolderOptions = [
		FOLDER_CONSTS.INBOX,
		FOLDER_CONSTS.SENT,
		FOLDER_CONSTS.DRAFT,
		FOLDER_CONSTS.ARCHIVE,
		FOLDER_CONSTS.TRASH,
	];

	const folderDisplayName = (id: string) => FOLDER_DISPLAY_NAMES[id] || id;

	const canAddAction = (type: AutomationAction["type"]) => {
		if (type === "auto_reply" || type === "ai_reply") {
			return !draftActions.some((a) => a.type === "auto_reply" || a.type === "ai_reply");
		}
		return draftActions.length < 20;
	};

	const addDraftAction = (type: AutomationAction["type"]) => {
		if (!canAddAction(type)) return;
		setDraftActions((prev) => {
			if (type === "file") return [...prev, { type: "file", folder: "archive" }];
			if (type === "mark_read") return [...prev, { type: "mark_read" }];
			if (type === "star") return [...prev, { type: "star" }];
			if (type === "ai_reply") return [...prev, { type: "ai_reply", prompt: "" }];
			return [...prev, { type: "auto_reply", body: "" }];
		});
	};

	const removeDraftAction = (index: number) => {
		setDraftActions((prev) => prev.filter((_, i) => i !== index));
	};

	const updateDraftAction = (index: number, patch: Partial<AutomationAction>) => {
		setDraftActions((prev) =>
			prev.map((a, i) => (i === index ? ({ ...a, ...patch } as AutomationAction) : a)),
		);
	};

	const autoReplyValid = draftActions.every(
		(a) => a.type !== "auto_reply" || a.body.trim().length > 0,
	);

	useEffect(() => {
		if (mailbox) {
			setDisplayName(mailbox.settings?.fromName || mailbox.name || "");
			setForwardTo(mailbox.forwardTo || "");
			setAgentPrompt(mailbox.settings?.agentSystemPrompt || "");
		}
	}, [mailbox]);

	const handleSave = async () => {
		if (!mailbox || !mailboxId) return;
		setIsSaving(true);
		const settings = {
			...mailbox.settings,
			fromName: displayName,
			agentSystemPrompt: agentPrompt.trim() || undefined,
		};
		try {
			await updateMailboxMutation.mutateAsync({
				mailboxId,
				name: displayName,
				forwardTo: forwardTo.trim() || undefined,
				settings,
			});
			toastManager.add({ title: "Settings saved!" });
		} catch {
			toastManager.add({
				title: "Failed to save settings",
				variant: "error",
			});
		} finally {
			setIsSaving(false);
		}
	};

	const handleResetPrompt = () => {
		setAgentPrompt("");
	};

	const handleCreateAutomation = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!mailboxId || !matchValue.trim() || draftActions.length === 0 || !autoReplyValid) return;
		try {
			await createAutomationMutation.mutateAsync({
				mailboxId,
				rule: {
					matchField,
					matchValue: matchValue.trim(),
					actions: draftActions,
				},
			});
			setMatchValue("");
			setDraftActions([]);
			toastManager.add({ title: "Automation created!" });
		} catch {
			toastManager.add({ title: "Failed to create automation", variant: "error" });
		}
	};

	const handleToggleAutomation = async (ruleId: string, enabled: boolean) => {
		if (!mailboxId) return;
		try {
			await updateAutomationMutation.mutateAsync({ mailboxId, ruleId, patch: { enabled } });
		} catch {
			toastManager.add({ title: "Failed to update automation", variant: "error" });
		}
	};

	const handleDeleteAutomation = async (ruleId: string) => {
		if (!mailboxId) return;
		try {
			await deleteAutomationMutation.mutateAsync({ mailboxId, ruleId });
			toastManager.add({ title: "Automation deleted" });
		} catch {
			toastManager.add({ title: "Failed to delete automation", variant: "error" });
		}
	};

	const handleCreateKey = async () => {
		if (!mailboxId || !keyDescription.trim()) return;
		try {
			const result = await createApiKeyMutation.mutateAsync({
				mailboxId,
				name: keyDescription.trim(),
			});
			setNewlyCreatedKey(result.key);
			setKeyDescription("");
			toastManager.add({ title: "API Key created successfully!" });
		} catch {
			toastManager.add({
				title: "Failed to create API key",
				variant: "error",
			});
		}
	};

	const handleDeleteKey = async (keyId: string) => {
		if (!mailboxId) return;
		try {
			await deleteApiKeyMutation.mutateAsync({ mailboxId, keyId });
			toastManager.add({ title: "API Key revoked" });
		} catch {
			toastManager.add({
				title: "Failed to revoke API key",
				variant: "error",
			});
		}
	};

	const handleCopyKey = () => {
		if (newlyCreatedKey) {
			navigator.clipboard.writeText(newlyCreatedKey);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	};

	const handleChangePassword = async (e: React.FormEvent) => {
		e.preventDefault();
		setPasswordError("");
		if (newPassword !== confirmNewPassword) {
			setPasswordError("New passwords do not match.");
			return;
		}
		if (newPassword.length < 8) {
			setPasswordError("New password must be at least 8 characters.");
			return;
		}
		setIsChangingPassword(true);
		try {
			await api.changePassword(currentPassword, newPassword);
			setCurrentPassword("");
			setNewPassword("");
			setConfirmNewPassword("");
			toastManager.add({ title: "Password updated successfully!" });
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Failed to change password";
			setPasswordError(msg);
		} finally {
			setIsChangingPassword(false);
		}
	};

	if (!mailbox) {
		return (
			<div className="flex justify-center py-20">
				<Loader size="lg" />
			</div>
		);
	}

	const isCustomPrompt = agentPrompt.trim().length > 0;
	const currentOrigin = typeof window !== "undefined" ? window.location.origin : "";
	const sampleCurlKey = newlyCreatedKey || "ag_key_sample123456789";

	return (
		<div className="max-w-2xl px-4 py-4 md:px-8 md:py-6 h-full overflow-y-auto">
			<h1 className="text-lg font-semibold text-kumo-default mb-6">Settings</h1>

			<div className="space-y-6">
				{/* Account */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
					<div className="text-sm font-medium text-kumo-default mb-4">
						Account
					</div>
					<div className="space-y-3">
						<Input
							label="Display Name"
							value={displayName}
							onChange={(e) => setDisplayName(e.target.value)}
						/>
						<Input label="Email" type="email" value={mailbox.email} disabled />
						<Input
							label="Forwarding Email Address"
							type="email"
							placeholder="e.g. personal@example.com (optional)"
							value={forwardTo}
							onChange={(e) => setForwardTo(e.target.value)}
						/>
					</div>
				</div>

				{/* API Keys & External GET Access */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
					<div className="flex items-center gap-2 mb-2">
						<KeyIcon size={16} weight="duotone" className="text-kumo-subtle" />
						<span className="text-sm font-medium text-kumo-default">
							API Keys & External GET Access
						</span>
					</div>
					<p className="text-xs text-kumo-subtle mb-4">
						Generate API keys for <strong className="text-kumo-default">{mailbox.email}</strong> to fetch incoming emails via GET requests in external applications.
					</p>

					{/* Create API Key Form */}
					<div className="flex items-end gap-2 mb-4">
						<div className="flex-1">
							<Input
								label="Key Description / Name"
								placeholder="e.g. Zapier Integration, Node.js Script"
								value={keyDescription}
								onChange={(e) => setKeyDescription(e.target.value)}
							/>
						</div>
						<Button
							variant="primary"
							onClick={handleCreateKey}
							loading={createApiKeyMutation.isPending}
							disabled={!keyDescription.trim()}
						>
							Generate API Key
						</Button>
					</div>

					{/* Newly Created Key Alert */}
					{newlyCreatedKey && (
						<div className="mb-4 rounded-md border border-green-500/30 bg-green-500/10 p-3">
							<div className="flex items-center justify-between">
								<span className="text-xs font-semibold text-green-700 dark:text-green-300">
									New API Key Generated! Copy it now as it won't be shown again:
								</span>
								<Button
									variant="ghost"
									size="xs"
									icon={copied ? <CheckIcon size={14} className="text-green-500" /> : <CopyIcon size={14} />}
									onClick={handleCopyKey}
								>
									{copied ? "Copied!" : "Copy Key"}
								</Button>
							</div>
							<div className="mt-2 font-mono text-xs text-kumo-default select-all bg-kumo-recessed p-2 rounded border border-kumo-line break-all">
								{newlyCreatedKey}
							</div>
						</div>
					)}

					{/* Active Keys List */}
					<div className="mt-4">
						<h3 className="text-xs font-medium text-kumo-default mb-2">Active API Keys</h3>
						{isLoadingKeys ? (
							<div className="py-4 text-center">
								<Loader size="sm" />
							</div>
						) : !apiKeys || apiKeys.length === 0 ? (
							<p className="text-xs text-kumo-subtle py-2 italic border border-dashed border-kumo-line rounded-md text-center">
								No API keys generated yet for this mailbox.
							</p>
						) : (
							<div className="divide-y divide-kumo-line border border-kumo-line rounded-md bg-kumo-recessed">
								{apiKeys.map((key) => (
									<div key={key.id} className="flex items-center justify-between p-3 text-xs">
										<div>
											<div className="font-medium text-kumo-default">{key.name}</div>
											<div className="font-mono text-kumo-subtle text-[11px] mt-0.5">
												{key.keyPreview} • Created {new Date(key.createdAt).toLocaleDateString()}
											</div>
										</div>
										<Button
											variant="ghost"
											size="xs"
											icon={<TrashIcon size={14} className="text-red-500" />}
											onClick={() => handleDeleteKey(key.id)}
											loading={deleteApiKeyMutation.isPending}
										>
											Revoke
										</Button>
									</div>
								))}
							</div>
						)}
					</div>

					{/* Documentation & Usage Snippet */}
					<div className="mt-6 border-t border-kumo-line pt-4 space-y-4">
						<div>
							<div className="flex items-center gap-2 mb-2">
								<CodeIcon size={14} className="text-kumo-subtle" />
								<span className="text-xs font-medium text-kumo-default">
									POST Request API (Submit Message / Contact Form Ingestion)
								</span>
							</div>
							<p className="text-xs text-kumo-subtle mb-2">
								Send a POST request with <code className="text-kumo-default font-mono font-semibold">&#123; name, email, message &#125;</code> to deposit a message directly into <code className="text-kumo-default font-mono">{mailbox.email}</code> INBOX:
							</p>
							<pre className="p-3 rounded-md bg-kumo-recessed border border-kumo-line font-mono text-[11px] text-kumo-default overflow-x-auto">
{`# Option 1: Direct endpoint for this mailbox (${mailbox.email}):
curl -X POST "${currentOrigin}/api/v1/external/mailboxes/${mailbox.email}/messages" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "John Doe",
    "email": "user@example.com",
    "message": "Hello! I am submitting a contact message."
  }'

# Option 2: API Key authenticated endpoint:
curl -X POST "${currentOrigin}/api/v1/external/messages" \\
  -H "X-API-Key: ${sampleCurlKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "John Doe",
    "email": "user@example.com",
    "message": "Hello! I am submitting a contact message."
  }'

# Response payload format (201 Created):
# {
#   "success": true,
#   "id": "c1f7a4b2-...",
#   "mailbox": "${mailbox.email}",
#   "statusCode": 201
# }`}
							</pre>
						</div>

						<div>
							<div className="flex items-center gap-2 mb-2">
								<CodeIcon size={14} className="text-kumo-subtle" />
								<span className="text-xs font-medium text-kumo-default">
									GET Request API Documentation (Fetch Inbox Messages)
								</span>
							</div>
							<p className="text-xs text-kumo-subtle mb-2">
								Make a GET request to fetch email messages containing <code className="text-kumo-default font-mono">from</code> (sender), <code className="text-kumo-default font-mono">subject</code> (message title), and <code className="text-kumo-default font-mono">body</code> (message content):
							</p>
							<pre className="p-3 rounded-md bg-kumo-recessed border border-kumo-line font-mono text-[11px] text-kumo-default overflow-x-auto">
{`# 1. Fetch recent inbox emails for ${mailbox.email}:
curl -X GET "${currentOrigin}/api/v1/external/messages?apiKey=${sampleCurlKey}"

# 2. Or pass API key in header:
curl -X GET "${currentOrigin}/api/v1/external/messages" \\
  -H "X-API-Key: ${sampleCurlKey}"

# Response payload format:
# {
#   "mailbox": "${mailbox.email}",
#   "totalCount": 1,
#   "emails": [
#     {
#       "id": "...",
#       "from": "sender@example.com",
#       "subject": "Name of message / Subject",
#       "body": "Mail message body content...",
#       "date": "2026-08-04T12:00:00.000Z",
#       "read": false,
#       "starred": false
#     }
#   ]
# }`}
							</pre>
						</div>
					</div>

				</div>

				{/* Save */}
				{/* Automations */}
				{mailboxId && mailboxId !== "all" && (
					<div className="mt-8 border-t border-kumo-line pt-6">
						<div className="flex items-center gap-2 mb-1">
							<LightningIcon size={16} className="text-kumo-subtle" />
							<span className="text-sm font-semibold text-kumo-default">Automations</span>
							<Badge variant="secondary" className="text-[10px]">Auto-file new emails</Badge>
						</div>
						<p className="text-xs text-kumo-subtle mb-4">
							Rules run on every new email that arrives in this mailbox. The first
							matching rule wins; later rules are ignored.
						</p>

						{/* Create rule */}
						<form
							onSubmit={handleCreateAutomation}
							className="mb-5 p-3 rounded-lg border border-kumo-line bg-kumo-surface space-y-3"
						>
							<div className="flex flex-wrap items-end gap-2">
								<div className="flex flex-col gap-1">
									<span className="text-xs text-kumo-subtle">When</span>
									<Select
										aria-label="Match field"
										value={matchField}
										onValueChange={(v) => v && setMatchField(v as AutomationMatchField)}
									>
										<Select.Option value="from">From</Select.Option>
										<Select.Option value="subject">Subject</Select.Option>
										<Select.Option value="to">To</Select.Option>
									</Select>
								</div>

								<span className="text-xs text-kumo-subtle pb-2">contains</span>

								<div className="flex flex-col gap-1 min-w-[180px]">
									<Input
										aria-label="Match value"
										size="sm"
										placeholder="e.g. newsletter"
										value={matchValue}
										onChange={(e) => setMatchValue(e.target.value)}
										required
										maxLength={200}
									/>
								</div>
							</div>

							<div className="space-y-2">
								<span className="text-xs text-kumo-subtle block">Then&hellip; (runs in order)</span>
								{draftActions.map((action, i) => (
									<div
										key={`${action.type}-${i}`}
										className="flex flex-wrap items-center gap-2 p-2 rounded-md border border-kumo-line bg-kumo-base"
									>
										<span className="text-[11px] font-mono text-kumo-subtle w-5 text-center">
											{i + 1}
										</span>

										{action.type === "file" && (
											<>
												<span className="text-xs text-kumo-default">File into</span>
												<FolderTargetSelect
													ariaLabel={`Target folder for action ${i + 1}`}
													value={action.folder}
													onChange={(folder) =>
														updateDraftAction(i, { type: "file", folder: folder || "archive" })
													}
													systemFolders={systemFolderOptions}
													customFolders={customFolders}
												/>
											</>
										)}

										{action.type === "mark_read" && (
											<span className="text-xs text-kumo-default">Mark as read</span>
										)}
										{action.type === "star" && (
											<span className="text-xs text-kumo-default">Star the email</span>
										)}

										{action.type === "auto_reply" && (
											<div className="flex-1 min-w-[240px] space-y-2">
												<div className="text-xs text-kumo-default font-medium">
													Auto-reply to the sender
												</div>
												<textarea
													aria-label="Auto-reply body"
													className="w-full min-h-[70px] text-xs p-2 rounded-md border border-kumo-line bg-kumo-base text-kumo-default resize-y"
													placeholder="Write the automatic reply body…"
													value={action.body}
													maxLength={5000}
													onChange={(e) => updateDraftAction(i, { type: "auto_reply", body: e.target.value })}
													required
												/>
												<div className="flex flex-wrap items-center gap-2 text-xs text-kumo-subtle">
													<span>Reply succeeded &rarr; file into</span>
													<FolderTargetSelect
														ariaLabel="On success folder"
														allowEmpty
														emptyLabel="(keep in Inbox)"
														value={action.onSuccessFolder}
														onChange={(folder) => updateDraftAction(i, { type: "auto_reply", onSuccessFolder: folder })}
														systemFolders={systemFolderOptions}
														customFolders={customFolders}
													/>
													<span>failed &rarr; file into</span>
													<FolderTargetSelect
														ariaLabel="On failure folder"
														allowEmpty
														emptyLabel="(keep in Inbox)"
														value={action.onFailureFolder}
														onChange={(folder) => updateDraftAction(i, { type: "auto_reply", onFailureFolder: folder })}
														systemFolders={systemFolderOptions}
														customFolders={customFolders}
													/>
												</div>
												<p className="text-[11px] text-kumo-subtle">
													Sent once per thread per rule. Skipped for auto-replies and
													mailer daemons to avoid loops. Replies are recorded in Sent.
												</p>
											</div>
										)}

										{action.type === "ai_reply" && (
											<div className="flex-1 min-w-[240px] space-y-2">
												<div className="flex items-center gap-2">
													<span className="text-xs text-kumo-default font-medium">
														Reply with AI
													</span>
													<Badge variant="secondary" size="sm">
														Cloudflare Llama 3.1 8B (Free)
													</Badge>
												</div>
												<textarea
													aria-label="AI reply guidance instructions"
													className="w-full min-h-[70px] text-xs p-2 rounded-md border border-kumo-line bg-kumo-base text-kumo-default resize-y"
													placeholder="Optional custom instructions (e.g. 'Acknowledge receipt and mention support hours are 9 AM - 5 PM UTC'). Leave empty for general contextual reply…"
													value={action.prompt || ""}
													maxLength={1000}
													onChange={(e) => updateDraftAction(i, { type: "ai_reply", prompt: e.target.value })}
												/>
												<div className="flex flex-wrap items-center gap-2 text-xs text-kumo-subtle">
													<span>Reply succeeded &rarr; file into</span>
													<FolderTargetSelect
														ariaLabel="On success folder"
														allowEmpty
														emptyLabel="(keep in Inbox)"
														value={action.onSuccessFolder}
														onChange={(folder) => updateDraftAction(i, { type: "ai_reply", onSuccessFolder: folder })}
														systemFolders={systemFolderOptions}
														customFolders={customFolders}
													/>
													<span>failed &rarr; file into</span>
													<FolderTargetSelect
														ariaLabel="On failure folder"
														allowEmpty
														emptyLabel="(keep in Inbox)"
														value={action.onFailureFolder}
														onChange={(folder) => updateDraftAction(i, { type: "ai_reply", onFailureFolder: folder })}
														systemFolders={systemFolderOptions}
														customFolders={customFolders}
													/>
												</div>
												<p className="text-[11px] text-kumo-subtle">
													Contextual AI reply generated via Cloudflare Workers AI. Sent once per thread per rule with anti-loop protection.
												</p>
											</div>
										)}

										<Button
											variant="ghost"
											shape="square"
											size="sm"
											className="ml-auto text-kumo-subtle hover:text-kumo-danger"
											aria-label={`Remove action ${i + 1}`}
											title="Remove action"
											type="button"
											onClick={() => removeDraftAction(i)}
										>
											<TrashIcon size={14} />
										</Button>
									</div>
								))}
							</div>

							<div className="flex flex-wrap items-center gap-2">
								<span className="text-xs text-kumo-subtle">Add action:</span>
								<Button type="button" variant="secondary" size="sm" disabled={!canAddAction("file")} onClick={() => addDraftAction("file")}>
									📁 File to folder
								</Button>
								<Button type="button" variant="secondary" size="sm" disabled={!canAddAction("mark_read")} onClick={() => addDraftAction("mark_read")}>
									Mark as read
								</Button>
								<Button type="button" variant="secondary" size="sm" disabled={!canAddAction("star")} onClick={() => addDraftAction("star")}>
									Star
								</Button>
								<Button type="button" variant="secondary" size="sm" disabled={!canAddAction("auto_reply")} onClick={() => addDraftAction("auto_reply")}>
									↩ Auto-reply
								</Button>
								<Button type="button" variant="secondary" size="sm" disabled={!canAddAction("ai_reply")} onClick={() => addDraftAction("ai_reply")}>
									✨ Reply with AI
								</Button>

								<Button
									type="submit"
									variant="primary"
									size="sm"
									className="ml-auto"
									loading={createAutomationMutation.isPending}
									disabled={!matchValue.trim() || draftActions.length === 0 || !autoReplyValid}
								>
									Add Rule
								</Button>
							</div>
						</form>

						{/* Rule list */}
						{isLoadingAutomations ? (
							<Loader size="sm" />
						) : automations.length === 0 ? (
							<p className="text-xs text-kumo-subtle italic">
								No automations yet. Add a rule above to automatically file
								incoming emails into folders.
							</p>
						) : (
							<div className="space-y-2">
								{automations.map((rule) => (
									<div
										key={rule.id}
										className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-kumo-line bg-kumo-surface ${rule.enabled ? "" : "opacity-60"}`}
									>
										<div className="min-w-0 flex-1">
<div className="text-sm text-kumo-default">
											When <strong>{matchFieldLabel(rule.matchField)}</strong>{" "}
											contains <strong>&ldquo;{rule.matchValue}&rdquo;</strong>
										</div>
										<ol className="text-xs text-kumo-subtle mt-0.5 space-y-0.5">
											{rule.actions.map((action, i) => (
												<li key={i} className="truncate">
													{i + 1}. {describeAction(action, folderDisplayName)}
												</li>
											))}
										</ol>
										{!rule.enabled && (
											<div className="text-[11px] text-kumo-subtle">Disabled</div>
										)}
										</div>
										<div className="flex items-center gap-2 shrink-0">
											<Button
												variant={rule.enabled ? "secondary" : "ghost"}
												size="sm"
												onClick={() => handleToggleAutomation(rule.id, !rule.enabled)}
												loading={updateAutomationMutation.isPending}
											>
												{rule.enabled ? "Enabled" : "Disabled"}
											</Button>
											<Button
												variant="ghost"
												shape="square"
												size="sm"
												aria-label={`Delete automation ${rule.matchValue}`}
												title="Delete automation"
												className="text-kumo-subtle hover:text-kumo-danger"
												loading={deleteAutomationMutation.isPending}
												onClick={() => handleDeleteAutomation(rule.id)}
											>
												<TrashIcon size={14} />
											</Button>
										</div>
									</div>
								))}
							</div>
						)}
					</div>
				)}

				{/* Change Password */}
				<div className="mt-8 border-t border-kumo-line pt-6">
					<div className="flex items-center gap-2 mb-4">
						<KeyIcon size={16} className="text-kumo-subtle" />
						<span className="text-sm font-semibold text-kumo-default">Change Password</span>
						<Badge variant="secondary" className="text-[10px]">Post-Quantum SHA-512</Badge>
					</div>
					<form onSubmit={handleChangePassword} className="space-y-3 max-w-sm">
						{passwordError && (
							<div className="text-xs text-kumo-danger bg-kumo-danger-tint border border-kumo-danger rounded-md px-3 py-2">
								{passwordError}
							</div>
						)}
						<Input
							label="Current Password"
							type="password"
							size="sm"
							value={currentPassword}
							onChange={(e) => setCurrentPassword(e.target.value)}
							required
						/>
						<Input
							label="New Password"
							type="password"
							size="sm"
							placeholder="Minimum 8 characters"
							value={newPassword}
							onChange={(e) => setNewPassword(e.target.value)}
							required
						/>
						<Input
							label="Confirm New Password"
							type="password"
							size="sm"
							placeholder="Repeat new password"
							value={confirmNewPassword}
							onChange={(e) => setConfirmNewPassword(e.target.value)}
							required
						/>
						<Button
							type="submit"
							variant="secondary"
							size="sm"
							loading={isChangingPassword}
						>
							Update Password
						</Button>
					</form>
				</div>

				{/* Save */}
				<div className="flex justify-end">
					<Button variant="primary" onClick={handleSave} loading={isSaving}>
						Save Changes
					</Button>
				</div>
			</div>
		</div>
	);
}