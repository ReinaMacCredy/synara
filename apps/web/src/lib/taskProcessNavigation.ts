import type { TaskProcessId, TaskProcessOwner, ThreadId } from "@synara/contracts";

export type TaskProcessNavigationTarget =
  | { readonly mode: "project"; readonly processId: TaskProcessId }
  | {
      readonly mode: "orchestrator";
      readonly rootThreadId: ThreadId;
      readonly processId: TaskProcessId;
    };

export function resolveTaskProcessNavigationTarget(
  processId: TaskProcessId,
  owner: TaskProcessOwner,
): TaskProcessNavigationTarget {
  return owner.kind === "orchestrator"
    ? { mode: "orchestrator", rootThreadId: owner.rootThreadId, processId }
    : { mode: "project", processId };
}
