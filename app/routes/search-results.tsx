// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Loader, Pagination, Tooltip } from "@cloudflare/kumo";
import { ArrowLeftIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import MailboxSplitView from "~/components/MailboxSplitView";
import { formatListDate, getSnippetText } from "~/lib/utils";
import { useUpdateEmail } from "~/queries/emails";
import { useSearchEmails, SEARCH_PAGE_SIZE } from "~/queries/search";
import { useUIStore } from "~/hooks/useUIStore";
import type { Email } from "~/types";

function highlightTerms(text: string, query: string): React.ReactNode {
	if (!query || !text) return text;
	const freeText = query
		.replace(/\b(?:from|to|subject|in|is|has|before|after):"[^"]*"/gi, "")
		.replace(/\b(?:from|to|subject|in|is|has|before|after):\S+/gi, "")
		.trim();
	if (!freeText) return text;
	try {
		const escaped = freeText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const regex = new RegExp(`(${escaped})`, "gi");
		const parts = text.split(regex);
		if (parts.length === 1) return text;
		// Use case-insensitive string comparison instead of regex.test() with g flag,
		// which has stateful lastIndex causing alternating true/false results.
		const lowerEscaped = escaped.toLowerCase();
		return parts.map((part, i) =>
			part.toLowerCase() === lowerEscaped ? (
				<mark key={i} className="bg-white/15 text-white rounded-sm px-0.5">
					{part}
				</mark>
			) : (
				part
			),
		);
	} catch {
		return text;
	}
}

export default function SearchResultsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const { selectedEmailId, isComposing, selectEmail, closePanel } = useUIStore();
	const updateEmail = useUpdateEmail();
	const urlQuery = searchParams.get("q") || "";
	const [page, setPage] = useState(1);
	const searchKey = useMemo(
		() => `${mailboxId ?? ""}::${urlQuery}`,
		[mailboxId, urlQuery],
	);
	const prevSearchKeyRef = useRef(searchKey);
	const searchChanged = prevSearchKeyRef.current !== searchKey;
	const currentPage = searchChanged ? 1 : page;

	useEffect(() => {
		if (!searchChanged) {
			return;
		}

		prevSearchKeyRef.current = searchKey;
		setPage(1);
		closePanel();
	}, [closePanel, searchChanged, searchKey]);

	const { data: searchData, isLoading } = useSearchEmails(
		mailboxId,
		urlQuery,
		currentPage,
	);
	const results = searchData?.results ?? [];
	const totalCount = searchData?.totalCount ?? 0;
	const isPanelOpen = selectedEmailId !== null || isComposing;

	const handleRowClick = (email: Email) => {
		selectEmail(email.id);
		if (!email.read && mailboxId)
			updateEmail.mutate({ mailboxId, id: email.id, data: { read: true } });
	};
	const folderDisplayName = (name: string | null | undefined): string => {
		if (!name) return "";
		const map: Record<string, string> = {
			inbox: "Inbox",
			sent: "Sent",
			draft: "Drafts",
			archive: "Archive",
			trash: "Trash",
		};
		return map[name.toLowerCase()] || name;
	};

	return (
		<MailboxSplitView
			selectedEmailId={selectedEmailId}
			isComposing={isComposing}
		>
			<div className="flex flex-col h-full bg-[#0f0f0f]">
				<div className="flex items-center gap-3 px-6 py-3.5 border-b border-white/[0.06] shrink-0 md:px-8">
					<Tooltip content="Back to inbox" side="bottom" asChild>
						<Button
							variant="ghost"
							shape="square"
							size="sm"
							icon={<ArrowLeftIcon size={18} className="text-white/60" />}
							onClick={() => navigate(`/mailbox/${mailboxId}/emails/inbox`)}
							aria-label="Back to inbox"
						/>
					</Tooltip>
					<div className="min-w-0 flex-1">
						<h1 className="text-[16px] font-semibold text-white/90 truncate">Search Results</h1>
						{!isLoading && (
							<span className="text-[12px] text-white/35">
								{totalCount} result{totalCount !== 1 ? "s" : ""}{urlQuery ? ` for "${urlQuery}"` : ""}
							</span>
						)}
					</div>
				</div>

				<div className="flex-1 overflow-y-auto">
					{isLoading ? (
						<div className="flex justify-center py-20">
							<Loader size="lg" />
						</div>
					) : results.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-32 px-8 text-center">
							<div className="mb-4 flex items-center justify-center w-12 h-12 rounded-full bg-white/[0.04] border border-white/[0.06]">
								<MagnifyingGlassIcon size={24} weight="regular" className="text-white/30" />
							</div>
							<h3 className="text-[15px] font-semibold text-white/80 mb-1.5">No results found</h3>
							<p className="text-[13px] text-white/40 max-w-xs leading-relaxed">
								{urlQuery
									? `Nothing matched "${urlQuery}". Try different keywords or check your spelling.`
									: "Enter a search term to find emails by subject, sender, or content."}
							</p>
							{urlQuery && (
								<p className="text-[11px] text-white/30 mt-4 max-w-sm">
									Tip: Use operators like <code className="bg-white/[0.06] border border-white/[0.08] px-1.5 py-0.5 rounded text-white/60 font-mono">from:name</code>, <code className="bg-white/[0.06] border border-white/[0.08] px-1.5 py-0.5 rounded text-white/60 font-mono">is:unread</code>, <code className="bg-white/[0.06] border border-white/[0.08] px-1.5 py-0.5 rounded text-white/60 font-mono">has:attachment</code>
								</p>
							)}
						</div>
					) : (
						<div>
							{results.map((email) => {
								const isSelected = selectedEmailId === email.id;
								const snippet = getSnippetText(email.snippet, 120);
								const folderName = (email as Email & { folder_name?: string }).folder_name;
								return (
									<div
										key={email.id}
										role="button"
										tabIndex={0}
										onClick={() => handleRowClick(email)}
										onKeyDown={(e) => {
											if (e.key === "Enter" || e.key === " ") {
												e.preventDefault();
												handleRowClick(email);
											}
										}}
										className={`group flex items-center gap-3 w-full text-left cursor-pointer transition-colors border-b border-white/[0.05] px-6 py-3 md:px-8 ${
											isPanelOpen ? "md:px-5 md:py-2.5" : ""
										} ${isSelected ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"}`}
									>
										<div className="w-2.5 shrink-0 flex justify-center">
											{!email.read && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
										</div>
										<div className="min-w-0 flex-1">
											<div className="flex items-center gap-2">
												<span
													className={`truncate text-[13px] ${
														!email.read ? "font-semibold text-white/95" : "text-white/70"
													}`}
												>
													{highlightTerms(email.sender.split("@")[0], urlQuery)}
												</span>
												{folderName && (
													<Badge
														variant="outline"
														className="text-[10px] bg-white/[0.06] border-white/[0.1] text-white/50 px-1.5 py-0"
													>
														{folderDisplayName(folderName)}
													</Badge>
												)}
												<span className="text-[11px] text-white/30 shrink-0 ml-auto font-mono">
													{formatListDate(email.date)}
												</span>
											</div>
											<div
												className={`truncate text-[13px] mt-0.5 ${
													!email.read ? "font-medium text-white/90" : "text-white/60"
												}`}
											>
												{highlightTerms(email.subject, urlQuery)}
											</div>
											{snippet && (
												<div className="truncate text-[12px] text-white/40 mt-0.5">
													{highlightTerms(snippet, urlQuery)}
												</div>
											)}
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>
				{totalCount > SEARCH_PAGE_SIZE && (
					<div className="flex justify-center py-3 border-t border-white/[0.06] shrink-0 bg-[#0f0f0f]">
						<Pagination page={currentPage} setPage={setPage} perPage={SEARCH_PAGE_SIZE} totalCount={totalCount} />
					</div>
				)}
			</div>
		</MailboxSplitView>
	);
}
