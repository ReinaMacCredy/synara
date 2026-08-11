import {
  ProjectId,
  ProjectTaskId,
  TaskProcessId,
  ThreadId,
  type TaskProcessGraphProjection,
} from "@veylen/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TaskDetailDrawer } from "./TaskDetailDrawer";

function graph(): TaskProcessGraphProjection {
  const processId = TaskProcessId.makeUnsafe("process");
  const projection = {
    task: {
      id: ProjectTaskId.makeUnsafe("task"),
      processId,
      parentTaskId: null,
      title: "Foundation",
      description: "Build the seam",
      acceptanceCriteria: [],
      priority: "high" as const,
      risk: "low" as const,
      lifecycle: "in_progress" as const,
      orderKey: "a",
      createdBy: { kind: "user" as const, actorId: "owner" },
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    readiness: "ready" as const,
    executionHealth: "running" as const,
    unmetDependencyIds: [],
    blockerIds: [],
    bindingIds: [],
    evidenceState: "current" as const,
  };
  return {
    process: {
      id: processId,
      projectId: ProjectId.makeUnsafe("project"),
      title: "Build",
      owner: { kind: "user" },
      state: "active",
      revision: 1,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    tasks: [projection],
    dependencies: [],
    bindings: [],
    blockers: [],
    graphRevision: 1,
    highWaterCursor: "1",
  };
}

describe("TaskDetailDrawer", () => {
  it("shows direct semantic controls only for Project-owned processes", () => {
    const projectGraph = graph();
    const common = {
      progress: [],
      threadOptions: [{ id: ThreadId.makeUnsafe("thread"), title: "Worker thread" }],
      pending: false,
      onClose: vi.fn(),
      onUpdateTask: vi.fn(),
      onSetDependencies: vi.fn(),
      onBindThread: vi.fn(),
      onTransition: vi.fn(),
      onComplete: vi.fn(),
      onReopen: vi.fn(),
      onOpenThread: vi.fn(),
    };
    const projectMarkup = renderToStaticMarkup(
      <TaskDetailDrawer
        {...common}
        task={projectGraph.tasks[0]!}
        graph={projectGraph}
        canEditGraph
      />,
    );
    const rootMarkup = renderToStaticMarkup(
      <TaskDetailDrawer
        {...common}
        task={projectGraph.tasks[0]!}
        graph={projectGraph}
        canEditGraph={false}
      />,
    );

    expect(projectMarkup).toContain("Save task");
    expect(projectMarkup).toContain("Task risk");
    expect(projectMarkup).toContain('data-task-risk="low"');
    expect(projectMarkup).toContain("Low risk");
    expect(projectMarkup).toContain("Select thread");
    expect(projectMarkup).toContain("Complete with evidence");
    expect(rootMarkup).not.toContain("Save task");
    expect(rootMarkup).not.toContain("Select thread");
    expect(rootMarkup).toContain("Cancel task");
  });
});
