import type { AssignmentContract, OrchestratorChildProjection, ThreadId } from "@synara/contracts";

export type OrchestratorChildLane = "ready" | "working" | "available";

export interface OrchestratorSidebarChild<T> {
  readonly thread: T;
  readonly rootThreadId: ThreadId;
  readonly parentThreadId: ThreadId;
  readonly lane: OrchestratorChildLane;
  readonly state: "ready" | "working" | "waiting" | "blocked" | "failed" | "available";
  readonly assignment: AssignmentContract | null;
  readonly projection: OrchestratorChildProjection | null;
}

function latestAssignments(
  assignments: readonly AssignmentContract[],
): ReadonlyMap<ThreadId, AssignmentContract> {
  const byThreadId = new Map<ThreadId, AssignmentContract>();
  for (const assignment of assignments) {
    const existing = byThreadId.get(assignment.assigneeThreadId);
    if (
      !existing ||
      assignment.version > existing.version ||
      (assignment.version === existing.version && assignment.updatedAt > existing.updatedAt)
    ) {
      byThreadId.set(assignment.assigneeThreadId, assignment);
    }
  }
  return byThreadId;
}

function childLifecycle(
  assignment: AssignmentContract | null,
): Pick<OrchestratorSidebarChild<never>, "lane" | "state"> {
  switch (assignment?.state) {
    case "reported_complete":
    case "verified":
      return { lane: "ready", state: "ready" };
    case "blocked":
    case "needs_permission":
    case "waiting_on_user":
      return { lane: "working", state: "blocked" };
    case "failed":
    case "cancelled":
      return { lane: "working", state: "failed" };
    case "waiting_on_thread":
      return { lane: "working", state: "waiting" };
    case "queued":
    case "running":
    case "reopened":
      return { lane: "working", state: "working" };
    case "accepted":
    case undefined:
      return { lane: "available", state: "available" };
  }
}

/**
 * True when `threadId` is a descendant of `rootThreadId` via parentThreadId links.
 * Walks parents with a cycle guard; foreign subtrees (e.g. Advisor children of
 * other chats) must not appear under an unrelated Orchestrator Root.
 */
function isDescendantOfRoot(
  threadId: ThreadId,
  rootThreadId: ThreadId,
  parentById: ReadonlyMap<ThreadId, ThreadId | null | undefined>,
): boolean {
  const seen = new Set<ThreadId>();
  let current: ThreadId | null | undefined = parentById.get(threadId);
  while (current != null) {
    if (current === rootThreadId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = parentById.get(current);
  }
  return false;
}

export function projectOrchestratorSidebarChildren<
  T extends {
    readonly id: ThreadId;
    readonly parentThreadId?: ThreadId | null;
    readonly createdAt: string;
    readonly updatedAt?: string | null | undefined;
  },
>(input: {
  readonly rootThreadId: ThreadId;
  readonly threads: readonly T[];
  readonly assignments: readonly AssignmentContract[];
  readonly childProjections?: readonly OrchestratorChildProjection[];
}): OrchestratorSidebarChild<T>[] {
  const latestAssignmentByThreadId = latestAssignments(input.assignments);
  const authoritativeByThreadId = new Map(
    (input.childProjections ?? []).map((projection) => [projection.threadId, projection] as const),
  );
  const parentById = new Map(
    input.threads.map((thread) => [thread.id, thread.parentThreadId ?? null] as const),
  );
  const children = input.threads.flatMap((thread) => {
    const parentThreadId = thread.parentThreadId ?? null;
    if (thread.id === input.rootThreadId || parentThreadId === null) return [];
    // Must belong to this root's ownership tree — not any parented thread in the
    // global sidebar (Advisor forks of other chats were leaking into the strip).
    if (!isDescendantOfRoot(thread.id, input.rootThreadId, parentById)) return [];
    const assignment = latestAssignmentByThreadId.get(thread.id) ?? null;
    const projection = authoritativeByThreadId.get(thread.id) ?? null;
    const projectedLifecycle =
      projection === null
        ? childLifecycle(assignment)
        : projection.orchestrationState === "ready"
          ? { lane: "ready" as const, state: "ready" as const }
          : projection.orchestrationState === "available"
            ? { lane: "available" as const, state: "available" as const }
            : {
                lane: "working" as const,
                state: projection.orchestrationState,
              };
    return [
      {
        thread,
        rootThreadId: input.rootThreadId,
        parentThreadId,
        assignment,
        projection,
        ...projectedLifecycle,
      },
    ];
  });
  const laneRank: Record<OrchestratorChildLane, number> = {
    ready: 0,
    working: 1,
    available: 2,
  };
  const stateRank: Record<OrchestratorSidebarChild<T>["state"], number> = {
    blocked: 0,
    failed: 1,
    ready: 2,
    working: 3,
    waiting: 4,
    available: 5,
  };
  return children.toSorted(
    (left, right) =>
      laneRank[left.lane] - laneRank[right.lane] ||
      stateRank[left.state] - stateRank[right.state] ||
      Date.parse(
        right.projection?.lifecycleAt ??
          right.assignment?.updatedAt ??
          right.thread.updatedAt ??
          right.thread.createdAt,
      ) -
        Date.parse(
          left.projection?.lifecycleAt ??
            left.assignment?.updatedAt ??
            left.thread.updatedAt ??
            left.thread.createdAt,
        ) ||
      left.thread.id.localeCompare(right.thread.id),
  );
}

export function visibleOrchestratorSidebarChildren<T>(
  children: readonly OrchestratorSidebarChild<T>[],
): readonly OrchestratorSidebarChild<T>[] {
  let availableCount = 0;
  return children.filter((child) => {
    if (child.lane !== "available") return true;
    availableCount += 1;
    return availableCount <= 3;
  });
}
