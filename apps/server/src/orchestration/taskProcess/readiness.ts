import type {
  ProjectTask,
  ProjectTaskExecutionHealth,
  ProjectTaskId,
  ProjectTaskProjection,
  ProjectTaskReadiness,
  TaskBlocker,
  TaskDependencyEdge,
  TaskProgressEntry,
  TaskThreadBinding,
} from "@veylen/contracts";

import { deriveExecutionHealth } from "./executionHealth.ts";

export interface TaskDerivationInput {
  readonly task: ProjectTask;
  readonly tasks: ReadonlyArray<ProjectTask>;
  readonly dependencies: ReadonlyArray<TaskDependencyEdge>;
  readonly bindings: ReadonlyArray<TaskThreadBinding>;
  readonly progress: ReadonlyArray<TaskProgressEntry>;
  readonly blockers: ReadonlyArray<TaskBlocker>;
  readonly evidenceState?: ProjectTaskProjection["evidenceState"];
}

export const unmetDependenciesForTask = (
  input: Pick<TaskDerivationInput, "task" | "tasks" | "dependencies">,
): ReadonlyArray<TaskDependencyEdge> => {
  const taskById = new Map(input.tasks.map((task) => [task.id, task] as const));
  return input.dependencies.filter(
    (edge) =>
      edge.state === "active" &&
      edge.dependentTaskId === input.task.id &&
      taskById.get(edge.prerequisiteTaskId)?.lifecycle !== "done",
  );
};

export const deriveTaskReadiness = (input: TaskDerivationInput): ProjectTaskReadiness =>
  unmetDependenciesForTask(input).length > 0 ||
  input.blockers.some((blocker) => blocker.taskId === input.task.id && blocker.resolvedAt === null)
    ? "blocked"
    : "ready";

export const deriveTaskExecutionHealth = (input: TaskDerivationInput): ProjectTaskExecutionHealth =>
  deriveExecutionHealth({
    task: input.task,
    bindings: input.bindings,
    progress: input.progress,
  });

export const deriveProjectTaskProjection = (input: TaskDerivationInput): ProjectTaskProjection => ({
  task: input.task,
  readiness: deriveTaskReadiness(input),
  executionHealth: deriveTaskExecutionHealth(input),
  unmetDependencyIds: unmetDependenciesForTask(input).map((edge) => edge.id),
  blockerIds: input.blockers
    .filter((blocker) => blocker.taskId === input.task.id && blocker.resolvedAt === null)
    .map((blocker) => blocker.id),
  bindingIds: input.bindings
    .filter((binding) => binding.taskId === input.task.id && binding.retiredAt === null)
    .map((binding) => binding.id),
  evidenceState: input.evidenceState ?? "current",
});

export const deriveAllTaskProjections = (input: {
  readonly tasks: ReadonlyArray<ProjectTask>;
  readonly dependencies: ReadonlyArray<TaskDependencyEdge>;
  readonly bindings: ReadonlyArray<TaskThreadBinding>;
  readonly progress: ReadonlyArray<TaskProgressEntry>;
  readonly blockers: ReadonlyArray<TaskBlocker>;
  readonly evidenceStateByTask?: ReadonlyMap<ProjectTaskId, ProjectTaskProjection["evidenceState"]>;
}): ReadonlyArray<ProjectTaskProjection> =>
  input.tasks.map((task) => {
    const evidenceState = input.evidenceStateByTask?.get(task.id);
    return deriveProjectTaskProjection({
      ...input,
      task,
      ...(evidenceState ? { evidenceState } : {}),
    });
  });
