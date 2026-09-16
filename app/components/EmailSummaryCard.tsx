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

function formatModelName(model?: string | null): string {
	if (!model) return "Nemotron 3 120B (Free)";
	if (model.includes("nemotron-3-120b")) return "Nemotron 3 120B (Free)";
	if (model.includes("llama-3.3-70b")) return "Llama 3.3 70B (Free)";
	if (model.includes("llama-3.1-8b")) return "Llama 3.1 8B (Free)";
	if (model.includes("mistral-7b")) return "Mistral 7B (Free)";
	if (model.includes("qwen")) return "Qwen 1.5 7B (Free)";
	return model.replace(/^@cf\/[^/]+\//, "");
}

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
	model,
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
		<div className="mx-5 my-3 md:mx-7 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-xs shadow-lg transition-all">
			<div className="flex items-center justify-between gap-2 pb-3 border-b border-white/[0.06]">
				<div className="flex items-center gap-2 flex-wrap">
					<div className="flex items-center gap-1.5 font-semibold text-white/80 text-[12px]">
						<SparkleIcon size={14} weight="fill" className="text-amber-400 animate-pulse" />
						<span>AI Summary</span>
					</div>
					<Tooltip
						content={
							model
								? `Generated with ${model} (automatic fallback enabled)`
								: "Primary: Nemotron 3 120B with automatic free fallbacks"
						}
						side="bottom"
						asChild
					>
						<Badge variant="secondary" className="cursor-help text-[10px] bg-white/[0.06] border-white/[0.1] text-white/50">
							{formatModelName(model)}
						</Badge>
					</Tooltip>

					{hasThread && onToggleThreadSummary && (
						<div className="flex items-center rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5 ml-2">
							<button
								type="button"
								onClick={() => onToggleThreadSummary(false)}
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

			<div className="pt-3">
				{isLoading ? (
					<div className="space-y-2 py-1">
						<div className="flex items-center gap-2 text-white/35">
							<span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
							<span>Summarizing with Cloudflare Workers AI...</span>
						</div>
						<div className="h-2 rounded-sm bg-white/[0.06] animate-pulse w-5/6" />
						<div className="h-2 rounded-sm bg-white/[0.06] animate-pulse w-4/6" />
						<div className="h-2 rounded-sm bg-white/[0.06] animate-pulse w-3/4" />
					</div>
				) : error ? (
					<div className="flex items-center justify-between text-red-400/80 py-1 text-[12px]">
						<span>{error}</span>
						<Button size="sm" variant="secondary" onClick={onRegenerate}>
							Retry
						</Button>
					</div>
				) : summary ? (
					<div className="prose-xs max-w-none text-white/75 leading-relaxed text-[13px]">
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
