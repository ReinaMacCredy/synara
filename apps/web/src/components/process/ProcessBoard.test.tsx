import {
  ProjectId,
  ProjectTaskId,
  TaskProcessId,
  type TaskProcessGraphProjection,
} from "@synara/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  deriveProcessBoardLane,
  groupProcessBoardTasks,
  processBoardGroupForLane,
  ProcessBoard,
} from "./ProcessBoard";

function graph(): TaskProcessGraphProjection {
  const processId = TaskProcessId.makeUnsafe("process-a");
  const task = (
    id: string,
    lifecycle: "planned" | "in_progress",
    readiness: "ready" | "blocked",
  ) => ({
    task: {
      id: ProjectTaskId.makeUnsafe(id),
      processId,
      parentTaskId: null,
      title: id,
      description: null,
      acceptanceCriteria: [],
      priority: "normal" as const,
      risk: "medium" as const,
      lifecycle,
      orderKey: id,
      createdBy: { kind: "user" as const, actorId: "owner" },
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    readiness,
    executionHealth: "idle" as const,
    unmetDependencyIds: [],
    blockerIds: [],
    bindingIds: [],
    evidenceState: "current" as const,
  });
  return {
    process: {
      id: processId,
      projectId: ProjectId.makeUnsafe("project-a"),
      title: "Process A",
      owner: { kind: "user" },
      state: "active",
      revision: 2,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    tasks: [task("task-ready", "planned", "ready"), task("task-blocked", "in_progress", "blocked")],
    dependencies: [],
    bindings: [],
    blockers: [],
    graphRevision: 2,
    highWaterCursor: "2",
  };
}

describe("ProcessBoard", () => {
  it("derives Blocked without changing persisted lifecycle", () => {
    const blocked = graph().tasks[1]!;
    expect(blocked.task.lifecycle).toBe("in_progress");
    expect(deriveProcessBoardLane(blocked)).toBe("blocked");
    expect(
      groupProcessBoardTasks(graph(), "blocked")
        .get("blocked")
        ?.map((item) => item.task.id),
    ).toEqual(["task-blocked"]);
  });

  it("groups lifecycle lanes into the approved operational overview", () => {
    expect(processBoardGroupForLane("in_progress")).toBe("active");
    expect(processBoardGroupForLane("review")).toBe("attention");
    expect(processBoardGroupForLane("blocked")).toBe("attention");
    expect(processBoardGroupForLane("ready")).toBe("ready");
    expect(processBoardGroupForLane("done")).toBe("completed");
  });

  it("renders durable ProjectTask cards and hides edit controls when authority is read-only", () => {
    const markup = renderToStaticMarkup(
      <ProcessBoard graph={graph()} filter="all" canEdit={false} onSelectTask={vi.fn()} />,
    );
    expect(markup).toContain('data-process-group="ready"');
    expect(markup).toContain('data-process-group="attention"');
    expect(markup).toContain('data-task-risk="medium"');
    expect(markup).toContain("Medium risk");
    expect(markup).not.toContain("Move up");
  });
});
