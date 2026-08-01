import type {
  ActorIdentity,
  ArtifactId,
  AssignmentId,
  AssignmentState,
  CommandId,
  ProjectId,
  ProjectTaskId,
  TaskProcessId,
  TaskProgressEntryId,
  TaskProgressKind,
  ThreadId,
} from "@synara/contracts";

export const progressKindForAssignmentState = (state: AssignmentState): TaskProgressKind =>
  state === "reported_complete"
    ? "completion_evidence"
    : state === "failed"
      ? "failure"
      : state === "blocked"
        ? "blocker"
        : state === "waiting_on_thread" ||
            state === "waiting_on_user" ||
            state === "needs_permission"
          ? "waiting"
          : "progress";

export const assignmentStatusProgressCommand = (input: {
  readonly commandId: CommandId;
  readonly processId: TaskProcessId;
  readonly projectId: ProjectId;
  readonly actor: ActorIdentity;
  readonly expectedRevision: number;
  readonly createdAt: string;
  readonly progressId: TaskProgressEntryId;
  readonly taskId: ProjectTaskId;
  readonly assignmentId: AssignmentId;
  readonly threadId: ThreadId | null;
  readonly state: AssignmentState;
  readonly summary: string;
  readonly evidenceRefs: ReadonlyArray<ArtifactId>;
}) => ({
  type: "project-task.progress.report" as const,
  commandId: input.commandId,
  processId: input.processId,
  projectId: input.projectId,
  actor: input.actor,
  expectedRevision: input.expectedRevision,
  createdAt: input.createdAt,
  progressId: input.progressId,
  taskId: input.taskId,
  assignmentId: input.assignmentId,
  threadId: input.threadId,
  kind: progressKindForAssignmentState(input.state),
  summary: input.summary,
  evidenceRefs: input.evidenceRefs,
});
