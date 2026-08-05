// FILE: ToolCallGroupSummaryRow.tsx
// Purpose: Collapsed summary disclosure for a settled run of tool calls
//          ("Ran 2 commands, Edited 2 files"); expands to the individual rows.
// Layer: Web chat presentation component
// Exports: ToolCallGroupSummaryRow
// Depends on: DisclosureRegion/DisclosureChevron (shared disclosure motion)

import { useEffect, useState, type ReactNode } from "react";
import { Wrench } from "lucide-react";

import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { DISCLOSURE_CLEANUP_BUFFER_MS, DISCLOSURE_TRANSITION_MS } from "~/lib/disclosureMotion";
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
  const { summary, headline, open, onToggle, fontSizePx, live = false, renderChildren } =
    props;
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

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        className="group/tool-summary inline-flex items-center gap-1.5 py-0.5 text-left text-muted-foreground/70 transition-colors duration-200 hover:text-muted-foreground/90"
        style={{ fontSize: `${fontSizePx}px` }}
        onClick={() => onToggle(!open)}
      >
        <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden>
          <Wrench className="size-[18px]" strokeWidth={2} />
        </span>
          <AnimatedTextSwap
            phrase={headline ?? summary.label}
            shimmer={live}
            rootData={{ "data-tool-summary-swap": "true" }}
          />
        <DisclosureChevron
          open={open}
          className="text-muted-foreground/55 opacity-0 transition-opacity duration-150 group-hover/tool-summary:opacity-100 group-focus-visible/tool-summary:opacity-100"
        />
      </button>
      <DisclosureRegion open={open}>
        {shouldRenderChildren ? renderChildren() : null}
      </DisclosureRegion>
    </div>
  );
}
