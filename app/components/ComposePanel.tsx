// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Banner, Button, Input } from "@cloudflare/kumo";
import { FloppyDiskIcon, PaperPlaneTiltIcon, RobotIcon, XIcon } from "@phosphor-icons/react";
import { useParams } from "react-router";
import { useComposeForm } from "~/hooks/useComposeForm";
import { useUIStore } from "~/hooks/useUIStore";
import RichTextEditor from "./RichTextEditor";

export default function ComposePanel() {
	const { mailboxId, folder } = useParams<{
		mailboxId: string;
		folder: string;
	}>();

	const { isAgentPanelOpen, toggleAgentPanel } = useUIStore();

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

	return (
		<div className="flex flex-col h-full bg-[#0f0f0f]">
			<div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5 border-b border-white/[0.06] shrink-0 md:px-8">
				<h2 className="text-[15px] font-semibold text-white/90">
					{formTitle}
				</h2>
				<div className="flex items-center gap-2 shrink-0">
					<button
						type="button"
						onClick={toggleAgentPanel}
						aria-expanded={isAgentPanelOpen}
						aria-controls="ai-assistant-panel"
						title="Open or close the assistant without changing your draft"
						className="flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-xs font-medium text-white/70 hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:outline-white/60 transition-colors cursor-pointer"
					>
						<RobotIcon size={14} aria-hidden="true" />
						AI assistant
					</button>
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
