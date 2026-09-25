import { Button, Input } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import api from "~/services/api";

export default function OperationsSettings({ section, mailboxId }: { section: string; mailboxId?: string }) {
	const [data, setData] = useState<unknown>(null);
	const [passphrase, setPassphrase] = useState("");
	const [message, setMessage] = useState("");
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		let active = true;
		setMessage("");
		if (section === "audit") {
			api.getAuditEvents().then((result) => { if (active) setData(result.events); }).catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Unable to load audit events"); });
		} else if (section === "team") {
			api.getUsers().then((result) => { if (active) setData(result); }).catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Owner access is required"); });
		} else if (section === "reliability" && mailboxId && mailboxId !== "all") {
			api.getAutomationRuns(mailboxId).then((result) => { if (active) setData(result); }).catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Unable to load reliability data"); });
		}
		return () => { active = false; };
	}, [section, mailboxId]);

	const exportBackup = async () => {
		if (passphrase.length < 12) { setMessage("Use a passphrase of at least 12 characters."); return; }
		setLoading(true);
		try {
			const envelope = await api.exportBackup(passphrase);
			const blob = new Blob([JSON.stringify(envelope)], { type: "application/json" });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a"); anchor.href = url; anchor.download = "agentic-inbox-backup.json"; anchor.click(); URL.revokeObjectURL(url);
			setMessage("Encrypted backup downloaded.");
		} catch (error) { setMessage(error instanceof Error ? error.message : "Backup failed"); } finally { setLoading(false); }
	};

	if (section === "backup") {
		return <div className="rounded-2xl border border-white/[0.07] bg-[#111111] p-6 space-y-4"><h2 className="text-white/90 text-lg">Encrypted backup</h2><p className="text-white/50 text-sm">Exports mailbox data without passwords, API keys, or owner memory. The passphrase is never stored.</p><Input label="Backup passphrase" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} size="sm" /><Button variant="primary" onClick={exportBackup} disabled={loading}>{loading ? "Preparing..." : "Download encrypted backup"}</Button>{message && <p className="text-white/60 text-sm">{message}</p>}</div>;
	}
	if (message) return <div className="rounded-2xl border border-white/[0.07] bg-[#111111] p-6 text-sm text-white/60">{message}</div>;
	if (!data) return <div className="rounded-2xl border border-white/[0.07] bg-[#111111] p-6 text-sm text-white/50">Loading...</div>;
	return <div className="rounded-2xl border border-white/[0.07] bg-[#111111] p-6 space-y-3"><h2 className="text-white/90 text-lg">{section === "audit" ? "Audit log" : section === "team" ? "Team members" : "Automation reliability"}</h2><pre className="max-h-[480px] overflow-auto whitespace-pre-wrap text-xs text-white/60">{JSON.stringify(data, null, 2)}</pre></div>;
}
