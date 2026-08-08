import { Schema } from "effect";

import {
  CommandId,
  EventId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ProviderItemId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";

const makeTaskProcessId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

const BoundedText = TrimmedNonEmptyString.check(Schema.isMaxLength(32_768));
const ShortText = TrimmedNonEmptyString.check(Schema.isMaxLength(512));
const AcceptanceCriteria = Schema.Array(
  TrimmedNonEmptyString.check(Schema.isMaxLength(2_048)),
).check(Schema.isMaxLength(128));
const EvidenceRefs = Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(128));

export const TaskProcessId = makeTaskProcessId("TaskProcessId");
export type TaskProcessId = typeof TaskProcessId.Type;
export const ProjectTaskId = makeTaskProcessId("ProjectTaskId");
export type ProjectTaskId = typeof ProjectTaskId.Type;
export const TaskDependencyEdgeId = makeTaskProcessId("TaskDependencyEdgeId");
export type TaskDependencyEdgeId = typeof TaskDependencyEdgeId.Type;
export const TaskThreadBindingId = makeTaskProcessId("TaskThreadBindingId");
export type TaskThreadBindingId = typeof TaskThreadBindingId.Type;
export const TaskProgressEntryId = makeTaskProcessId("TaskProgressEntryId");
export type TaskProgressEntryId = typeof TaskProgressEntryId.Type;
export const TaskBlockerId = makeTaskProcessId("TaskBlockerId");
export type TaskBlockerId = typeof TaskBlockerId.Type;

export const ActorIdentity = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("user"), actorId: TrimmedNonEmptyString }),
  Schema.Struct({ kind: Schema.Literal("thread"), threadId: ThreadId }),
  Schema.Struct({ kind: Schema.Literal("server"), actorId: TrimmedNonEmptyString }),
  Schema.Struct({ kind: Schema.Literal("provider"), actorId: TrimmedNonEmptyString }),
]);
export type ActorIdentity = typeof ActorIdentity.Type;

export const TaskProcessOwner = Schema.Struct({ kind: Schema.Literal("user") });
export type TaskProcessOwner = typeof TaskProcessOwner.Type;

export const TaskProcessState = Schema.Literals(["active", "paused", "completed", "archived"]);
export type TaskProcessState = typeof TaskProcessState.Type;
export const ProjectTaskLifecycle = Schema.Literals([
  "planned",
  "in_progress",
  "review",
  "done",
  "paused",
  "failed",
  "cancelled",
]);
export type ProjectTaskLifecycle = typeof ProjectTaskLifecycle.Type;
export const ProjectTaskPriority = Schema.Literals(["low", "normal", "high", "critical"]);
export type ProjectTaskPriority = typeof ProjectTaskPriority.Type;
export const ProjectTaskRisk = Schema.Literals(["low", "medium", "high"]);
export type ProjectTaskRisk = typeof ProjectTaskRisk.Type;
export const ProjectTaskReadiness = Schema.Literals(["ready", "blocked"]);
export type ProjectTaskReadiness = typeof ProjectTaskReadiness.Type;
export const ProjectTaskExecutionHealth = Schema.Literals([
  "idle",
  "running",
  "waiting",
  "stalled",
]);
export type ProjectTaskExecutionHealth = typeof ProjectTaskExecutionHealth.Type;

