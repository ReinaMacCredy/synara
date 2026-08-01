import type {
  OrchestratorCommunicationLink,
  OrchestratorMessageEnvelope,
  ThreadId,
} from "@synara/contracts";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { MessageCircleIcon } from "~/lib/icons";
import { formatRelativeTime } from "~/lib/relativeTime";
import { cn } from "~/lib/utils";

import {
  groupOrchestratorExchanges,
  threadLabel,
  type ExchangeGroup,
} from "./orchestratorViewModel";

function matchingLink(
  exchange: OrchestratorMessageEnvelope,
  links: readonly OrchestratorCommunicationLink[],
): OrchestratorCommunicationLink | null {
  return (
    links.find(
      (link) =>
        ((link.sourceThreadId === exchange.senderThreadId &&
          link.targetThreadId === exchange.targetThreadId) ||
          (link.direction === "bidirectional" &&
            link.sourceThreadId === exchange.targetThreadId &&
            link.targetThreadId === exchange.senderThreadId)) &&
        (link.taskId === null || exchange.assignmentId !== null) &&
        (link.runId === null || link.runId === exchange.runId),
    ) ?? null
  );
}

function ExchangeRow(props: {
  readonly exchange: OrchestratorMessageEnvelope;
  readonly links: readonly OrchestratorCommunicationLink[];
  readonly threadLabels: ReadonlyMap<ThreadId, string>;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const link = matchingLink(props.exchange, props.links);
  const failure =
    props.exchange.deliveryState === "failed" || props.exchange.deliveryState === "expired";
  return (
    <article className="rounded-lg border border-border/70 bg-background/55 p-2.5">
      <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
        <Button
          variant="link"
          size="xs"
          className="h-auto min-w-0 px-0 py-0"
          onClick={() => props.onOpenThread(props.exchange.senderThreadId)}
        >
          <span className="truncate">
            {threadLabel(props.threadLabels, props.exchange.senderThreadId)}
          </span>
        </Button>
        <span className="text-muted-foreground">→</span>
        <Button
          variant="link"
          size="xs"
          className="h-auto min-w-0 px-0 py-0"
          onClick={() => props.onOpenThread(props.exchange.targetThreadId)}
        >
          <span className="truncate">
            {threadLabel(props.threadLabels, props.exchange.targetThreadId)}
          </span>
        </Button>
        <span
          className={cn(
            "ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-medium",
            failure ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
          )}
        >
          {props.exchange.deliveryState}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed">
        {props.exchange.body}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
        <span>{formatRelativeTime(props.exchange.updatedAt)}</span>
        <span>hop {props.exchange.hopCount}</span>
        {link ? (
          <span>
            link {link.state} ·{" "}
            {link.taskId ? `task ${link.taskId}` : link.runId ? `run ${link.runId}` : "ownership"}
          </span>
        ) : (
          <span className="text-warning">link unavailable in snapshot</span>
        )}
        {props.exchange.replyToMessageId ? (
          <span>reply to {props.exchange.replyToMessageId}</span>
        ) : null}
      </div>
      {props.exchange.artifactRefs.length > 0 ? (
        <p className="mt-1 text-[10px] text-muted-foreground">
          Artifacts {props.exchange.artifactRefs.join(", ")}
        </p>
      ) : null}
    </article>
  );
}

function ExchangeGroupView(props: {
  readonly group: ExchangeGroup;
  readonly links: readonly OrchestratorCommunicationLink[];
  readonly threadLabels: ReadonlyMap<ThreadId, string>;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(props.defaultOpen);
  const states = [...new Set(props.group.items.map((item) => item.deliveryState))];
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-border/70">
        <CollapsibleTrigger className="flex w-full min-w-0 items-center gap-2 px-2.5 py-2 text-left hover:bg-muted/40">
          <DisclosureChevron open={open} />
          <MessageCircleIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-medium">{props.group.label}</span>
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
            {props.group.items.length} · {states.join(", ")}
          </span>
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="grid gap-2 border-t border-border/70 p-2">
            {props.group.items.map((exchange) => (
              <ExchangeRow
                key={exchange.messageId}
                exchange={exchange}
                links={props.links}
                threadLabels={props.threadLabels}
                onOpenThread={props.onOpenThread}
              />
            ))}
          </div>
        </CollapsiblePanel>
      </div>
    </Collapsible>
  );
}

export function ExchangesPanel(props: {
  readonly exchanges: readonly OrchestratorMessageEnvelope[];
  readonly links: readonly OrchestratorCommunicationLink[];
  readonly threadLabels: ReadonlyMap<ThreadId, string>;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly loading: boolean;
  readonly error: string | null;
}) {
  const groups = groupOrchestratorExchanges(props.exchanges);
  return (
    <div className="flex h-full min-h-0 flex-col" data-orchestrator-panel="exchanges">
      <div className="border-b border-border/70 px-3 py-2">
        <p className="text-xs font-medium">Thread exchanges</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          Grouped by assignment, run, or correlation. Delivery state is durable.
        </p>
      </div>
      <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto p-2">
        {props.loading ? (
          <p className="p-2 text-xs text-muted-foreground">Loading exchanges…</p>
        ) : null}
        {props.error ? (
          <p role="alert" className="p-2 text-xs text-destructive">
            {props.error}
          </p>
        ) : null}
        {!props.loading && !props.error && groups.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">No thread-to-thread exchanges yet.</p>
        ) : null}
        {groups.map((group, index) => (
          <ExchangeGroupView
            key={group.id}
            group={group}
            links={props.links}
            threadLabels={props.threadLabels}
            onOpenThread={props.onOpenThread}
            defaultOpen={index === 0}
          />
        ))}
      </div>
    </div>
  );
}
