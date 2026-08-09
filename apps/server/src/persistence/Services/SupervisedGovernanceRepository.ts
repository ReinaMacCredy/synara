import type {
  ModelCapabilityProfile,
  ModelSelectionReceipt,
  ModelTelemetryAggregate,
  SupervisorNotebookCompactionReceipt,
  SupervisorNotebookCursor,
  SupervisorNotebookEntry,
  SupervisedGovernanceSnapshot,
  SupervisedOrchestrationSnapshot,
  UserModelPreferenceProfile,
} from "@synara/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export interface PersistedModelRoutingState {
  readonly revision: number;
  readonly modelCapabilityProfiles: readonly ModelCapabilityProfile[];
  readonly userModelPreferenceProfiles: readonly UserModelPreferenceProfile[];
  readonly modelTelemetryAggregates: readonly ModelTelemetryAggregate[];
}

export interface PersistedSupervisorNotebookState {
  readonly entries: readonly SupervisorNotebookEntry[];
  readonly compactionReceipts: readonly SupervisorNotebookCompactionReceipt[];
  readonly cursor: SupervisorNotebookCursor | null;
}

export interface SupervisedGovernanceRepositoryShape {
  readonly getSnapshot: () => Effect.Effect<
    SupervisedGovernanceSnapshot,
    ProjectionRepositoryError
  >;
  readonly getModelRoutingState: () => Effect.Effect<
    PersistedModelRoutingState,
    ProjectionRepositoryError
  >;
  readonly replaceSnapshot: (
    snapshot: SupervisedGovernanceSnapshot,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly replaceOrchestration: (input: {
    readonly expectedRevision: number;
    readonly orchestration: SupervisedOrchestrationSnapshot;
    readonly updatedAt: string;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getNotebookState: (input: {
    readonly workspaceId: string;
    readonly seatId: string;
    readonly limit: number;
  }) => Effect.Effect<PersistedSupervisorNotebookState, ProjectionRepositoryError>;
  readonly appendNotebookEntry: (
    entry: SupervisorNotebookEntry,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;
  readonly appendNotebookCompaction: (input: {
    readonly summaryEntry: SupervisorNotebookEntry;
    readonly receipt: SupervisorNotebookCompactionReceipt;
  }) => Effect.Effect<boolean, ProjectionRepositoryError>;
  readonly putNotebookCursor: (
    cursor: SupervisorNotebookCursor,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly putModelCapabilityProfile: (input: {
    readonly profile: ModelCapabilityProfile;
    readonly expectedRevision: number;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly putUserModelPreferenceProfile: (input: {
    readonly profile: UserModelPreferenceProfile;
    readonly expectedRevision: number;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly appendModelSelectionReceipt: (input: {
    readonly receipt: ModelSelectionReceipt;
    readonly expectedRevision: number;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly putModelTelemetryAggregate: (input: {
    readonly aggregate: ModelTelemetryAggregate;
    readonly expectedRevision: number;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class SupervisedGovernanceRepository extends ServiceMap.Service<
  SupervisedGovernanceRepository,
  SupervisedGovernanceRepositoryShape
>()("synara/persistence/Services/SupervisedGovernanceRepository/SupervisedGovernanceRepository") {}
