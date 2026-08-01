import type { OrchestratorDomainEvent } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { createEmptyOrchestratorState, replayOrchestratorEvents } from "./projector.ts";

describe("Orchestrator projector", () => {
  it("replays the same event bytes deterministically", () => {
    const events = [
      {
        sequence: 1,
        eventId: "event-1",
        aggregateKind: "orchestrator",
        aggregateId: "root-a",
        type: "orchestrator.root.created",
        payload: {
          rootThreadId: "root-a",
          projectId: "project-a",
          actor: { kind: "user", actorId: "owner" },
          protocolVersion: 1,
          acceptedRevision: 1,
          root: {
            rootThreadId: "root-a",
            projectId: "project-a",
            protocolVersion: 1,
            state: "active",
            activeProcessId: null,
            resourcePolicyVersion: 1,
            createdAt: "2026-08-01T00:00:00.000Z",
            archivedAt: null,
            revision: 1,
          },
        },
        occurredAt: "2026-08-01T00:00:00.000Z",
        commandId: "command-1",
        causationEventId: null,
        correlationId: "command-1",
        metadata: {},
      },
    ] as unknown as ReadonlyArray<OrchestratorDomainEvent>;

    const first = replayOrchestratorEvents(events);
    const second = replayOrchestratorEvents(events);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.root?.rootThreadId).toBe("root-a");
    expect(first.revision).toBe(1);
    expect(createEmptyOrchestratorState().revision).toBe(0);
  });

  it("retains assignment evidence independently from Assignment state", () => {
    const event = {
      sequence: 2,
      eventId: "event-evidence",
      aggregateKind: "orchestrator",
      aggregateId: "root-a",
      type: "orchestrator.assignment.status-reported",
      payload: {
        rootThreadId: "root-a",
        projectId: "project-a",
        actor: { kind: "thread", threadId: "child-a" },
        protocolVersion: 1,
        acceptedRevision: 2,
        root: {
          rootThreadId: "root-a",
          projectId: "project-a",
          protocolVersion: 1,
          state: "active",
          activeProcessId: null,
          resourcePolicyVersion: 1,
          createdAt: "2026-08-01T00:00:00.000Z",
          archivedAt: null,
          revision: 2,
        },
        evidence: {
          assignmentId: "assignment-a",
          taskId: "task-a",
          summary: "proof",
          changedPaths: [],
          diffRef: null,
          checks: [],
          consumerEvidenceRefs: [],
          artifactRefs: ["artifact-a"],
          risks: [],
          deviations: [],
          reportedAt: "2026-08-01T00:00:01.000Z",
        },
      },
      occurredAt: "2026-08-01T00:00:01.000Z",
      commandId: "command-evidence",
      causationEventId: null,
      correlationId: "command-evidence",
      metadata: {},
    } as unknown as OrchestratorDomainEvent;
    const state = replayOrchestratorEvents([event]);
    expect(state.assignmentEvidence).toHaveLength(1);
    expect(state.assignments).toHaveLength(0);
  });
});
