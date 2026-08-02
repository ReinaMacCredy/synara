import { ProjectId, TaskProcessId, type TaskProcessSummaryProjection } from "@synara/contracts";
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
      counts: { total: 5, done: 2, ready: 1, blocked: 1, running: 1, review: 0, failed: 0 },
      graphRevision: 3,
      highWaterCursor: "3",
    } satisfies TaskProcessSummaryProjection;
    const markup = renderToStaticMarkup(
      <RightDockProcessPanelView
        summary={summary}
        progress={null}
        onOpenTask={vi.fn()}
        onOpenProcess={vi.fn()}
      />,
    );
    expect(markup).toContain("Authentication");
    expect(markup).toContain("2/5");
    expect(markup).toContain("Open task board");
    expect(markup).not.toContain("Add task");
  });
});
