import type { HandoffDraftV1 } from "@synara/contracts";
import { useEffect, useState } from "react";

import { CheckIcon, EllipsisIcon, Trash2 } from "../../lib/icons";
import { Button } from "../ui/button";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  ComposerStackedPanelHeaderRow,
  ComposerStackedPanelRowMain,
} from "./ComposerStackedPanelContent";
import { HandoffContextDialog } from "./HandoffContextDialog";

function formatHandoffElapsed(startedAt: string, now = Date.now()): string {
  const startedAtMs = Date.parse(startedAt);
  const elapsedSeconds = Number.isFinite(startedAtMs)
    ? Math.max(0, Math.floor((now - startedAtMs) / 1_000))
    : 0;
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`;
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function useHandoffElapsed(startedAt: string, active: boolean): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [active, startedAt]);

  return formatHandoffElapsed(startedAt, now);
}

export function ComposerHandoffPacketRail(props: {
  readonly handoff: HandoffDraftV1;
  readonly attachedToPrevious: boolean;
  readonly onDetach: () => void;
  readonly onUseSourceLinkOnly: () => void;
  readonly onRetry: () => Promise<void>;
}) {
  const [contextOpen, setContextOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const isPreparing = props.handoff.preparationState === "preparing";
  const elapsed = useHandoffElapsed(props.handoff.stagedAt, isPreparing);
  const stateLabel =
    props.handoff.preparationState === "ready"
      ? "Ready"
      : props.handoff.sourceLinkOnly
        ? "Source link only"
        : props.handoff.preparationState === "failed"
          ? "Needs attention"
          : "Preparing";

  return (
      <ComposerStackedPanel
        attachedToPrevious={props.attachedToPrevious}
        className={isPreparing ? "handoff-magic-border" : undefined}
        data-testid="handoff-packet-rail"
      >
      <ComposerStackedPanelHeaderRow className="gap-2 sm:gap-3">
        <button
          type="button"
          className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setContextOpen(true)}
        >
          <ComposerStackedPanelRowMain>
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium">
                {isPreparing ? "Preparing handoff" : "Handoff packet"}
              </span>
              {!isPreparing && props.handoff.preparationState !== "ready" ? (
                <span className="shrink-0 text-xs text-muted-foreground">{stateLabel}</span>
              ) : null}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {props.handoff.sourceTitle} · {props.handoff.preparationPhase}
            </p>
          </ComposerStackedPanelRowMain>
        </button>
        {isPreparing ? (
          <span
            className="shrink-0 tabular-nums text-sm font-medium text-muted-foreground"
            aria-label={`Handoff preparation active for ${elapsed}`}
          >
            {elapsed}
          </span>
        ) : props.handoff.preparationState === "ready" ? (
          <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-foreground/80">
            <CheckIcon className="size-4" aria-hidden="true" />
            Completed
          </span>
        ) : null}
        {(["failed", "interrupted", "cancelled"] as const).includes(
          props.handoff.preparationState as "failed" | "interrupted" | "cancelled",
        ) && !props.handoff.sourceLinkOnly ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setActionError(null);
              void props
                .onRetry()
                .catch((error: unknown) => {
                  setActionError(error instanceof Error ? error.message : String(error));
                })
                .finally(() => setBusy(false));
            }}
          >
            Retry
          </Button>
        ) : null}
        {props.handoff.preparationState !== "ready" && !props.handoff.sourceLinkOnly ? (
          <Button type="button" size="sm" variant="ghost" onClick={props.onUseSourceLinkOnly}>
            Use source link only
          </Button>
        ) : null}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
          aria-label="Detach handoff packet"
          onClick={props.onDetach}
        >
          <Trash2 className="size-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
          aria-label="Inspect handoff packet"
          onClick={() => setContextOpen(true)}
        >
          <EllipsisIcon className="size-4" />
        </Button>
      </ComposerStackedPanelHeaderRow>
      <HandoffContextDialog
        open={contextOpen}
        onOpenChange={setContextOpen}
        handoff={props.handoff}
      />
      {actionError ? <p className="px-3 pb-2 text-xs text-destructive">{actionError}</p> : null}
    </ComposerStackedPanel>
  );
}
