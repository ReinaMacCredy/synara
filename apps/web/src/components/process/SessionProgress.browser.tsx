import "../../index.css";

import {
  ProjectTaskId,
  TaskProcessId,
  ThreadId,
  type SessionProgressProjection,
} from "@synara/contracts";
import { useState } from "react";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { SessionProgress } from "./SessionProgress";

function projection(): SessionProgressProjection {
  const processId = TaskProcessId.makeUnsafe("process-browser-progress");
  const taskId = ProjectTaskId.makeUnsafe("task-running");
  const task = {
    task: {
      id: taskId,
      processId,
      parentTaskId: null,
      title: "Foundation persistence",
      description: null,
      acceptanceCriteria: [],
      priority: "high" as const,
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
  const readyTask = {
    task: {
      ...task.task,
      id: ProjectTaskId.makeUnsafe("task-ready"),
      title: "Implement commands",
      lifecycle: "planned" as const,
    },
    readiness: "ready" as const,
    executionHealth: "idle" as const,
    unmetDependencyIds: [],
    blockerIds: [],
    bindingIds: [],
    evidenceState: "current" as const,
  };
  return {
    threadId: ThreadId.makeUnsafe("thread-browser-progress"),
    processId,
    primaryTask: task,
    visibleTasks: [
      { task, depth: 0, blockedByTitles: [] },
      { task: readyTask, depth: 0, blockedByTitles: [] },
    ],
    boundThreads: [],
    completedCount: 0,
    totalCount: 2,
    latestProgress: [],
    graphRevision: 1,
    cursor: "1",
    hasMore: false,
  };
}

describe("SessionProgress browser behavior", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("supports keyboard disclosure, task navigation, and running-only rotation", async () => {
    const onOpenTask = vi.fn();
    function Harness() {
      const [collapsed, setCollapsed] = useState(false);
      return (
        <SessionProgress
          variant="composer"
          projection={projection()}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          onOpenTask={onOpenTask}
          onOpenProcess={vi.fn()}
        />
      );
    }
    const mounted = await render(<Harness />);
      const header = page.getByRole("button", {
        name: /Foundation persistence: Running step 1 of 2/,
      });
    await expect.element(header).toHaveAttribute("aria-expanded", "true");
    const runningRow = document.querySelector<HTMLElement>(
      "[aria-label='Foundation persistence: active']",
    );
    expect(runningRow).not.toBeNull();
    const icon = runningRow?.querySelector<HTMLElement>("span");
    expect(icon ? getComputedStyle(icon).animationName : "").toContain("session-progress-spin");
    const readyRow = document.querySelector<HTMLElement>(
      "[aria-label='Implement commands: pending']",
    );
    expect(readyRow).not.toBeNull();
    expect(
      readyRow?.querySelector<HTMLElement>("span")
        ? getComputedStyle(readyRow.querySelector<HTMLElement>("span")!).animationName
        : "",
    ).toBe("none");

    await mounted.rerender(<Harness />);
    expect(
      getComputedStyle(
        document.querySelector<HTMLElement>("[aria-label='Implement commands: pending']")!,
      ).animationName,
    ).toBe("none");

    await header.click();
    await expect.element(header).toHaveAttribute("aria-expanded", "false");
    await header.click();
    await page.getByRole("button", { name: "Foundation persistence: active" }).click();
    expect(onOpenTask).toHaveBeenCalledWith(ProjectTaskId.makeUnsafe("task-running"));
  });
});
