// Preserve the conversation title while collapsing repeated reply prefixes.
export function replySubject(subject?: string | null): string {
	const title = (subject ?? "").replace(/[\r\n]+/g, " ").trim()
		.replace(/^(?:re\s*:\s*)+/i, "").trim();
	return `Re: ${title || "(no subject)"}`;
}
