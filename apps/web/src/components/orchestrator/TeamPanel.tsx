import type { AssignmentContract, OrchestratorSnapshot, ThreadId } from "@synara/contracts";
import { orchestratorChildAlias } from "@synara/shared/orchestratorThreadAlias";
import { useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { Collapsible, CollapsiblePanel } from "~/components/ui/collapsible";
import { formatRelativeTime } from "~/lib/relativeTime";
import { cn } from "~/lib/utils";
import type { Thread } from "~/types";

import { CommunicationGraphInspect } from "./CommunicationGraphInspect";
import { buildOwnershipTree, type OwnershipTreeNode } from "./orchestratorViewModel";

function assignmentForThread(
  assignments: readonly AssignmentContract[],
  threadId: ThreadId,
): AssignmentContract | null {
  return (
    assignments.find(
      (assignment) =>
        assignment.assigneeThreadId === threadId &&
        assignment.state !== "cancelled" &&
        assignment.state !== "accepted",
    ) ??
    assignments.find((assignment) => assignment.assigneeThreadId === threadId) ??
    null
  );
}

function attentionLabel(thread: Thread | undefined): string | null {
  if (thread?.hasPendingApprovals) return "permission";
  if (thread?.hasPendingUserInput) return "user input";
  if (thread?.error || thread?.session?.status === "error") return "error";
  return null;
}

function TeamNode(props: {
  readonly node: OwnershipTreeNode;
  readonly depth: number;
  readonly rootThreadId: ThreadId;
  readonly selectedThreadId: ThreadId;
  readonly threadsById: ReadonlyMap<ThreadId, Thread>;
  readonly assignments: readonly AssignmentContract[];
  readonly onSelectThread: (threadId: ThreadId) => void;
  readonly onDetachChild: (threadId: ThreadId) => Promise<void>;
  readonly detachPendingThreadId: ThreadId | null;
}) {
  const [open, setOpen] = useState(true);
  const thread = props.threadsById.get(props.node.threadId);
  const assignment = assignmentForThread(props.assignments, props.node.threadId);
  const edge = props.node.edge;
  const isRoot = props.node.threadId === props.rootThreadId;
  const retired = edge?.retiredAt !== null && edge?.retiredAt !== undefined;
  const attention = attentionLabel(thread);
  const role = isRoot ? "root" : (edge?.role ?? "child");
  const sessionStatus = thread?.session?.status ?? "not started";
  const updatedAt = thread?.updatedAt ?? thread?.createdAt ?? edge?.activeFrom ?? null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} data-team-thread-id={props.node.threadId}>
      <div
        className={cn(
          "group rounded-lg border px-2 py-2",
          props.selectedThreadId === props.node.threadId
            ? "border-primary/35 bg-primary/5"
            : "border-transparent hover:bg-muted/45",
          retired && "opacity-60",
        )}
        style={{ marginLeft: `${props.depth * 14}px` }}
      >
        <div className="flex min-w-0 items-start gap-1.5">
          {props.node.children.length > 0 ? (
            <button
              type="button"
              aria-label={open ? "Collapse descendants" : "Expand descendants"}
              className="mt-0.5 rounded p-0.5 hover:bg-muted"
              onClick={() => setOpen((value) => !value)}
            >
              <DisclosureChevron open={open} />
            </button>
          ) : (
            <span className="mt-0.5 size-4 shrink-0" />
          )}
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => props.onSelectThread(props.node.threadId)}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-xs font-medium">
                  {thread?.title ??
                    (isRoot ? props.node.threadId : orchestratorChildAlias(props.node.threadId))}
              </span>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                {role.replaceAll("_", " ")}
              </span>
              {retired ? (
                <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                  retired
                </span>
              ) : null}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
              <span>
                {thread?.session?.provider ?? thread?.modelSelection.provider ?? "unknown"} ·{" "}
                {thread?.modelSelection.model ?? "unknown model"}
              </span>
              <span>{sessionStatus}</span>
              {updatedAt ? <span>{formatRelativeTime(updatedAt)}</span> : null}
              {attention ? (
                <span className="font-medium text-warning">Needs {attention}</span>
              ) : null}
            </span>
          </button>
          {!isRoot && !retired ? (
            <Button
              variant="destructive-outline"
              size="xs"
              disabled={props.detachPendingThreadId !== null}
              className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
              onClick={() => {
                if (
                  window.confirm(
                      `Detach ${thread?.title ?? orchestratorChildAlias(props.node.threadId)} from this Orchestrator? Its thread history will be preserved.`,
                  )
                ) {
                  void props.onDetachChild(props.node.threadId);
                }
              }}
            >
              {props.detachPendingThreadId === props.node.threadId ? "Detaching…" : "Detach"}
            </Button>
          ) : null}
        </div>
        {assignment ? (
          <div className="ml-5 mt-2 rounded-md bg-background/60 px-2 py-1.5 text-[10px]">
            <div className="flex items-center gap-2">
              <span className="font-medium">{assignment.goal}</span>
              <span className="ml-auto shrink-0 text-muted-foreground">{assignment.state}</span>
            </div>
            <p className="mt-1 text-muted-foreground">
              Task {assignment.taskId} · {assignment.decisionReason.summary}
            </p>
          </div>
        ) : edge ? (
          <p className="ml-5 mt-1 text-[10px] text-muted-foreground">
            {edge.decisionReason.summary}
          </p>
        ) : null}
      </div>
      <CollapsiblePanel>
        {props.node.children.map((child) => (
          <TeamNode
            key={`${child.threadId}:${child.edge?.activeFrom ?? "root"}`}
            {...props}
            node={child}
            depth={props.depth + 1}
          />
        ))}
      </CollapsiblePanel>
    </Collapsible>
  );
}

export function TeamPanel(props: {
  readonly snapshot: OrchestratorSnapshot;
  readonly threads: readonly Thread[];
  readonly selectedThreadId: ThreadId;
  readonly threadLabels: ReadonlyMap<ThreadId, string>;
  readonly onSelectThread: (threadId: ThreadId) => void;
  readonly onDetachChild: (threadId: ThreadId) => Promise<void>;
  readonly detachPendingThreadId: ThreadId | null;
}) {
  const tree = useMemo(
    () => buildOwnershipTree(props.snapshot.root.rootThreadId, props.snapshot.ownershipEdges),
    [props.snapshot.ownershipEdges, props.snapshot.root.rootThreadId],
  );
  const threadsById = useMemo(
    () => new Map(props.threads.map((thread) => [thread.id, thread] as const)),
    [props.threads],
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-orchestrator-panel="team">
      <div className="border-b border-border/70 px-3 py-2">
        <p className="text-xs font-medium">Ownership tree</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          Ownership is hierarchical. Communication links are inspected separately.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <TeamNode
          node={tree}
          depth={0}
          rootThreadId={props.snapshot.root.rootThreadId}
          selectedThreadId={props.selectedThreadId}
          threadsById={threadsById}
          assignments={props.snapshot.assignments}
          onSelectThread={props.onSelectThread}
          onDetachChild={props.onDetachChild}
          detachPendingThreadId={props.detachPendingThreadId}
        />
        <div className="mt-2 border-t border-border/70 pt-2">
          <CommunicationGraphInspect
            rootThreadId={props.snapshot.root.rootThreadId}
            selectedThreadId={props.selectedThreadId}
            links={props.snapshot.communicationLinks}
            threadLabels={props.threadLabels}
            onOpenThread={props.onSelectThread}
          />
        </div>
      </div>
    </div>
  );
}
