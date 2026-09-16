// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { Automation } from "~/types";
import { queryKeys } from "./keys";

export function useAutomations(mailboxId: string | undefined) {
	return useQuery<Automation[]>({
		queryKey: mailboxId
			? queryKeys.automations.list(mailboxId)
			: ["automations", "_disabled"],
		queryFn: () => api.listAutomations(mailboxId!) as Promise<Automation[]>,
		enabled: !!mailboxId,
	});
}

export function useCreateAutomation() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, rule }: { mailboxId: string; rule: Parameters<typeof api.createAutomation>[1] }) =>
			api.createAutomation(mailboxId, rule),
		onSuccess: (_data, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: queryKeys.automations.list(mailboxId) });
		},
	});
}

export function useUpdateAutomation() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			ruleId,
			patch,
		}: {
			mailboxId: string;
			ruleId: string;
			patch: Parameters<typeof api.updateAutomation>[2];
		}) => api.updateAutomation(mailboxId, ruleId, patch),
		onSuccess: (_data, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: queryKeys.automations.list(mailboxId) });
		},
	});
}

export function useDeleteAutomation() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, ruleId }: { mailboxId: string; ruleId: string }) =>
			api.deleteAutomation(mailboxId, ruleId),
		onSuccess: (_data, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: queryKeys.automations.list(mailboxId) });
		},
	});
}