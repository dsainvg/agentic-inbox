// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Attachments storage disabled per D1 database specification.
export interface StoredAttachment {
	id: string;
	filename: string;
	mimetype: string;
	size: number;
}

export async function storeAttachments(): Promise<StoredAttachment[]> {
	return [];
}
