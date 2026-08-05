// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface Env extends Cloudflare.Env {
	DB: D1Database;
	POLICY_AUD?: string;
	TEAM_DOMAIN?: string;
	DOMAINS?: string;
	EMAIL_ADDRESSES?: string[];
}
