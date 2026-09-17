// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Banner, Button, Input } from "@cloudflare/kumo";
import {
	FloppyDiskIcon,
	PaperPlaneTiltIcon,
	SparkleIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useParams } from "react-router";
import { useComposeForm } from "~/hooks/useComposeForm";
import { htmlToPlainText } from "~/lib/utils";
import api from "~/services/api";
import RichTextEditor from "./RichTextEditor";

export default function ComposePanel() {
	const { mailboxId, folder } = useParams<{
		mailboxId: string;
		folder: string;
	}>();

	const {
		to,
		setTo,
		cc,
		setCc,
		bcc,
		setBcc,
		showCcBcc,
		setShowCcBcc,
		subject,
		setSubject,
		body,
		setBody,
		error,
		isSavingDraft,
		isSending,
		formTitle,
		handleSaveDraft,
		handleSend,
		closeCompose,
		closePanel,
	} = useComposeForm(mailboxId, folder);

	// ── AI composer: generate email text directly into this draft ──
	const [aiPanelOpen, setAiPanelOpen] = useState(false);
	const [aiPrompt, setAiPrompt] = useState("");
	const [aiDraft, setAiDraft] = useState<string | null>(null);
	const [aiLoading, setAiLoading] = useState(false);
	const [aiError, setAiError] = useState<string | null>(null);

	const generateAiDraft = async () => {
		if (!mailboxId || aiLoading) return;
		setAiLoading(true);
		setAiError(null);
		try {
			const res = await api.composeWithAi(mailboxId, {
				instructions: aiPrompt,
				subject,
				existingBody: body,
			});
			setAiDraft(res.draft);
		} catch (err) {
			setAiError(err instanceof Error ? err.message : "AI generation failed. Try again.");
		} finally {
			setAiLoading(false);
		}
	};

	const insertAiDraft = () => {
		if (!aiDraft) return;
		setBody(body && body.trim() ? `${body}<p><br></p>${aiDraft}` : aiDraft);
	};

	return (
		<div className="flex flex-col h-full bg-[#0f0f0f]">
			<div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5 border-b border-white/[0.06] shrink-0 md:px-8">
				<h2 className="text-[15px] font-semibold text-white/90">
					{formTitle}
				</h2>
				<div className="flex items-center gap-2 shrink-0">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						icon={<SparkleIcon size={14} className={aiLoading ? "animate-pulse" : ""} />}
						onClick={() => setAiPanelOpen((o) => !o)}
						aria-expanded={aiPanelOpen}
					>
						Write with AI
					</Button>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<XIcon size={18} />}
						onClick={closeCompose}
						disabled={isSending}
						aria-label="Close compose"
					/>
				</div>
			</div>

			<form
				onSubmit={(e) => handleSend(e, closePanel)}
				className="flex flex-col flex-1 min-h-0 overflow-y-auto"
			>
				<div className="p-6 md:p-8 space-y-4">
					{error && <div className="grayscale"><Banner variant="error" text={error} /></div>}

					{aiPanelOpen && (
						<div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
							<div className="flex items-center gap-2">
								<SparkleIcon size={14} className="text-white/60" />
								<span className="text-xs font-medium text-white/80">Write with AI</span>
							</div>
							<textarea
								aria-label="AI writing instructions"
								value={aiPrompt}
								onChange={(e) => setAiPrompt(e.target.value)}
								rows={2}
								maxLength={2000}
								placeholder="Describe what to write — e.g. “polite follow-up asking the client to confirm the delivery date this week”…"
								className="w-full text-xs p-2.5 rounded-lg border border-white/[0.08] bg-[#0c0c0c] text-white/90 placeholder:text-white/30 resize-y focus:outline-none focus:border-white/20"
							/>
							<div className="flex flex-wrap items-center gap-2">
								<Button
									type="button"
									variant="secondary"
									size="sm"
									icon={<SparkleIcon size={14} />}
									onClick={generateAiDraft}
									loading={aiLoading}
									disabled={aiLoading}
								>
									{aiLoading ? "Writing…" : aiDraft ? "Regenerate" : "Generate"}
								</Button>
								{aiDraft && !aiLoading && (
									<>
										<Button type="button" variant="secondary" size="sm" onClick={() => { setBody(aiDraft); setAiPanelOpen(false); }}>
											Replace body
										</Button>
										<Button type="button" variant="ghost" size="sm" onClick={insertAiDraft}>
											Insert at end
										</Button>
										<Button type="button" variant="ghost" size="sm" onClick={() => setAiDraft(null)}>
											Dismiss
										</Button>
									</>
								)}
							</div>
							{aiError && <p className="text-xs text-white/60">{aiError}</p>}
							{aiDraft && !aiLoading && (
								<div className="rounded-lg border border-white/[0.06] bg-[#0c0c0c] p-3 text-[13px] leading-relaxed text-white/80 whitespace-pre-wrap">
									{htmlToPlainText(aiDraft)}
								</div>
							)}
						</div>
					)}

					<div className="space-y-3">
						<div className="flex items-center gap-2">
							<label className="text-[13px] font-medium text-white/40 w-16 shrink-0">
								To
							</label>
							<div className="flex-1 flex items-center gap-2 min-w-0">
								<Input
									type="text"
									placeholder="recipient@example.com"
									size="sm"
									value={to}
									onChange={(e) => setTo(e.target.value)}
									required
								/>
								{!showCcBcc && (
									<button
										type="button"
										onClick={() => setShowCcBcc(true)}
										className="shrink-0 text-[12px] text-white/40 hover:text-white/80 font-medium"
									>
										CC / BCC
									</button>
								)}
							</div>
						</div>

						{showCcBcc && (
							<div className="flex items-center gap-2">
								<label className="text-[13px] font-medium text-white/40 w-16 shrink-0">
									CC
								</label>
								<div className="flex-1">
									<Input
										type="text"
										size="sm"
										value={cc}
										onChange={(e) => setCc(e.target.value)}
										placeholder="Separate multiple addresses with commas"
									/>
								</div>
							</div>
						)}

						{showCcBcc && (
							<div className="flex items-center gap-2">
								<label className="text-[13px] font-medium text-white/40 w-16 shrink-0">
									BCC
								</label>
								<div className="flex-1">
									<Input
										type="text"
										size="sm"
										value={bcc}
										onChange={(e) => setBcc(e.target.value)}
										placeholder="Separate multiple addresses with commas"
									/>
								</div>
							</div>
						)}

						<div className="flex items-center gap-2">
							<label className="text-[13px] font-medium text-white/40 w-16 shrink-0">
								Subject
							</label>
							<div className="flex-1">
								<Input
									type="text"
									placeholder="Email subject"
									size="sm"
									value={subject}
									onChange={(e) => setSubject(e.target.value)}
									required
								/>
							</div>
						</div>
					</div>

					<div className="border border-white/[0.07] rounded-xl overflow-hidden bg-[#111111]">
						<RichTextEditor
							value={body}
							onChange={setBody}
						/>
					</div>
				</div>

				{/* Footer actions */}
				<div className="mt-auto px-6 py-3.5 border-t border-white/[0.06] bg-[#0d0d0d] shrink-0 md:px-8">
					<div className="flex items-center justify-between">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="text-white/50 hover:text-white/80"
							onClick={closeCompose}
							disabled={isSending}
						>
							Discard
						</Button>
						<div className="flex items-center gap-2">
							<Button
								type="button"
								variant="secondary"
								size="sm"
								loading={isSavingDraft}
								disabled={isSending}
								icon={<FloppyDiskIcon size={14} />}
								onClick={handleSaveDraft}
							>
								{isSavingDraft ? "Saving..." : "Save as Draft"}
							</Button>
							<Button
								type="submit"
								variant="primary"
								className="grayscale"
								size="sm"
								loading={isSending}
								disabled={isSavingDraft || isSending}
								icon={<PaperPlaneTiltIcon size={14} />}
							>
								{isSending ? "Sending..." : "Send"}
							</Button>
						</div>
					</div>
				</div>
			</form>
		</div>
	);
}
