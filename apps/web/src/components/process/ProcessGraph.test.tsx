import {
  ProjectId,
  ProjectTaskId,
  TaskDependencyEdgeId,
  TaskProcessId,
  type TaskProcessGraphProjection,
} from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { buildDependencyLayout, buildDependencyWaves } from "./ProcessGraph";

describe("ProcessGraph", () => {
  it("lays out only active dependency edges when the graph view requests layout", () => {
    const processId = TaskProcessId.makeUnsafe("process");
    const task = (id: string) => ({
      task: {
        id: ProjectTaskId.makeUnsafe(id),
        processId,
        parentTaskId: null,
        title: id,
        description: null,
        acceptanceCriteria: [],
        priority: "normal" as const,
        risk: "medium" as const,
        lifecycle: "planned" as const,
        orderKey: id,
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
    });
    const graph = {
      process: {
        id: processId,
        projectId: ProjectId.makeUnsafe("project"),
        title: "Process",
        owner: { kind: "user" as const },
        state: "active" as const,
        revision: 1,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      tasks: [task("a"), task("b"), task("c")],
      dependencies: [
        {
          id: TaskDependencyEdgeId.makeUnsafe("edge"),
          processId,
          prerequisiteTaskId: ProjectTaskId.makeUnsafe("a"),
          dependentTaskId: ProjectTaskId.makeUnsafe("b"),
          state: "active" as const,
          createdBy: { kind: "user" as const, actorId: "owner" },
          createdAt: "2026-08-01T00:00:00.000Z",
          waivedBy: null,
          waivedAt: null,
          waiverReason: null,
        },
      ],
      bindings: [],
      blockers: [],
      graphRevision: 1,
      highWaterCursor: "1",
    } satisfies TaskProcessGraphProjection;
    expect(
      buildDependencyWaves(graph).map((wave) => wave.tasks.map((item) => item.task.id)),
    ).toEqual([["a", "c"], ["b"]]);
    const layout = buildDependencyLayout(graph);
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]).toMatchObject({
      prerequisiteTaskId: "a",
      dependentTaskId: "b",
    });
    expect(layout.edges[0]?.path).toMatch(/^M .* C .*$/);
    expect(layout.nodes.find((node) => node.task.task.id === "b")?.left).toBeGreaterThan(
      layout.nodes.find((node) => node.task.task.id === "a")?.left ?? 0,
    );
  });
});
