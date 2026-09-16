import type { ReactNode } from "react";
import ComposePanel from "~/components/ComposePanel";
import EmailPanel from "~/components/EmailPanel";

interface MailboxSplitViewProps {
  selectedEmailId: string | null;
  isComposing: boolean;
  children: ReactNode;
}

export default function MailboxSplitView({
  selectedEmailId,
  isComposing,
  children,
}: MailboxSplitViewProps) {
  const isPanelOpen = selectedEmailId !== null || isComposing;

  return (
    <div className="flex h-full">
      <div
        className={`flex flex-col min-w-0 shrink-0 ${
          isPanelOpen
            ? "hidden md:flex md:w-[360px] md:border-r md:border-white/[0.06]"
            : "w-full"
        }`}
      >
        {children}
      </div>
      {isPanelOpen && (
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden w-full md:w-auto">
          {isComposing && !selectedEmailId ? (
            <ComposePanel />
          ) : isComposing && selectedEmailId ? (
            <div className="flex flex-col h-full overflow-y-auto">
              <ComposePanel />
              <div className="border-t border-white/[0.06]">
                <EmailPanel emailId={selectedEmailId} />
              </div>
            </div>
          ) : selectedEmailId ? (
            <EmailPanel emailId={selectedEmailId} />
          ) : null}
        </div>
      )}
    </div>
  );
}
