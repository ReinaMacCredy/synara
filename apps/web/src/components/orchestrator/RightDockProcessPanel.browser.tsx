import "../../index.css";

import {
  ProjectId,
  ProjectTaskId,
  TaskProcessId,
  type TaskProcessGraphProjection,
  type TaskProcessSummaryProjection,
} from "@synara/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { RightDockProcessPanelView } from "./RightDockProcessPanel";

const processId = TaskProcessId.makeUnsafe("process-dock-layout");
const summary = {
  process: {
    id: processId,
    projectId: ProjectId.makeUnsafe("project-dock-layout"),
    title: "Authentication",
    owner: { kind: "user" },
    state: "active",
    revision: 5,
    updatedAt: "2026-08-02T00:00:00.000Z",
  },
  counts: { total: 4, done: 1, ready: 1, blocked: 1, running: 1, review: 0, failed: 0 },
  graphRevision: 5,
  highWaterCursor: "5",
} satisfies TaskProcessSummaryProjection;

function task(
  id: string,
  title: string,
  lifecycle: "planned" | "in_progress" | "done",
  risk: "low" | "medium" | "high",
  executionHealth: "idle" | "running",
  readiness: "ready" | "blocked" = "ready",
) {
  return {
    task: {
      id: ProjectTaskId.makeUnsafe(id),
      processId,
      parentTaskId: null,
      title,
      description: `Durable outcome for ${title}.`,
      acceptanceCriteria: [`${title} is verified`],
      priority: "normal" as const,
      risk,
      lifecycle,
      orderKey: id,
      createdBy: { kind: "user" as const, actorId: "owner" },
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    },
    readiness,
    executionHealth,
    unmetDependencyIds: [],
    blockerIds: [],
    bindingIds: [],
    evidenceState: "current" as const,
  };
}

const graph = {
  process: { ...summary.process, createdAt: "2026-08-02T00:00:00.000Z" },
  tasks: [
    task("01-foundation", "Foundation", "in_progress", "high", "running"),
    task("02-api-review", "API review", "planned", "medium", "idle", "blocked"),
    task("03-integration", "Integration tests", "planned", "low", "idle"),
    task("04-explore", "Explore", "done", "low", "idle"),
  ],
  dependencies: [],
  bindings: [],
  blockers: [],
  graphRevision: 5,
  highWaterCursor: "5",
} satisfies TaskProcessGraphProjection;

async function renderPanel(width: number) {
  const result = await render(
    <div style={{ width, height: 640 }}>
      <RightDockProcessPanelView
        summary={summary}
        graph={graph}
        progress={null}
        onOpenTask={vi.fn()}
        onOpenProcess={vi.fn()}
      />
    </div>,
  );
  await result.baseElement.ownerDocument.fonts.ready;
  return result;
}

function pulseGroup(name: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-task-pulse-group="${name}"]`);
  if (!element) throw new Error(`Missing task pulse group: ${name}`);
  return element;
}

describe("RightDockProcessPanel adaptive task pulse", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("stacks actionable pulse groups when narrow [geometry:linux]", async () => {
    await renderPanel(460);
    const attention = pulseGroup("attention").getBoundingClientRect();
    const active = pulseGroup("active").getBoundingClientRect();
    const ready = pulseGroup("ready").getBoundingClientRect();
    expect(attention.bottom).toBeLessThanOrEqual(active.top + 1);
    expect(active.bottom).toBeLessThanOrEqual(ready.top + 1);
    expect(document.body.textContent).toContain("Needs attention");
    expect(document.body.textContent).toContain("Ready next");
  });

  it("uses three operational columns when wide [geometry:linux]", async () => {
    await renderPanel(900);
    const attention = pulseGroup("attention").getBoundingClientRect();
    const active = pulseGroup("active").getBoundingClientRect();
    const ready = pulseGroup("ready").getBoundingClientRect();
    expect(attention.right).toBeLessThanOrEqual(active.left + 1);
    expect(active.right).toBeLessThanOrEqual(ready.left + 1);
    expect(Math.abs(attention.top - active.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(active.top - ready.top)).toBeLessThanOrEqual(1);
  });
});
