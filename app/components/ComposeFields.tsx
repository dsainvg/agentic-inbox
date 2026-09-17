// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license.

import { Input } from "@cloudflare/kumo";
import { useId } from "react";

type ComposeFieldsProps = {
	to: string;
	setTo: (value: string) => void;
	cc: string;
	setCc: (value: string) => void;
	bcc: string;
	setBcc: (value: string) => void;
	showCcBcc: boolean;
	setShowCcBcc: (value: boolean) => void;
	subject: string;
	setSubject: (value: string) => void;
};

/** Shared by the inline and modal composers. Labels stay above full-width
 * controls, including when the split pane is narrower than the viewport. */
export default function ComposeFields({
	to, setTo, cc, setCc, bcc, setBcc,
	showCcBcc, setShowCcBcc, subject, setSubject,
}: ComposeFieldsProps) {
	const id = useId();
	return (
		<div className="min-w-0 space-y-4">
			<div className="space-y-1.5">
				<div className="flex items-center justify-between gap-3">
					<label id={`${id}-to-label`} htmlFor={`${id}-to`} className="text-sm font-medium text-white/70">To</label>
					<button
						type="button"
						onClick={() => setShowCcBcc(!showCcBcc)}
						aria-expanded={showCcBcc}
						aria-controls={`${id}-copies`}
						className="shrink-0 rounded px-1 py-1 text-xs font-medium text-white/60 hover:text-white"
					>
						{showCcBcc ? "Hide CC / BCC" : "CC / BCC"}
					</button>
				</div>
				<Input
					id={`${id}-to`}
					aria-labelledby={`${id}-to-label`}
					type="text"
					className="w-full min-w-0"
					placeholder="recipient@example.com"
					value={to}
					onChange={(e) => setTo(e.target.value)}
					required
				/>
			</div>
			<div id={`${id}-copies`} hidden={!showCcBcc} className="space-y-4">
				<Input label="CC" type="text" className="w-full min-w-0" value={cc}
					onChange={(e) => setCc(e.target.value)} placeholder="Separate multiple addresses with commas" />
				<Input label="BCC" type="text" className="w-full min-w-0" value={bcc}
					onChange={(e) => setBcc(e.target.value)} placeholder="Separate multiple addresses with commas" />
			</div>
			<Input label="Subject" type="text" className="w-full min-w-0"
				placeholder="Email subject" value={subject}
				onChange={(e) => setSubject(e.target.value)} required />
		</div>
	);
}
