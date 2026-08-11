import type {
  ProjectTask,
  ProjectTaskId,
  TaskDependencyEdge,
  TaskProcessId,
} from "@veylen/contracts";

export interface DependencyValidationIssue {
  readonly code:
    | "self_dependency"
    | "duplicate_dependency"
    | "cycle"
    | "missing_task"
    | "cross_process";
  readonly taskId: ProjectTaskId;
  readonly dependencyTaskId?: ProjectTaskId;
  readonly reason: string;
}

export const activeDependencyEdges = (
  dependencies: ReadonlyArray<TaskDependencyEdge>,
): ReadonlyArray<TaskDependencyEdge> => dependencies.filter((edge) => edge.state === "active");

export const dependencyDescendants = (input: {
  readonly sourceTaskId: ProjectTaskId;
  readonly dependencies: ReadonlyArray<TaskDependencyEdge>;
}): ReadonlyArray<ProjectTaskId> => {
  const discovered = new Set<ProjectTaskId>();
  const queue: ProjectTaskId[] = [input.sourceTaskId];
  while (queue.length > 0) {
    const prerequisite = queue.shift()!;
    for (const edge of activeDependencyEdges(input.dependencies)) {
      if (edge.prerequisiteTaskId !== prerequisite || discovered.has(edge.dependentTaskId))
        continue;
      discovered.add(edge.dependentTaskId);
      queue.push(edge.dependentTaskId);
    }
  }
  return [...discovered];
};

export const graphHasCycle = (input: {
  readonly tasks: ReadonlyArray<ProjectTask>;
  readonly dependencies: ReadonlyArray<TaskDependencyEdge>;
}): boolean => {
  const outgoing = new Map<ProjectTaskId, ProjectTaskId[]>();
  for (const edge of activeDependencyEdges(input.dependencies)) {
    const current = outgoing.get(edge.prerequisiteTaskId) ?? [];
    current.push(edge.dependentTaskId);
    outgoing.set(edge.prerequisiteTaskId, current);
  }
  const visiting = new Set<ProjectTaskId>();
  const visited = new Set<ProjectTaskId>();
  const visit = (taskId: ProjectTaskId): boolean => {
    if (visiting.has(taskId)) return true;
    if (visited.has(taskId)) return false;
    visiting.add(taskId);
    for (const dependent of outgoing.get(taskId) ?? []) {
      if (visit(dependent)) return true;
    }
    visiting.delete(taskId);
    visited.add(taskId);
    return false;
  };
  return input.tasks.some((task) => visit(task.id));
};

export const validateDependencySet = (input: {
  readonly processId: TaskProcessId;
  readonly taskId: ProjectTaskId;
  readonly prerequisiteTaskIds: ReadonlyArray<ProjectTaskId>;
  readonly tasks: ReadonlyArray<ProjectTask>;
  readonly existingDependencies: ReadonlyArray<TaskDependencyEdge>;
}): DependencyValidationIssue | null => {
  const taskById = new Map(input.tasks.map((task) => [task.id, task] as const));
  if (!taskById.has(input.taskId)) {
    return { code: "missing_task", taskId: input.taskId, reason: "Dependent task does not exist." };
  }
  const seen = new Set<ProjectTaskId>();
  for (const prerequisiteTaskId of input.prerequisiteTaskIds) {
    if (prerequisiteTaskId === input.taskId) {
      return {
        code: "self_dependency",
        taskId: input.taskId,
        dependencyTaskId: prerequisiteTaskId,
        reason: "A task cannot depend on itself.",
      };
    }
    if (seen.has(prerequisiteTaskId)) {
      return {
        code: "duplicate_dependency",
        taskId: input.taskId,
        dependencyTaskId: prerequisiteTaskId,
        reason: "A dependency may appear only once in the replacement set.",
      };
    }
    seen.add(prerequisiteTaskId);
    const prerequisite = taskById.get(prerequisiteTaskId);
    if (!prerequisite) {
      return {
        code: "missing_task",
        taskId: input.taskId,
        dependencyTaskId: prerequisiteTaskId,
        reason: "Prerequisite task does not exist.",
      };
    }
    if (prerequisite.processId !== input.processId) {
      return {
        code: "cross_process",
        taskId: input.taskId,
        dependencyTaskId: prerequisiteTaskId,
        reason: "Dependency endpoints must belong to the same process.",
      };
    }
  }

  const retained = input.existingDependencies.filter(
    (edge) => edge.dependentTaskId !== input.taskId && edge.state === "active",
  );
  const synthetic = input.prerequisiteTaskIds.map(
    (prerequisiteTaskId): TaskDependencyEdge => ({
      id: `validation:${input.taskId}:${prerequisiteTaskId}` as TaskDependencyEdge["id"],
      processId: input.processId,
      dependentTaskId: input.taskId,
      prerequisiteTaskId,
      state: "active",
      createdBy: { kind: "server", actorId: "dependency-validator" },
      createdAt: "1970-01-01T00:00:00.000Z",
      waivedBy: null,
      waivedAt: null,
      waiverReason: null,
    }),
  );
  return graphHasCycle({ tasks: input.tasks, dependencies: [...retained, ...synthetic] })
    ? {
        code: "cycle",
        taskId: input.taskId,
        reason: "Dependency replacement would create a cycle.",
      }
    : null;
};
