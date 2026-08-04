import {
  PROVIDER_DISPLAY_NAMES,
  type AssignmentContract,
  type OrchestratorChildProjection,
  type OrchestratorMessageEnvelope,
  type OrchestratorSnapshot,
  type ProfilePreset,
  type ProfilePresetId,
  type ThreadId,
} from "@synara/contracts";
import { formatModelDisplayName } from "@synara/shared/model";
import { orchestratorChildAlias } from "@synara/shared/orchestratorThreadAlias";
import { useMemo, useState } from "react";

import { ProviderIcon } from "~/components/ProviderIcon";
import { ThreadActivityGlyph, type ThreadActivityState } from "~/components/ThreadActivityGlyph";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import { Button } from "~/components/ui/button";
import { ChevronRightIcon, MessageCircleIcon } from "~/lib/icons";
import { formatRelativeTime } from "~/lib/relativeTime";
import { cn } from "~/lib/utils";
import type { Thread } from "~/types";

import { CommunicationGraphInspect } from "./CommunicationGraphInspect";
import { CreatePeerDialog } from "./CreatePeerDialog";
import {
  buildOwnershipTree,
  communicationLinksForSelection,
  threadLabel,
  type OwnershipTreeNode,
} from "./orchestratorViewModel";
import styles from "./TeamPanel.module.css";

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

function lifecycleState(
  isRoot: boolean,
  thread: Thread | undefined,
  assignment: AssignmentContract | null,
  projection: OrchestratorChildProjection | null,
): ThreadActivityState {
  if (thread?.error || thread?.session?.status === "error") return "failed";
  if (thread?.hasPendingApprovals || thread?.hasPendingUserInput) return "blocked";
  if (isRoot) return thread?.session?.status === "running" ? "working" : "idle";
  switch (projection?.orchestrationState) {
    case "ready":
      return "ready";
    case "working":
    case "waiting":
      return "working";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "available":
      return "available";
  }
  if (assignment?.state === "reported_complete" || assignment?.state === "verified") return "ready";
  if (assignment?.state === "running" || assignment?.state === "waiting_on_thread")
    return "working";
  if (assignment?.state === "blocked" || assignment?.state === "needs_permission") return "blocked";
  if (assignment?.state === "failed") return "failed";
  if (assignment?.state === "accepted") return "available";
  return "idle";
}

function lifecycleLabel(state: ThreadActivityState): string {
  switch (state) {
    case "working":
      return "Working";
    case "ready":
      return "Ready to review";
    case "available":
      return "Available";
    case "blocked":
      return "Blocked";
    case "failed":
      return "Failed";
    case "connecting":
      return "Connecting";
    case "idle":
      return "Ready";
  }
}

