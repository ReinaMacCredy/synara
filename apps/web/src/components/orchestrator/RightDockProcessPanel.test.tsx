import {
  ProjectId,
  ProjectTaskId,
  TaskProcessId,
  type TaskProcessGraphProjection,
  type TaskProcessSummaryProjection,
} from "@synara/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { RightDockProcessPanelView } from "./RightDockProcessPanel";

describe("RightDockProcessPanel", () => {
  it("renders a bounded non-editing operational projection", () => {
    const summary = {
      process: {
        id: TaskProcessId.makeUnsafe("process"),
        projectId: ProjectId.makeUnsafe("project"),
        title: "Authentication",
        owner: { kind: "user" },
        state: "active",
        revision: 3,
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      counts: { total: 5, done: 2, ready: 1, blocked: 1, running: 0, review: 0, failed: 0 },
      graphRevision: 3,
      highWaterCursor: "3",
    } satisfies TaskProcessSummaryProjection;
    const graph = {
      process: {
        ...summary.process,
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      tasks: [
        {
          task: {
            id: ProjectTaskId.makeUnsafe("task-foundation"),
            processId: summary.process.id,
            parentTaskId: null,
            title: "Foundation",
            description: "Establish the core architecture and project structure.",
            acceptanceCriteria: ["Architecture is reviewable"],
            priority: "high",
            risk: "high",
            lifecycle: "in_progress",
            orderKey: "a",
            createdBy: { kind: "user", actorId: "owner" },
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
          },
          readiness: "ready",
          executionHealth: "running",
          unmetDependencyIds: [],
          blockerIds: [],
          bindingIds: [],
          evidenceState: "current",
        },
      ],
      dependencies: [],
      bindings: [],
      blockers: [],
      graphRevision: 3,
      highWaterCursor: "3",
    } satisfies TaskProcessGraphProjection;
    const markup = renderToStaticMarkup(
      <RightDockProcessPanelView
        summary={summary}
        graph={graph}
        progress={null}
        onOpenTask={vi.fn()}
        onOpenProcess={vi.fn()}
      />,
    );
    expect(markup).toContain("Authentication");
    expect(markup).toContain("Task pulse");
    expect(markup).toContain("0/1 complete");
    expect(markup).toContain("Active now");
    expect(markup).toContain("1 active");
    expect(markup).toContain("Foundation");
    expect(markup).toContain("Work is currently in motion");
    expect(markup).toContain("Open task board");
    expect(markup).not.toContain("Outcome");
    expect(markup).not.toContain("Add task");
  });
});
