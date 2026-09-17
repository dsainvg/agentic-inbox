// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Tooltip } from "@cloudflare/kumo";
import {
	CaretDownIcon,
	CaretUpIcon,
	CodeIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import EmailAttachmentList from "~/components/EmailAttachmentList";
import EmailIframe from "~/components/EmailIframe";
import {
	formatDetailDate,
	formatShortDate,
	rewriteInlineImages,
	stripHtml,
} from "~/lib/utils";
import type { Email } from "~/types";

interface ThreadMessageProps {
	email: Email;
	mailboxId?: string;
	mailboxEmail?: string;
	isLast: boolean;
	isDraft?: boolean;
	isSending?: boolean;
	isExpanded: boolean;
	onToggleExpand: () => void;
	onSendDraft?: () => void;
	onEditDraft?: () => void;
	onDeleteDraft?: () => void;
	onViewSource?: () => void;
	onPreviewImage?: (url: string, filename: string) => void;
}

function Avatar({ isDraft, isSelf, sender }: { isDraft?: boolean; isSelf: boolean; sender?: string }) {
	return (
		<div
			className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
				isDraft
					? "bg-white/[0.06] text-white/30"
					: isSelf
						? "bg-white/90 text-black"
						: "bg-white/[0.08] text-white/70"
			}`}
		>
			{isDraft ? "D" : (sender || "").charAt(0).toUpperCase() || "?"}
		</div>
	);
}

export default function ThreadMessage({
	email,
	mailboxId,
	mailboxEmail,
	isLast,
	isDraft,
	isSending,
	isExpanded,
	onToggleExpand,
	onSendDraft,
	onEditDraft,
	onDeleteDraft,
	onViewSource,
	onPreviewImage,
}: ThreadMessageProps) {
	const isSelf = Boolean(mailboxEmail && email.sender === mailboxEmail);
	const containerClassName = `${!isLast ? "border-b border-white/[0.05]" : ""} ${isDraft ? "border-l-2 border-l-white/30 bg-white/[0.03]" : ""}`;
	const senderLabel = isDraft ? "Draft reply" : isSelf ? "You" : (email.sender || "Unknown");

	if (!isExpanded) {
		return (
			<div className={containerClassName}>
				<button
					type="button"
					onClick={onToggleExpand}
					className="w-full flex items-center gap-3 px-6 py-3 hover:bg-white/[0.03] text-left transition-colors md:px-8"
				>
					<Avatar isDraft={isDraft} isSelf={isSelf} sender={email.sender} />
					<div className="flex-1 min-w-0">
						<div className="flex items-center justify-between gap-2">
							<span className="text-[13px] font-medium text-white/70 truncate">{senderLabel}</span>
							<span className="text-[11px] text-white/30 shrink-0">{formatDetailDate(email.date)}</span>
						</div>
						<p className="text-[12px] text-white/30 truncate mt-0.5">{stripHtml(email.body || "").slice(0, 80)}</p>
					</div>
					<CaretDownIcon size={12} className="text-white/25 shrink-0" />
				</button>
			</div>
		);
	}

	return (
		<div className={`group/thread-msg ${containerClassName}`}>
			<div className="px-6 py-5 md:px-8">
				<div className="flex items-center justify-between gap-3 mb-4">
					<div className="flex items-center gap-3 min-w-0">
						<button
							type="button"
							onClick={onToggleExpand}
							className="shrink-0"
							aria-label="Collapse message"
						>
							<div className="cursor-pointer hover:ring-2 hover:ring-white/40 transition-shadow rounded-full">
								<Avatar isDraft={isDraft} isSelf={isSelf} sender={email.sender} />
							</div>
						</button>
						<div className="min-w-0">
							<div className="flex items-center gap-2">
								<span className="text-[14px] font-semibold text-white/90 truncate">
									{senderLabel}
								</span>
								{isDraft && <Badge variant="outline">Draft</Badge>}
							</div>
							<div className="text-[12px] text-white/35 mt-0.5">To: {email.recipient}</div>
						</div>
					</div>
					<div className="flex items-center gap-2 shrink-0">
						<span className="text-[12px] text-white/30">
							{formatShortDate(email.date)}
						</span>
						{onViewSource && (
							<Tooltip content="View source" side="bottom" asChild>
								<Button
									variant="ghost"
									shape="square"
									size="sm"
									icon={<CodeIcon size={14} />}
									onClick={onViewSource}
									aria-label="View source"
									className="transition-opacity !h-6 !w-6"
								/>
							</Tooltip>
						)}
						<button
							type="button"
							onClick={onToggleExpand}
							className="ml-1"
							aria-label="Collapse message"
						>
							<CaretUpIcon
								size={14}
								className="text-white/25 hover:text-white/60 transition-colors"
							/>
						</button>
					</div>
				</div>

				<div className="md:ml-10">
					<EmailIframe
						body={rewriteInlineImages(
							email.body || "",
							mailboxId || "",
							email.id,
							email.attachments,
						)}
						autoSize
					/>
				</div>

				{isDraft && (onSendDraft || onEditDraft || onDeleteDraft) && (
					<div className="flex gap-2 mt-4 md:ml-10">
						{onSendDraft && (
							<Button
								variant="primary"
								size="sm"
								icon={<PaperPlaneTiltIcon size={14} />}
								onClick={onSendDraft}
								loading={isSending}
								disabled={isSending}
							>
								{isSending ? "Sending..." : "Send"}
							</Button>
						)}
						{onEditDraft && (
							<Button
								variant="secondary"
								size="sm"
								icon={<PencilSimpleIcon size={14} />}
								onClick={onEditDraft}
								disabled={isSending}
							>
								Edit
							</Button>
						)}
						{onDeleteDraft && (
							<Button
								variant="ghost"
								size="sm"
								icon={<TrashIcon size={14} />}
								onClick={onDeleteDraft}
								disabled={isSending}
							>
								Discard
							</Button>
						)}
					</div>
				)}

				<EmailAttachmentList
					mailboxId={mailboxId}
					emailId={email.id}
					attachments={email.attachments}
					onPreviewImage={onPreviewImage}
					className="mt-4 md:ml-10"
				/>
			</div>
		</div>
	);
}