export const TaskProcess = Schema.Struct({
  id: TaskProcessId,
  projectId: ProjectId,
  title: ShortText,
  owner: TaskProcessOwner,
  state: TaskProcessState,
  revision: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TaskProcess = typeof TaskProcess.Type;

export const TaskProcessSummary = Schema.Struct({
  id: TaskProcessId,
  projectId: ProjectId,
  title: ShortText,
  owner: TaskProcessOwner,
  state: TaskProcessState,
  revision: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type TaskProcessSummary = typeof TaskProcessSummary.Type;

export const ProjectTask = Schema.Struct({
  id: ProjectTaskId,
  processId: TaskProcessId,
  parentTaskId: Schema.NullOr(ProjectTaskId),
  title: ShortText,
  description: Schema.NullOr(BoundedText),
  acceptanceCriteria: AcceptanceCriteria,
  priority: ProjectTaskPriority,
  risk: ProjectTaskRisk,
  lifecycle: ProjectTaskLifecycle,
  orderKey: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  createdBy: ActorIdentity,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectTask = typeof ProjectTask.Type;

export const TaskDependencyEdge = Schema.Struct({
  id: TaskDependencyEdgeId,
  processId: TaskProcessId,
  dependentTaskId: ProjectTaskId,
  prerequisiteTaskId: ProjectTaskId,
  state: Schema.Literals(["active", "waived"]),
  createdBy: ActorIdentity,
  createdAt: IsoDateTime,
  waivedBy: Schema.NullOr(ActorIdentity),
  waivedAt: Schema.NullOr(IsoDateTime),
  waiverReason: Schema.NullOr(ShortText),
});
export type TaskDependencyEdge = typeof TaskDependencyEdge.Type;

export const TaskThreadRole = Schema.Literals([
  "owner",
  "contributor",
  "reviewer",
  "verifier",
  "observer",
]);
export type TaskThreadRole = typeof TaskThreadRole.Type;

export const TaskThreadBinding = Schema.Struct({
  id: TaskThreadBindingId,
  taskId: ProjectTaskId,
  threadId: ThreadId,
  assignmentId: Schema.NullOr(TrimmedNonEmptyString),
  role: TaskThreadRole,
  activeFrom: IsoDateTime,
  retiredAt: Schema.NullOr(IsoDateTime),
});
export type TaskThreadBinding = typeof TaskThreadBinding.Type;

export const TaskProgressKind = Schema.Literals([
  "progress",
  "waiting",
  "blocker",
  "failure",
  "completion_evidence",
]);
export type TaskProgressKind = typeof TaskProgressKind.Type;

export const TaskProgressEntry = Schema.Struct({
  id: TaskProgressEntryId,
  taskId: ProjectTaskId,
  assignmentId: Schema.NullOr(TrimmedNonEmptyString),
  threadId: Schema.NullOr(ThreadId),
  actor: ActorIdentity,
  kind: TaskProgressKind,
  summary: BoundedText,
  evidenceRefs: EvidenceRefs,
  createdAt: IsoDateTime,
});
export type TaskProgressEntry = typeof TaskProgressEntry.Type;

export const TaskBlocker = Schema.Struct({
  id: TaskBlockerId,
  taskId: ProjectTaskId,
  kind: Schema.Literals(["external", "user_input", "permission", "resource", "writer_claim"]),
  summary: BoundedText,
  createdBy: ActorIdentity,
  createdAt: IsoDateTime,
  resolvedBy: Schema.NullOr(ActorIdentity),
  resolvedAt: Schema.NullOr(IsoDateTime),
  resolution: Schema.NullOr(BoundedText),
});
export type TaskBlocker = typeof TaskBlocker.Type;

export const ProjectTaskProjection = Schema.Struct({
  task: ProjectTask,
  readiness: ProjectTaskReadiness,
  executionHealth: ProjectTaskExecutionHealth,
  unmetDependencyIds: Schema.Array(TaskDependencyEdgeId),
  blockerIds: Schema.Array(TaskBlockerId),
  bindingIds: Schema.Array(TaskThreadBindingId),
  evidenceState: Schema.Literals(["current", "potentially_stale"]),
});
export type ProjectTaskProjection = typeof ProjectTaskProjection.Type;

export const TaskGraphMutationResult = Schema.Struct({
  graphRevision: NonNegativeInt,
  affectedTasks: Schema.Array(ProjectTaskId),
  newlyReadyTasks: Schema.Array(ProjectTaskId),
  newlyBlockedTasks: Schema.Array(ProjectTaskId),
});
export type TaskGraphMutationResult = typeof TaskGraphMutationResult.Type;

export const TaskGraphConflict = Schema.Struct({
  code: Schema.Literal("task_process.revision_conflict"),
  processId: TaskProcessId,
  expectedRevision: NonNegativeInt,
  currentRevision: NonNegativeInt,
});
export type TaskGraphConflict = typeof TaskGraphConflict.Type;

export const TaskGraphValidationError = Schema.Struct({
  code: Schema.Literals([
    "self_dependency",
    "duplicate_dependency",
    "cycle",
    "cross_process",
    "cross_project",
    "missing_task",
    "illegal_transition",
    "owner_binding_conflict",
    "missing_evidence",
  ]),
  processId: TaskProcessId,
  taskId: Schema.optional(ProjectTaskId),
  dependencyTaskId: Schema.optional(ProjectTaskId),
  reason: ShortText,
});
export type TaskGraphValidationError = typeof TaskGraphValidationError.Type;

export const TaskProcessCounts = Schema.Struct({
  total: NonNegativeInt,
  done: NonNegativeInt,
  ready: NonNegativeInt,
  blocked: NonNegativeInt,
  running: NonNegativeInt,
  review: NonNegativeInt,
  failed: NonNegativeInt,
});
export type TaskProcessCounts = typeof TaskProcessCounts.Type;

export const TaskProcessSummaryProjection = Schema.Struct({
  process: TaskProcessSummary,
  counts: TaskProcessCounts,
  graphRevision: NonNegativeInt,
  highWaterCursor: TrimmedNonEmptyString,
});
export type TaskProcessSummaryProjection = typeof TaskProcessSummaryProjection.Type;

export const TaskThreadBindingProjection = Schema.Struct({
  binding: TaskThreadBinding,
  taskLifecycle: ProjectTaskLifecycle,
  executionHealth: ProjectTaskExecutionHealth,
});
export type TaskThreadBindingProjection = typeof TaskThreadBindingProjection.Type;

export const TaskProcessGraphProjection = Schema.Struct({
  process: TaskProcess,
  tasks: Schema.Array(ProjectTaskProjection),
  dependencies: Schema.Array(TaskDependencyEdge),
  bindings: Schema.Array(TaskThreadBindingProjection),
  blockers: Schema.Array(TaskBlocker),
  graphRevision: NonNegativeInt,
  highWaterCursor: TrimmedNonEmptyString,
});
export type TaskProcessGraphProjection = typeof TaskProcessGraphProjection.Type;

export const BoundThreadSummary = Schema.Struct({
  threadId: ThreadId,
  taskId: ProjectTaskId,
  role: TaskThreadRole,
  executionHealth: ProjectTaskExecutionHealth,
  provider: Schema.NullOr(TrimmedNonEmptyString),
  model: Schema.NullOr(TrimmedNonEmptyString),
  lastActivityAt: Schema.NullOr(IsoDateTime),
});
export type BoundThreadSummary = typeof BoundThreadSummary.Type;

export const SessionProgressItem = Schema.Struct({
  task: ProjectTaskProjection,
  depth: NonNegativeInt,
  blockedByTitles: Schema.Array(ShortText),
});
export type SessionProgressItem = typeof SessionProgressItem.Type;

export const SessionProgressProjection = Schema.Struct({
  threadId: ThreadId,
  processId: TaskProcessId,
  primaryTask: Schema.NullOr(ProjectTaskProjection),
  visibleTasks: Schema.Array(SessionProgressItem).check(Schema.isMaxLength(64)),
  boundThreads: Schema.Array(BoundThreadSummary).check(Schema.isMaxLength(64)),
  completedCount: NonNegativeInt,
  totalCount: NonNegativeInt,
  latestProgress: Schema.Array(TaskProgressEntry).check(Schema.isMaxLength(50)),
  graphRevision: NonNegativeInt,
  cursor: TrimmedNonEmptyString,
  hasMore: Schema.Boolean,
  projectionBehind: Schema.optional(Schema.Boolean),
});
export type SessionProgressProjection = typeof SessionProgressProjection.Type;

const TaskProcessCommandBase = {
  commandId: CommandId,
  processId: TaskProcessId,
  projectId: ProjectId,
  actor: ActorIdentity,
  expectedRevision: NonNegativeInt,
  createdAt: IsoDateTime,
} as const;

export const TaskProcessCreateCommand = Schema.Struct({
  ...TaskProcessCommandBase,
  type: Schema.Literal("task-process.create"),
  title: ShortText,
  owner: TaskProcessOwner,
});
export const TaskProcessPauseCommand = Schema.Struct({
  ...TaskProcessCommandBase,
  type: Schema.Literal("task-process.pause"),
  reason: Schema.NullOr(ShortText),
});
export const TaskProcessResumeCommand = Schema.Struct({
  ...TaskProcessCommandBase,
  type: Schema.Literal("task-process.resume"),
});
export const TaskProcessCompleteCommand = Schema.Struct({
  ...TaskProcessCommandBase,
  type: Schema.Literal("task-process.complete"),
});
export const TaskProcessArchiveCommand = Schema.Struct({
  ...TaskProcessCommandBase,
  type: Schema.Literal("task-process.archive"),
});
export const ProjectTaskCreateCommand = Schema.Struct({
  ...TaskProcessCommandBase,
  type: Schema.Literal("project-task.create"),
  taskId: ProjectTaskId,
  parentTaskId: Schema.NullOr(ProjectTaskId),
  title: ShortText,
  description: Schema.NullOr(BoundedText),
  acceptanceCriteria: AcceptanceCriteria,
  priority: ProjectTaskPriority,
  risk: ProjectTaskRisk,
  orderKey: TrimmedNonEmptyString,
});
export const ProjectTaskMetaUpdateCommand = Schema.Struct({
  ...TaskProcessCommandBase,
  type: Schema.Literal("project-task.meta.update"),
  taskId: ProjectTaskId,
  parentTaskId: Schema.optional(Schema.NullOr(ProjectTaskId)),
  title: Schema.optional(ShortText),
  description: Schema.optional(Schema.NullOr(BoundedText)),
  acceptanceCriteria: Schema.optional(AcceptanceCriteria),
  priority: Schema.optional(ProjectTaskPriority),
  risk: Schema.optional(ProjectTaskRisk),
});
export const ProjectTaskReorderCommand = Schema.Struct({
  ...TaskProcessCommandBase,
  type: Schema.Literal("project-task.reorder"),
  taskId: ProjectTaskId,
  orderKey: TrimmedNonEmptyString,
});
export const ProjectTaskDependenciesSetCommand = Schema.Struct({
  ...TaskProcessCommandBase,
  type: Schema.Literal("project-task.dependencies.set"),
  taskId: ProjectTaskId,
  prerequisiteTaskIds: Schema.Array(ProjectTaskId).check(Schema.isMaxLength(256)),
});
export const ProjectTaskDependencyWaiveCommand = Schema.Struct({
  ...TaskProcessCommandBase,
  type: Schema.Literal("project-task.dependency.waive"),
  edgeId: TaskDependencyEdgeId,
  reason: ShortText,
});
export const ProjectTaskThreadBindCommand = Schema.Struct({
  ...TaskProcessCommandBase,
  type: Schema.Literal("project-task.thread.bind"),
  bindingId: TaskThreadBindingId,
  taskId: ProjectTaskId,
  threadId: ThreadId,
  assignmentId: Schema.NullOr(TrimmedNonEmptyString),
  role: TaskThreadRole,
});
export const ProjectTaskThreadUnbindCommand = Schema.Struct({
  ...TaskProcessCommandBase,
  type: Schema.Literal("project-task.thread.unbind"),
  bindingId: TaskThreadBindingId,
  taskId: ProjectTaskId,
});
export const ProjectTaskProgressReportCommand = Schema.Struct({
  ...TaskProcessCommandBase,
  type: Schema.Literal("project-task.progress.report"),
  progressId: TaskProgressEntryId,
  taskId: ProjectTaskId,
  assignmentId: Schema.NullOr(TrimmedNonEmptyString),
  threadId: Schema.NullOr(ThreadId),
  kind: TaskProgressKind,
  summary: BoundedText,
  evidenceRefs: EvidenceRefs,
});
export const ProjectTaskBlockerResolveCommand = Schema.Struct({
  ...TaskProcessCommandBase,
  type: Schema.Literal("project-task.blocker.resolve"),
  taskId: ProjectTaskId,
  blockerId: TaskBlockerId,
  resolution: BoundedText,
});
export const ProjectTaskTransitionCommand = Schema.Struct({
  ...TaskProcessCommandBase,
  type: Schema.Literal("project-task.transition"),
  taskId: ProjectTaskId,
  lifecycle: ProjectTaskLifecycle,
  reason: Schema.NullOr(BoundedText),
});
export const ProjectTaskCompleteCommand = Schema.Struct({
  ...TaskProcessCommandBase,
  type: Schema.Literal("project-task.complete"),
  taskId: ProjectTaskId,
  assignmentIds: Schema.Array(TrimmedNonEmptyString),
  evidenceRefs: EvidenceRefs,
});
export const ProjectTaskReopenCommand = Schema.Struct({
  ...TaskProcessCommandBase,
  type: Schema.Literal("project-task.reopen"),
  taskId: ProjectTaskId,
  reason: BoundedText,
});

export const TaskProcessCommand = Schema.Union([
  TaskProcessCreateCommand,
  TaskProcessPauseCommand,
  TaskProcessResumeCommand,
  TaskProcessCompleteCommand,
  TaskProcessArchiveCommand,
  ProjectTaskCreateCommand,
  ProjectTaskMetaUpdateCommand,
  ProjectTaskReorderCommand,
  ProjectTaskDependenciesSetCommand,
  ProjectTaskDependencyWaiveCommand,
  ProjectTaskThreadBindCommand,
  ProjectTaskThreadUnbindCommand,
  ProjectTaskProgressReportCommand,
  ProjectTaskBlockerResolveCommand,
  ProjectTaskTransitionCommand,
  ProjectTaskCompleteCommand,
  ProjectTaskReopenCommand,
]);
export type TaskProcessCommand = typeof TaskProcessCommand.Type;

export const TaskProcessEventType = Schema.Literals([
  "task-process.created",
  "task-process.paused",
  "task-process.resumed",
  "task-process.completed",
  "task-process.archived",
  "project-task.created",
  "project-task.meta-updated",
  "project-task.reordered",
  "project-task.dependencies-set",
  "project-task.dependency-waived",
  "project-task.thread-bound",
  "project-task.thread-unbound",
  "project-task.progress-reported",
  "project-task.blocker-resolved",
  "project-task.transitioned",
  "project-task.completed",
  "project-task.reopened",
  "project-task.dependency-invalidated",
]);
export type TaskProcessEventType = typeof TaskProcessEventType.Type;

export const TaskProcessEventPayload = Schema.Struct({
  processId: TaskProcessId,
  projectId: ProjectId,
  actor: ActorIdentity,
  acceptedRevision: NonNegativeInt,
  mutation: TaskGraphMutationResult,
  task: Schema.optional(ProjectTask),
  dependency: Schema.optional(TaskDependencyEdge),
  binding: Schema.optional(TaskThreadBinding),
  progress: Schema.optional(TaskProgressEntry),
  blocker: Schema.optional(TaskBlocker),
  process: Schema.optional(TaskProcess),
  reason: Schema.optional(Schema.NullOr(BoundedText)),
});
export type TaskProcessEventPayload = typeof TaskProcessEventPayload.Type;

export const TaskProcessDomainEvent = Schema.Struct({
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: Schema.Literal("task_process"),
  aggregateId: TaskProcessId,
  type: TaskProcessEventType,
  payload: TaskProcessEventPayload,
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: Schema.Struct({
    providerTurnId: Schema.optional(TrimmedNonEmptyString),
    providerItemId: Schema.optional(ProviderItemId),
    adapterKey: Schema.optional(TrimmedNonEmptyString),
    ingestedAt: Schema.optional(IsoDateTime),
  }),
});
export type TaskProcessDomainEvent = typeof TaskProcessDomainEvent.Type;

export const ListTaskProcessesInput = Schema.Struct({
  projectId: ProjectId,
  cursor: Schema.optional(TrimmedNonEmptyString),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(100))),
  includeArchived: Schema.optional(Schema.Boolean),
});
export type ListTaskProcessesInput = typeof ListTaskProcessesInput.Type;
export const ListTaskProcessesResult = Schema.Struct({
  items: Schema.Array(TaskProcessSummary).check(Schema.isMaxLength(100)),
  nextCursor: Schema.NullOr(TrimmedNonEmptyString),
  highWaterCursor: TrimmedNonEmptyString,
});
export type ListTaskProcessesResult = typeof ListTaskProcessesResult.Type;

export const GetTaskProcessInput = Schema.Struct({ processId: TaskProcessId });
export type GetTaskProcessInput = typeof GetTaskProcessInput.Type;
export const GetTaskProcessSummaryResult = Schema.Struct({
  summary: TaskProcessSummaryProjection,
  projectionBehind: Schema.Boolean,
});
export type GetTaskProcessSummaryResult = typeof GetTaskProcessSummaryResult.Type;
export const GetTaskProcessGraphResult = Schema.Struct({
  graph: TaskProcessGraphProjection,
  projectionBehind: Schema.Boolean,
});
export type GetTaskProcessGraphResult = typeof GetTaskProcessGraphResult.Type;

export const GetSessionProgressInput = Schema.Struct({
  threadId: ThreadId,
  processId: Schema.optional(TaskProcessId),
  cursor: Schema.optional(TrimmedNonEmptyString),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(64))),
});
export type GetSessionProgressInput = typeof GetSessionProgressInput.Type;
export const GetSessionProgressResult = Schema.Struct({
  progress: Schema.NullOr(SessionProgressProjection),
  projectionBehind: Schema.Boolean,
});
export type GetSessionProgressResult = typeof GetSessionProgressResult.Type;

export const DispatchTaskProcessCommandInput = Schema.Struct({ command: TaskProcessCommand });
export type DispatchTaskProcessCommandInput = typeof DispatchTaskProcessCommandInput.Type;
export const DispatchTaskProcessCommandResult = Schema.Struct({
  sequence: NonNegativeInt,
  mutation: TaskGraphMutationResult,
});
export type DispatchTaskProcessCommandResult = typeof DispatchTaskProcessCommandResult.Type;
