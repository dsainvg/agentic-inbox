// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { connect } from "cloudflare:sockets";

export interface SendSmtpOptions {
	host?: string;
	port?: number | string;
	user?: string;
	pass?: string;
	from: string;
	to: string | string[];
	cc?: string | string[];
	bcc?: string | string[];
	replyTo?: string;
	subject: string;
	html?: string;
	text?: string;
	headers?: Record<string, string>;
}

/**
 * Sends an email using Cloudflare Workers TCP sockets over SMTP (e.g., Gmail SMTP).
 */
export async function sendSmtpEmail(options: SendSmtpOptions): Promise<{ messageId: string }> {
	const host = (options.host || "smtp.gmail.com").trim();
	const port = Number(options.port || 465);
	const user = (options.user || "").trim();
	const pass = (options.pass || "").trim();

	if (!user || !pass) {
		throw new Error("SMTP_USER and SMTP_PASS environment variables are required for SMTP sending.");
	}

	const isTls = port === 465;
	const socket = connect(
		{ hostname: host, port },
		isTls ? { secureTransport: "on" } : { secureTransport: "starttls" },
	);

	const writer = socket.writable.getWriter();
	const reader = socket.readable.getReader();
	const decoder = new TextDecoder();

	let readBuffer = "";

	async function readResponse(): Promise<{ code: number; text: string }> {
		while (true) {
			const { value, done } = await reader.read();
			if (done) throw new Error("SMTP server closed connection unexpectedly");
			readBuffer += decoder.decode(value, { stream: true });

			const lines = readBuffer.split("\r\n");
			for (let i = 0; i < lines.length - 1; i++) {
				const line = lines[i];
				if (/^\d{3} /.test(line)) {
					const code = Number(line.substring(0, 3));
					const text = readBuffer;
					readBuffer = lines.slice(i + 1).join("\r\n");
					return { code, text };
				}
			}
		}
	}

	async function sendCommand(cmd: string, expectedCode = 250): Promise<{ code: number; text: string }> {
		const encoder = new TextEncoder();
		await writer.write(encoder.encode(cmd + "\r\n"));
		const res = await readResponse();
		if (res.code !== expectedCode && Math.floor(res.code / 100) !== Math.floor(expectedCode / 100)) {
			throw new Error(`SMTP Error [cmd: ${cmd.split(" ")[0]}]: ${res.text.trim()}`);
		}
		return res;
	}

	try {
		const banner = await readResponse();
		if (banner.code !== 220) throw new Error(`SMTP Banner Error: ${banner.text}`);

		await sendCommand("EHLO agentic-inbox", 250);

		// AUTH LOGIN
		await sendCommand("AUTH LOGIN", 334);
		await sendCommand(btoa(user), 334);
		await sendCommand(btoa(pass), 235);

		// MAIL FROM
		await sendCommand(`MAIL FROM:<${user}>`, 250);

		// RCPT TO
		const recipients = [
			...(Array.isArray(options.to) ? options.to : [options.to]),
			...(options.cc ? (Array.isArray(options.cc) ? options.cc : [options.cc]) : []),
			...(options.bcc ? (Array.isArray(options.bcc) ? options.bcc : [options.bcc]) : []),
		].filter(Boolean);

		for (const rcpt of recipients) {
			const emailMatch = rcpt.match(/<([^>]+)>/) || [null, rcpt.trim()];
			const cleanRcpt = emailMatch[1] || rcpt.trim();
			await sendCommand(`RCPT TO:<${cleanRcpt}>`, 250);
		}

		// DATA
		await sendCommand("DATA", 354);

		const boundary = "=====" + crypto.randomUUID() + "=====";
		const messageId = `<${crypto.randomUUID()}@${host}>`;

		const headers: string[] = [
			`From: ${options.from.includes("<") ? options.from : `<${options.from}>`}`,
			`To: ${Array.isArray(options.to) ? options.to.join(", ") : options.to}`,
			`Subject: ${options.subject}`,
			`Message-ID: ${messageId}`,
			`Date: ${new Date().toUTCString()}`,
			`MIME-Version: 1.0`,
		];

		if (options.cc) {
			headers.push(`Cc: ${Array.isArray(options.cc) ? options.cc.join(", ") : options.cc}`);
		}
		if (options.replyTo) {
			headers.push(`Reply-To: ${options.replyTo}`);
		}
		if (options.headers) {
			for (const [k, v] of Object.entries(options.headers)) {
				headers.push(`${k}: ${v}`);
			}
		}

		let mimeBody = "";
		if (options.html && options.text) {
			headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
			mimeBody =
				`--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${options.text}\r\n` +
				`--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${options.html}\r\n` +
				`--${boundary}--`;
		} else if (options.html) {
			headers.push(`Content-Type: text/html; charset=utf-8`);
			mimeBody = options.html;
		} else {
			headers.push(`Content-Type: text/plain; charset=utf-8`);
			mimeBody = options.text || "";
		}

		const stuffedBody = mimeBody.replace(/\r\n\./g, "\r\n..");
		const fullData = headers.join("\r\n") + "\r\n\r\n" + stuffedBody + "\r\n.\r\n";

		const encoder = new TextEncoder();
		await writer.write(encoder.encode(fullData));
		const dataRes = await readResponse();
		if (dataRes.code !== 250) {
			throw new Error(`SMTP DATA Error: ${dataRes.text}`);
		}

		await sendCommand("QUIT", 221).catch(() => {});
		return { messageId };
	} finally {
		try {
			writer.releaseLock();
			reader.releaseLock();
			socket.close();
		} catch {}
	}
}
