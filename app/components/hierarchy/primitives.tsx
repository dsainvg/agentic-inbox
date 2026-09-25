import { ApiError } from "~/services/api";
import type { AutomationAction, AutomationMatchField } from "shared/automations";

export type Group = {
	id: string;
	name: string;
	parentId: string | null;
	mailboxIds: string[];
};

export type Memory = {
	scopeType: "all" | "group" | "mailbox";
	scopeId: string;
	content: string;
	revision: number;
};

export type Rule = {
	id: string;
	name: string;
	scopeType: "all" | "group" | "mailboxes";
	scopeIds: string[];
	matchField: AutomationMatchField;
	matchValue: string;
	actions: AutomationAction[];
	enabled: boolean;
};

export type Choice = { id: string; name: string };
export const panel = "rounded-2xl border border-white/10 bg-[#111111] p-5 space-y-4";
export const input =
	"w-full rounded-lg border border-white/15 bg-[#0c0c0c] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/40 disabled:opacity-50";
export const hint = "text-xs text-white/60 leading-relaxed";
export const memoryLimit = 4000;

export function Feedback({ error, saved, pending }: { error?: Error | null; saved?: boolean; pending?: boolean }) {
	return (
		<>
			{error && (
				<p role="alert" className="text-sm border border-white/30 rounded-lg p-3">
					{error instanceof ApiError && error.status === 409 && error.body.memory
						? "Conflict: settings changed elsewhere. Your edits have been kept. Reload the latest version before saving again. "
						: ""}
					{error.message}
				</p>
			)}
			<p role="status" className={hint}>{pending ? "Saving…" : saved ? "Saved." : ""}</p>
		</>
	);
}

export function Choices({ label, options, value, onChange }: { label: string; options: Choice[]; value: string[]; onChange: (ids: string[]) => void }) {
	return (
		<fieldset className="space-y-2">
			<legend className="text-sm mb-2">{label}</legend>
			<div className="max-h-48 overflow-auto rounded-lg border border-white/10 p-3 space-y-2">
				{options.length === 0 && <p className={hint}>None available.</p>}
				{options.map((item) => (
					<label key={item.id} className="flex items-center gap-2 text-sm break-all">
						<input type="checkbox" checked={value.includes(item.id)} onChange={(event) => onChange(event.target.checked ? [...value, item.id] : value.filter((id) => id !== item.id))} />
						{item.name}
					</label>
				))}
			</div>
		</fieldset>
	);
}

export function groupPath(group: Group, groups: Group[]): string {
	const names = [group.name];
	const seen = new Set([group.id]);
	let parent = groups.find((candidate) => candidate.id === group.parentId);
	while (parent && !seen.has(parent.id)) {
		seen.add(parent.id);
		names.unshift(parent.name);
		parent = groups.find((candidate) => candidate.id === parent!.parentId);
	}
	return names.join(" / ");
}
