// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Tooltip } from "@cloudflare/kumo";
import {
	ArrowsClockwiseIcon,
	CheckIcon,
	CopyIcon,
	SparkleIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface EmailSummaryCardProps {
	summary: string | null;
	isLoading: boolean;
	error: string | null;
	isThreadSummarized?: boolean;
	hasThread?: boolean;
	onToggleThreadSummary?: (summarizeThread: boolean) => void;
	onRegenerate: () => void;
	onClose: () => void;
}

export default function EmailSummaryCard({
	summary,
	isLoading,
	error,
	isThreadSummarized = false,
	hasThread = false,
	onToggleThreadSummary,
	onRegenerate,
	onClose,
}: EmailSummaryCardProps) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		if (!summary) return;
		try {
			await navigator.clipboard.writeText(summary);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard API failed
		}
	};

	return (
		<div className="mx-4 my-3 md:mx-6 rounded-lg border border-kumo-line bg-gradient-to-r from-kumo-base to-kumo-tint/50 p-3.5 text-xs shadow-xs transition-all">
			<div className="flex items-center justify-between gap-2 pb-2 border-b border-kumo-line/60">
				<div className="flex items-center gap-2 flex-wrap">
					<div className="flex items-center gap-1.5 font-semibold text-kumo-default text-xs">
						<SparkleIcon size={16} weight="fill" className="text-amber-500 animate-pulse" />
						<span>AI Summary</span>
					</div>
					<Badge variant="secondary" size="sm">
						Llama 3.1 8B (Free)
					</Badge>

					{hasThread && onToggleThreadSummary && (
						<div className="flex items-center rounded-md border border-kumo-line bg-kumo-base p-0.5 ml-2">
							<button
								type="button"
								onClick={() => onToggleThreadSummary(false)}
								className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
									!isThreadSummarized
										? "bg-kumo-fill font-medium text-kumo-default"
										: "text-kumo-subtle hover:text-kumo-default"
								}`}
							>
								Single Email
							</button>
							<button
								type="button"
								onClick={() => onToggleThreadSummary(true)}
								className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
									isThreadSummarized
										? "bg-kumo-fill font-medium text-kumo-default"
										: "text-kumo-subtle hover:text-kumo-default"
								}`}
							>
								Full Thread
							</button>
						</div>
					)}
				</div>

				<div className="flex items-center gap-1">
					{summary && (
						<Tooltip content={copied ? "Copied!" : "Copy summary"} side="bottom" asChild>
							<Button
								variant="ghost"
								shape="square"
								size="sm"
								icon={copied ? <CheckIcon size={14} className="text-emerald-500" /> : <CopyIcon size={14} />}
								onClick={handleCopy}
								aria-label="Copy summary"
							/>
						</Tooltip>
					)}
					<Tooltip content="Regenerate summary" side="bottom" asChild>
						<Button
							variant="ghost"
							shape="square"
							size="sm"
							icon={<ArrowsClockwiseIcon size={14} className={isLoading ? "animate-spin" : ""} />}
							onClick={onRegenerate}
							disabled={isLoading}
							aria-label="Regenerate summary"
						/>
					</Tooltip>
					<Tooltip content="Close summary" side="bottom" asChild>
						<Button
							variant="ghost"
							shape="square"
							size="sm"
							icon={<XIcon size={14} />}
							onClick={onClose}
							aria-label="Close summary"
						/>
					</Tooltip>
				</div>
			</div>

			<div className="pt-2.5">
				{isLoading ? (
					<div className="space-y-2 py-1">
						<div className="flex items-center gap-2 text-kumo-subtle">
							<span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-ping" />
							<span>Summarizing with Cloudflare Workers AI...</span>
						</div>
						<div className="h-2.5 w-5/6 rounded bg-kumo-fill animate-pulse" />
						<div className="h-2.5 w-4/6 rounded bg-kumo-fill animate-pulse" />
						<div className="h-2.5 w-3/4 rounded bg-kumo-fill animate-pulse" />
					</div>
				) : error ? (
					<div className="flex items-center justify-between text-kumo-danger py-1">
						<span>{error}</span>
						<Button size="sm" variant="secondary" onClick={onRegenerate}>
							Retry
						</Button>
					</div>
				) : summary ? (
					<div className="prose-xs max-w-none text-kumo-default leading-relaxed">
						<Markdown
							remarkPlugins={[remarkGfm]}
							components={{
								p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
								strong: ({ children }) => (
									<strong className="font-semibold text-kumo-default">{children}</strong>
								),
								ul: ({ children }) => (
									<ul className="list-disc pl-4 mb-2 last:mb-0 space-y-1">{children}</ul>
								),
								ol: ({ children }) => (
									<ol className="list-decimal pl-4 mb-2 last:mb-0 space-y-1">{children}</ol>
								),
								li: ({ children }) => <li className="text-kumo-default">{children}</li>,
								h1: ({ children }) => <h4 className="font-semibold text-xs mb-1">{children}</h4>,
								h2: ({ children }) => <h4 className="font-semibold text-xs mb-1">{children}</h4>,
								h3: ({ children }) => <h5 className="font-semibold text-xs mb-0.5">{children}</h5>,
								code: ({ children }) => (
									<code className="bg-kumo-fill px-1 py-0.5 rounded text-[11px] font-mono">
										{children}
									</code>
								),
							}}
						>
							{summary}
						</Markdown>
					</div>
				) : null}
			</div>
		</div>
	);
}
