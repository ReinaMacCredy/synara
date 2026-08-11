// FILE: ToolCallGroupSummaryRow.tsx
// Purpose: One-line tool summary disclosure
//          ("Loaded a tool, edited files, read files, ran commands").
//          Default collapsed; hover shows chevron only; click expands rows.
// Layer: Web chat presentation component
// Exports: ToolCallGroupSummaryRow
// Depends on: DisclosureRegion/DisclosureChevron (shared disclosure motion)

import { useEffect, useState, type ReactNode } from "react";
import { Wrench } from "lucide-react";

import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { DISCLOSURE_CLEANUP_BUFFER_MS, DISCLOSURE_TRANSITION_MS } from "~/lib/disclosureMotion";
import { cn } from "~/lib/utils";
import type { ToolCallGroupSummary } from "./toolCallGroup.logic";
import { AnimatedTextSwap } from "./AnimatedTextSwap";

export function ToolCallGroupSummaryRow(props: {
  summary: ToolCallGroupSummary;
  headline?: string | null;
  open: boolean;
  onToggle: (open: boolean) => void;
  fontSizePx: number;
  live?: boolean;
  renderChildren: () => ReactNode;
}) {
  const { summary, headline, open, onToggle, fontSizePx, live = false, renderChildren } = props;
  const [keepChildrenMounted, setKeepChildrenMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setKeepChildrenMounted(true);
      return;
    }
    if (!keepChildrenMounted) return;
    const cleanup = window.setTimeout(
      () => setKeepChildrenMounted(false),
      DISCLOSURE_TRANSITION_MS + DISCLOSURE_CLEANUP_BUFFER_MS,
    );
    return () => window.clearTimeout(cleanup);
  }, [keepChildrenMounted, open]);

  const shouldRenderChildren = open || keepChildrenMounted;
  const phrase = headline ?? summary.label;

  return (
    <div data-tool-activity-disclosure="true" data-expanded={open ? "true" : "false"}>
      {/* Chevron: opacity-0 until hover/focus; always visible when expanded. */}
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? "Collapse tool activity" : "Expand tool activity"}
        className={cn(
          "group/activity-header group/tool-summary relative inline-flex max-w-full min-w-0 items-center gap-1.5 self-start py-0.5 text-left",
          "text-muted-foreground/70 transition-colors duration-150",
          "hover:text-muted-foreground/90 focus-visible:text-muted-foreground/90",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border/60",
        )}
        style={{ fontSize: `${fontSizePx}px` }}
        onClick={() => onToggle(!open)}
      >
        <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
          <Wrench className="size-4" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1 truncate">
          <AnimatedTextSwap
            phrase={phrase}
            shimmer={live}
            rootData={{ "data-tool-summary-swap": "true" }}
          />
        </span>
        <DisclosureChevron
          open={open}
          className={cn(
            "text-muted-foreground/55 transition-opacity duration-150",
            // Expanded: always visible. Collapsed: only hover/focus (ChatGPT C).
            open
              ? "opacity-100"
              : "opacity-0 group-hover/activity-header:opacity-100 group-focus-visible/activity-header:opacity-100",
          )}
        />
      </button>
      <DisclosureRegion open={open}>
        {shouldRenderChildren ? (
          <div className="ps-5" data-tool-activity-body="true">
            {renderChildren()}
          </div>
        ) : null}
      </DisclosureRegion>
    </div>
  );
}
