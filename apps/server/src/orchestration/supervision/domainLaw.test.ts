import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import {
  emptySupervisionSnapshot,
  type LeadRotation,
  type LeadSeat,
  type SupervisionDomainEvent,
  type WorkflowDirective,
} from "@synara/contracts";

import { missionScopeExpands } from "./invariants.ts";
import { mayAdvanceLeadRotation, switchLeadSeatForRotation } from "./leadRotation.ts";
import { projectSupervisionEvent } from "./projector.ts";
import { coalesceSupervisionWakePointers, isEligibleSupervisionWake } from "./wakePolicy.ts";
import { effectiveWorkflowDirectives, workflowDirectiveConflicts } from "./workflowDirectives.ts";

const now = "2026-08-03T10:00:00.000Z";

it.effect("detects only real scope expansion across a multi-target mission", () =>
  Effect.sync(() => {
    assert.equal(
      missionScopeExpands(
        [
          { kind: "project", projectId: "project-a" as never },
          { kind: "project", projectId: "project-b" as never },
        ],
        [{ kind: "project", projectId: "project-a" as never }],
      ),
      false,
    );
    assert.equal(
      missionScopeExpands(
        [{ kind: "project", projectId: "project-a" as never }],
        [{ kind: "all_projects" }],
      ),
      true,
    );
  }),
);

it.effect("filters Peer noise and coalesces a Lead event burst by episode", () =>
  Effect.sync(() => {
    assert.equal(
      isEligibleSupervisionWake({
        eventType: "supervised.specialist.created",
        aggregateThreadId: "root-a",
        leadThreadIds: new Set(["root-a"]),
        peerThreadIds: new Set(["peer-a"]),
      }),
      true,
    );
    assert.equal(
      isEligibleSupervisionWake({
        eventType: "thread.message-sent",
        aggregateThreadId: "peer-a",
        leadThreadIds: new Set(["root-a"]),
        peerThreadIds: new Set(["peer-a"]),
      }),
      false,
    );
    assert.deepEqual(
      coalesceSupervisionWakePointers([
        { sequence: 3, eventType: "blocker" },
        { sequence: 5, eventType: "blocker" },
        { sequence: 4, eventType: "conflict" },
      ]),
      [
        { sequence: 4, eventType: "conflict" },
        { sequence: 5, eventType: "blocker" },
      ],
    );
  }),
);

it.effect("keeps the previous workflow effective until owner conflict resolution", () =>
  Effect.sync(() => {
    const directive = (id: string, instruction: string): WorkflowDirective => ({
      id: id as never,
      supervisorSeatId: `supervisor-${id}` as never,
      leadSeatId: "lead-a" as never,
      missionId: `mission-${id}` as never,
      slot: "release-policy",
      instruction,
      status: id === "old" ? "active" : "conflicted",
      createdAt: now,
      updatedAt: now,
      revision: 1,
    });
    const old = directive("old", "Run compatibility checks");
    const candidate = {
      ...directive("new", "Skip compatibility checks"),
      status: "active" as const,
    };
    assert.deepEqual(workflowDirectiveConflicts({ existing: [old], candidate }), [old]);
    assert.deepEqual(
      effectiveWorkflowDirectives({
        directives: [old, { ...candidate, status: "conflicted" }],
        conflicts: [],
      }),
      [old],
    );
  }),
);

it.effect("switches a Lead pointer only after validation and retains predecessor history", () =>
  Effect.sync(() => {
    const lead: LeadSeat = {
      id: "lead-a" as never,
      projectId: "project-a" as never,
      activeThreadId: "root-old" as never,
      predecessorThreadIds: [],
      profileSnapshotId: "snapshot-old" as never,
      status: "rotating",
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      revision: 2,
    };
    const rotation: LeadRotation = {
      id: "rotation-a" as never,
      leadSeatId: lead.id,
      missionId: null,
      predecessorThreadId: lead.activeThreadId,
      replacementThreadId: "root-new" as never,
      replacementProfileSnapshotId: "snapshot-new" as never,
      state: "validated",
      error: null,
      handoffSummary: "bounded handoff",
      createdAt: now,
      updatedAt: now,
      revision: 4,
    };
    assert.equal(mayAdvanceLeadRotation("validated", "switched"), true);
    assert.equal(mayAdvanceLeadRotation("frozen", "switched"), false);
    const switched = switchLeadSeatForRotation({ lead, rotation, occurredAt: now });
    assert.equal(switched.activeThreadId, "root-new");
    assert.deepEqual(switched.predecessorThreadIds, ["root-old"]);
  }),
);

it.effect("projects workflow resolution and wake lifecycle deterministically", () =>
  Effect.sync(() => {
    const state = emptySupervisionSnapshot(now);
    const event: SupervisionDomainEvent = {
      sequence: 1,
      eventId: "event-1" as never,
      aggregateKind: "supervision",
      aggregateId: "supervision" as never,
      type: "supervision.wake-enqueued",
      payload: {
        acceptedRevision: 1,
        wake: {
          id: "wake-a" as never,
          missionId: "mission-a" as never,
          supervisorSeatId: "supervisor-a" as never,
          leadSeatId: "lead-a" as never,
          episodeKind: "conflict",
          pointers: [
            {
              sequence: 1,
              eventType: "conflict",
              aggregateKind: "supervision",
              aggregateId: "supervision",
            },
          ],
          status: "queued",
          attemptCount: 0,
          error: null,
          createdAt: now,
          updatedAt: now,
        },
      },
      occurredAt: now,
      commandId: "command-1" as never,
      causationEventId: null,
      correlationId: "command-1" as never,
      metadata: {},
    };
    assert.equal(projectSupervisionEvent(state, event).wakeQueue.length, 1);
  }),
);
