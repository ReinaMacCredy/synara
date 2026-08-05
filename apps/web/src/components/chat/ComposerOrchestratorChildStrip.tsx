// FILE: ComposerOrchestratorChildStrip.tsx
// Purpose: Collapsible child-thread list stacked above the composer on an
// Orchestrator Root (Cursor-style "N subagents" placement, but rows are threads).
// Layer: Chat composer UI
// Exports: ComposerOrchestratorChildStrip

import type { ThreadId } from "@synara/contracts";
import { pluralize } from "@synara/shared/text";

import {
  ChatBubbleIcon,
  LoaderIcon,
  PanelCollapseIcon,
  PanelExpandIcon,
} from "~/lib/icons";
import { CentralIcon } from "~/lib/central-icons";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import {
  orchestratorChildStatusTextToneClassName,
  type ComposerOrchestratorChildStripCounts,
  type ComposerOrchestratorChildStripItem,
} from "./ComposerOrchestratorChildStrip.logic";
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

interface ComposerOrchestratorChildStripProps {
  items: ReadonlyArray<ComposerOrchestratorChildStripItem>;
  counts: ComposerOrchestratorChildStripCounts;
  compact: boolean;
  onCompactChange: (compact: boolean) => void;
  onOpenThread: (threadId: ThreadId) => void;
  attachedToPrevious?: boolean;
}

export function ComposerOrchestratorChildStrip({
  items,
  counts,
  compact,
  onCompactChange,
  onOpenThread,
  attachedToPrevious: attachedToPreviousProp,
}: ComposerOrchestratorChildStripProps) {
  const attachedToPrevious = attachedToPreviousProp ?? false;
  const activeCount = items.filter((item) => item.isActive).length;
  const headerLabel =
    activeCount > 0
      ? `${activeCount} of ${items.length} ${pluralize(items.length, "child thread")} active`
      : `${items.length} ${pluralize(items.length, "child thread")}`;

  return (
    <ComposerStackedPanel
      passthroughSideMargins
      attachedToPrevious={attachedToPrevious}
      data-testid="composer-orchestrator-child-strip"
    >
      <ComposerStackedPanelHeaderRow>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => onCompactChange(!compact)}
          aria-expanded={!compact}
          aria-label={compact ? "Expand child threads" : "Collapse child threads"}
        >
          <ComposerStackedPanelRowMain>
            {compact && activeCount > 0 ? (
              <LoaderIcon className={cn(COMPOSER_STACKED_PANEL_ICON_CLASS_NAME, "animate-spin")} />
            ) : (
              <ChatBubbleIcon className={COMPOSER_STACKED_PANEL_ICON_CLASS_NAME} />
            )}
            <ComposerStackedPanelRowLabel tone="meta">{headerLabel}</ComposerStackedPanelRowLabel>
          </ComposerStackedPanelRowMain>
          {counts.ready > 0 || counts.working > 0 || counts.blocked > 0 ? (
            <span className="ml-auto flex shrink-0 items-center gap-1 pr-1">
              {counts.ready > 0 ? (
                <span className="rounded-full bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-orange-600/90 dark:text-orange-400/90">
                  {counts.ready}
                </span>
              ) : null}
              {counts.working > 0 ? (
                <span className="rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-violet-600/90 dark:text-violet-400/90">
                  {counts.working}
                </span>
              ) : null}
              {counts.blocked > 0 ? (
                <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-destructive/90">
                  {counts.blocked}
                </span>
              ) : null}
            </span>
          ) : null}
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn("shrink-0", COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME)}
          onClick={() => onCompactChange(!compact)}
          aria-label={compact ? "Expand child threads" : "Collapse child threads"}
          title={compact ? "Expand child threads" : "Collapse child threads"}
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
            "space-y-0",
            COMPOSER_STACKED_PANEL_BODY_PADDING_CLASS_NAME,
            COMPOSER_STACKED_PANEL_SCROLL_REGION_CLASS_NAME,
          )}
        >
          {items.map((item) => (
            <div
              key={item.key}
              data-testid="composer-orchestrator-child-row"
              data-viewed={item.isViewed || undefined}
              data-status={item.statusKind}
              className={cn(
                "group -mx-1 flex w-[calc(100%+0.5rem)] min-w-0 items-center gap-1 rounded-md px-1 py-1 transition-colors hover:bg-[var(--color-background-button-secondary-hover)]",
                item.isViewed && "bg-[var(--color-background-button-secondary)]",
              )}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                title={item.title}
                onClick={() => onOpenThread(item.threadId)}
              >
                {/* Solid Central "robot" fill — matches the filled bot face, not the outline BotIcon. */}
                <CentralIcon
                  name="robot"
                  variant="fill"
                  className={cn(COMPOSER_STACKED_PANEL_ICON_CLASS_NAME, "size-3.5")}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/85">
                  {item.title}
                </span>
                {item.additions != null && item.deletions != null ? (
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/55">
                    <span className="text-emerald-600/75 dark:text-emerald-400/75">
                      +{item.additions}
                    </span>{" "}
                    <span className="text-red-600/70 dark:text-red-400/70">
                      -{item.deletions}
                    </span>
                  </span>
                ) : null}
                <span
                  className={cn(
                    "shrink-0 text-[11px]",
                    orchestratorChildStatusTextToneClassName(item.statusKind),
                  )}
                >
                  {item.statusLabel}
                </span>
              </button>
            </div>
          ))}
        </div>
      </DisclosureRegion>
    </ComposerStackedPanel>
  );
}
