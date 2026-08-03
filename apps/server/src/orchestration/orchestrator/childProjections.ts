import type {
  AssignmentContract,
  ChildResultEnvelope,
  OrchestratorChildProjection,
  OrchestratorOwnershipEdge,
  ThreadId,
} from "@synara/contracts";

const newestAssignmentByChild = (
  assignments: readonly AssignmentContract[],
): ReadonlyMap<ThreadId, AssignmentContract> => {
  const result = new Map<ThreadId, AssignmentContract>();
  for (const assignment of assignments) {
    const current = result.get(assignment.assigneeThreadId);
    if (
      current === undefined ||
      assignment.version > current.version ||
      (assignment.version === current.version && assignment.updatedAt > current.updatedAt)
    ) {
      result.set(assignment.assigneeThreadId, assignment);
    }
  }
  return result;
};

const newestResultByAssignment = (
  results: readonly ChildResultEnvelope[],
): ReadonlyMap<string, ChildResultEnvelope> => {
  const byAssignment = new Map<string, ChildResultEnvelope>();
  for (const result of results) {
    const current = byAssignment.get(result.assignmentId);
    if (
      current === undefined ||
      result.submittedAt > current.submittedAt ||
      (result.submittedAt === current.submittedAt && result.revision > current.revision)
    ) {
      byAssignment.set(result.assignmentId, result);
    }
  }
  return byAssignment;
};

const assignmentState = (
  assignment: AssignmentContract | undefined,
): OrchestratorChildProjection["orchestrationState"] => {
  switch (assignment?.state) {
    case "reported_complete":
    case "verified":
      return "ready";
    case "blocked":
    case "needs_permission":
    case "waiting_on_user":
      return "blocked";
    case "failed":
    case "cancelled":
      return "failed";
    case "waiting_on_thread":
      return "waiting";
    case "queued":
    case "running":
    case "reopened":
      return "working";
    case "accepted":
    case undefined:
      return "available";
  }
};

function ownershipPath(
  rootThreadId: ThreadId,
  edge: OrchestratorOwnershipEdge,
  byChild: ReadonlyMap<ThreadId, OrchestratorOwnershipEdge>,
): ThreadId[] {
  const reversed: ThreadId[] = [edge.childThreadId];
  const visited = new Set<ThreadId>(reversed);
  let parent = edge.parentThreadId;
  while (!visited.has(parent)) {
    reversed.push(parent);
    if (parent === rootThreadId) break;
    visited.add(parent);
    const parentEdge = byChild.get(parent);
    if (parentEdge === undefined) break;
    parent = parentEdge.parentThreadId;
  }
  return reversed.reverse();
}

export function projectOrchestratorChildren(input: {
  readonly rootThreadId: ThreadId;
  readonly ownershipEdges: readonly OrchestratorOwnershipEdge[];
  readonly assignments: readonly AssignmentContract[];
  readonly childResults: readonly ChildResultEnvelope[];
}): OrchestratorChildProjection[] {
  const activeEdges = input.ownershipEdges.filter((edge) => edge.retiredAt === null);
  const edgeByChild = new Map(activeEdges.map((edge) => [edge.childThreadId, edge] as const));
  const assignmentByChild = newestAssignmentByChild(input.assignments);
  const resultByAssignment = newestResultByAssignment(input.childResults);

  return activeEdges.map((edge) => {
    const assignment = assignmentByChild.get(edge.childThreadId);
    const result = assignment ? resultByAssignment.get(assignment.assignmentId) : undefined;
    const orchestrationState =
      result?.reviewState === "pending"
        ? "ready"
        : result?.reviewState === "changes_requested"
          ? "working"
          : result?.reviewState === "accepted"
            ? "available"
            : assignmentState(assignment);
    return {
      rootThreadId: input.rootThreadId,
      threadId: edge.childThreadId,
      parentThreadId: edge.parentThreadId,
      ownershipPath: ownershipPath(input.rootThreadId, edge, edgeByChild),
      orchestrationState,
      pendingResultId: result?.reviewState === "pending" ? result.resultId : null,
      resultReviewState: result?.reviewState ?? null,
      activeAssignmentId: assignment?.assignmentId ?? null,
      diffSummary:
        result !== undefined && assignment?.assignmentId === result.assignmentId
          ? result.diffSummary
          : null,
      lifecycleAt:
        result?.reviewedAt ?? result?.submittedAt ?? assignment?.updatedAt ?? edge.activeFrom,
    };
  });
}
