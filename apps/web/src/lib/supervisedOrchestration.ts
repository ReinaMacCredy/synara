import type {
  MissionScope,
  ModelSessionTrace,
  ModelSelection,
  ProfileRuntimeConfig,
  SupervisedGovernanceDomainEvent,
  SupervisionDomainEvent,
  SupervisionMission,
  SupervisedOrchestrationSnapshot,
} from "@veylen/contracts";

import { buildModelSelection } from "../providerModelOptions";

// TODO(supervised-runtime): Remove the legacy role alias on or after 2027-08-09
// once every pre-cutover transcript has been upcast to Peer.
export function isPeerModelSessionRole(
  role: ModelSessionTrace["role"],
): role is "peer" | "specialist" {
  return role === "peer" || role === "specialist";
}

const upsert = <A>(rows: readonly A[], next: A, id: (row: A) => string): A[] => {
  const index = rows.findIndex((row) => id(row) === id(next));
  return index === -1 ? [...rows, next] : [...rows.slice(0, index), next, ...rows.slice(index + 1)];
};

export function projectSupervisedOrchestrationEvent(
  state: SupervisedOrchestrationSnapshot,
  event: SupervisionDomainEvent | SupervisedGovernanceDomainEvent,
): SupervisedOrchestrationSnapshot {
  const payload = event.payload;
  let next: SupervisedOrchestrationSnapshot = {
    ...state,
    revision: event.sequence,
    updatedAt: event.occurredAt,
  };
  if (payload.profile !== undefined) {
    next = { ...next, profiles: upsert(next.profiles, payload.profile, (row) => row.id) };
  }
  if (payload.profileSnapshot !== undefined) {
    next = {
      ...next,
      profileSnapshots: upsert(next.profileSnapshots, payload.profileSnapshot, (row) => row.id),
    };
  }
  if (payload.mission !== undefined) {
    next = { ...next, missions: upsert(next.missions, payload.mission, (row) => row.id) };
  }
  if (payload.workflowDirective !== undefined) {
    next = {
      ...next,
      workflowDirectives: upsert(
        next.workflowDirectives,
        payload.workflowDirective,
        (row) => row.id,
      ),
    };
  }
  if (payload.workflowConflict !== undefined) {
    const conflict = payload.workflowConflict;
    const isResolved =
      event.type === "supervision.workflow-resolved" ||
      event.type === "supervised.workflow-resolved";
    next = {
      ...next,
      workflowConflicts: upsert(next.workflowConflicts, conflict, (row) => row.id),
      ...(isResolved
        ? {
            workflowDirectives: next.workflowDirectives.map((directive) =>
              conflict.directiveIds.includes(directive.id)
                ? {
                    ...directive,
                    status: directive.id === conflict.resolvedDirectiveId ? "active" : "superseded",
                    updatedAt: event.occurredAt,
                    revision: directive.revision + 1,
                  }
                : directive,
            ),
          }
        : {}),
    };
  }
  if (payload.advice !== undefined) {
    next = { ...next, advice: upsert(next.advice, payload.advice, (row) => row.id) };
  }
  if (payload.observationCursor !== undefined) {
    next = {
      ...next,
      observationCursors: upsert(
        next.observationCursors,
        payload.observationCursor,
        (row) => row.id,
      ),
    };
  }
  if (payload.wake !== undefined) {
    next = { ...next, wakeQueue: upsert(next.wakeQueue, payload.wake, (row) => row.id) };
  }
  if (payload.rotation !== undefined) {
    next = { ...next, rotations: upsert(next.rotations, payload.rotation, (row) => row.id) };
  }
  return next;
}

export function supervisedScopeLabel(scope: MissionScope): string {
  switch (scope.kind) {
    case "all_projects":
      return "All projects";
    case "space":
      return "Space";
    case "project":
      return "Project";
    case "lead":
      return "Lead";
  }
}

export function supervisedScopesLabel(scopes: readonly MissionScope[]): string {
  return scopes.map(supervisedScopeLabel).join(", ");
}

export function activeMissionsForSupervisor(
  snapshot: SupervisedOrchestrationSnapshot,
  supervisorSeatId: string,
): SupervisionMission[] {
  return snapshot.missions.filter(
    (mission) =>
      mission.supervisorSeatId === supervisorSeatId &&
      (mission.status === "active" || mission.status === "paused"),
  );
}

export function resolveSupervisedBoundModelSelection(input: {
  readonly fallback: ModelSelection;
  readonly runtime: ProfileRuntimeConfig | null;
}): ModelSelection {
  const runtime = input.runtime;
  if (runtime === null) return input.fallback;
  if (runtime.provider === "codex") {
    return buildModelSelection(
      "codex",
      runtime.model,
      runtime.reasoningEffort ? { reasoningEffort: runtime.reasoningEffort } : undefined,
    );
  }
  return buildModelSelection(runtime.provider, runtime.model);
}