function TeamNode(props: {
  readonly node: OwnershipTreeNode;
  readonly depth: number;
  readonly rootThreadId: ThreadId;
  readonly selectedThreadId: ThreadId;
  readonly threadsById: ReadonlyMap<ThreadId, Thread>;
  readonly assignments: readonly AssignmentContract[];
  readonly childProjections: readonly OrchestratorChildProjection[];
  readonly onSelectThread: (threadId: ThreadId) => void;
}) {
  const [open, setOpen] = useState(true);
  const thread = props.threadsById.get(props.node.threadId);
  const assignment = assignmentForThread(props.assignments, props.node.threadId);
  const projection = props.childProjections.find(
    (candidate) => candidate.threadId === props.node.threadId,
  );
  const edge = props.node.edge;
  const isRoot = props.node.threadId === props.rootThreadId;
  const retired = edge?.retiredAt !== null && edge?.retiredAt !== undefined;
  const attention = attentionLabel(thread);
  const provider = thread?.session?.provider ?? thread?.modelSelection.provider ?? "codex";
  const activityState = lifecycleState(isRoot, thread, assignment, projection ?? null);
  const model = thread?.modelSelection.model ?? "unknown model";

  return (
    <div
      className={cn(styles.node, props.depth > 0 && styles.childNode)}
      data-team-thread-id={props.node.threadId}
    >
      <div
        className={cn(
          "group rounded-lg border px-2.5 py-2.5",
          isRoot && props.selectedThreadId === props.node.threadId
            ? "border-primary/35 bg-primary/5"
            : props.selectedThreadId === props.node.threadId
              ? "border-transparent bg-muted/55"
              : "border-transparent hover:bg-muted/45",
          retired && "opacity-60",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          {props.node.children.length > 0 ? (
            <button
              type="button"
              aria-label={open ? "Collapse descendants" : "Expand descendants"}
              className="rounded p-0.5 hover:bg-muted"
              onClick={() => setOpen((value) => !value)}
            >
              <DisclosureChevron open={open} />
            </button>
          ) : (
            <ChevronRightIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          )}
          <ProviderIcon provider={provider} className="size-4 shrink-0" />
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => props.onSelectThread(props.node.threadId)}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-medium">
                {thread?.title ??
                  (isRoot ? props.node.threadId : orchestratorChildAlias(props.node.threadId))}
              </span>
              {isRoot ? (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                  Root
                </span>
              ) : null}
              {retired ? (
                <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                  retired
                </span>
              ) : null}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>
                {PROVIDER_DISPLAY_NAMES[provider]} · {formatModelDisplayName(model) ?? model}
              </span>
              {attention ? (
                <span className="font-medium text-warning">Needs {attention}</span>
              ) : null}
            </span>
          </button>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            {lifecycleLabel(activityState)}
            <ThreadActivityGlyph state={activityState} />
          </span>
        </div>
      </div>
      {props.node.children.length > 0 ? (
        <DisclosureRegion open={open}>
          <div className={styles.children} data-team-children={props.node.threadId}>
            {props.node.children.map((child) => (
              <TeamNode
                key={`${child.threadId}:${child.edge?.activeFrom ?? "root"}`}
                {...props}
                node={child}
                depth={props.depth + 1}
              />
            ))}
          </div>
        </DisclosureRegion>
      ) : null}
    </div>
  );
}

export function TeamPanel(props: {
  readonly snapshot: OrchestratorSnapshot;
  readonly threads: readonly Thread[];
  readonly selectedThreadId: ThreadId;
  readonly threadLabels: ReadonlyMap<ThreadId, string>;
  readonly onSelectThread: (threadId: ThreadId) => void;
  readonly exchanges: readonly OrchestratorMessageEnvelope[];
  readonly exchangesLoading: boolean;
  readonly exchangesError: string | null;
  readonly profiles: readonly ProfilePreset[];
  readonly canCreatePeer: boolean;
  readonly onCreatePeer: (input: {
    readonly title: string;
    readonly brief: string;
    readonly profilePresetId: ProfilePresetId;
  }) => Promise<void>;
}) {
  const [createPeerOpen, setCreatePeerOpen] = useState(false);
  const tree = useMemo(
    () => buildOwnershipTree(props.snapshot.root.rootThreadId, props.snapshot.ownershipEdges),
    [props.snapshot.ownershipEdges, props.snapshot.root.rootThreadId],
  );
  const threadsById = useMemo(
    () => new Map(props.threads.map((thread) => [thread.id, thread] as const)),
    [props.threads],
  );
  const visibleExchanges = useMemo(
    () =>
      props.exchanges
        .filter(
          (exchange) =>
            props.selectedThreadId === props.snapshot.root.rootThreadId ||
            exchange.senderThreadId === props.selectedThreadId ||
            exchange.targetThreadId === props.selectedThreadId,
        )
        .toSorted((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .slice(0, 24),
    [props.exchanges, props.selectedThreadId, props.snapshot.root.rootThreadId],
  );
  const activeCount =
    props.snapshot.childProjections?.filter(
      (projection) => projection.orchestrationState === "working",
    ).length ?? 0;
  const teamThreadCount =
    1 + props.snapshot.ownershipEdges.filter((edge) => !edge.retiredAt).length;
  const visibleLinks = communicationLinksForSelection(
    props.snapshot.root.rootThreadId,
    props.selectedThreadId,
    props.snapshot.communicationLinks,
  );

  return (
    <div
      className={cn("flex h-full min-h-0 w-full min-w-0 flex-col", styles.root)}
      data-orchestrator-panel="team"
    >
      <div className={cn("min-h-0 flex-1", styles.layout)}>
        <section
          className={cn("min-h-0 p-3", styles.team)}
          aria-label="Team ownership"
          data-team-section="ownership"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Team
            </p>
            {props.canCreatePeer ? (
              <Button size="xs" variant="outline" onClick={() => setCreatePeerOpen(true)}>
                New Peer
              </Button>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {teamThreadCount} threads · {activeCount} active
          </p>
          <div className="mt-3">
            <TeamNode
              node={tree}
              depth={0}
              rootThreadId={props.snapshot.root.rootThreadId}
              selectedThreadId={props.selectedThreadId}
              threadsById={threadsById}
              assignments={props.snapshot.assignments}
              childProjections={props.snapshot.childProjections ?? []}
              onSelectThread={props.onSelectThread}
            />
          </div>
        </section>
        <section
          className={cn("min-h-0 border-t border-border/70 p-3", styles.activity)}
          aria-label="Recent team activity"
          data-team-section="activity"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span className={styles.wideActivityLabel}>Activity</span>
            <span className={styles.narrowActivityLabel}>Recent activity</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {props.selectedThreadId === props.snapshot.root.rootThreadId
              ? "All team"
              : `Selected · ${threadLabel(props.threadLabels, props.selectedThreadId)}`}
          </p>
          <div className="mt-3 divide-y divide-border/70">
            {props.exchangesLoading ? (
              <p className="py-3 text-xs text-muted-foreground">Loading activity…</p>
            ) : props.exchangesError ? (
              <p role="alert" className="py-3 text-xs text-destructive">
                {props.exchangesError}
              </p>
            ) : visibleExchanges.length === 0 ? (
              <p className="py-3 text-xs text-muted-foreground">No durable exchanges yet.</p>
            ) : (
              visibleExchanges.map((exchange) => (
                <button
                  key={exchange.messageId}
                  type="button"
                  className="flex w-full min-w-0 gap-2 py-3 text-left hover:text-foreground"
                  onClick={() => props.onSelectThread(exchange.targetThreadId)}
                >
                  <MessageCircleIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {threadLabel(props.threadLabels, exchange.senderThreadId)} →{" "}
                      {threadLabel(props.threadLabels, exchange.targetThreadId)}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                      {exchange.body}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {formatRelativeTime(exchange.updatedAt)}
                  </span>
                </button>
              ))
            )}
          </div>
        </section>
        <section
          className={cn("border-t border-border/70 p-3", styles.connections)}
          data-team-section="connections"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Connections
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{visibleLinks.length} explicit</p>
          <CommunicationGraphInspect
            rootThreadId={props.snapshot.root.rootThreadId}
            selectedThreadId={props.selectedThreadId}
            links={props.snapshot.communicationLinks}
            ownershipEdges={props.snapshot.ownershipEdges}
            threadLabels={props.threadLabels}
            onOpenThread={props.onSelectThread}
            presentation="team"
          />
        </section>
      </div>
      <CreatePeerDialog
        open={createPeerOpen}
        profiles={props.profiles}
        onOpenChange={setCreatePeerOpen}
        onCreate={props.onCreatePeer}
      />
    </div>
  );
}
