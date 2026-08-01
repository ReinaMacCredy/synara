import { readFileSync } from "node:fs";
import {
  ProjectTaskId,
  TaskProcessId,
  ThreadId,
  type SessionProgressProjection,
} from "@synara/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { resolveSessionProgressVisualState, SessionProgress } from "./SessionProgress";

function projection(): SessionProgressProjection {
  const processId = TaskProcessId.makeUnsafe("process");
  const makeItem = (
    id: string,
    lifecycle: "done" | "in_progress" | "planned" | "failed" | "cancelled",
    readiness: "ready" | "blocked",
    executionHealth: "idle" | "running",
  ) => ({
    task: {
      task: {
        id: ProjectTaskId.makeUnsafe(id),
        processId,
        parentTaskId: null,
        title: id,
        description: null,
        acceptanceCriteria: [],
        priority: "normal" as const,
        lifecycle,
        orderKey: id,
        createdBy: { kind: "user" as const, actorId: "owner" },
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      readiness,
      executionHealth,
      unmetDependencyIds: [],
      blockerIds: [],
      bindingIds: [],
      evidenceState: "current" as const,
    },
    depth: 0,
    blockedByTitles: readiness === "blocked" ? ["task-running"] : [],
  });
  const items = [
    makeItem("task-done", "done", "ready", "idle"),
    makeItem("task-running", "in_progress", "ready", "running"),
    makeItem("task-ready", "planned", "ready", "idle"),
    makeItem("task-blocked", "planned", "blocked", "idle"),
    makeItem("task-failed", "failed", "ready", "idle"),
    makeItem("task-cancelled", "cancelled", "ready", "idle"),
  ];
  return {
    threadId: ThreadId.makeUnsafe("thread"),
    processId,
    primaryTask: items[1]!.task,
    visibleTasks: items,
    boundThreads: [
      {
        threadId: ThreadId.makeUnsafe("thread"),
        taskId: items[1]!.task.task.id,
        role: "owner",
        executionHealth: "running",
        provider: "claude",
        model: "opus-4.8",
        lastActivityAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    completedCount: 1,
    totalCount: 6,
    latestProgress: [],
    graphRevision: 4,
    cursor: "4",
    hasMore: false,
  };
}

describe("SessionProgress", () => {
  it("derives glyph states from durable lifecycle, readiness, and execution health", () => {
    const items = projection().visibleTasks;
    expect(items.map((item) => resolveSessionProgressVisualState(item.task))).toEqual([
      "complete",
      "active",
      "pending",
      "blocked",
      "failed",
      "cancelled",
    ]);
  });

  it("renders a controlled accessible disclosure without provider-native task state", () => {
    const markup = renderToStaticMarkup(
      <SessionProgress
        variant="composer"
        projection={projection()}
        collapsed={false}
        onCollapsedChange={vi.fn()}
        onOpenTask={vi.fn()}
        onOpenProcess={vi.fn()}
      />,
    );
    expect(markup).toContain('data-session-progress="composer"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("task-running");
    expect(markup).toContain("blocked by task-running");
    expect(markup).toContain("Full process");
  });

  it("uses shared disclosure motion and contains no simulated lifecycle", () => {
    const source = readFileSync(new URL("./SessionProgress.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("./SessionProgress.module.css", import.meta.url), "utf8");
    expect(source).toContain("DisclosureRegion");
    expect(source).not.toMatch(/LABELS|START_DELAY|STEP_MS|setInterval|setTimeout/);
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("session-progress-spin");
    expect(css).toContain(".active .iconWrap");
    expect(css).toContain("var(--color-text-foreground)");
    expect(css).not.toContain("prefers-color-scheme");
  });
});
