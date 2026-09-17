// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Tooltip } from "@cloudflare/kumo";
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
	model?: string | null;
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
		<div className="mx-6 my-4 md:mx-8 rounded-lg border border-white/[0.08] bg-white/[0.02] p-4 text-xs">
			<div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
				<div className="flex items-center gap-3 flex-wrap">
					<div className="flex items-center gap-2 font-medium text-white/80 text-xs">
						<SparkleIcon size={14} className="text-white/60" />
						<span>AI summary</span>
					</div>

					{hasThread && onToggleThreadSummary && (
						<div className="flex items-center rounded-md border border-white/[0.08] bg-white/[0.03] p-0.5">
							<button
								type="button"
								onClick={() => onToggleThreadSummary(false)}
								aria-pressed={!isThreadSummarized}
								className={`px-2.5 py-1 rounded-md text-[11px] transition-colors ${
									!isThreadSummarized
										? "bg-white/[0.08] font-medium text-white/80"
										: "text-white/35 hover:text-white/70"
								}`}
							>
								Single Email
							</button>
							<button
								type="button"
								onClick={() => onToggleThreadSummary(true)}
								aria-pressed={isThreadSummarized}
								className={`px-2.5 py-1 rounded-md text-[11px] transition-colors ${
									isThreadSummarized
										? "bg-white/[0.08] font-medium text-white/80"
										: "text-white/35 hover:text-white/70"
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
								icon={copied ? <CheckIcon size={14} className="text-white/80" /> : <CopyIcon size={14} />}
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

			<div className="pt-3">
				{isLoading ? (
					<div className="space-y-2 py-1">
						<div className="flex items-center gap-2 text-white/35">
							<span className="inline-block h-1.5 w-1.5 rounded-full bg-white/50 animate-pulse" />
							<span role="status">Summarizing with AI…</span>
						</div>
						<div className="h-2 rounded-sm bg-white/[0.06] animate-pulse w-5/6" />
						<div className="h-2 rounded-sm bg-white/[0.06] animate-pulse w-4/6" />
						<div className="h-2 rounded-sm bg-white/[0.06] animate-pulse w-3/4" />
					</div>
				) : error ? (
					<div role="alert" className="flex items-center justify-between gap-3 text-white/70 py-1 text-xs">
						<span>Unable to generate an AI summary. Please try again.</span>
						<Button size="sm" variant="secondary" onClick={onRegenerate}>
							Retry
						</Button>
					</div>
				) : summary ? (
					<div className="max-w-none break-words text-white/75 leading-6 text-[13px]">
						<Markdown
							remarkPlugins={[remarkGfm]}
							components={{
								p: ({ children }) => <p className="mb-2 last:mb-0 text-white/75">{children}</p>,
								strong: ({ children }) => (
									<strong className="font-semibold text-white/90">{children}</strong>
								),
								ul: ({ children }) => (
									<ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>
								),
								ol: ({ children }) => (
									<ol className="list-decimal pl-4 mb-2 last:mb-0 space-y-1">{children}</ol>
								),
								li: ({ children }) => <li className="text-white/70">{children}</li>,
								h1: ({ children }) => <h4 className="font-semibold text-xs mb-1">{children}</h4>,
								h2: ({ children }) => <h4 className="font-semibold text-xs mb-1">{children}</h4>,
								h3: ({ children }) => <h5 className="font-semibold text-xs mb-0.5">{children}</h5>,
								code: ({ children }) => (
									<code className="bg-white/[0.06] px-1 py-0.5 rounded text-[11px] font-mono text-white/70">
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
