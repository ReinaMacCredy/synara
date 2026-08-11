import type { TaskProcessId, TaskProcessOwner } from "@veylen/contracts";

export type TaskProcessNavigationTarget = {
  readonly mode: "project";
  readonly processId: TaskProcessId;
};

export function resolveTaskProcessNavigationTarget(
  processId: TaskProcessId,
  owner: TaskProcessOwner,
): TaskProcessNavigationTarget {
  void owner;
  return { mode: "project", processId };
}
