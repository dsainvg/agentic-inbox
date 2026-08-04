// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { ApiKeyRecord, ApiKeySummary } from "~/types";
import { queryKeys } from "./keys";

export function useApiKeys(mailboxId: string | undefined) {
	return useQuery<ApiKeySummary[]>({
		queryKey: mailboxId
			? queryKeys.apiKeys.list(mailboxId)
			: ["apiKeys", "_disabled"],
		queryFn: () => api.listApiKeys(mailboxId!) as Promise<ApiKeySummary[]>,
		enabled: !!mailboxId,
	});
}

export function useCreateApiKey() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			name,
		}: {
			mailboxId: string;
			name: string;
		}) => api.createApiKey(mailboxId, name) as Promise<ApiKeyRecord>,
		onSuccess: (_data, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: queryKeys.apiKeys.list(mailboxId) });
		},
	});
}

export function useDeleteApiKey() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			keyId,
		}: {
			mailboxId: string;
			keyId: string;
		}) => api.deleteApiKey(mailboxId, keyId),
		onSuccess: (_data, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: queryKeys.apiKeys.list(mailboxId) });
		},
	});
}
