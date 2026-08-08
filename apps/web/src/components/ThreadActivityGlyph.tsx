// FILE: ThreadActivityGlyph.tsx
// Purpose: Shared lifecycle glyph for Project and Supervised sidebar rows.
// Layer: Sidebar UI primitive

import { Check, CircleAlert, X } from "lucide-react";
import type { CSSProperties } from "react";

import { cn } from "~/lib/utils";

export type ThreadActivityState =
  | "idle"
  | "connecting"
  | "working"
  | "ready"
  | "available"
  | "blocked"
  | "failed";

function SyncedDotGrid({ connecting }: { connecting: boolean }) {
  const clockOffset = typeof performance === "undefined" ? 0 : -(performance.now() % 950);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "thread-activity-grid grid h-3 w-2.5 shrink-0 place-items-center grid-cols-2 grid-rows-3 gap-[2px]",
        connecting ? "text-muted-foreground/38" : "text-blue-500/85",
      )}
      style={
        {
          "--thread-activity-clock-offset": `${clockOffset}ms`,
        } as CSSProperties
      }
    >
      {Array.from({ length: 6 }, (_, index) => (
        <span key={index} className="thread-activity-grid-dot size-[3px] rounded-full bg-current" />
      ))}
    </span>
  );
}

export function ThreadActivityGlyph(props: { state: ThreadActivityState; className?: string }) {
  const { state, className } = props;
  if (state === "working" || state === "connecting") {
    return (
      <span className={cn("inline-flex size-4 items-center justify-center", className)}>
        <SyncedDotGrid connecting={state === "connecting"} />
      </span>
    );
  }
  if (state === "ready") {
    return <Check aria-hidden="true" className={cn("size-3.5 text-emerald-500", className)} />;
  }
  if (state === "blocked") {
    return <CircleAlert aria-hidden="true" className={cn("size-3.5 text-amber-500", className)} />;
  }
  if (state === "failed") {
    return <X aria-hidden="true" className={cn("size-3.5 text-red-500", className)} />;
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        state === "available" ? "bg-emerald-500/70" : "bg-muted-foreground/28",
        className,
      )}
    />
  );
}
