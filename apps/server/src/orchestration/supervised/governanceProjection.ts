import {
  SupervisedGovernanceAggregateId,
  type SupervisedGovernanceDomainEvent,
  type SupervisedOrchestrationSnapshot,
  type SupervisionDomainEvent,
} from "@synara/contracts";

import { projectSupervisedGovernanceDecisionEvent } from "./governanceProjector.ts";

const canonicalType = (type: string) => type.replace(/^supervision\./, "supervised.");

// TODO(synara): Remove the legacy event adapter on or after 2027-08-09 once every
// supported database has replayed migration 108 and no supervision events remain.
export const upcastLegacySupervisionEvent = (
  event: SupervisionDomainEvent,
): SupervisedGovernanceDomainEvent =>
  ({
    ...event,
    aggregateKind: "supervised_governance",
    aggregateId: SupervisedGovernanceAggregateId.makeUnsafe(event.aggregateId),
    type: canonicalType(event.type),
    metadata: { ...event.metadata, schemaVersion: "supervised-governance/v1" },
  }) as SupervisedGovernanceDomainEvent;

export function projectSupervisedGovernanceEvent(
  state: SupervisedOrchestrationSnapshot,
  event: SupervisionDomainEvent | SupervisedGovernanceDomainEvent,
): SupervisedOrchestrationSnapshot {
  const canonicalEvent =
    event.aggregateKind === "supervised_governance"
      ? event
      : upcastLegacySupervisionEvent(event);
  const projected = projectSupervisedGovernanceDecisionEvent(
    {
      revision: state.revision,
      profiles: state.profiles,
      profileSnapshots: state.profileSnapshots,
      supervisors: [],
      leads: [],
      peers: [],
      missions: state.missions,
      workflowDirectives: state.workflowDirectives,
      workflowConflicts: state.workflowConflicts,
      advice: state.advice,
      observationCursors: state.observationCursors,
      wakeQueue: state.wakeQueue,
      rotations: state.rotations,
      updatedAt: state.updatedAt,
    },
    canonicalEvent,
  );
  return {
    revision: projected.revision,
    agentSeats: state.agentSeats,
    profiles: projected.profiles,
    profileSnapshots: projected.profileSnapshots,
    missions: projected.missions,
    workflowDirectives: projected.workflowDirectives,
    workflowConflicts: projected.workflowConflicts,
    advice: projected.advice,
    observationCursors: projected.observationCursors,
    wakeQueue: projected.wakeQueue,
    rotations: projected.rotations,
    updatedAt: projected.updatedAt,
  };
}

export const redactSupervisedOrchestrationForShell = (
  snapshot: SupervisedOrchestrationSnapshot,
): SupervisedOrchestrationSnapshot => ({
  ...snapshot,
  profiles: snapshot.profiles.map((profile) => ({
    ...profile,
    runtime: {
      provider: profile.runtime.provider,
      model: profile.runtime.model,
      reasoningEffort: profile.runtime.reasoningEffort,
      sandboxMode: profile.runtime.sandboxMode,
      approvalPolicy: profile.runtime.approvalPolicy,
      developerInstructions: "[available in profile detail]",
    },
  })),
  profileSnapshots: snapshot.profileSnapshots.map((profile) => ({
    ...profile,
    runtime: {
      provider: profile.runtime.provider,
      model: profile.runtime.model,
      reasoningEffort: profile.runtime.reasoningEffort,
      sandboxMode: profile.runtime.sandboxMode,
      approvalPolicy: profile.runtime.approvalPolicy,
      developerInstructions: "[available in profile detail]",
    },
  })),
});
