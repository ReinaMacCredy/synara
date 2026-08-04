import type { ProfilePreset, SupervisionDomainEvent, SupervisionSnapshot } from "@synara/contracts";
import { emptySupervisionSnapshot } from "@synara/contracts";

const upsert = <A>(rows: ReadonlyArray<A>, next: A, id: (row: A) => string): A[] => {
  const index = rows.findIndex((row) => id(row) === id(next));
  return index < 0 ? [...rows, next] : [...rows.slice(0, index), next, ...rows.slice(index + 1)];
};

export const createEmptySupervisionState = (at = new Date(0).toISOString()) =>
  emptySupervisionSnapshot(at);

export function projectSupervisionEvent(
  state: SupervisionSnapshot,
  event: SupervisionDomainEvent,
): SupervisionSnapshot {
  const payload = event.payload;
  let next: SupervisionSnapshot = {
    ...state,
    snapshotSequence: event.sequence,
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
  if (payload.supervisor !== undefined) {
    next = {
      ...next,
      supervisors: upsert(next.supervisors, payload.supervisor, (row) => row.id),
    };
  }
  if (payload.lead !== undefined) {
    next = { ...next, leads: upsert(next.leads, payload.lead, (row) => row.id) };
  }
  if (payload.peer !== undefined) {
    next = { ...next, peers: upsert(next.peers, payload.peer, (row) => row.threadId) };
  }
  if (payload.peers !== undefined) {
    next = {
      ...next,
      peers: payload.peers.reduce(
        (peers, peer) => upsert(peers, peer, (row) => row.threadId),
        [...next.peers],
      ),
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
    next = {
      ...next,
      workflowConflicts: upsert(next.workflowConflicts, conflict, (row) => row.id),
      ...(event.type === "supervision.workflow-resolved"
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

export const replaySupervisionEvents = (
  events: ReadonlyArray<SupervisionDomainEvent>,
  seedProfiles: ReadonlyArray<ProfilePreset> = [],
): SupervisionSnapshot =>
  events.reduce(projectSupervisionEvent, {
    ...createEmptySupervisionState(),
    profiles: [...seedProfiles],
  });
