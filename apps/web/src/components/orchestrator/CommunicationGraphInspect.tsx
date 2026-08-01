import type { OrchestratorCommunicationLink, ThreadId } from "@synara/contracts";
import { useState } from "react";

import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { LinkIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

import { threadLabel } from "./orchestratorViewModel";

function linkScope(link: OrchestratorCommunicationLink): string {
  if (link.taskId) return `Task ${link.taskId}`;
  if (link.runId) return `Run ${link.runId}`;
  return "Ownership scope";
}

export function CommunicationGraphInspect(props: {
  readonly selectedThreadId: ThreadId;
  readonly links: readonly OrchestratorCommunicationLink[];
  readonly threadLabels: ReadonlyMap<ThreadId, string>;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const [open, setOpen] = useState(false);
  const links = props.links.filter(
    (link) =>
      link.sourceThreadId === props.selectedThreadId ||
      link.targetThreadId === props.selectedThreadId,
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium hover:bg-muted/55">
        <DisclosureChevron open={open} />
        <LinkIcon className="size-3.5" />
        Communication graph
        <span className="ml-auto tabular-nums text-muted-foreground">{links.length}</span>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="grid gap-2 px-2 pb-2 pt-1">
          {links.length === 0 ? (
            <p className="text-xs text-muted-foreground">No links touch the selected thread.</p>
          ) : (
            links.map((link) => (
              <div
                key={link.id}
                className="rounded-lg border border-border/70 bg-background/50 p-2"
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
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
