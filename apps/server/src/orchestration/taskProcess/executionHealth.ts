import type {
  AssignmentContract,
  OrchestratorMonitor,
  ProjectTask,
  ProjectTaskExecutionHealth,
  TaskProgressEntry,
  TaskThreadBinding,
  ThreadId,
} from "@synara/contracts";

export type BoundThreadRuntimeState =
  | "running"
  | "waiting"
  | "idle"
  | "crashed"
  | "retired"
  | "unknown";

export interface TaskExecutionHealthInput {
  readonly task: ProjectTask;
  readonly bindings: ReadonlyArray<TaskThreadBinding>;
  readonly progress: ReadonlyArray<TaskProgressEntry>;
  readonly assignments?: ReadonlyArray<AssignmentContract>;
  readonly runtimeByThread?: ReadonlyMap<ThreadId, BoundThreadRuntimeState>;
  readonly monitors?: ReadonlyArray<OrchestratorMonitor>;
  readonly now?: string;
  readonly staleAfterMs?: number;
}

const WAITING_ASSIGNMENT_STATES = new Set([
  "waiting_on_thread",
  "waiting_on_user",
  "needs_permission",
  "blocked",
  "reported_complete",
]);

export const deriveExecutionHealth = (
  input: TaskExecutionHealthInput,
): ProjectTaskExecutionHealth => {
  if (["done", "failed", "cancelled"].includes(input.task.lifecycle)) return "idle";
  const bindings = input.bindings.filter(
    (binding) => binding.taskId === input.task.id && binding.retiredAt === null,
  );
  if (bindings.length === 0) return "idle";

  const assignmentIds = new Set(
    bindings.flatMap((binding) => (binding.assignmentId === null ? [] : [binding.assignmentId])),
  );
  const assignments = (input.assignments ?? []).filter((assignment) =>
    assignmentIds.has(assignment.assignmentId),
  );
  const runtimeStates = bindings.map(
    (binding) => input.runtimeByThread?.get(binding.threadId) ?? "unknown",
  );
  if (runtimeStates.includes("running")) return "running";
  if (
    runtimeStates.includes("waiting") ||
    assignments.some((assignment) => WAITING_ASSIGNMENT_STATES.has(assignment.state))
  ) {
    return "waiting";
  }

  const latest = input.progress
    .filter((entry) => entry.taskId === input.task.id)
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (
    latest?.kind === "waiting" ||
    latest?.kind === "blocker" ||
    latest?.kind === "completion_evidence"
  ) {
    return "waiting";
  }
  if (latest?.kind === "failure") return "stalled";

  const heartbeatExpired = (input.monitors ?? []).some(
    (monitor) =>
      monitor.kind === "heartbeat" &&
      monitor.targetThreadId !== null &&
      bindings.some((binding) => binding.threadId === monitor.targetThreadId) &&
      (monitor.state === "expired" || (input.now !== undefined && monitor.expiresAt <= input.now)),
  );
  if (
    heartbeatExpired ||
    runtimeStates.some((state) => state === "crashed" || state === "retired")
  ) {
    return "stalled";
  }

  if (input.now !== undefined && input.staleAfterMs !== undefined && latest !== undefined) {
    const nowMs = Date.parse(input.now);
    const latestMs = Date.parse(latest.createdAt);
    if (
      Number.isFinite(nowMs) &&
      Number.isFinite(latestMs) &&
      nowMs - latestMs > input.staleAfterMs
    ) {
      return "stalled";
    }
  }

  if (
    assignments.some((assignment) => assignment.state === "running") ||
    input.task.lifecycle === "in_progress" ||
    input.task.lifecycle === "review"
  ) {
    return "running";
  }
  return "idle";
};
