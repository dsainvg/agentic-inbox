import { ApiError } from "~/services/api";

export const hierarchyRootKey = ["hierarchy-settings"] as const;

export async function hierarchyRequest<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
	const response = await fetch(`/api/v1/settings${path}`, {
		method,
		credentials: "same-origin",
		signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
		headers: { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	if (!response.ok) {
		throw new ApiError(response.status, (await response.json().catch(() => ({}))) as Record<string, unknown>);
	}
	return response.status === 204 ? (undefined as T) : response.json();
}
