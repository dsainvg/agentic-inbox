// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

interface EmailPanelHeaderProps {
  subject: string;
  messageCount: number;
  showThreadCount: boolean;
}

export default function EmailPanelHeader({ subject, messageCount, showThreadCount }: EmailPanelHeaderProps) {
  return (
    <div className="px-6 pt-5 pb-4 md:px-8 border-b border-white/[0.05] shrink-0">
      <h2 className="text-[16px] font-semibold text-white/95 leading-snug tracking-tight">{subject || "(no subject)"}</h2>
      {showThreadCount && (
        <p className="text-[12px] text-white/35 mt-1">{messageCount} messages in thread</p>
      )}
    </div>
  );
}
