import { ProjectTaskId, TaskProcessId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { canTransitionTaskLifecycle, wouldCreateTaskHierarchyCycle } from "./invariants.ts";
import { createEmptyTaskProcessState } from "./projector.ts";

describe("TaskProcess invariants", () => {
  it("reserves done and reopen for evidence-bearing commands", () => {
    expect(canTransitionTaskLifecycle("in_progress", "review")).toBe(true);
    expect(canTransitionTaskLifecycle("review", "done")).toBe(false);
    expect(canTransitionTaskLifecycle("done", "planned")).toBe(false);
  });

  it("keeps task hierarchy acyclic independently from dependency edges", () => {
    const processId = TaskProcessId.makeUnsafe("process");
    const parent = ProjectTaskId.makeUnsafe("parent");
    const child = ProjectTaskId.makeUnsafe("child");
    const state = {
      ...createEmptyTaskProcessState(),
      tasks: [
        {
          task: {
            id: parent,
            processId,
            parentTaskId: null,
            title: "Parent",
            description: null,
            acceptanceCriteria: [],
            priority: "normal" as const,
            risk: "medium" as const,
            lifecycle: "planned" as const,
            orderKey: "a",
            createdBy: { kind: "user" as const, actorId: "owner" },
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
          },
          readiness: "ready" as const,
          executionHealth: "idle" as const,
          unmetDependencyIds: [],
          blockerIds: [],
          bindingIds: [],
          evidenceState: "current" as const,
        },
        {
          task: {
            id: child,
            processId,
            parentTaskId: parent,
            title: "Child",
            description: null,
            acceptanceCriteria: [],
            priority: "normal" as const,
            risk: "medium" as const,
            lifecycle: "planned" as const,
            orderKey: "b",
            createdBy: { kind: "user" as const, actorId: "owner" },
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
          },
          readiness: "ready" as const,
          executionHealth: "idle" as const,
          unmetDependencyIds: [],
          blockerIds: [],
          bindingIds: [],
          evidenceState: "current" as const,
        },
      ],
    };
    expect(wouldCreateTaskHierarchyCycle({ state, taskId: parent, parentTaskId: child })).toBe(
      true,
    );
  });
});
