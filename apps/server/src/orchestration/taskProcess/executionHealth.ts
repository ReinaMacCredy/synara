import type {
  ProjectTask,
  ProjectTaskExecutionHealth,
  TaskProgressEntry,
  TaskThreadBinding,
  ThreadId,
} from "@veylen/contracts";

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
  readonly runtimeByThread?: ReadonlyMap<ThreadId, BoundThreadRuntimeState>;
  readonly now?: string;
  readonly staleAfterMs?: number;
}

export const deriveExecutionHealth = (
  input: TaskExecutionHealthInput,
): ProjectTaskExecutionHealth => {
  if (["done", "failed", "cancelled"].includes(input.task.lifecycle)) return "idle";
  const bindings = input.bindings.filter(
    (binding) => binding.taskId === input.task.id && binding.retiredAt === null,
  );
  if (bindings.length === 0) return "idle";

  const runtimeStates = bindings.map(
    (binding) => input.runtimeByThread?.get(binding.threadId) ?? "unknown",
  );
  if (runtimeStates.includes("running")) return "running";
  if (runtimeStates.includes("waiting")) {
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

  if (runtimeStates.some((state) => state === "crashed" || state === "retired")) {
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

  if (input.task.lifecycle === "in_progress" || input.task.lifecycle === "review") {
    return "running";
  }
  return "idle";
};
