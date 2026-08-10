// FILE: ForkContinuationDivider.tsx
// Purpose: "Continued from chat" link on forked threads — jump back to the source.
// Layer: Chat transcript UI
// Exports: ForkContinuationDivider

import { type ThreadId } from "@veylen/contracts";
import { memo } from "react";

// Same Central `branch` glyph used for git/branch chrome across Veylen
// (ThreadHoverCard, GitActions, PR summary, command menu) — not a one-off asset.
import { GitBranchIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

export const ForkContinuationDivider = memo(function ForkContinuationDivider({
  sourceThreadId,
  onOpenSourceThread,
  className,
}: {
  readonly sourceThreadId: ThreadId;
  readonly onOpenSourceThread?: (threadId: ThreadId) => void;
  readonly className?: string;
}) {
  const label = "Continued from chat";
  const content = (
    <>
      <GitBranchIcon className="size-3.5 shrink-0" aria-hidden />
      <span>{label}</span>
    </>
  );

  const sharedClassName = cn(
    "inline-flex items-center gap-1.5 px-2 font-system-ui text-[length:var(--app-font-size-ui,12px)] font-normal",
    // Theme accent (same token as chat accent links / highlights).
    "text-[var(--color-text-accent)]",
    onOpenSourceThread &&
      "cursor-pointer transition-opacity duration-150 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm",
  );

  return (
    <div
      className={cn("flex w-full items-center gap-3 py-3", className)}
      data-fork-continuation="true"
    >
      <div className="h-px min-w-0 flex-1 bg-border/70" aria-hidden />
      {onOpenSourceThread ? (
        <button
          type="button"
          className={sharedClassName}
          aria-label="Open the chat this was forked from"
          onClick={() => onOpenSourceThread(sourceThreadId)}
        >
          {content}
        </button>
      ) : (
        <span className={sharedClassName}>{content}</span>
      )}
      <div className="h-px min-w-0 flex-1 bg-border/70" aria-hidden />
    </div>
  );
});
