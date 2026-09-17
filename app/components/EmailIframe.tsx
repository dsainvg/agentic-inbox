// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import DOMPurify from "dompurify";
import { useCallback, useEffect, useRef, useState } from "react";
import { processEmailDarkMode } from "~/lib/email-dark-mode";

interface EmailIframeProps {
	body: string;
	/** When true, iframe auto-sizes to content height instead of filling parent */
	autoSize?: boolean;
}

/**
 * Renders email HTML inside a sandboxed iframe with automatic dark mode adaptation.
 * Includes a toggle switch allowing users to switch between adapted Dark Mode and Original Light view.
 */
export default function EmailIframe({ body, autoSize }: EmailIframeProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(autoSize ? 100 : 0);
	const [forceOriginalMode, setForceOriginalMode] = useState(false);

	// Listen for height reports from the sandboxed iframe
	const handleMessage = useCallback(
		(event: MessageEvent) => {
			if (!autoSize) return;
			// Only accept messages from our own iframe
			if (event.source !== iframeRef.current?.contentWindow) return;
			if (
				event.data &&
				typeof event.data === "object" &&
				event.data.__emailIframeHeight &&
				typeof event.data.height === "number" &&
				event.data.height > 0
			) {
				setHeight(event.data.height);
			}
		},
		[autoSize],
	);

	useEffect(() => {
		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [handleMessage]);

	useEffect(() => {
		const iframe = iframeRef.current;
		if (!iframe || !body) return;

		const isHtml = /<[a-z][\s\S]*>/i.test(body);

		let cleanBody = "";
		if (!isHtml) {
			// Plain-text email: sanitize without tags and preserve newlines and whitespace
			const escaped = DOMPurify.sanitize(body, {
				ALLOWED_TAGS: [],
				ALLOWED_ATTR: [],
			});
			cleanBody = `<div class="plain-text-body">${escaped}</div>`;
		} else {
			// Apply Dark Mode Engine unless user forced original rendering
			const processedHtml = forceOriginalMode ? body : processEmailDarkMode(body);
			cleanBody = DOMPurify.sanitize(processedHtml, {
				USE_PROFILES: { html: true },
				ADD_ATTR: ["target"],
				FORCE_BODY: true,
			});
		}

		const padding = autoSize ? "0" : "24px";
		const isDark = !forceOriginalMode;

		// Height-reporting script: sends full body/content height to parent.
		// Uses ResizeObserver and image listeners for dynamic loading content.
		const heightScript = autoSize
			? `<script>
				function reportHeight() {
					var h = Math.max(
						document.body ? document.body.scrollHeight : 0,
						document.documentElement ? document.documentElement.scrollHeight : 0,
						document.body ? document.body.offsetHeight : 0,
						document.documentElement ? document.documentElement.offsetHeight : 0
					);
					if (h > 0) parent.postMessage({ __emailIframeHeight: true, height: h }, "*");
				}
				window.addEventListener('load', reportHeight);
				document.addEventListener('DOMContentLoaded', reportHeight);
				reportHeight();
				setTimeout(reportHeight, 50);
				setTimeout(reportHeight, 150);
				setTimeout(reportHeight, 400);
				setTimeout(reportHeight, 1000);
				if (window.ResizeObserver && document.body) {
					new ResizeObserver(reportHeight).observe(document.body);
				}
				document.querySelectorAll('img').forEach(function(img) {
					img.addEventListener('load', reportHeight);
					img.addEventListener('error', reportHeight);
				});
			<\/script>`
			: "";

		// Use srcdoc so the iframe is truly sandboxed (no same-origin access).
		iframe.srcdoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: cid: https: http:; script-src 'unsafe-inline';">
<style>
* { box-sizing: border-box; }
html {
	background: ${isDark ? "transparent" : "#ffffff"};
	color-scheme: ${isDark ? "dark" : "light"};
}
body {
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
	font-size: 14px;
	line-height: 1.65;
	color: ${isDark ? "rgba(255, 255, 255, 0.9)" : "#111827"};
	background: ${isDark ? "transparent" : "#ffffff"};
	padding: ${padding};
	margin: 0;
	word-wrap: break-word;
	overflow-wrap: break-word;
	${autoSize ? "overflow: hidden;" : ""}
}
.plain-text-body {
	white-space: pre-wrap;
	word-break: break-word;
	font-family: inherit;
	font-size: 14px;
	line-height: 1.65;
	color: ${isDark ? "rgba(255, 255, 255, 0.9)" : "#111827"};
}
[style*="position: fixed"], [style*="position:fixed"], [style*="position: absolute"], [style*="position:absolute"] {
	position: relative !important;
}
a { color: ${isDark ? "#e5e5e5" : "#333333"}; text-decoration: underline; text-underline-offset: 2px; }
img { max-width: 100% !important; height: auto; }
blockquote {
	border-left: 2px solid ${isDark ? "rgba(255, 255, 255, 0.2)" : "#e5e7eb"};
	padding-left: 1em;
	margin: 8px 0;
	color: ${isDark ? "rgba(255, 255, 255, 0.65)" : "#4b5563"};
}
pre {
	background: ${isDark ? "rgba(255, 255, 255, 0.05)" : "#f3f4f6"};
	padding: 12px;
	border-radius: 8px;
	overflow-x: auto;
	font-size: 13px;
	color: ${isDark ? "rgba(255, 255, 255, 0.85)" : "#1f2937"};
	border: 1px solid ${isDark ? "rgba(255, 255, 255, 0.07)" : "#e5e7eb"};
}
code {
	font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	font-size: 12px;
}
table { border-collapse: collapse; max-width: 100%; color: inherit; }
td, th { padding: 6px 10px; }
p { margin: 6px 0; }
h1, h2, h3, h4 { margin: 14px 0 6px; color: ${isDark ? "rgba(255, 255, 255, 0.95)" : "#111827"}; font-weight: 600; }
ul, ol { padding-left: 24px; margin: 6px 0; }
li { margin: 2px 0; }

/* Dark mode text readability protection for inline dark colors */
${
	isDark
		? `
[style*="color: rgb(0, 0, 0)"],
[style*="color:rgb(0,0,0)"],
[style*="color: #000"],
[style*="color:#000"],
[style*="color: black"],
[style*="color:black"],
[style*="color: #111"],
[style*="color: #222"],
[style*="color: #333"],
[style*="color: #444"],
[style*="color: #555"] {
	color: rgba(255, 255, 255, 0.9) !important;
}
`
		: ""
}
</style>
</head>
<body>${cleanBody}${heightScript}</body>
</html>`;
	}, [body, autoSize, forceOriginalMode]);

	return (
		<div className="relative group/email-iframe">
			<div className="absolute top-0 right-0 z-10 opacity-0 group-hover/email-iframe:opacity-100 focus-within:opacity-100 transition-opacity pb-2">
				<button
					type="button"
					onClick={() => setForceOriginalMode((prev) => !prev)}
					className="text-[10px] font-medium px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors border border-white/10"
					title="Toggle between adapted Dark Mode and Original layout rendering"
				>
					{forceOriginalMode ? "Show Dark Mode" : "Show Original"}
				</button>
			</div>
			<iframe
				ref={iframeRef}
				className="block w-full border-0"
				style={autoSize ? { height: `${height}px` } : { height: "100%" }}
				sandbox="allow-scripts allow-popups allow-top-navigation-by-user-activation"
				title="Email content"
			/>
		</div>
	);
}
