// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Loader, Tooltip } from "@cloudflare/kumo";
import {
	ArrowUpIcon,
	RobotIcon,
	TrashIcon,
	UserIcon,
	EnvelopeSimpleIcon,
	MagnifyingGlassIcon,
	PaperPlaneTiltIcon,
	EyeIcon,
	ArrowBendUpLeftIcon,
	WrenchIcon,
	CheckCircleIcon,
	StopIcon,
	PencilSimpleIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useUIStore } from "~/hooks/useUIStore";
import type { UIMessage } from "ai";

const TOOL_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
	list_emails: {
		label: "Fetching emails",
		icon: <EnvelopeSimpleIcon size={14} weight="bold" />,
	},
	get_email: {
		label: "Reading email",
		icon: <EyeIcon size={14} weight="bold" />,
	},
	get_thread: {
		label: "Loading thread",
		icon: <ArrowBendUpLeftIcon size={14} weight="bold" />,
	},
	search_emails: {
		label: "Searching",
		icon: <MagnifyingGlassIcon size={14} weight="bold" />,
	},
	draft_email: {
		label: "Drafting email",
		icon: <PaperPlaneTiltIcon size={14} weight="bold" />,
	},
	draft_reply: {
		label: "Drafting reply",
		icon: <PaperPlaneTiltIcon size={14} weight="bold" />,
	},
	discard_draft: {
		label: "Discarding draft",
		icon: <TrashIcon size={14} weight="bold" />,
	},
	mark_email_read: {
		label: "Updating status",
		icon: <CheckCircleIcon size={14} weight="bold" />,
	},
	move_email: {
		label: "Moving email",
		icon: <EnvelopeSimpleIcon size={14} weight="bold" />,
	},
};

function ToolCallBadge({
	toolName,
	state,
	active,
	errorText,
}: {
	toolName: string;
	state: string;
	active: boolean;
	errorText?: unknown;
}) {
	const info = TOOL_LABELS[toolName] || {
		label: toolName,
		icon: <WrenchIcon size={14} weight="bold" />,
	};
	const isDone =
		state === "output-available" ||
		state === "result" ||
		state === "output-error" || state === "output-denied";
	const failed = state === "output-error" || state === "output-denied" || Boolean(errorText);

	return (
		<div className="flex items-center gap-1.5 py-1 px-2 rounded bg-kumo-fill/50 text-xs">
			<span className="text-kumo-brand">{info.icon}</span>
			<span className="text-kumo-strong">{info.label}</span>
			{failed ? (
				<span role="alert">{typeof errorText === "string" ? errorText : "Tool failed or was denied."}</span>
			) : isDone ? (
				<CheckCircleIcon
					size={12}
					weight="fill"
					className="text-kumo-success ml-auto"
				/>
			) : active && !state.startsWith("approval-") ? (
				<Loader size="sm" className="ml-auto" />
			) : (
				<span className="ml-auto">{state.startsWith("approval-") ? "Awaiting approval" : "Stopped"}</span>
			)}
		</div>
	);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown> : null;
}

// SDK 6 uses tool-<name> / dynamic-tool with output; retain legacy result support.
function getToolPart(part: UIMessage["parts"][number]) {
	const record = asRecord(part)!;
	const tool = asRecord(record.toolInvocation) ?? record;
	const name = part.type === "dynamic-tool" || record.toolInvocation
		? tool.toolName
		: part.type.startsWith("tool-") ? part.type.slice(5) : tool.toolName;
	if (typeof name !== "string") return null;
	return { name, state: String(tool.state ?? "running"), output: tool.output ?? tool.result, errorText: tool.errorText };
}

function getSavedDraft(part: UIMessage["parts"][number], mailboxId: string) {
	const tool = getToolPart(part);
	if (!tool || !["draft_reply", "draft_email"].includes(tool.name) ||
		!["output-available", "result"].includes(tool.state)) return null;
	const output = asRecord(tool.output);
	const draft = asRecord(output?.draft);
	if (!output || output.error || !draft || typeof output.draftId !== "string" ||
		!output.draftId.trim() || typeof draft.to !== "string" ||
		typeof draft.subject !== "string" || typeof draft.body !== "string" || !draft.body.trim()) return null;
	return {
		id: output.draftId,
		mailbox_id: mailboxId,
		folder_id: "draft",
		subject: draft.subject,
		sender: mailboxId,
		recipient: draft.to,
		// Use the saved HTML, including server verification and quoted content, not tool input.
		body: draft.body,
		in_reply_to: typeof draft.originalEmailId === "string" ? draft.originalEmailId : null,
		thread_id: typeof output.threadId === "string" ? output.threadId :
			typeof draft.threadId === "string" ? draft.threadId : null,
		date: new Date().toISOString(),
		read: true,
		starred: false,
	};
}

