import { Select } from "@cloudflare/kumo";
import type { AutomationAction } from "shared/automations";
import { getFolderDisplayName } from "shared/folders";

export const matchFieldLabel = (field: string) => field.charAt(0).toUpperCase() + field.slice(1);

export function describeAction(
	action: AutomationAction,
	folderDisplayName: (id: string) => string,
): string {
	switch (action.type) {
		case "file":
			return `File into "${folderDisplayName(action.folder)}"`;
		case "mark_read":
			return "Mark as read";
		case "star":
			return "Star the email";
		case "auto_reply": {
			const parts = ["Auto-reply to the sender"];
			if (action.onSuccessFolder)
				parts.push(`on success file into "${folderDisplayName(action.onSuccessFolder)}"`);
			if (action.onFailureFolder)
				parts.push(`on failure file into "${folderDisplayName(action.onFailureFolder)}"`);
			return parts.join(", ");
		}
		case "ai_reply": {
			const parts = ["Reply with AI"];
			if (action.prompt?.trim())
				parts.push(`instruction: "${action.prompt.trim()}"`);
			if (action.onSuccessFolder)
				parts.push(`on success file into "${folderDisplayName(action.onSuccessFolder)}"`);
			if (action.onFailureFolder)
				parts.push(`on failure file into "${folderDisplayName(action.onFailureFolder)}"`);
			return parts.join(", ");
		}
		default:
			return "Action";
	}
}

interface FolderTargetSelectProps {
	value?: string;
	onChange: (folder: string | undefined) => void;
	systemFolders: string[];
	customFolders: { id: string; name: string }[];
	allowEmpty?: boolean;
	emptyLabel?: string;
	ariaLabel: string;
}

export function FolderTargetSelect({
	value,
	onChange,
	systemFolders,
	customFolders,
	allowEmpty,
	emptyLabel,
	ariaLabel,
}: FolderTargetSelectProps) {
	return (
		<Select aria-label={ariaLabel} value={value ?? ""} onValueChange={(value) => onChange(value || undefined)}>
			{allowEmpty && <Select.Option value="">{emptyLabel ?? "(don't file)"}</Select.Option>}
			{systemFolders.map((folder) => <Select.Option key={folder} value={folder}>{getFolderDisplayName(folder)}</Select.Option>)}
			{customFolders.map((folder) => <Select.Option key={folder.id} value={folder.id}>{folder.name}</Select.Option>)}
		</Select>
	);
}
