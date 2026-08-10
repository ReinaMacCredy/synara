import "../../index.css";

import {
  ProjectId,
  ProjectTaskId,
  TaskDependencyEdgeId,
  TaskProcessId,
  ThreadId,
  type TaskProcessGraphProjection,
} from "@synara/contracts";
import { useState } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ProcessBoard } from "./ProcessBoard";
import { ProcessGraph } from "./ProcessGraph";
import { TaskDetailTransitionShell } from "./ProcessWorkspace";
import { TaskDetailDrawer } from "./TaskDetailDrawer";

const processId = TaskProcessId.makeUnsafe("process-browser");
const foundationId = ProjectTaskId.makeUnsafe("task-foundation");
const integrationId = ProjectTaskId.makeUnsafe("task-integration");

function graph(): TaskProcessGraphProjection {
  const task = (id: typeof foundationId, title: string, orderKey: string) => ({
    task: {
      id,
      processId,
      parentTaskId: null,
      title,
      description: null,
      acceptanceCriteria: [],
      priority: "normal" as const,
      risk: "medium" as const,
      lifecycle: "planned" as const,
      orderKey,
      createdBy: { kind: "user" as const, actorId: "owner" },
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    readiness: id === integrationId ? ("blocked" as const) : ("ready" as const),
    executionHealth: "idle" as const,
    unmetDependencyIds: id === integrationId ? [TaskDependencyEdgeId.makeUnsafe("edge")] : [],
    blockerIds: [],
    bindingIds: [],
    evidenceState: "current" as const,
  });
  return {
    process: {
      id: processId,
      projectId: ProjectId.makeUnsafe("project-browser"),
      title: "Browser Process",
      owner: { kind: "user" },
      state: "active",
      revision: 1,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    tasks: [task(foundationId, "Foundation", "a"), task(integrationId, "Integration", "b")],
    dependencies: [
      {
        id: TaskDependencyEdgeId.makeUnsafe("edge"),
        processId,
        dependentTaskId: integrationId,
        prerequisiteTaskId: foundationId,
        state: "active",
        createdBy: { kind: "user", actorId: "owner" },
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
  };
}

describe("Process workspace interaction", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("defers graph layout, opens task details, and keeps Root semantic controls absent", async () => {
    const projection = graph();
    function Harness() {
      const [view, setView] = useState<"board" | "graph">("board");
      const [selectedTaskId, setSelectedTaskId] = useState<ProjectTaskId | null>(null);
      const selected = projection.tasks.find((task) => task.task.id === selectedTaskId) ?? null;
      return (
        <div>
          <button type="button" onClick={() => setView("board")}>
            Board
          </button>
          <button type="button" onClick={() => setView("graph")}>
            Graph
          </button>
          {view === "board" ? (
            <ProcessBoard
              graph={projection}
              filter="all"
              canEdit={false}
              onSelectTask={setSelectedTaskId}
            />
          ) : (
            <ProcessGraph graph={projection} onSelectTask={setSelectedTaskId} />
          )}
          {selected ? (
            <TaskDetailDrawer
              task={selected}
              graph={projection}
              progress={[]}
              threadOptions={[]}
              canEditGraph={false}
              onClose={() => setSelectedTaskId(null)}
              onUpdateTask={vi.fn()}
              onSetDependencies={vi.fn()}
              onBindThread={vi.fn()}
              onTransition={vi.fn()}
              onComplete={vi.fn()}
              onReopen={vi.fn()}
              onOpenThread={vi.fn()}
            />
          ) : null}
        </div>
      );
    }

    await render(<Harness />);
    expect(document.querySelector("[data-process-view='board']")).not.toBeNull();
    expect(document.querySelector("[data-process-view='graph']")).toBeNull();
    expect(document.body.textContent).not.toContain("Move up");

    await page.getByRole("button", { name: /Foundation/ }).click();
    expect(document.querySelector("[data-task-detail-drawer='task-foundation']")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Save task");
    expect(document.body.textContent).toContain("Cancel task");

    await page.getByRole("button", { name: "Graph", exact: true }).click();
    expect(document.querySelector("[data-process-view='graph']")).not.toBeNull();
    expect(document.querySelector("[data-layout='dependency-only']")).not.toBeNull();
  });

  it("reuses the shared disclosure width motion for task detail open and close", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div className="flex h-80 w-[70rem]">
          <button type="button" onClick={() => setOpen((value) => !value)}>
            Toggle details
          </button>
          <TaskDetailTransitionShell open={open}>
            <div className="h-full w-full" data-transition-content />
          </TaskDetailTransitionShell>
        </div>
      );
    }

    await render(<Harness />);
    const shell = document.querySelector<HTMLElement>("[data-task-detail-shell]");
    expect(shell).not.toBeNull();
    expect(shell?.className).toContain("transition-[width]");
    expect(shell?.className).toContain("duration-220");
    expect(shell?.className).toContain("w-0");
    expect(shell?.getAttribute("aria-hidden")).toBe("true");

    const toggleDetails = page.getByRole("button", { name: "Toggle details" });
    await toggleDetails.click();
    expect(shell?.className).toContain("w-[min(28rem,42vw)]");
    expect(shell?.getAttribute("aria-hidden")).toBe("false");

    // The artificial harness has no production drawer close control. Once the
    // responsive shell opens it can cover this external toggle, so invoke the
    // control directly to exercise only the width transition under test.
    const toggleDetailsElement = toggleDetails.element();
    if (!(toggleDetailsElement instanceof HTMLElement)) {
      throw new Error("Expected the task-detail toggle to be an HTML button.");
    }
    toggleDetailsElement.click();
    await vi.waitFor(() => {
      expect(shell?.className).toContain("w-0");
      expect(shell?.getAttribute("aria-hidden")).toBe("true");
    });
  });
});
