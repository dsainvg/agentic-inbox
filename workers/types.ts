// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface Env extends Omit<Cloudflare.Env, "SMTP_HOST" | "SMTP_PORT" | "SMTP_USER" | "SMTP_PASS" | "EmailAgent"> {
	DB: D1Database;
	AI: Ai;
	EmailAgent: DurableObjectNamespace;
	POLICY_AUD?: string;
	TEAM_DOMAIN?: string;
	DOMAINS: string;
	EMAIL_ADDRESSES?: string[];
	EMAIL?: SendEmail;
	SMTP_HOST?: string;
	SMTP_PORT?: string;
	SMTP_USER?: string;
	SMTP_PASS?: string;
	OPENROUTER_API_KEY?: string;
	OPENROUTER_MODEL?: string;
	OPENROUTER_BASE_URL?: string;
	EXTERNAL_INTAKE_TOKEN?: string;
	ATTACHMENTS: R2Bucket;
	ATTACHMENT_SCAN_ENDPOINT?: string;
	ATTACHMENT_SCAN_TOKEN?: string;
}
