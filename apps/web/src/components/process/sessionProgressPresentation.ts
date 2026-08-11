import type {
  ProjectTaskId,
  SessionProgressProjection,
  TaskProgressEntry,
} from "@veylen/contracts";

export type SessionProgressActivityState =
  | "inactive"
  | "running"
  | "waiting"
  | "review"
  | "failed"
  | "completed";

export interface SessionProgressActivity {
  readonly state: SessionProgressActivityState;
  readonly title: string;
  readonly taskId: ProjectTaskId | null;
  readonly stepIndex: number;
  readonly totalCount: number;
  readonly completedCount: number;
  readonly startedAt: string | null;
  readonly summary: string | null;
}

function latestProgressForTask(
  projection: SessionProgressProjection,
  taskId: ProjectTaskId,
): TaskProgressEntry | null {
  let latest: TaskProgressEntry | null = null;
  for (const progress of projection.latestProgress) {
    if (progress.taskId !== taskId) continue;
    if (!latest || progress.createdAt > latest.createdAt) latest = progress;
  }
  return latest;
}

export function deriveSessionProgressActivity(
  projection: SessionProgressProjection,
): SessionProgressActivity {
  const allDone = projection.totalCount > 0 && projection.completedCount === projection.totalCount;
  const primaryId = projection.primaryTask?.task.id ?? null;
  const primaryItem =
    (primaryId
      ? projection.visibleTasks.find((item) => item.task.task.id === primaryId)
      : undefined) ??
    projection.visibleTasks.find((item) => item.task.executionHealth === "running") ??
    projection.visibleTasks.find((item) => item.task.task.lifecycle === "in_progress") ??
    projection.visibleTasks.find((item) => item.task.task.lifecycle === "failed") ??
    null;
  const task = primaryItem?.task ?? projection.primaryTask;
  const taskId = task?.task.id ?? null;
  const latestProgress = taskId ? latestProgressForTask(projection, taskId) : null;
  const stepIndex = taskId
    ? Math.max(1, projection.visibleTasks.findIndex((item) => item.task.task.id === taskId) + 1)
    : 0;
  const base = {
    title: task?.task.title ?? "Process activity",
    taskId,
    stepIndex,
    totalCount: projection.totalCount,
    completedCount: projection.completedCount,
    startedAt: latestProgress?.createdAt ?? task?.task.updatedAt ?? null,
    summary: latestProgress?.summary ?? null,
  };

  if (allDone) return { ...base, state: "completed" };
  if (task?.task.lifecycle === "failed" || latestProgress?.kind === "failure") {
    return { ...base, state: "failed" };
  }
  if (
    latestProgress?.kind === "blocker" ||
    (task?.blockerIds.length ?? 0) > 0 ||
    task?.readiness === "blocked"
  ) {
    return { ...base, state: "review" };
  }
  if (task?.executionHealth === "running") return { ...base, state: "running" };
  if (latestProgress?.kind === "waiting" || task?.task.lifecycle === "in_progress") {
    return { ...base, state: "waiting" };
  }
  return { ...base, state: "inactive" };
}

export function sessionProgressStateLabel(state: SessionProgressActivityState): string {
  switch (state) {
    case "running":
      return "Running";
    case "waiting":
      return "Waiting";
    case "review":
      return "Review required";
    case "failed":
      return "Failed";
    case "completed":
      return "Completed";
    case "inactive":
      return "Inactive";
  }
}
