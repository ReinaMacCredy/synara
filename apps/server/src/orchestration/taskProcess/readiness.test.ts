import {
  ProjectTaskId,
  TaskBlockerId,
  TaskDependencyEdgeId,
  TaskProcessId,
  TaskProgressEntryId,
  TaskThreadBindingId,
  ThreadId,
  type ProjectTask,
} from "@veylen/contracts";
import { describe, expect, it } from "vitest";

import { deriveProjectTaskProjection } from "./readiness.ts";

const processId = TaskProcessId.makeUnsafe("process");
const prerequisite: ProjectTask = {
  id: ProjectTaskId.makeUnsafe("prerequisite"),
  processId,
  parentTaskId: null,
  title: "Prerequisite",
  description: null,
  acceptanceCriteria: [],
  priority: "normal",
  risk: "medium",
  lifecycle: "in_progress",
  orderKey: "a",
  createdBy: { kind: "user", actorId: "owner" },
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};
const dependent: ProjectTask = {
  ...prerequisite,
  id: ProjectTaskId.makeUnsafe("dependent"),
  title: "Dependent",
  orderKey: "b",
};

describe("Task readiness", () => {
  it("derives blocked independently from semantic lifecycle", () => {
    const projection = deriveProjectTaskProjection({
      task: dependent,
      tasks: [prerequisite, dependent],
      dependencies: [
        {
          id: TaskDependencyEdgeId.makeUnsafe("edge"),
          processId,
          dependentTaskId: dependent.id,
          prerequisiteTaskId: prerequisite.id,
          state: "active",
          createdBy: { kind: "user", actorId: "owner" },
          createdAt: prerequisite.createdAt,
          waivedBy: null,
          waivedAt: null,
          waiverReason: null,
        },
      ],
      bindings: [],
      progress: [],
      blockers: [],
    });
    expect(projection.task.lifecycle).toBe("in_progress");
    expect(projection.readiness).toBe("blocked");
    expect(projection.executionHealth).toBe("idle");
  });

  it("derives running, waiting, and stalled from binding plus evidence without completing lifecycle", () => {
    const threadId = ThreadId.makeUnsafe("thread");
    const base = {
      task: dependent,
      tasks: [{ ...prerequisite, lifecycle: "done" as const }, dependent],
      dependencies: [],
      bindings: [
        {
          id: TaskThreadBindingId.makeUnsafe("binding"),
          taskId: dependent.id,
          threadId,
          assignmentId: null,
          role: "owner" as const,
          activeFrom: dependent.createdAt,
          retiredAt: null,
        },
      ],
      blockers: [],
    };
    expect(deriveProjectTaskProjection({ ...base, progress: [] }).executionHealth).toBe("running");
    expect(
      deriveProjectTaskProjection({
        ...base,
        progress: [
          {
            id: TaskProgressEntryId.makeUnsafe("waiting"),
            taskId: dependent.id,
            assignmentId: null,
            threadId,
            actor: { kind: "thread", threadId },
            kind: "waiting",
            summary: "Waiting",
            evidenceRefs: [],
            createdAt: dependent.createdAt,
          },
        ],
      }).executionHealth,
    ).toBe("waiting");
    expect(
      deriveProjectTaskProjection({
        ...base,
        progress: [
          {
            id: TaskProgressEntryId.makeUnsafe("failure"),
            taskId: dependent.id,
            assignmentId: null,
            threadId,
            actor: { kind: "thread", threadId },
            kind: "failure",
            summary: "Crashed",
            evidenceRefs: [],
            createdAt: dependent.createdAt,
          },
        ],
        blockers: [
          {
            id: TaskBlockerId.makeUnsafe("blocker"),
            taskId: dependent.id,
            kind: "external",
            summary: "Blocked",
            createdBy: { kind: "thread", threadId },
            createdAt: dependent.createdAt,
            resolvedBy: null,
            resolvedAt: null,
            resolution: null,
          },
        ],
      }).executionHealth,
    ).toBe("stalled");
  });
});
