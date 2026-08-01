import type { OrchestratorMessageEnvelope, ThreadId } from "@synara/contracts";
import { orchestratorChildAlias } from "@synara/shared/orchestratorThreadAlias";
import { createContext, useContext, type ReactNode } from "react";

import { MessageCircleIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

interface OrchestratorTranscriptContextValue {
  readonly exchangesByMessageId: ReadonlyMap<string, OrchestratorMessageEnvelope>;
  readonly threadLabels: ReadonlyMap<ThreadId, string>;
  readonly onOpenThread: (threadId: ThreadId) => void;
}

const OrchestratorTranscriptContext = createContext<OrchestratorTranscriptContextValue | null>(
  null,
);

export function OrchestratorTranscriptProvider(props: {
  readonly value: OrchestratorTranscriptContextValue;
  readonly children: ReactNode;
}) {
  return (
    <OrchestratorTranscriptContext.Provider value={props.value}>
      {props.children}
    </OrchestratorTranscriptContext.Provider>
  );
}

function threadLabel(context: OrchestratorTranscriptContextValue, threadId: ThreadId): string {
  return context.threadLabels.get(threadId) ?? orchestratorChildAlias(threadId);
}

export function OrchestratorThreadMessageRow(props: {
  readonly messageId: string;
  readonly text: string;
}) {
  const context = useContext(OrchestratorTranscriptContext);
  const exchange = context?.exchangesByMessageId.get(props.messageId) ?? null;
  const sender = exchange && context ? threadLabel(context, exchange.senderThreadId) : "Thread";
  const target = exchange && context ? threadLabel(context, exchange.targetThreadId) : null;

  return (
    <div
      role="note"
      data-orchestrator-exchange-row="true"
      data-live-output="false"
      className="rounded-xl border border-border/70 bg-muted/35 px-3 py-2.5 text-sm"
    >
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <MessageCircleIcon className="size-3.5 shrink-0" />
        {exchange && context ? (
          <>
            <button
              type="button"
              className="truncate font-medium text-foreground hover:underline"
              onClick={() => context.onOpenThread(exchange.senderThreadId)}
            >
              {sender}
            </button>
            <span aria-hidden="true">→</span>
            <button
              type="button"
              className="truncate font-medium text-foreground hover:underline"
              onClick={() => context.onOpenThread(exchange.targetThreadId)}
            >
              {target}
            </button>
            <span
              className={cn(
                "ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                exchange.deliveryState === "failed" || exchange.deliveryState === "expired"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-background/70",
              )}
            >
              {exchange.deliveryState}
            </span>
          </>
        ) : (
          <span className="font-medium text-foreground">{sender} message</span>
        )}
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-foreground/90">{props.text}</p>
      {exchange ? (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
          {exchange.assignmentId ? <span>Assignment {exchange.assignmentId}</span> : null}
          {exchange.runId ? <span>Run {exchange.runId}</span> : null}
          {exchange.correlationId ? <span>Correlation {exchange.correlationId}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
