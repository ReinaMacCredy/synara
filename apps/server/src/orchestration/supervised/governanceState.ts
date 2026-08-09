import type {
  LeadRotation,
  LeadSeat,
  PeerBinding,
  ProfilePreset,
  ProfileSnapshot,
  SupervisionAdvice,
  SupervisionMission,
  SupervisionObservationCursor,
  SupervisionWake,
  SupervisorSeat,
  WorkflowConflict,
  WorkflowDirective,
} from "@synara/contracts";

export interface SupervisedGovernanceDecisionState {
  readonly revision: number;
  readonly profiles: ReadonlyArray<ProfilePreset>;
  readonly profileSnapshots: ReadonlyArray<ProfileSnapshot>;
  readonly supervisors: ReadonlyArray<SupervisorSeat>;
  readonly leads: ReadonlyArray<LeadSeat>;
  readonly peers: ReadonlyArray<PeerBinding>;
  readonly missions: ReadonlyArray<SupervisionMission>;
  readonly workflowDirectives: ReadonlyArray<WorkflowDirective>;
  readonly workflowConflicts: ReadonlyArray<WorkflowConflict>;
  readonly advice: ReadonlyArray<SupervisionAdvice>;
  readonly observationCursors: ReadonlyArray<SupervisionObservationCursor>;
  readonly wakeQueue: ReadonlyArray<SupervisionWake>;
  readonly rotations: ReadonlyArray<LeadRotation>;
  readonly updatedAt: string;
}

export const emptySupervisedGovernanceDecisionState = (
  updatedAt: string,
): SupervisedGovernanceDecisionState => ({
  revision: 0,
  profiles: [],
  profileSnapshots: [],
  supervisors: [],
  leads: [],
  peers: [],
  missions: [],
  workflowDirectives: [],
  workflowConflicts: [],
  advice: [],
  observationCursors: [],
  wakeQueue: [],
  rotations: [],
  updatedAt,
});
