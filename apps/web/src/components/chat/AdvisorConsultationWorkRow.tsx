// FILE: AdvisorConsultationWorkRow.tsx
// Purpose: Type-3 agent auto-Advisor presentation (B1): tool-row density when
//          closed; click expands Question + live/settled advice. Actions only
//          when ready.
// Layer: Web chat presentation component
// Exports: AdvisorConsultationWorkRow

import { ThreadId } from "@synara/contracts";
import { useEffect, useState } from "react";

import {
  advisorWorkEntryStatus,
  advisorWorkEntryThreadId,
  extractAdvisorWorkEntryAdvice,
  extractAdvisorWorkEntryQuestion,
} from "~/lib/advisorWorkEntry";
import { AdvisorIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import type { WorkLogEntry } from "../../session-logic";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { DISCLOSURE_CLEANUP_BUFFER_MS, DISCLOSURE_TRANSITION_MS } from "~/lib/disclosureMotion";
import { Button } from "../ui/button";

function shortQuestionTail(question: string | null, max = 48): string | null {
  if (!question) return null;
  const compact = question.replace(/\s+/g, " ").trim();
  if (compact.length === 0) return null;
  return compact.length > max ? `${compact.slice(0, max - 1).trimEnd()}…` : compact;
}

export function AdvisorConsultationWorkRow(props: {
  workEntry: WorkLogEntry;
  fontSizePx: number;
  onOpenThread?: (threadId: ThreadId) => void;
}) {
  const { workEntry, fontSizePx, onOpenThread } = props;
  const status = advisorWorkEntryStatus(workEntry);
  const question = extractAdvisorWorkEntryQuestion(workEntry);
  const advice = extractAdvisorWorkEntryAdvice(workEntry);
  const threadIdRaw = advisorWorkEntryThreadId(workEntry);
  const threadId = threadIdRaw ? ThreadId.makeUnsafe(threadIdRaw) : null;
  const isLive = status === "running";
  const isReady = status === "complete";
  const [open, setOpen] = useState(false);
  const [keepExpandedMounted, setKeepExpandedMounted] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  useEffect(() => {
    if (open) {
      setKeepExpandedMounted(true);
      return;
    }
    if (!keepExpandedMounted) return;
    const cleanup = window.setTimeout(
      () => setKeepExpandedMounted(false),
      DISCLOSURE_TRANSITION_MS + DISCLOSURE_CLEANUP_BUFFER_MS,
    );
    return () => window.clearTimeout(cleanup);
  }, [keepExpandedMounted, open]);

  const primaryLabel =
    status === "error"
      ? "Advisor could not complete"
      : status === "stopped"
        ? "Advisor stopped"
        : isLive
          ? "Asking Advisor"
          : "Got a second opinion";

  const questionTail = shortQuestionTail(question);
  const errorDetail =
    status === "error"
      ? (workEntry.detail?.trim() || workEntry.liveActivity?.detail?.trim() || null)
      : null;
  const shouldRenderExpand = open || keepExpandedMounted;
  const showActions = isReady && (Boolean(advice) || Boolean(threadId && onOpenThread));

  return (
    <div
      data-advisor-work-row="true"
      data-advisor-work-state={status}
      className="py-0.5"
    >
      <button
        type="button"
        aria-expanded={open}
        className="group/advisor-receipt flex w-full max-w-full items-center gap-1.5 text-left text-muted-foreground/70 transition-colors duration-200 hover:text-muted-foreground/90"
        style={{ fontSize: `${fontSizePx}px` }}
        onClick={() => setOpen((current) => !current)}
      >
        <span
          className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/55 transition-colors group-hover/advisor-receipt:text-muted-foreground/80"
          aria-hidden
        >
          <AdvisorIcon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate leading-5">
          <span className="font-medium text-muted-foreground/85">{primaryLabel}</span>
          {isLive ? (
            <>
              <span className="text-muted-foreground/55">
                {" "}
                · <span className="shimmer motion-reduce:animate-none">consulting…</span>
              </span>
              {questionTail ? (
                <span className="text-muted-foreground/50"> · {questionTail}</span>
              ) : null}
            </>
          ) : null}
        </span>
        <DisclosureChevron
          open={open}
          className={cn(
            "shrink-0 text-muted-foreground/55 transition-opacity duration-150",
            open
              ? "opacity-100"
              : "opacity-0 group-hover/advisor-receipt:opacity-100 group-focus-visible/advisor-receipt:opacity-100",
          )}
        />
      </button>

      <DisclosureRegion open={open}>
        {shouldRenderExpand ? (
          <div className="mt-1 ml-5 space-y-2 rounded-lg border border-border/60 bg-background/80 px-2.5 py-2">
            {question ? (
              <div className="space-y-0.5">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
                  Question
                </div>
                <p className="text-xs leading-relaxed text-foreground/80">{question}</p>
              </div>
            ) : null}

            <div
              className={cn(
                "space-y-0.5",
                question ? "border-t border-border/50 pt-2" : null,
              )}
            >
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
                Advice
              </div>
              {advice ? (
                <p
                  className={cn(
                    "text-xs leading-relaxed whitespace-pre-wrap text-foreground/90",
                    isLive &&
                      "after:ml-0.5 after:inline-block after:animate-pulse after:text-[var(--color-text-accent)] after:content-['▍']",
                  )}
                >
                  {advice}
                </p>
              ) : errorDetail ? (
                <p className="text-xs text-destructive">{errorDetail}</p>
              ) : status === "error" ? (
                <p className="text-xs text-destructive">Advisor ended without a response.</p>
              ) : isLive ? (
                <p className="text-xs text-muted-foreground">Waiting for Advisor…</p>
              ) : status === "stopped" ? (
                <p className="text-xs text-muted-foreground">Advisor stopped before answering.</p>
              ) : (
                <p className="text-xs text-muted-foreground">No advice returned.</p>
              )}
            </div>

            {showActions ? (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {threadId && onOpenThread ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 px-2.5 text-[11px]"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenThread(threadId);
                    }}
                  >
                    Open consultation
                  </Button>
                ) : null}
                {advice ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2.5 text-[11px] text-muted-foreground"
                    onClick={(event) => {
                      event.stopPropagation();
                      void navigator.clipboard.writeText(advice).then(() => {
                        setCopyState("copied");
                        window.setTimeout(() => setCopyState("idle"), 1200);
                      });
                    }}
                  >
                    {copyState === "copied" ? "Copied" : "Copy advice"}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </DisclosureRegion>
    </div>
  );
}
