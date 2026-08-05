// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Input, Loader, useKumoToastManager } from "@cloudflare/kumo";
import {
	RobotIcon,
	ArrowCounterClockwiseIcon,
	KeyIcon,
	TrashIcon,
	CopyIcon,
	CheckIcon,
	CodeIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMailbox, useUpdateMailbox } from "~/queries/mailboxes";
import { useApiKeys, useCreateApiKey, useDeleteApiKey } from "~/queries/api-keys";
import api from "~/services/api";

// Placeholder shown in the textarea when no custom prompt is set.
// The authoritative default prompt lives in workers/agent/index.ts (DEFAULT_SYSTEM_PROMPT).
const PROMPT_PLACEHOLDER = `You are an email assistant that helps manage this inbox. You read emails, draft replies, and help organize conversations.\n\nWrite like a real person. Short, direct, flowing prose. Plain text only.\n\n(Leave empty to use the full built-in default prompt)`;

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

				{/* Agent System Prompt */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5">
					<div className="flex items-center justify-between mb-4">
						<div className="flex items-center gap-2">
							<RobotIcon size={16} weight="duotone" className="text-kumo-subtle" />
							<span className="text-sm font-medium text-kumo-default">
								AI Agent Prompt
							</span>
							{isCustomPrompt ? (
								<Badge variant="primary">Custom</Badge>
							) : (
								<Badge variant="secondary">Default</Badge>
							)}
						</div>
						{isCustomPrompt && (
							<Button
								variant="ghost"
								size="xs"
								icon={<ArrowCounterClockwiseIcon size={14} />}
								onClick={handleResetPrompt}
							>
								Reset to default
							</Button>
						)}
					</div>
					<p className="text-xs text-kumo-subtle mb-3">
						Customize how the AI agent behaves for this mailbox.
						Leave empty to use the built-in default prompt.
					</p>
					<textarea
						value={agentPrompt}
						onChange={(e) => setAgentPrompt(e.target.value)}
						placeholder={PROMPT_PLACEHOLDER}
						rows={12}
						className="w-full resize-y rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2 text-xs text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-ring font-mono leading-relaxed"
					/>
					<p className="text-xs text-kumo-subtle mt-2">
						The prompt is sent as the system message to the AI model.
						It controls the agent's personality, writing style, and behavior rules.
					</p>
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
