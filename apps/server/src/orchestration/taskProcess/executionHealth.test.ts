import {
  ProjectTaskId,
  TaskProcessId,
  TaskThreadBindingId,
  ThreadId,
  type ProjectTask,
  type TaskThreadBinding,
} from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { deriveExecutionHealth } from "./executionHealth.ts";

const now = "2026-08-01T00:10:00.000Z";
const task = {
  id: ProjectTaskId.makeUnsafe("task"),
  processId: TaskProcessId.makeUnsafe("process"),
  parentTaskId: null,
  title: "Task",
  description: "Work",
  acceptanceCriteria: [],
  priority: "normal",
  lifecycle: "in_progress",
  orderKey: "a",
  createdBy: { kind: "user", actorId: "owner" },
  createdAt: now,
  updatedAt: now,
} satisfies ProjectTask;
const binding = {
  id: TaskThreadBindingId.makeUnsafe("binding"),
  taskId: task.id,
  threadId: ThreadId.makeUnsafe("child"),
  assignmentId: null,
  role: "owner",
  activeFrom: now,
  retiredAt: null,
} satisfies TaskThreadBinding;

describe("task execution health", () => {
  it("uses running over mixed failures and never changes lifecycle", () => {
    const runtime = new Map([[binding.threadId, "running" as const]]);
    expect(
      deriveExecutionHealth({ task, bindings: [binding], progress: [], runtimeByThread: runtime }),
    ).toBe("running");
    expect(task.lifecycle).toBe("in_progress");
  });

  it("derives waiting from permission evidence and stalled from crashes", () => {
    const waitingRuntime = new Map([[binding.threadId, "waiting" as const]]);
    expect(
      deriveExecutionHealth({
        task,
        bindings: [binding],
        progress: [],
        runtimeByThread: waitingRuntime,
      }),
    ).toBe("waiting");
    const crashedRuntime = new Map([[binding.threadId, "crashed" as const]]);
    expect(
      deriveExecutionHealth({
        task,
        bindings: [binding],
        progress: [],
        runtimeByThread: crashedRuntime,
      }),
    ).toBe("stalled");
  });

  it("keeps terminal semantic lifecycle idle regardless of runtime", () => {
    const runtime = new Map([[binding.threadId, "running" as const]]);
    expect(
      deriveExecutionHealth({
        task: { ...task, lifecycle: "done" },
        bindings: [binding],
        progress: [],
        runtimeByThread: runtime,
      }),
    ).toBe("idle");
  });
});
