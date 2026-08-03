import type { TaskProcessDomainEvent } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { replayTaskProcessEvents } from "./projector.ts";

describe("TaskProcess projector", () => {
  it("replays lifecycle, readiness, and execution health deterministically", () => {
    const events = [
      {
        sequence: 1,
        eventId: "event-process",
        aggregateKind: "task_process",
        aggregateId: "process",
        type: "task-process.created",
        payload: {
          processId: "process",
          projectId: "project",
          actor: { kind: "user", actorId: "owner" },
          acceptedRevision: 1,
          mutation: {
            graphRevision: 1,
            affectedTasks: [],
            newlyReadyTasks: [],
            newlyBlockedTasks: [],
          },
          process: {
            id: "process",
            projectId: "project",
            title: "Process",
            owner: { kind: "user" },
            state: "active",
            revision: 1,
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:00.000Z",
          },
        },
        occurredAt: "2026-08-01T00:00:00.000Z",
        commandId: "command-process",
        causationEventId: null,
        correlationId: "command-process",
        metadata: {},
      },
      {
        sequence: 2,
        eventId: "event-task",
        aggregateKind: "task_process",
        aggregateId: "process",
        type: "project-task.created",
        payload: {
          processId: "process",
          projectId: "project",
          actor: { kind: "user", actorId: "owner" },
          acceptedRevision: 2,
          mutation: {
            graphRevision: 2,
            affectedTasks: ["task"],
            newlyReadyTasks: ["task"],
            newlyBlockedTasks: [],
          },
          process: {
            id: "process",
            projectId: "project",
            title: "Process",
            owner: { kind: "user" },
            state: "active",
            revision: 2,
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:01.000Z",
          },
          task: {
            id: "task",
            processId: "process",
            parentTaskId: null,
            title: "Task",
            description: null,
            acceptanceCriteria: [],
            priority: "normal",
            risk: "high",
            lifecycle: "planned",
            orderKey: "a",
            createdBy: { kind: "user", actorId: "owner" },
            createdAt: "2026-08-01T00:00:01.000Z",
            updatedAt: "2026-08-01T00:00:01.000Z",
          },
        },
        occurredAt: "2026-08-01T00:00:01.000Z",
        commandId: "command-task",
        causationEventId: null,
        correlationId: "command-task",
        metadata: {},
      },
    ] as unknown as ReadonlyArray<TaskProcessDomainEvent>;
    const first = replayTaskProcessEvents(events);
    const second = replayTaskProcessEvents(events);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.tasks[0]).toMatchObject({ readiness: "ready", executionHealth: "idle" });
  });
});
