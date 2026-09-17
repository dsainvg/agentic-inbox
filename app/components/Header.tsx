// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Tooltip } from "@cloudflare/kumo";
import { GearSixIcon, ListIcon, MagnifyingGlassIcon, RobotIcon, XIcon } from "@phosphor-icons/react";
import { type KeyboardEvent, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useUIStore } from "~/hooks/useUIStore";
import AgentSidebar from "./AgentSidebar";

export default function Header() {
	const [searchQuery, setSearchQuery] = useState("");
	const [isSearchExpanded, setIsSearchExpanded] = useState(false);
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const navigate = useNavigate();
	const location = useLocation();
	const [searchParams] = useSearchParams();
	const { toggleSidebar, toggleAgentPanel, isAgentPanelOpen } = useUIStore();

	const [hasOpenedAssistant, setHasOpenedAssistant] = useState(false);
	useEffect(() => {
		if (isAgentPanelOpen) setHasOpenedAssistant(true);
	}, [isAgentPanelOpen]);

	// Sync search input with URL query param so it stays populated
	const urlQuery = searchParams.get("q") || "";
	useEffect(() => {
		if (location.pathname.includes("/search") && urlQuery) {
			setSearchQuery(urlQuery);
		}
	}, [urlQuery, location.pathname]);

	const performSearch = () => {
		if (mailboxId && searchQuery.trim()) {
			const q = searchQuery.trim();
			navigate(`/mailbox/${mailboxId}/search?q=${encodeURIComponent(q)}`);
			setIsSearchExpanded(false);
		}
	};

	const clearSearch = () => {
		setSearchQuery("");
		if (location.pathname.includes("/search") && mailboxId) {
			navigate(`/mailbox/${mailboxId}/emails/inbox`);
		}
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Enter") {
			performSearch();
		}
		if (e.key === "Escape") {
			if (searchQuery) {
				clearSearch();
			} else {
				setIsSearchExpanded(false);
			}
		}
	};

	const isSettingsActive = location.pathname.includes("/settings");

	return (
		<header className="flex items-center gap-3 px-4 py-2 bg-[#0a0a0a] border-b border-white/[0.05] sticky top-0 z-10 h-12">
			{/* Hamburger menu - mobile only */}
			<button
				type="button"
				onClick={toggleSidebar}
				aria-label="Toggle sidebar"
				className="md:hidden shrink-0 p-1.5 rounded-md text-white/50 hover:text-white/80 hover:bg-white/6 transition-colors cursor-pointer"
			>
				<ListIcon size={18} />
			</button>

			{/* Search - full on desktop, collapsible on mobile */}
			<div
				className={`flex-1 min-w-0 max-w-xl transition-all items-center gap-1 ${
					isSearchExpanded ? "flex" : "hidden md:flex"
				}`}
			>
				<div className="flex-1 min-w-0 relative flex items-center bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 h-8 gap-2 focus-within:border-white/20 focus-within:bg-white/[0.07] transition-all">
					<MagnifyingGlassIcon size={14} className="text-white/30 shrink-0" />
					<input
						aria-label="Search emails"
						placeholder="Search emails… (try from:name, is:unread, has:attachment)"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						onKeyDown={handleKeyDown}
						className="flex-1 min-w-0 bg-transparent text-[13px] text-white/90 placeholder:text-white/30 outline-none border-none"
					/>
					{searchQuery && (
						<button
							type="button"
							onClick={clearSearch}
							className="text-white/40 hover:text-white/80 transition-colors cursor-pointer shrink-0"
							aria-label="Clear search"
						>
							<XIcon size={13} />
						</button>
					)}
				</div>
			</div>

			{/* Search toggle button - mobile only, hidden when search is expanded */}
			{!isSearchExpanded && (
				<button
					type="button"
					onClick={() => setIsSearchExpanded(true)}
					aria-label="Search"
					className="md:hidden shrink-0 p-1.5 rounded-md text-white/50 hover:text-white/80 hover:bg-white/6 transition-colors cursor-pointer"
				>
					<MagnifyingGlassIcon size={18} />
				</button>
			)}

			<div className="flex items-center gap-2 ml-auto shrink-0">
				<button
					type="button"
					onClick={toggleAgentPanel}
					aria-label="AI assistant"
					aria-expanded={isAgentPanelOpen}
					aria-controls="ai-assistant-panel"
					className={`flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-xs font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-white/60 ${
						isAgentPanelOpen
							? "border-white/20 bg-white/10 text-white"
							: "border-white/10 text-white/70 hover:bg-white/[0.06] hover:text-white"
					}`}
				>
					<RobotIcon size={16} aria-hidden="true" />
					AI assistant
				</button>
				<Tooltip content="Settings" side="bottom" asChild>
					<button
						type="button"
						onClick={() =>
							navigate(
								isSettingsActive
									? `/mailbox/${mailboxId}/emails/inbox`
									: `/mailbox/${mailboxId}/settings`,
							)
						}
						aria-label="Settings"
						className={`p-1.5 rounded-md transition-colors cursor-pointer ${
							isSettingsActive
								? "bg-white/10 text-white"
								: "text-white/50 hover:text-white/80 hover:bg-white/6"
						}`}
					>
						<GearSixIcon size={18} />
					</button>
				</Tooltip>
			</div>
			<aside
				id="ai-assistant-panel"
				aria-label="AI assistant"
				hidden={!isAgentPanelOpen}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						toggleAgentPanel();
						document.querySelector<HTMLButtonElement>('button[aria-controls="ai-assistant-panel"]')?.focus();
					}
				}}
				className="fixed right-0 top-12 bottom-0 z-30 w-full sm:w-96 border-l border-white/10 bg-[#0f0f0f] grayscale"
			>
				{(hasOpenedAssistant || isAgentPanelOpen) && <AgentSidebar key={mailboxId} />}
			</aside>
		</header>
	);
}
