import type {
  AssignmentCompletionEvidence,
  AssignmentContract,
  ChildResultEnvelope,
  OrchestratorArtifact,
  OrchestratorCommunicationLink,
  OrchestratorDomainEvent,
  OrchestratorMessageEnvelope,
  OrchestratorMonitor,
  OrchestratorOwnershipEdge,
  OrchestratorRoot,
  OrchestratorRun,
  OrchestratorWriterClaim,
} from "@synara/contracts";

export interface OrchestratorAggregateState {
  readonly root: OrchestratorRoot | null;
  readonly ownershipEdges: ReadonlyArray<OrchestratorOwnershipEdge>;
  readonly communicationLinks: ReadonlyArray<OrchestratorCommunicationLink>;
  readonly assignments: ReadonlyArray<AssignmentContract>;
  readonly assignmentEvidence: ReadonlyArray<AssignmentCompletionEvidence>;
  readonly childResults: ReadonlyArray<ChildResultEnvelope>;
  readonly messages: ReadonlyArray<OrchestratorMessageEnvelope>;
  readonly artifacts: ReadonlyArray<OrchestratorArtifact>;
  readonly runs: ReadonlyArray<OrchestratorRun>;
  readonly monitors: ReadonlyArray<OrchestratorMonitor>;
  readonly writerClaims: ReadonlyArray<OrchestratorWriterClaim>;
  readonly revision: number;
  readonly highWaterSequence: number;
}

export const createEmptyOrchestratorState = (): OrchestratorAggregateState => ({
  root: null,
  ownershipEdges: [],
  communicationLinks: [],
  assignments: [],
  assignmentEvidence: [],
  childResults: [],
  messages: [],
  artifacts: [],
  runs: [],
  monitors: [],
  writerClaims: [],
  revision: 0,
  highWaterSequence: 0,
});

const upsert = <A>(
  rows: ReadonlyArray<A>,
  next: A,
  sameIdentity: (left: A, right: A) => boolean,
): ReadonlyArray<A> => {
  const index = rows.findIndex((row) => sameIdentity(row, next));
  return index < 0 ? [...rows, next] : [...rows.slice(0, index), next, ...rows.slice(index + 1)];
};

export function projectOrchestratorEvent(
  state: OrchestratorAggregateState,
  event: OrchestratorDomainEvent,
): OrchestratorAggregateState {
  const base = {
    ...state,
    ...(event.payload.root !== undefined ? { root: event.payload.root } : {}),
    ...(event.payload.evidence !== undefined
      ? {
          assignmentEvidence: upsert(
            state.assignmentEvidence,
            event.payload.evidence,
            (left, right) =>
              left.assignmentId === right.assignmentId && left.reportedAt === right.reportedAt,
          ),
        }
      : {}),
    ...(event.payload.childResult !== undefined
      ? {
          childResults: upsert(
            state.childResults,
            event.payload.childResult,
            (left, right) => left.resultId === right.resultId,
          ),
        }
      : {}),
    revision: event.payload.acceptedRevision,
    highWaterSequence: event.sequence,
  };
  const payload = event.payload;

  if (payload.ownershipEdge !== undefined) {
    const existingEdges =
      event.type === "orchestrator.child.reparented" && payload.ownershipEdge.retiredAt === null
        ? base.ownershipEdges.map((edge) =>
            edge.childThreadId === payload.ownershipEdge!.childThreadId && edge.retiredAt === null
              ? { ...edge, retiredAt: event.occurredAt }
              : edge,
          )
        : base.ownershipEdges;
    return {
      ...base,
      ownershipEdges: upsert(
        existingEdges,
        payload.ownershipEdge,
        (left, right) =>
          left.rootThreadId === right.rootThreadId &&
          left.childThreadId === right.childThreadId &&
          left.contractVersion === right.contractVersion,
      ),
    };
  }
  if (payload.link !== undefined) {
    return {
      ...base,
      communicationLinks: upsert(
        base.communicationLinks,
        payload.link,
        (left, right) => left.id === right.id,
      ),
    };
  }
  if (payload.assignment !== undefined) {
    return {
      ...base,
      assignments: upsert(
        base.assignments,
        payload.assignment,
        (left, right) => left.assignmentId === right.assignmentId && left.version === right.version,
      ),
    };
  }
  if (payload.message !== undefined) {
    return {
      ...base,
      messages: upsert(
        base.messages,
        payload.message,
        (left, right) => left.messageId === right.messageId,
      ),
    };
  }
  if (payload.artifact !== undefined) {
    return {
      ...base,
      artifacts: upsert(base.artifacts, payload.artifact, (left, right) => left.id === right.id),
    };
  }
  if (payload.run !== undefined) {
    return {
      ...base,
      runs: upsert(base.runs, payload.run, (left, right) => left.id === right.id),
    };
  }
  if (payload.monitor !== undefined) {
    return {
      ...base,
      monitors: upsert(base.monitors, payload.monitor, (left, right) => left.id === right.id),
    };
  }
  if (payload.writerClaim !== undefined) {
    return {
      ...base,
      writerClaims: upsert(
        base.writerClaims,
        payload.writerClaim,
        (left, right) => left.id === right.id,
      ),
    };
  }
  return base;
}

export const replayOrchestratorEvents = (
  events: ReadonlyArray<OrchestratorDomainEvent>,
): OrchestratorAggregateState =>
  events.reduce(projectOrchestratorEvent, createEmptyOrchestratorState());
