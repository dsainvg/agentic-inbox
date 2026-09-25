// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import EmailAttachmentList from "~/components/EmailAttachmentList";
import EmailIframe from "~/components/EmailIframe";
import { formatDetailDate } from "shared/dates";
import { rewriteInlineImages } from "~/lib/utils";
import type { Email } from "~/types";

interface SingleMessageViewProps {
  email: Email;
  mailboxId?: string;
  onPreviewImage?: (url: string, filename: string) => void;
}

export default function SingleMessageView({ email, mailboxId, onPreviewImage }: SingleMessageViewProps) {
  return (
    <div className="px-6 py-5 md:px-8">
      <div className="flex items-start gap-3 mb-6">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[12px] font-bold text-white/70">
          {(email.sender || "").charAt(0).toUpperCase() || "?"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[14px] font-semibold text-white/90 truncate">{email.sender}</span>
            <span className="text-[12px] text-white/30 shrink-0">{formatDetailDate(email.date)}</span>
          </div>
          <div className="text-[12px] text-white/35 mt-0.5">To: {email.recipient}</div>
        </div>
      </div>
      <EmailIframe
        body={rewriteInlineImages(email.body || "", mailboxId || "", email.id, email.attachments)}
        autoSize
      />
      <EmailAttachmentList
        mailboxId={mailboxId}
        emailId={email.id}
        attachments={email.attachments}
        onPreviewImage={onPreviewImage}
        className="mt-5"
      />
    </div>
  );
}