function DraftActions({
	onEdit,
	disabled,
}: {
	onEdit: () => void;
	disabled: boolean;
}) {
	return (
		<div className="flex gap-1.5 mt-1">
			<Button
				variant="primary"
				size="sm"
				icon={<PencilSimpleIcon size={14} />}
				onClick={onEdit}
				disabled={disabled}
			>
				Edit & send in composer
			</Button>
		</div>
	);
}

function MessageBubble({
	message,
	onAction,
	isStreaming,
}: {
	message: UIMessage;
	onAction?: (part: UIMessage["parts"][number]) => void;
	isStreaming: boolean;
}) {
	const isUser = message.role === "user";

	return (
		<div
			className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}
		>
			<div
				className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
					isUser
						? "bg-kumo-brand text-kumo-inverse"
						: "bg-kumo-fill text-kumo-default"
				}`}
			>
				{isUser ? (
					<UserIcon size={12} weight="bold" />
				) : (
					<RobotIcon size={12} weight="bold" />
				)}
			</div>
			<div
				className={`flex flex-col gap-1 max-w-[85%] min-w-0 ${
					isUser ? "items-end" : "items-start"
				}`}
			>
				{message.parts.map((part, i) => {
					const key = `${message.id}-part-${i}`;
					if (part.type === "text" && part.text.trim()) {
						return (
							<div
								key={key}
								className={`rounded-lg px-3 py-2 text-[13px] leading-relaxed break-words overflow-wrap-anywhere ${
									isUser
										? "bg-kumo-brand text-kumo-inverse rounded-br-sm"
										: "bg-kumo-elevated text-kumo-default border border-kumo-line rounded-bl-sm overflow-hidden"
								}`}
							>
								{isUser ? (
									part.text
								) : (
									<Markdown
										remarkPlugins={[remarkGfm]}
										components={{
											a: ({ href, children }) => (
												<a
													href={href}
													target="_blank"
													rel="noopener noreferrer"
													style={{
														color: "var(--color-link)",
														textDecoration: "underline",
													}}
												>
													{children}
												</a>
											),
											p: ({ children }) => (
												<p className="mb-2 last:mb-0">
													{children}
												</p>
											),
											strong: ({ children }) => (
												<strong className="font-semibold">
													{children}
												</strong>
											),
											ul: ({ children }) => (
												<ul className="list-disc pl-4 mb-2 last:mb-0 space-y-0.5">
													{children}
												</ul>
											),
											ol: ({ children }) => (
												<ol className="list-decimal pl-4 mb-2 last:mb-0 space-y-0.5">
													{children}
												</ol>
											),
											li: ({ children }) => (
												<li>{children}</li>
											),
											h1: ({ children }) => (
												<h3 className="font-semibold text-sm mb-1">
													{children}
												</h3>
											),
											h2: ({ children }) => (
												<h4 className="font-semibold text-[13px] mb-1">
													{children}
												</h4>
											),
											h3: ({ children }) => (
												<h5 className="font-semibold text-[13px] mb-0.5">
													{children}
												</h5>
											),
											code: ({ children }) => (
												<code className="bg-kumo-fill px-1 py-0.5 rounded text-[12px]">
													{children}
												</code>
											),
											table: ({ children }) => (
												<div className="overflow-x-auto my-2">
													<table className="w-full text-xs border-collapse">
														{children}
													</table>
												</div>
											),
											thead: ({ children }) => (
												<thead className="border-b border-kumo-line bg-kumo-fill/30">
													{children}
												</thead>
											),
											th: ({ children }) => (
												<th className="text-left px-2 py-1 font-semibold text-kumo-strong">
													{children}
												</th>
											),
											td: ({ children }) => (
												<td className="px-2 py-1 border-b border-kumo-line/50">
													{children}
												</td>
											),
										}}
									>
										{part.text}
									</Markdown>
								)}
							</div>
						);
					}
					const tool = getToolPart(part);
					if (tool) {
						return (
							<div key={key}>
								<ToolCallBadge toolName={tool.name} state={tool.state} active={isStreaming}
									errorText={tool.errorText ?? asRecord(tool.output)?.error} />
								{!isUser && onAction && getSavedDraft(part, "") && (
									<DraftActions onEdit={() => onAction(part)} disabled={isStreaming} />
								)}
							</div>
						);
					}
					return null;
				})}
			</div>
		</div>
	);
}

function AgentChatConnected({
	mailboxId,
	useAgent,
	useAgentChat,
}: {
	mailboxId: string;
	useAgent: typeof import("agents/react").useAgent;
	useAgentChat: typeof import("@cloudflare/ai-chat/react").useAgentChat;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const [inputValue, setInputValue] = useState("");
	const { startCompose } = useUIStore();

	const [connected, setConnected] = useState(false);
	const [connectionError, setConnectionError] = useState<string | null>(null);
	const [chatError, setChatError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const requestRef = useRef<symbol | null>(null);
	const stopRef = useRef<() => void>(() => {});
	const disconnect = (message: string) => {
		setConnected(false);
		setConnectionError(message);
		if (requestRef.current) {
			setChatError("Connection lost. Generation stopped; your message was not resent. Check Drafts before trying again.");
		}
		stopRef.current();
	};
	const agent = useAgent({
		agent: "EmailAgent", name: mailboxId,
		// Never queue a send across a disconnect.
		maxEnqueuedMessages: 0,
		onOpen: () => { setConnected(true); setConnectionError(null); },
		onClose: () => disconnect("Agent disconnected. Waiting for connection; reload if this persists."),
		onError: () => disconnect("Unable to connect to the agent. Check your connection and sign-in, or reload to retry."),
	});
	const { messages, sendMessage, status, setMessages, stop, error, clearError } =
		useAgentChat({ agent, resume: false, sendAutomaticallyWhen: () => false });
	const stopGeneration = () => {
		requestRef.current = null;
		setPending(false);
		void stop();
	};
	stopRef.current = stopGeneration;
	const isStreaming = pending || status === "streaming" || status === "submitted";
	const canSend = connected && !isStreaming;

	useEffect(() => {
		if (connected) return;
		const timer = setTimeout(() => {
			setConnectionError("Agent connection timed out. Check your connection and sign-in, or reload to retry.");
			stopRef.current();
		}, 15_000);
		return () => clearTimeout(timer);
	}, [connected]);

	// One absolute deadline, not an inactivity timer reset by incoming tokens.
	useEffect(() => {
		if (!isStreaming) return;
		const timer = setTimeout(() => {
			setChatError("Generation timed out after 70 seconds. Nothing was resent. Check Drafts before trying again.");
			stopRef.current();
		}, 70_000); // Server deadline is 60 seconds.
		return () => clearTimeout(timer);
	}, [isStreaming]);

	useEffect(() => {
		if (error) {
			setChatError(error.message || "Chat failed. Please try again.");
			stopRef.current();
		}
	}, [error]);

	useEffect(() => () => { stopRef.current(); }, []);

	useEffect(() => {
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [messages]);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const send = async (value: string) => {
		const text = value.trim();
		if (!text || !canSend || agent.readyState !== WebSocket.OPEN || requestRef.current) return;
		const request = Symbol();
		requestRef.current = request;
		setPending(true);
		setChatError(null);
		clearError();
		setInputValue("");
		if (inputRef.current) inputRef.current.style.height = "auto";
		try {
			await sendMessage({ text });
		} catch (err) {
			if (requestRef.current === request) {
				setChatError(err instanceof Error ? err.message : "Chat failed. Please try again.");
				stopRef.current();
			}
		} finally {
			if (requestRef.current === request) {
				requestRef.current = null;
				setPending(false);
			}
		}
	};
	const handleSend = () => { void send(inputValue); };

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	const suggestedPrompts = [
		"Show me the latest inbox emails",
		"Any unread emails?",
		"Draft a response to the latest email",
	];

	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-1.5 border-b border-kumo-line shrink-0">
				<div className="flex items-center gap-2">
					<Badge variant="beta">AI</Badge>
					<span className="text-xs text-kumo-subtle">
						Email Agent
					</span>
				</div>
				<div className="flex items-center gap-1">
					{isStreaming && <Loader size="sm" />}
					{messages.length > 0 && (
						<Tooltip content="Clear chat" asChild>
							<Button
								variant="ghost"
								shape="square"
								size="sm"
								icon={<TrashIcon size={14} />}
								onClick={() => {
									if (window.confirm("Clear chat history?")) {
										setMessages([]);
									}
								}}
								aria-label="Clear chat"
							/>
						</Tooltip>
					)}
				</div>
			</div>

			<div className="shrink-0 px-3 pt-2 text-xs text-kumo-subtle" role="status">
				{connected ? "Connected" : "Connecting… Sends are disabled until connected."}
			</div>
			<div id="agent-chat-error" role="alert" aria-atomic="true" className="shrink-0 px-3 text-xs text-kumo-default">
				{connectionError && <p className="py-2">{connectionError}</p>}
				{(chatError || error) && <p className="py-2">{chatError || error?.message}</p>}
			</div>

			{/* Messages */}
			<div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4">
				{messages.length === 0 ? (
					<div className="flex flex-col items-center justify-center h-full gap-4">
						<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-kumo-brand/10">
							<RobotIcon
								size={24}
								weight="duotone"
								className="text-kumo-brand"
							/>
						</div>
						<p className="text-xs text-kumo-subtle text-center leading-relaxed px-4">
							I can read emails, search conversations, and draft
							replies.
						</p>
						<div className="flex flex-col gap-1.5 w-full">
							{suggestedPrompts.map((prompt) => (
								<button
									key={prompt}
									type="button"
									disabled={!canSend}
									onClick={() => { void send(prompt); }}
									className="text-left px-3 py-2 rounded-lg border border-kumo-line text-xs text-kumo-strong hover:bg-kumo-tint hover:border-kumo-fill-hover transition-colors cursor-pointer bg-transparent"
								>
									{prompt}
								</button>
							))}
						</div>
					</div>
				) : (
					<div className="flex flex-col gap-3">
						{messages.map((msg) => (
							<MessageBubble
								key={msg.id}
								message={msg}
								isStreaming={isStreaming && msg.id === messages[messages.length - 1]?.id}
							onAction={(part) => {
									const draftEmail = getSavedDraft(part, mailboxId);
									if (!draftEmail) {
										setChatError("This draft is unavailable. Open it from Drafts instead.");
										return;
									}
									startCompose({
										mode: draftEmail.in_reply_to ? "reply" : "new",
										originalEmail: null,
										draftEmail,
									});
								}}
							/>
						))}
						{isStreaming && (
							<div className="flex gap-2">
								<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-kumo-fill text-kumo-default">
									<RobotIcon size={12} weight="bold" />
								</div>
								<div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-kumo-elevated border border-kumo-line rounded-bl-sm">
									<Loader size="sm" />
									<span className="text-xs text-kumo-subtle">
										Thinking...
									</span>
								</div>
							</div>
						)}
					</div>
				)}
			</div>

			{/* Input */}
			<div className="shrink-0 border-t border-kumo-line px-3 py-2">
				{isStreaming ? (
					<div className="flex justify-center">
						<Button
							variant="secondary"
							size="sm"
							icon={<StopIcon size={14} weight="fill" />}
							onClick={stopGeneration}
						>
							Stop generating
						</Button>
					</div>
				) : (
					<div className="flex items-end gap-1.5">
						<textarea
							ref={inputRef}
							id="agent-chat-input"
							name="agent-chat-input"
							value={inputValue}
							onChange={(e) => setInputValue(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder="Ask your email agent..."
							rows={1}
							aria-label="Chat message input"
							aria-describedby="agent-chat-error"
							className="flex-1 resize-none rounded-lg border border-kumo-line bg-kumo-control px-3 py-2 text-xs text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-ring min-h-[36px] max-h-[100px]"
							style={{ height: "auto", overflow: "hidden" }}
							onInput={(e) => {
								const t = e.target as HTMLTextAreaElement;
								t.style.height = "auto";
								t.style.height = `${Math.min(t.scrollHeight, 100)}px`;
								t.style.overflow =
									t.scrollHeight > 100 ? "auto" : "hidden";
							}}
						/>
						<Button
							variant="primary"
							shape="square"
							size="sm"
							disabled={!inputValue.trim() || !canSend}
							icon={<ArrowUpIcon size={14} weight="bold" />}
							onClick={handleSend}
							aria-label="Send message"
						/>
					</div>
				)}
			</div>
		</div>
	);
}

export default function AgentPanel() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const [hooks, setHooks] = useState<{
		useAgent: typeof import("agents/react").useAgent;
		useAgentChat: typeof import("@cloudflare/ai-chat/react").useAgentChat;
	} | null>(null);

	const [loadError, setLoadError] = useState<string | null>(null);

	useEffect(() => {
		Promise.all([
			import("agents/react"),
			import("@cloudflare/ai-chat/react"),
		]).then(([a, c]) =>
			setHooks({
				useAgent: a.useAgent,
				useAgentChat: c.useAgentChat,
			}),
		).catch((err) => {
			console.error("Failed to load agent modules:", err);
			setLoadError("Failed to connect to agent. Reload to retry.");
		});
	}, []);

	if (loadError) {
		return (
			<div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
				<span role="alert" className="text-xs text-kumo-default">{loadError}</span>
			</div>
		);
	}

	if (!hooks) {
		return (
			<div className="flex flex-col items-center justify-center h-full gap-2">
				<Loader size="base" />
				<span className="text-xs text-kumo-subtle">
					Connecting...
				</span>
			</div>
		);
	}

	return (
		<AgentChatConnected
			key={mailboxId ?? "default"}
			mailboxId={mailboxId ?? "default"}
			useAgent={hooks.useAgent}
			useAgentChat={hooks.useAgentChat}
		/>
	);
}
