import {
  ProjectId,
  ProjectTaskId,
  ProjectTaskProjection,
  NonNegativeInt,
  TaskBlocker,
  TaskDependencyEdge,
  TaskProcess,
  TaskProcessGraphProjection,
  TaskProcessId,
  TaskProgressEntry,
  TaskThreadBinding,
  ThreadId,
} from "@synara/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionTaskProcessRecord = Schema.Struct({
  process: TaskProcess,
  graphRevision: NonNegativeInt,
  highWaterCursor: Schema.String,
});
export type ProjectionTaskProcessRecord = typeof ProjectionTaskProcessRecord.Type;

export const ProcessScopedTask = Schema.Struct({
  processId: TaskProcessId,
  task: ProjectTaskProjection,
});
export type ProcessScopedTask = typeof ProcessScopedTask.Type;

export const ProcessScopedDependency = Schema.Struct({
  processId: TaskProcessId,
  dependency: TaskDependencyEdge,
});
export type ProcessScopedDependency = typeof ProcessScopedDependency.Type;

export const ProcessScopedBinding = Schema.Struct({
  processId: TaskProcessId,
  binding: TaskThreadBinding,
});
export type ProcessScopedBinding = typeof ProcessScopedBinding.Type;

export const ProcessScopedProgress = Schema.Struct({
  processId: TaskProcessId,
  progress: TaskProgressEntry,
});
export type ProcessScopedProgress = typeof ProcessScopedProgress.Type;

export const ProcessScopedBlocker = Schema.Struct({
  processId: TaskProcessId,
  blocker: TaskBlocker,
});
export type ProcessScopedBlocker = typeof ProcessScopedBlocker.Type;

export interface ProjectionTaskProcessRepositoryShape {
  readonly upsertProcess: (
    row: ProjectionTaskProcessRecord,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getProcess: (
    processId: TaskProcessId,
  ) => Effect.Effect<Option.Option<ProjectionTaskProcessRecord>, ProjectionRepositoryError>;
  readonly listProcesses: (
    projectId: ProjectId,
  ) => Effect.Effect<ReadonlyArray<ProjectionTaskProcessRecord>, ProjectionRepositoryError>;
  readonly listProcessPage: (input: {
    readonly projectId: ProjectId;
    readonly includeArchived: boolean;
    readonly beforeUpdatedAt?: string;
    readonly afterProcessIdAtTimestamp?: TaskProcessId;
    readonly limit: number;
  }) => Effect.Effect<ReadonlyArray<ProjectionTaskProcessRecord>, ProjectionRepositoryError>;
  readonly findActiveProcessForThread: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<TaskProcessId>, ProjectionRepositoryError>;
  readonly upsertTask: (row: ProcessScopedTask) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertDependency: (
    row: ProcessScopedDependency,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertBinding: (
    row: ProcessScopedBinding,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly appendProgress: (
    row: ProcessScopedProgress,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listProgress: (
    processId: TaskProcessId,
  ) => Effect.Effect<ReadonlyArray<typeof TaskProgressEntry.Type>, ProjectionRepositoryError>;
  readonly upsertBlocker: (
    row: ProcessScopedBlocker,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getGraph: (
    processId: TaskProcessId,
  ) => Effect.Effect<Option.Option<TaskProcessGraphProjection>, ProjectionRepositoryError>;
  readonly deleteTask: (input: {
    readonly processId: TaskProcessId;
    readonly taskId: ProjectTaskId;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionTaskProcessRepository extends ServiceMap.Service<
  ProjectionTaskProcessRepository,
  ProjectionTaskProcessRepositoryShape
>()("synara/persistence/Services/ProjectionTaskProcess/ProjectionTaskProcessRepository") {}
