// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Dialog, Input, Tooltip, useKumoToastManager } from "@cloudflare/kumo";
import {
	ArchiveIcon,
	CaretLeftIcon,
	EnvelopeSimpleIcon,
	FileIcon,
	FolderIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	PlusIcon,
	TrashIcon,
	TrayIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router";
import { Folders, SYSTEM_FOLDER_IDS } from "shared/folders";
import { useCreateFolder, useDeleteFolder, useFolders, useUpdateFolder } from "~/queries/folders";
import { useQueryClient } from "@tanstack/react-query";
import { useMailbox } from "~/queries/mailboxes";
import { useUIStore } from "~/hooks/useUIStore";
import api from "~/services/api";

const FOLDER_ICONS: Record<string, React.ReactNode> = {
	[Folders.ALL_MAIL]: <EnvelopeSimpleIcon size={18} weight="regular" />,
	[Folders.INBOX]: <TrayIcon size={18} weight="regular" />,
	[Folders.SENT]: <PaperPlaneTiltIcon size={18} weight="regular" />,
	[Folders.DRAFT]: <FileIcon size={18} weight="regular" />,
	[Folders.ARCHIVE]: <ArchiveIcon size={18} weight="regular" />,
	[Folders.TRASH]: <TrashIcon size={18} weight="regular" />,
};

const SYSTEM_FOLDER_LINKS = [
	{ id: Folders.ALL_MAIL, label: "All Mail" },
	{ id: Folders.INBOX, label: "Inbox" },
	{ id: Folders.SENT, label: "Sent" },
	{ id: Folders.DRAFT, label: "Drafts" },
	{ id: Folders.ARCHIVE, label: "Archive" },
	{ id: Folders.TRASH, label: "Trash" },
];


interface FolderLinkProps {
	to: string;
	icon: React.ReactNode;
	label: string;
	unreadCount?: number;
	onClick?: () => void;
	actions?: React.ReactNode;
}

function FolderLink({
	to,
	icon,
	label,
	unreadCount,
	onClick,
	actions,
}: FolderLinkProps) {
	return (
		<div className="group/folder relative">
			<NavLink
				to={to}
				onClick={onClick}
				className={({ isActive }) =>
					`flex items-center gap-3 py-2 px-3 rounded-md text-sm transition-colors ${
						isActive
							? "bg-kumo-fill font-semibold text-kumo-default"
							: "text-kumo-strong hover:bg-kumo-tint"
					}`
				}
			>
				<span className="shrink-0">{icon}</span>
				<span className="truncate flex-1">{label}</span>
				{unreadCount != null && unreadCount > 0 && (
					<Badge variant="secondary">{unreadCount}</Badge>
				)}
			</NavLink>
			{actions && (
				<div className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover/folder:flex group-focus-within/folder:flex items-center gap-0.5 bg-kumo-base rounded-md shadow-sm border border-kumo-line px-0.5">
					{actions}
				</div>
			)}
		</div>
	);
}

export default function Sidebar() {
	const { mailboxId, folder: currentFolder } = useParams<{ mailboxId: string; folder: string }>();
	const navigate = useNavigate();
	const toastManager = useKumoToastManager();
	const { data: folders = [] } = useFolders(mailboxId);
	const createFolderMutation = useCreateFolder();
	const updateFolderMutation = useUpdateFolder();
	const deleteFolderMutation = useDeleteFolder();
	const queryClient = useQueryClient();
	const { startCompose, closeSidebar } = useUIStore();
	const { data: currentMailbox } = useMailbox(mailboxId);
	const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
	const [newFolderName, setNewFolderName] = useState("");

	// Rename / delete custom folders
	const [editingFolder, setEditingFolder] = useState<{ id: string; name: string } | null>(null);
	const [renameFolderName, setRenameFolderName] = useState("");
	const [folderToDelete, setFolderToDelete] = useState<{ id: string; name: string } | null>(null);

	const customFolders = useMemo(
		() =>
			folders.filter((f) => !(SYSTEM_FOLDER_IDS as readonly string[]).includes(f.id)),
		[folders],
	);

	const getUnreadCount = (folderId: string) => {
		const found = folders.find((f) => f.id === folderId);
		return found?.unreadCount || 0;
	};

	const handleCreateFolder = (e: React.FormEvent) => {
		e.preventDefault();
		if (newFolderName.trim() && mailboxId) {
			createFolderMutation.mutate({ mailboxId, name: newFolderName.trim() });
			setNewFolderName("");
			setIsCreateFolderOpen(false);
		}
	};

	const handleRenameFolder = (e: React.FormEvent) => {
		e.preventDefault();
		if (!mailboxId || !editingFolder || !renameFolderName.trim()) return;
		const newName = renameFolderName.trim();
		if (newName === editingFolder.name) {
			setEditingFolder(null);
			return;
		}
		updateFolderMutation.mutate(
			{ mailboxId, id: editingFolder.id, name: newName },
			{
				onSuccess: () => {
					queryClient.invalidateQueries({ queryKey: ["automations", mailboxId] });
					queryClient.invalidateQueries({ queryKey: ["emails", mailboxId] });
					// If the renamed folder is currently open, navigate to its new URL
					if (currentFolder === editingFolder.id || currentFolder === editingFolder.name) {
						navigate(`/mailbox/${mailboxId}/emails/${encodeURIComponent(newName)}`);
					}
					toastManager.add({ title: "Folder renamed" });
				},
				onError: () => {
					toastManager.add({ title: "Failed to rename folder", variant: "error" });
				},
			},
		);
		setEditingFolder(null);
	};

	const handleDeleteFolder = () => {
		if (!mailboxId || !folderToDelete) return;
		const deletedId = folderToDelete.id;
		deleteFolderMutation.mutate(
			{ mailboxId, id: deletedId },
			{
				onSuccess: () => {
					queryClient.invalidateQueries({ queryKey: ["automations", mailboxId] });
					queryClient.invalidateQueries({ queryKey: ["emails", mailboxId] });
					// If the deleted folder is open, move the user back to the Inbox
					if (currentFolder === deletedId || currentFolder === folderToDelete.name) {
						navigate(`/mailbox/${mailboxId}/emails/inbox`);
					}
					toastManager.add({ title: "Folder deleted", description: "Its emails were moved to Archive" });
				},
				onError: () => {
					toastManager.add({ title: "Failed to delete folder", variant: "error" });
				},
			},
		);
		setFolderToDelete(null);
	};

	const displayName = useMemo(() => {
		if (mailboxId === "all") return "All Mailboxes";
		if (!currentMailbox) return mailboxId?.split("@")[0] || "Mailbox";
		// Prefer settings.fromName > name > local part of email
		if (currentMailbox.settings?.fromName) {
			return currentMailbox.settings.fromName;
		}
		if (currentMailbox.name && currentMailbox.name !== currentMailbox.email) {
			return currentMailbox.name;
		}
		return currentMailbox.email.split("@")[0] || currentMailbox.name;
	}, [currentMailbox, mailboxId]);

	const handleNavClick = () => {
		// Close mobile sidebar on navigation
		closeSidebar();
	};

	return (
		<aside className="h-full w-64 bg-kumo-recessed flex flex-col shrink-0 border-r border-kumo-line">
			{/* Back + identity */}
			<div className="px-4 pt-4 pb-1">
				<div className="flex items-center justify-between mb-2.5">
					<button
						type="button"
						onClick={() => {
							navigate("/");
							closeSidebar();
						}}
						className="flex items-center gap-1.5 text-kumo-subtle text-sm hover:text-kumo-default transition-colors cursor-pointer bg-transparent border-0 p-0"
					>
						<CaretLeftIcon size={14} />
						<span>Mailboxes</span>
					</button>
					{mailboxId !== "all" && (
						<NavLink
							to="/mailbox/all/emails/all_mail"
							onClick={handleNavClick}
							className="text-xs text-kumo-link hover:underline font-medium"
						>
							All Mails
						</NavLink>
					)}
				</div>
				<div className="px-1">
					<div className="text-base font-semibold text-kumo-default truncate">
						{displayName}
					</div>
					<div className="text-sm text-kumo-subtle truncate mt-0.5">
						{mailboxId === "all" ? "Combined Inbox" : currentMailbox?.email || mailboxId}
					</div>
				</div>
			</div>

			{/* Compose */}
			<div className="px-3 py-3">
				<Button
					variant="primary"
					icon={<PencilSimpleIcon size={16} />}
					onClick={() => startCompose()}
					className="w-full"
				>
					Compose
				</Button>
			</div>

			{/* Navigation */}
			<nav className="flex-1 overflow-y-auto px-2 space-y-0.5">
				{SYSTEM_FOLDER_LINKS.map((folder) => (
					<FolderLink
						key={folder.id}
						to={`/mailbox/${mailboxId}/emails/${folder.id}`}
						icon={FOLDER_ICONS[folder.id]}
						label={folder.label}
						unreadCount={getUnreadCount(folder.id)}
						onClick={handleNavClick}
					/>
				))}

				{/* Custom folders */}
				{customFolders.length > 0 && (
					<div className="pt-5">
						<div className="flex items-center justify-between px-3 mb-1.5">
							<span className="text-xs uppercase tracking-wider font-semibold text-kumo-subtle">
								Folders
							</span>
							<Tooltip content="New folder" asChild>
								<Button
									variant="ghost"
									shape="square"
									size="sm"
									icon={<PlusIcon size={16} />}
									onClick={() => setIsCreateFolderOpen(true)}
									aria-label="Create new folder"
								/>
							</Tooltip>
						</div>
						{customFolders.map((folder) => (
							<FolderLink
								key={folder.id}
								to={`/mailbox/${mailboxId}/emails/${encodeURIComponent(folder.id)}`}
								icon={<FolderIcon size={18} />}
								label={folder.name}
								unreadCount={folder.unreadCount}
								onClick={handleNavClick}
								actions={
									<>
										<button
											className="p-1 rounded hover:bg-kumo-tint text-kumo-subtle hover:text-kumo-default cursor-pointer"
											aria-label={`Rename folder ${folder.name}`}
											title="Rename folder"
											onClick={(e) => {
												e.preventDefault();
												e.stopPropagation();
												setEditingFolder({ id: folder.id, name: folder.name });
												setRenameFolderName(folder.name);
											}}
										>
											<PencilSimpleIcon size={13} />
										</button>
										<button
											className="p-1 rounded hover:bg-kumo-danger-tint text-kumo-subtle hover:text-kumo-danger cursor-pointer"
											aria-label={`Delete folder ${folder.name}`}
											title="Delete folder"
											onClick={(e) => {
												e.preventDefault();
												e.stopPropagation();
												setFolderToDelete({ id: folder.id, name: folder.name });
											}}
										>
											<TrashIcon size={13} />
										</button>
									</>
								}
							/>
						))}
					</div>
				)}

				{/* Add folder button when no custom folders */}
				{customFolders.length === 0 && (
					<div className="pt-5">
						<div className="flex items-center justify-between px-3 mb-1.5">
							<span className="text-xs uppercase tracking-wider font-semibold text-kumo-subtle">
								Folders
							</span>
							<Tooltip content="New folder" asChild>
								<Button
									variant="ghost"
									shape="square"
									size="sm"
									icon={<PlusIcon size={16} />}
									onClick={() => setIsCreateFolderOpen(true)}
									aria-label="Create new folder"
								/>
							</Tooltip>
						</div>
					</div>
				)}
			</nav>

			{/* Create folder dialog */}
			<Dialog.Root
				open={isCreateFolderOpen}
				onOpenChange={setIsCreateFolderOpen}
			>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-4">
						Create folder
					</Dialog.Title>
					<form onSubmit={handleCreateFolder} className="space-y-4">
						<Input
							label="Folder name"
							placeholder="e.g. Projects"
							value={newFolderName}
							onChange={(e) => setNewFolderName(e.target.value)}
							required
						/>
						<div className="flex justify-end gap-2">
							<Dialog.Close
								render={(props) => (
									<Button {...props} variant="secondary">
										Cancel
									</Button>
								)}
							/>
							<Button
								type="submit"
								variant="primary"
								disabled={!newFolderName.trim()}
							>
								Create
							</Button>
						</div>
					</form>
				</Dialog>
			</Dialog.Root>

			{/* Rename folder dialog */}
			<Dialog.Root
				open={editingFolder !== null}
				onOpenChange={(open) => {
					if (!open) setEditingFolder(null);
				}}
			>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-4">
						Rename folder
					</Dialog.Title>
					<form onSubmit={handleRenameFolder} className="space-y-4">
						<Input
							label="Folder name"
							placeholder="e.g. Projects"
							value={renameFolderName}
							onChange={(e) => setRenameFolderName(e.target.value)}
							required
						/>
						<div className="flex justify-end gap-2">
							<Dialog.Close
								render={(props) => (
									<Button {...props} variant="secondary">
										Cancel
									</Button>
								)}
							/>
							<Button
								type="submit"
								variant="primary"
								disabled={!renameFolderName.trim()}
								loading={updateFolderMutation.isPending}
							>
								Save
							</Button>
						</div>
					</form>
				</Dialog>
			</Dialog.Root>

			{/* Delete folder confirmation dialog */}
			<Dialog.Root
				open={folderToDelete !== null}
				onOpenChange={(open) => {
					if (!open) setFolderToDelete(null);
				}}
			>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-2">
						Delete folder
					</Dialog.Title>
					<Dialog.Description className="text-kumo-subtle text-sm mb-5">
						Are you sure you want to delete{" "}
						<strong className="text-kumo-default">{folderToDelete?.name}</strong>?
						Emails in this folder will be moved to <strong>Archive</strong>, and any
						automations that file into it will be removed. This action cannot be
						undone.
					</Dialog.Description>
					<div className="flex justify-end gap-2">
						<Dialog.Close
							render={(props) => (
								<Button {...props} variant="secondary">
									Cancel
								</Button>
							)}
						/>
						<Button
							variant="destructive"
							loading={deleteFolderMutation.isPending}
							onClick={handleDeleteFolder}
						>
							Delete Folder
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>

			{/* Logout / Session Actions Footer */}
			<div className="p-3 border-t border-kumo-line bg-kumo-surface">
				<Button
					variant="secondary"
					size="sm"
					className="w-full flex items-center justify-center gap-2"
					onClick={async () => {
						try {
							await api.logout();
							window.location.href = "/login";
						} catch (err) {
							console.error("Logout failed:", err);
							window.location.href = "/login";
						}
					}}
				>
					Sign Out
				</Button>
			</div>
		</aside>
	);
}
