import type {
  OrchestratorCommunicationLink,
  OrchestratorOwnershipEdge,
  ThreadId,
} from "@synara/contracts";
import { useState } from "react";

import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { ChevronRightIcon, LinkIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

import {
  communicationLinksForSelection,
  ownershipRoutesForSelection,
  threadLabel,
} from "./orchestratorViewModel";

function linkScope(link: OrchestratorCommunicationLink): string {
  if (link.taskId) return `Task ${link.taskId}`;
  if (link.runId) return `Run ${link.runId}`;
  return "Ownership scope";
}

export function CommunicationGraphInspect(props: {
  readonly rootThreadId: ThreadId;
  readonly selectedThreadId: ThreadId;
  readonly links: readonly OrchestratorCommunicationLink[];
  readonly ownershipEdges: readonly OrchestratorOwnershipEdge[];
  readonly threadLabels: ReadonlyMap<ThreadId, string>;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly presentation?: "disclosure" | "team";
}) {
  const [open, setOpen] = useState(false);
  const links = communicationLinksForSelection(
    props.rootThreadId,
    props.selectedThreadId,
    props.links,
  );
  const ownershipRoutes = ownershipRoutesForSelection(
    props.rootThreadId,
    props.selectedThreadId,
    props.ownershipEdges,
  );
  const explicitLinkLabel = `${links.length} explicit ${links.length === 1 ? "link" : "links"}`;

  if (props.presentation === "team") {
    return (
      <div className="mt-3 grid gap-1" data-communication-presentation="team">
        {links.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">No explicit connections.</p>
        ) : (
          links.map((link) => (
            <button
              key={link.id}
              type="button"
              className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted/55"
              data-communication-route="explicit-link"
              onClick={() => props.onOpenThread(link.sourceThreadId)}
            >
              <LinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">
                  {threadLabel(props.threadLabels, link.sourceThreadId)}{" "}
                  {link.direction === "bidirectional" ? "↔" : "→"}{" "}
                  {threadLabel(props.threadLabels, link.targetThreadId)}
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="truncate">{link.reason}</span>
                  <span aria-hidden="true">·</span>
                  <span>{link.state === "granted" ? "Active" : link.state}</span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      link.state === "granted"
                        ? "bg-emerald-500"
                        : link.state === "rejected" || link.state === "revoked"
                          ? "bg-destructive"
                          : "bg-muted-foreground/45",
                    )}
                  />
                </span>
              </span>
              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          ))
        )}
        <span className="sr-only">{ownershipRoutes.length} implicit ownership routes</span>
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium hover:bg-muted/55">
        <DisclosureChevron open={open} />
        <LinkIcon className="size-3.5" />
        Communication routes
        <span className="ml-auto tabular-nums text-muted-foreground">{explicitLinkLabel}</span>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="grid gap-3 px-2 pb-2 pt-1">
          <section className="grid gap-1.5" aria-label="Implicit ownership routes">
            <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
              <span>Implicit ownership routes</span>
              <span className="ml-auto tabular-nums">{ownershipRoutes.length}</span>
            </div>
            {ownershipRoutes.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No direct ownership routes touch the selected thread.
              </p>
            ) : (
              ownershipRoutes.map((edge) => (
                <div
                  key={`${edge.parentThreadId}:${edge.childThreadId}`}
                  className="rounded-lg border border-dashed border-border/70 bg-muted/20 p-2"
                  data-communication-route="ownership-direct"
                >
                  <div className="flex min-w-0 items-center gap-1.5 text-xs">
                    <button
                      type="button"
                      className="truncate font-medium hover:underline"
                      onClick={() => props.onOpenThread(edge.parentThreadId)}
                    >
                      {threadLabel(props.threadLabels, edge.parentThreadId)}
                    </button>
                    <span className="text-muted-foreground">↔</span>
                    <button
                      type="button"
                      className="truncate font-medium hover:underline"
                      onClick={() => props.onOpenThread(edge.childThreadId)}
                    >
                      {threadLabel(props.threadLabels, edge.childThreadId)}
                    </button>
                    <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      ownership direct
                    </span>
                  </div>
                </div>
              ))
            )}
          </section>

          <section className="grid gap-1.5" aria-label="Explicit cross-links">
            <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
              <span>Explicit cross-links</span>
              <span className="ml-auto tabular-nums">{explicitLinkLabel}</span>
            </div>
            {links.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No explicit sibling or cross-branch links.
              </p>
            ) : (
              links.map((link) => (
                <div
                  key={link.id}
                  className="rounded-lg border border-border/70 bg-background/50 p-2"
                  data-communication-route="explicit-link"
                >
                  <div className="flex min-w-0 items-center gap-1.5 text-xs">
                    <button
                      type="button"
                      className="truncate font-medium hover:underline"
                      onClick={() => props.onOpenThread(link.sourceThreadId)}
                    >
                      {threadLabel(props.threadLabels, link.sourceThreadId)}
                    </button>
                    <span className="text-muted-foreground">
                      {link.direction === "bidirectional" ? "↔" : "→"}
                    </span>
                    <button
                      type="button"
                      className="truncate font-medium hover:underline"
                      onClick={() => props.onOpenThread(link.targetThreadId)}
                    >
                      {threadLabel(props.threadLabels, link.targetThreadId)}
                    </button>
                    <span
                      className={cn(
                        "ml-auto rounded-full px-1.5 py-0.5 text-[10px]",
                        link.state === "granted"
                          ? "bg-success/10 text-success"
                          : link.state === "rejected" || link.state === "revoked"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {link.state}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {linkScope(link)} · {link.reason}
                  </p>
                  {link.expiresAt ? (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Expires {new Date(link.expiresAt).toLocaleString()}
                    </p>
                  ) : null}
                </div>
              ))
            )}
          </section>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
