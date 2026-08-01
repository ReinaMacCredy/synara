import {
  AssignmentContract,
  OrchestratorCapacitySnapshot,
  OrchestratorCommunicationLink,
  OrchestratorMessageEnvelope,
  OrchestratorMonitor,
  OrchestratorMessageId,
  OrchestratorOwnershipEdge,
  OrchestratorProviderCapability,
  OrchestratorRoot,
  OrchestratorRun,
  OrchestratorWriterClaim,
  ProjectId,
  TaskProcessId,
  ThreadId,
} from "@synara/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionOrchestratorRootRecord = Schema.Struct({
  root: OrchestratorRoot,
  highWaterCursor: Schema.String,
});
export type ProjectionOrchestratorRootRecord = typeof ProjectionOrchestratorRootRecord.Type;

export const ProjectionAssignmentRecord = Schema.Struct({
  rootThreadId: ThreadId,
  processId: TaskProcessId,
  contract: AssignmentContract,
});
export type ProjectionAssignmentRecord = typeof ProjectionAssignmentRecord.Type;

export const ProjectionOrchestratorCore = Schema.Struct({
  root: ProjectionOrchestratorRootRecord,
  ownershipEdges: Schema.Array(OrchestratorOwnershipEdge),
  communicationLinks: Schema.Array(OrchestratorCommunicationLink),
  assignments: Schema.Array(AssignmentContract),
  runs: Schema.Array(OrchestratorRun),
  providerCapabilities: Schema.Array(OrchestratorProviderCapability),
  capacity: Schema.NullOr(OrchestratorCapacitySnapshot),
});
export type ProjectionOrchestratorCore = typeof ProjectionOrchestratorCore.Type;

export interface ProjectionOrchestratorRepositoryShape {
  readonly upsertRoot: (
    row: ProjectionOrchestratorRootRecord,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getRoot: (
    rootThreadId: ThreadId,
  ) => Effect.Effect<Option.Option<ProjectionOrchestratorRootRecord>, ProjectionRepositoryError>;
  readonly listRoots: () => Effect.Effect<
    ReadonlyArray<ProjectionOrchestratorRootRecord>,
    ProjectionRepositoryError
  >;
  readonly listRootPage: (input: {
    readonly projectId?: ProjectId;
    readonly includeArchived: boolean;
    readonly beforeCreatedAt?: string;
    readonly afterRootThreadIdAtTimestamp?: ThreadId;
    readonly limit: number;
  }) => Effect.Effect<ReadonlyArray<ProjectionOrchestratorRootRecord>, ProjectionRepositoryError>;
  readonly findRootForThread: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<ThreadId>, ProjectionRepositoryError>;
  readonly upsertOwnershipEdge: (
    edge: typeof OrchestratorOwnershipEdge.Type,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly retireActiveOwnershipForChild: (input: {
    readonly rootThreadId: ThreadId;
    readonly childThreadId: ThreadId;
    readonly retiredAt: string;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertCommunicationLink: (
    link: typeof OrchestratorCommunicationLink.Type,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertAssignmentVersion: (
    row: ProjectionAssignmentRecord,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertRun: (
    run: typeof OrchestratorRun.Type,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertMessage: (
    message: typeof OrchestratorMessageEnvelope.Type,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertMonitor: (
    monitor: typeof OrchestratorMonitor.Type,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertWriterClaim: (
    claim: typeof OrchestratorWriterClaim.Type,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertProviderCapability: (
    capability: typeof OrchestratorProviderCapability.Type,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertCapacity: (input: {
    readonly rootThreadId: ThreadId;
    readonly capacity: typeof OrchestratorCapacitySnapshot.Type;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getCore: (
    rootThreadId: ThreadId,
  ) => Effect.Effect<Option.Option<ProjectionOrchestratorCore>, ProjectionRepositoryError>;
  readonly listMessages: (
    rootThreadId: ThreadId,
  ) => Effect.Effect<
    ReadonlyArray<typeof OrchestratorMessageEnvelope.Type>,
    ProjectionRepositoryError
  >;
  readonly listMessagePage: (input: {
    readonly rootThreadId: ThreadId;
    readonly beforeCreatedAt?: string;
    readonly afterMessageIdAtTimestamp?: OrchestratorMessageId;
    readonly limit: number;
  }) => Effect.Effect<
    ReadonlyArray<typeof OrchestratorMessageEnvelope.Type>,
    ProjectionRepositoryError
  >;
  readonly listMailboxMessages: (input: {
    readonly rootThreadId: ThreadId;
    readonly limit: number;
  }) => Effect.Effect<
    ReadonlyArray<typeof OrchestratorMessageEnvelope.Type>,
    ProjectionRepositoryError
  >;
  readonly listMonitors: (input: {
    readonly rootThreadId: ThreadId;
    readonly limit: number;
  }) => Effect.Effect<ReadonlyArray<typeof OrchestratorMonitor.Type>, ProjectionRepositoryError>;
  readonly listActiveWriterClaims: (input: {
    readonly rootThreadId: ThreadId;
    readonly at: string;
    readonly limit: number;
  }) => Effect.Effect<
    ReadonlyArray<typeof OrchestratorWriterClaim.Type>,
    ProjectionRepositoryError
  >;
}

export class ProjectionOrchestratorRepository extends ServiceMap.Service<
  ProjectionOrchestratorRepository,
  ProjectionOrchestratorRepositoryShape
>()("synara/persistence/Services/ProjectionOrchestrator/ProjectionOrchestratorRepository") {}
