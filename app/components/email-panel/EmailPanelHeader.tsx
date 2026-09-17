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
    <div className="px-6 py-5 md:px-8 border-b border-white/[0.06] shrink-0">
      <h2 className="text-base font-medium text-white/90 leading-relaxed tracking-tight break-words">{subject || "(no subject)"}</h2>
      {showThreadCount && (
        <p className="text-xs text-white/50 mt-1.5">{messageCount} {messageCount === 1 ? "message" : "messages"} in thread</p>
      )}
    </div>
  );
}
