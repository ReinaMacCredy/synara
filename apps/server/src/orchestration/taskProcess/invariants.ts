import type {
  ProjectTaskId,
  ProjectTaskLifecycle,
  TaskThreadBinding,
  ThreadId,
} from "@veylen/contracts";

import type { TaskProcessAggregateState } from "./projector.ts";

const LIFECYCLE_TRANSITIONS: Readonly<
  Record<ProjectTaskLifecycle, ReadonlySet<ProjectTaskLifecycle>>
> = {
  planned: new Set(["in_progress", "paused", "cancelled"]),
  in_progress: new Set(["review", "paused", "failed", "cancelled"]),
  review: new Set(["in_progress", "paused", "failed", "cancelled"]),
  paused: new Set(["planned", "in_progress", "cancelled"]),
  done: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

export const canTransitionTaskLifecycle = (
  from: ProjectTaskLifecycle,
  to: ProjectTaskLifecycle,
): boolean => from === to || LIFECYCLE_TRANSITIONS[from].has(to);

export const activeOwnerBindingForThread = (
  state: TaskProcessAggregateState,
  threadId: ThreadId,
): TaskThreadBinding | null =>
  state.bindings.find(
    (binding) =>
      binding.threadId === threadId && binding.role === "owner" && binding.retiredAt === null,
  ) ?? null;

export const wouldCreateTaskHierarchyCycle = (input: {
  readonly state: TaskProcessAggregateState;
  readonly taskId: ProjectTaskId;
  readonly parentTaskId: ProjectTaskId | null;
}): boolean => {
  if (input.parentTaskId === null) return false;
  if (input.parentTaskId === input.taskId) return true;
  const taskById = new Map(
    input.state.tasks.map((projection) => [projection.task.id, projection.task]),
  );
  let cursor: ProjectTaskId | null = input.parentTaskId;
  const visited = new Set<ProjectTaskId>();
  while (cursor !== null && !visited.has(cursor)) {
    if (cursor === input.taskId) return true;
    visited.add(cursor);
    cursor = taskById.get(cursor)?.parentTaskId ?? null;
  }
  return false;
};
