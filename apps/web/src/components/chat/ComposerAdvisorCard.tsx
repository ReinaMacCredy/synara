import type { ThreadId } from "@synara/contracts";
import { useState } from "react";

import type { AdvisorConsultation } from "~/lib/advisorConsultation";
import { AdvisorIcon, LoaderIcon, PanelCollapseIcon, PanelExpandIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import {
  ComposerStackedPanelHeaderRow,
  ComposerStackedPanelRowLabel,
  ComposerStackedPanelRowMain,
} from "./ComposerStackedPanelContent";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  COMPOSER_STACKED_PANEL_BODY_PADDING_CLASS_NAME,
  COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME,
  COMPOSER_STACKED_PANEL_ICON_CLASS_NAME,
  COMPOSER_STACKED_PANEL_SCROLL_REGION_CLASS_NAME,
} from "./composerStackedPanelStyles";

function statusLabel(consultation: AdvisorConsultation): string {
  switch (consultation.status) {
    case "complete":
      return "Advice ready";
    case "stopped":
      return "Stopped";
    case "error":
      return "Could not complete";
    case "running":
    default:
      return "Consulting";
  }
}
interface ComposerAdvisorCardProps {
  consultation: AdvisorConsultation;
  attachedToPrevious?: boolean;
  onOpenThread: (threadId: ThreadId) => void;
  onUseInTask: (answer: string) => void;
}

export function ComposerAdvisorCard({
  consultation,
  attachedToPrevious: attachedToPreviousProp,
  onOpenThread,
  onUseInTask,
}: ComposerAdvisorCardProps) {
  const [compact, setCompact] = useState(false);
  const attachedToPrevious = attachedToPreviousProp ?? false;
  return (
    <ComposerStackedPanel
      attachedToPrevious={attachedToPrevious}
      passthroughSideMargins
      data-testid="composer-advisor-card"
    >
      <ComposerStackedPanelHeaderRow>
        <ComposerStackedPanelRowMain>
          {consultation.status === "running" ? (
            <LoaderIcon className={cn(COMPOSER_STACKED_PANEL_ICON_CLASS_NAME, "animate-spin")} />
          ) : (
            <AdvisorIcon className={COMPOSER_STACKED_PANEL_ICON_CLASS_NAME} />
          )}
          <ComposerStackedPanelRowLabel>Advisor</ComposerStackedPanelRowLabel>
          <span className="truncate text-[11px] text-muted-foreground/70">
            {statusLabel(consultation)}
          </span>
        </ComposerStackedPanelRowMain>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px] text-muted-foreground"
          onClick={() => onOpenThread(consultation.threadId)}
        >
          Open
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn("shrink-0", COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME)}
          onClick={() => setCompact(!compact)}
          aria-label={compact ? "Expand Advisor result" : "Collapse Advisor result"}
          title={compact ? "Expand Advisor result" : "Collapse Advisor result"}
        >
          {compact ? (
            <PanelExpandIcon className="size-3" />
          ) : (
            <PanelCollapseIcon className="size-3" />
          )}
        </Button>
      </ComposerStackedPanelHeaderRow>
      <DisclosureRegion open={!compact}>
        <div
          className={cn(
            "space-y-2 pt-0.5",
            COMPOSER_STACKED_PANEL_BODY_PADDING_CLASS_NAME,
            COMPOSER_STACKED_PANEL_SCROLL_REGION_CLASS_NAME,
          )}
        >
          <div className="space-y-0.5">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
              Question
            </div>
            <p className="text-xs leading-relaxed text-foreground/80">{consultation.question}</p>
          </div>
          {consultation.answer ? (
            <div className="space-y-1.5 border-t border-border/50 pt-2">
              <ChatMarkdown
                text={consultation.answer}
                isStreaming={consultation.answerStreaming}
                className="text-xs leading-relaxed text-foreground/90"
              />
              {consultation.status === "complete" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 px-2.5 text-[11px]"
                  onClick={() => onUseInTask(consultation.answer ?? "")}
                >
                  Use in task
                </Button>
              ) : null}
            </div>
          ) : consultation.status === "running" ? (
            <p className="text-xs text-muted-foreground">Reviewing the task context…</p>
          ) : (
            <p className="text-xs text-destructive">
              {consultation.error ?? "Advisor ended without a response."}
            </p>
          )}
        </div>
      </DisclosureRegion>
    </ComposerStackedPanel>
  );
}
