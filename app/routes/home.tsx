// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	Button,
	Dialog,
	Input,
	Loader,
	Select,
	Text,
	useKumoToastManager,
} from "@cloudflare/kumo";
import { EnvelopeIcon, EnvelopeSimpleIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router";
import api from "~/services/api";
import {
	useCreateMailbox,
	useDeleteMailbox,
	useMailboxes,
	useUpdateMailbox,
} from "~/queries/mailboxes";
import { queryKeys } from "~/queries/keys";

export function meta() {
	return [{ title: "Agentic Inbox" }];
}

export default function HomeRoute() {
	const toastManager = useKumoToastManager();
	const { data: mailboxes = [], refetch: refetchMailboxes, isFetched: mailboxesFetched } = useMailboxes();
	const createMailbox = useCreateMailbox();
	const deleteMailbox = useDeleteMailbox();
	const updateMailbox = useUpdateMailbox();

	const { data: configData } = useQuery({
		queryKey: queryKeys.config,
		queryFn: () => api.getConfig(),
		staleTime: Infinity, // config rarely changes
	});

	const domains = configData?.domains ?? [];
	const emailAddresses = configData?.emailAddresses ?? [];

	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [newPrefix, setNewPrefix] = useState("");
	const [selectedDomain, setSelectedDomain] = useState("");
	const [customDomain, setCustomDomain] = useState("");
	const [useCustomSubdomain, setUseCustomSubdomain] = useState(false);
	const [newName, setNewName] = useState("");
	const [newForwardTo, setNewForwardTo] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);

	const [isDeleteOpen, setIsDeleteOpen] = useState(false);
	const [mailboxToDelete, setMailboxToDelete] = useState<{
		id: string;
		email: string;
	} | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);

	// Forwarding edit state
	const [isForwardOpen, setIsForwardOpen] = useState(false);
	const [mailboxToEditForward, setMailboxToEditForward] = useState<{
		id: string;
		email: string;
		forwardTo: string;
	} | null>(null);
	const [forwardInput, setForwardInput] = useState("");
	const [isSavingForward, setIsSavingForward] = useState(false);

	// Set default domain when config loads
	useEffect(() => {
		if (domains.length > 0 && !selectedDomain) {
			setSelectedDomain(domains[0]);
		}
	}, [domains, selectedDomain]);

	// Auto-create mailboxes from config (run once when both data sources are ready)
	const autoCreateDone = useRef(false);
	useEffect(() => {
		if (autoCreateDone.current) return;
		if (emailAddresses.length === 0 || !mailboxesFetched) return;
		const existingEmails = new Set(
			mailboxes.map((m) => m.email.toLowerCase()),
		);
		const toCreate = emailAddresses.filter(
			(addr) => !existingEmails.has(addr.toLowerCase()),
		);
		if (toCreate.length === 0) {
			autoCreateDone.current = true;
			return;
		}
		autoCreateDone.current = true;
		let cancelled = false;
		Promise.all(
			toCreate.map((addr) => {
				const localPart = addr.split("@")[0] || addr;
				return api.createMailbox(addr, localPart).catch(() => {});
			}),
		).then(() => { if (!cancelled) refetchMailboxes(); });
		return () => { cancelled = true; };
	}, [emailAddresses, mailboxes, refetchMailboxes]);

	const handleCreate = async (e: FormEvent) => {
		e.preventDefault();
		setCreateError(null);
		const rawPrefix = newPrefix.trim();
		let email = "";

		if (rawPrefix.includes("@")) {
			email = rawPrefix.toLowerCase();
		} else {
			const activeDomain = (useCustomSubdomain ? customDomain : selectedDomain).trim().toLowerCase();
			if (!rawPrefix || !activeDomain) {
				setCreateError("Please fill in both prefix and domain/subdomain");
				return;
			}
			email = `${rawPrefix}@${activeDomain}`;
		}

		const name = newName.trim() || email.split("@")[0];
		const forwardTo = newForwardTo.trim() || undefined;
		setIsCreating(true);
		try {
			await createMailbox.mutateAsync({ email, name, forwardTo });
			toastManager.add({ title: "Mailbox created successfully!" });
			setIsCreateOpen(false);
			setNewPrefix("");
			setNewName("");
			setNewForwardTo("");
			setCustomDomain("");
			setUseCustomSubdomain(false);
		} catch (err: unknown) {
			const message = (err instanceof Error ? err.message : null) || "Failed to create mailbox";
			setCreateError(message);
		} finally {
			setIsCreating(false);
		}
	};

	const handleDelete = async () => {
		if (!mailboxToDelete) return;
		setIsDeleting(true);
		try {
			await deleteMailbox.mutateAsync(mailboxToDelete.id);
			toastManager.add({ title: "Mailbox deleted" });
			setIsDeleteOpen(false);
			setMailboxToDelete(null);
		} catch {
			toastManager.add({ title: "Failed to delete mailbox", variant: "error" });
		} finally {
			setIsDeleting(false);
		}
	};

	const handleSaveForward = async (e: FormEvent) => {
		e.preventDefault();
		if (!mailboxToEditForward) return;
		setIsSavingForward(true);
		try {
			await updateMailbox.mutateAsync({
				mailboxId: mailboxToEditForward.id,
				forwardTo: forwardInput.trim() || undefined,
			});
			toastManager.add({ title: "Forwarding address updated!" });
			setIsForwardOpen(false);
			setMailboxToEditForward(null);
		} catch {
			toastManager.add({ title: "Failed to update forwarding address", variant: "error" });
		} finally {
			setIsSavingForward(false);
		}
	};

	const isConfigured = emailAddresses.length > 0;
	const accounts = isConfigured
		? emailAddresses.map((addr) => {
				const found = mailboxes.find((m) => m.email.toLowerCase() === addr.toLowerCase());
				return {
					id: addr,
					email: addr,
					name: found?.name || addr.split("@")[0] || addr,
					forwardTo: found?.forwardTo,
				};
		  })
		: mailboxes;

	const isLoading = !configData;

	return (
		<div className="min-h-screen bg-[#090909]">
			<div className="mx-auto max-w-xl px-4 py-10 md:px-6 md:py-16">
				{/* Header */}
				<div className="mb-8">
					<div className="flex items-center justify-between">
						<h1 className="text-[22px] font-bold text-white/90">Mailboxes</h1>
						{!isConfigured && (
							<Button
								variant="primary"
								icon={<PlusIcon size={16} />}
								onClick={() => setIsCreateOpen(true)}
							>
								New Mailbox
							</Button>
						)}
					</div>
					{domains.length > 0 && (
						<p className="text-[12px] text-white/35 mt-1.5">
							{domains.join(", ")}
						</p>
					)}
				</div>

				{/* All Mailboxes Combined Inbox Entry */}
				<RouterLink
					to="/mailbox/all/emails/all_mail"
					className="group flex items-center justify-between px-5 py-4 mb-5 rounded-2xl border border-white/[0.07] bg-[#111111] no-underline transition-all hover:border-white/[0.12] hover:bg-white/[0.04]"
				>
					<div className="min-w-0 flex-1">
						<div className="text-[13px] font-semibold text-white/85">All Mailboxes</div>
						<div className="text-[12px] text-white/35 mt-0.5">View emails from all mailboxes in a single stream</div>
					</div>
					<div className="text-[12px] font-medium text-white/40 group-hover:text-white/70 transition-colors shrink-0 ml-4">View All →</div>
				</RouterLink>

				{isLoading ? (
					<div className="flex justify-center py-20">
						<Loader size="lg" />
					</div>
				) : accounts.length > 0 ? (
					<div className="rounded-2xl border border-white/[0.07] bg-[#111111] overflow-hidden">
						{accounts.map((account, idx) => (
							<RouterLink
								key={account.id}
								to={`/mailbox/${account.id}`}
								className={`group flex items-center gap-4 px-5 py-4 no-underline transition-colors hover:bg-white/[0.03] ${
									idx > 0 ? "border-t border-white/[0.06]" : ""
								}`}
							>
								<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[14px] font-bold text-white/70">
									{account.name.charAt(0).toUpperCase()}
								</div>
								<div className="min-w-0 flex-1">
									<div className="text-[14px] font-medium text-white/85 truncate">{account.name}</div>
									<div className="text-[12px] text-white/40">{account.email}</div>
									{account.forwardTo && (
										<div className="text-[11px] text-white/25 mt-0.5">Forwarding to: {account.forwardTo}</div>
									)}
								</div>
								<div className="flex items-center gap-1 shrink-0">
									<Button
										variant="ghost"
										size="sm"
										shape="square"
										icon={<PencilSimpleIcon size={15} />}
										aria-label={`Edit forwarding for ${account.email}`}
										onClick={(e) => {
											e.preventDefault();
											e.stopPropagation();
											setMailboxToEditForward({
												id: account.id,
												email: account.email,
												forwardTo: account.forwardTo || "",
											});
											setForwardInput(account.forwardTo || "");
											setIsForwardOpen(true);
										}}
									/>
									{!isConfigured && (
										<Button
											variant="ghost"
											size="sm"
											shape="square"
											icon={<TrashIcon size={15} />}
											aria-label={`Delete mailbox ${account.email}`}
											onClick={(e) => {
												e.preventDefault();
												e.stopPropagation();
												setMailboxToDelete({
													id: account.id,
													email: account.email,
												});
												setIsDeleteOpen(true);
											}}
										/>
									)}
								</div>
							</RouterLink>
						))}
					</div>
				) : (
					<div className="rounded-2xl border border-white/[0.07] bg-[#111111] py-16 px-6">
						<div className="flex flex-col items-center text-center">
							<div className="mb-5 opacity-20">
								<EnvelopeIcon size={44} weight="thin" className="text-white" />
							</div>
							<h3 className="text-[15px] font-semibold text-white/70 mb-2">No mailboxes yet</h3>
							<p className="text-[13px] text-white/35 max-w-sm mb-6">
								{isConfigured
									? "Your email routing is configured but no mailboxes have been created yet. They will appear here automatically."
									: "Create a mailbox to start sending and receiving emails with your domain."}
							</p>
							{!isConfigured && (
								<Button variant="primary" icon={<PlusIcon size={15} />} onClick={() => setIsCreateOpen(true)}>
									Create Mailbox
								</Button>
							)}
						</div>
					</div>
				)}
			</div>

			{/* Create Dialog */}
			<Dialog.Root open={isCreateOpen} onOpenChange={setIsCreateOpen}>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-5">
						Create New Mailbox
					</Dialog.Title>
					<form onSubmit={handleCreate} className="space-y-4">
						{createError && (
							<Text variant="error" size="sm">
								{createError}
							</Text>
						)}
						<div>
							<span className="text-sm font-medium text-kumo-default mb-1.5 block">
								Email Address / Subdomain
							</span>
							<div className="flex items-center gap-2">
								<div className="flex-1">
									<Input
										aria-label="Address prefix or full email"
										placeholder="info or info@sub.domain.com"
										size="sm"
										value={newPrefix}
										onChange={(e) => setNewPrefix(e.target.value)}
										required
									/>
								</div>
								{!newPrefix.includes("@") && (
									<>
										<span className="text-sm text-kumo-subtle">@</span>
										<div className="flex-1">
											{useCustomSubdomain ? (
												<Input
													aria-label="Custom Subdomain"
													placeholder="sub.domain.com"
													size="sm"
													value={customDomain}
													onChange={(e) => setCustomDomain(e.target.value)}
													required
												/>
											) : (
												<Select
													aria-label="Domain"
													value={selectedDomain}
													onValueChange={(value) => {
														if (value === "__custom__") {
															setUseCustomSubdomain(true);
														} else if (value) {
															setSelectedDomain(value);
														}
													}}
												>
													{domains.map((d) => (
														<Select.Option key={d} value={d}>
															{d}
														</Select.Option>
													))}
													<Select.Option value="__custom__">
														+ Enter Subdomain...
													</Select.Option>
												</Select>
											)}
										</div>
									</>
								)}
							</div>
							<p className="text-[11px] text-kumo-subtle mt-1.5">
								Supports base domains and any subdomains (e.g. <code className="font-mono text-kumo-default">user@sub.example.com</code>).
							</p>
							{useCustomSubdomain && (
								<button
									type="button"
									onClick={() => setUseCustomSubdomain(false)}
									className="text-[11px] text-kumo-primary hover:underline mt-1 cursor-pointer"
								>
									← Select base domain instead
								</button>
							)}
						</div>
						<Input
							label="Display Name (optional)"
							placeholder="Info"
							size="sm"
							value={newName}
							onChange={(e) => setNewName(e.target.value)}
						/>

						<Input
							label="Forwarding Email Address (optional)"
							placeholder="e.g. personal@example.com"
							type="email"
							size="sm"
							value={newForwardTo}
							onChange={(e) => setNewForwardTo(e.target.value)}
						/>

						<div className="flex justify-end gap-2 pt-2">
							<Dialog.Close
								render={(props) => (
									<Button {...props} variant="secondary" size="sm">
										Cancel
									</Button>
								)}
							/>
							<Button
								type="submit"
								variant="primary"
								size="sm"
								loading={isCreating}
								disabled={!selectedDomain}
							>
								Create
							</Button>
						</div>
					</form>
				</Dialog>
			</Dialog.Root>

			{/* Forwarding Edit Dialog */}
			<Dialog.Root
				open={isForwardOpen}
				onOpenChange={(open) => {
					setIsForwardOpen(open);
					if (!open) setMailboxToEditForward(null);
				}}
			>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-2">
						Configure Forwarding Address
					</Dialog.Title>
					<Dialog.Description className="text-kumo-subtle text-xs mb-4">
						Set or update the target forwarding email address for{" "}
						<strong className="text-kumo-default">
							{mailboxToEditForward?.email}
						</strong>.
					</Dialog.Description>
					<form onSubmit={handleSaveForward} className="space-y-4">
						<Input
							label="Forwarding Email Address"
							type="email"
							placeholder="personal@example.com (leave blank to disable)"
							size="sm"
							value={forwardInput}
							onChange={(e) => setForwardInput(e.target.value)}
						/>
						<div className="flex justify-end gap-2 pt-2">
							<Dialog.Close
								render={(props) => (
									<Button {...props} variant="secondary" size="sm">
										Cancel
									</Button>
								)}
							/>
							<Button
								type="submit"
								variant="primary"
								size="sm"
								loading={isSavingForward}
							>
								Save Forwarding Address
							</Button>
						</div>
					</form>
				</Dialog>
			</Dialog.Root>

			{/* Delete Dialog */}
			<Dialog.Root
				open={isDeleteOpen}
				onOpenChange={(open) => {
					setIsDeleteOpen(open);
					if (!open) setMailboxToDelete(null);
				}}
			>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-2">
						Delete Mailbox
					</Dialog.Title>
					<Dialog.Description className="text-kumo-subtle text-sm mb-5">
						Are you sure you want to delete{" "}
						<strong className="text-kumo-default">
							{mailboxToDelete?.email}
						</strong>
						? This action cannot be undone.
					</Dialog.Description>
					<div className="flex justify-end gap-2">
						<Dialog.Close
							render={(props) => (
								<Button {...props} variant="secondary" size="sm">
									Cancel
								</Button>
							)}
						/>
						<Button
							variant="destructive"
							size="sm"
							loading={isDeleting}
							onClick={handleDelete}
						>
							Delete
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>
		</div>
	);
}
