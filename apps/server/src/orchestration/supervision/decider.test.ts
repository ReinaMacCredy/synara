import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import {
  emptySupervisionSnapshot,
  type LeadRotation,
  type LeadSeat,
  type PeerBinding,
  type ProfilePreset,
  type ProfileSnapshot,
  type SupervisionMission,
  type SupervisorSeat,
  type WorkflowDirective,
} from "@synara/contracts";

import { decideSupervisionCommand } from "./decider.ts";
import { projectSupervisionEvent } from "./projector.ts";

const now = "2026-08-03T10:00:00.000Z";
const snapshotProfile: ProfileSnapshot = {
  id: "snapshot-default" as never,
  sourcePresetId: "profile-default" as never,
  sourcePresetName: "Default",
  runtime: {
    provider: "codex",
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
    developerInstructions: "Persistent role collaborator",
    providerOptions: {},
  },
  contentHash: "sha256-default",
  createdAt: now,
};
const archivedPreset: ProfilePreset = {
  id: "profile-archived" as never,
  name: "Archived profile",
  roleHints: ["peer"],
  runtime: snapshotProfile.runtime,
  isDefault: false,
  createdAt: now,
  updatedAt: now,
  archivedAt: now,
  clearedAt: null,
  revision: 2,
};
const supervisor: SupervisorSeat = {
  id: "supervisor-a" as never,
  name: "A",
  activeThreadId: "supervisor-thread-a" as never,
  predecessorThreadIds: [],
  profileSnapshotId: snapshotProfile.id,
  status: "active",
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  revision: 1,
};
const lead: LeadSeat = {
  id: "lead-a" as never,
  projectId: "project-a" as never,
  activeThreadId: "root-a" as never,
  predecessorThreadIds: [],
  profileSnapshotId: snapshotProfile.id,
  status: "active",
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  revision: 1,
};
const mission: SupervisionMission = {
  id: "mission-a" as never,
  supervisorSeatId: supervisor.id,
  brief: "Observe Project A",
  focus: "Release coordination",
  scope: [{ kind: "project", projectId: lead.projectId }],
  grants: ["lead.observe", "lead.advise", "workflow.apply", "workflow.revoke", "lead.replace"],
  endCondition: { kind: "manual" },
  status: "active",
  sourceMessageId: "message-owner" as never,
  createdAt: now,
  updatedAt: now,
  completedAt: null,
  revision: 1,
};

const state = {
  ...emptySupervisionSnapshot(now),
  profileSnapshots: [snapshotProfile],
  supervisors: [supervisor],
  leads: [lead],
  missions: [mission],
};

const base = {
  commandId: "command" as never,
  aggregateId: "supervision" as never,
  createdAt: now,
};

it.effect("clears only archived profile presets and projects a durable tombstone", () =>
  Effect.gen(function* () {
    const current = { ...state, profiles: [archivedPreset] };
    const cleared = yield* decideSupervisionCommand({
      state: current,
      command: {
        ...base,
        type: "supervision.profile.clear",
        actor: { kind: "user", actorId: "owner" },
        expectedRevision: archivedPreset.revision,
        profileId: archivedPreset.id,
      },
    });
    assert.equal(Array.isArray(cleared), false);
    if (Array.isArray(cleared)) return;
    assert.equal(cleared.type, "supervision.profile-cleared");
    const projected = projectSupervisionEvent(current, { ...cleared, sequence: 1 });
    assert.equal(projected.profiles[0]?.clearedAt, now);
    assert.equal(projected.profiles[0]?.revision, 3);

    const denied = yield* Effect.exit(
      decideSupervisionCommand({
        state: { ...state, profiles: [{ ...archivedPreset, archivedAt: null }] },
        command: {
          ...base,
          type: "supervision.profile.clear",
          actor: { kind: "user", actorId: "owner" },
          expectedRevision: archivedPreset.revision,
          profileId: archivedPreset.id,
        },
      }),
    );
    assert.equal(denied._tag, "Failure");
  }),
);

it.effect("enforces one active Lead per Project without restricting ordinary Roots", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      decideSupervisionCommand({
        state,
        command: {
          ...base,
          type: "supervision.lead.enroll",
          actor: { kind: "user", actorId: "owner" },
          expectedRevision: 0,
          profilePresetId: "profile-default" as never,
          profileSnapshot: snapshotProfile,
          lead: { ...lead, id: "lead-second" as never, activeThreadId: "root-b" as never },
        },
      }),
    );
    assert.equal(exit._tag, "Failure");
    if (exit._tag === "Failure") assert.match(String(exit.cause), /already has an active Lead/i);
  }),
);

it.effect("denies non-human scope expansion while allowing a bounded mission completion", () =>
  Effect.gen(function* () {
    const expandExit = yield* Effect.exit(
      decideSupervisionCommand({
        state,
        command: {
          ...base,
          type: "supervision.mission.update",
          actor: {
            kind: "thread",
            actorId: supervisor.activeThreadId,
            threadId: supervisor.activeThreadId,
          },
          expectedRevision: mission.revision,
          mission: { ...mission, scope: [{ kind: "all_projects" }] },
        },
      }),
    );
    assert.equal(expandExit._tag, "Failure");

    const completed = yield* decideSupervisionCommand({
      state,
      command: {
        ...base,
        type: "supervision.mission.complete",
        actor: {
          kind: "thread",
          actorId: supervisor.activeThreadId,
          threadId: supervisor.activeThreadId,
        },
        expectedRevision: mission.revision,
        mission,
      },
    });
    assert.equal(Array.isArray(completed), false);
    if (!Array.isArray(completed)) assert.equal(completed.payload.mission?.status, "completed");
  }),
);

it.effect("keeps a conflicting workflow inactive until an owner resolves it", () =>
  Effect.gen(function* () {
    const current: WorkflowDirective = {
      id: "directive-current" as never,
      supervisorSeatId: supervisor.id,
      leadSeatId: lead.id,
      missionId: mission.id,
      slot: "release-policy",
      instruction: "Run backward compatibility checks",
      status: "active",
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    const candidate: WorkflowDirective = {
      ...current,
      id: "directive-candidate" as never,
      instruction: "Skip backward compatibility checks",
      revision: 0,
    };
    const conflictEvent = yield* decideSupervisionCommand({
      state: { ...state, workflowDirectives: [current] },
      command: {
        ...base,
        type: "supervision.workflow.apply",
        actor: {
          kind: "thread",
          actorId: supervisor.activeThreadId,
          threadId: supervisor.activeThreadId,
        },
        expectedRevision: 0,
        directive: candidate,
      },
    });
    assert.equal(Array.isArray(conflictEvent), false);
    if (Array.isArray(conflictEvent)) return;
    assert.equal(conflictEvent.type, "supervision.workflow-conflicted");
    assert.equal(conflictEvent.payload.workflowDirective?.status, "conflicted");
    const projected = projectSupervisionEvent(
      { ...state, workflowDirectives: [current] },
      { ...conflictEvent, sequence: 1 },
    );
    assert.equal(
      projected.workflowDirectives.find((row) => row.id === current.id)?.status,
      "active",
    );
  }),
);

it.effect(
  "starts replacement as a durable rotating state and switches only through server saga",
  () =>
    Effect.gen(function* () {
      const replacementProfile = { ...snapshotProfile, id: "snapshot-replacement" as never };
      const peer: PeerBinding = {
        threadId: "peer-a" as never,
        projectId: lead.projectId,
        leadSeatId: lead.id,
        rootThreadId: lead.activeThreadId,
        profileSnapshotId: snapshotProfile.id,
        status: "active",
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        revision: 1,
      };
      const rotationState = { ...state, peers: [peer] };
      const rotation: LeadRotation = {
        id: "rotation-a" as never,
        leadSeatId: lead.id,
        missionId: mission.id,
        predecessorThreadId: lead.activeThreadId,
        replacementThreadId: "root-replacement" as never,
        replacementProfileSnapshotId: replacementProfile.id,
        state: "requested",
        error: null,
        handoffSummary: null,
        createdAt: now,
        updatedAt: now,
        revision: 0,
      };
      const requested = yield* decideSupervisionCommand({
        state: rotationState,
        command: {
          ...base,
          type: "supervision.lead.replace",
          actor: {
            kind: "thread",
            actorId: supervisor.activeThreadId,
            threadId: supervisor.activeThreadId,
          },
          expectedRevision: lead.revision,
          rotation,
          profilePresetId: "profile-default" as never,
          replacementProfileSnapshot: replacementProfile,
        },
      });
      assert.equal(Array.isArray(requested), false);
      if (Array.isArray(requested)) return;
      assert.equal(requested.type, "supervision.lead-replacement-requested");
      assert.equal(requested.payload.lead?.activeThreadId, lead.activeThreadId);
      assert.equal(requested.payload.lead?.status, "rotating");

      let projected = projectSupervisionEvent(rotationState, { ...requested, sequence: 1 });
      const phases: LeadRotation["state"][] = [
        "frozen",
        "replacement_created",
        "validated",
        "switched",
        "completed",
      ];
      for (const phase of phases) {
        const current = projected.rotations[0]!;
        const advanced = yield* decideSupervisionCommand({
          state: projected,
          command: {
            ...base,
            commandId: `command-${phase}` as never,
            type: "supervision.lead.rotation.advance",
            actor: { kind: "server", actorId: "lead-rotation-reactor" },
            expectedRevision: current.revision,
            rotation: { ...current, state: phase },
          },
        });
        assert.equal(Array.isArray(advanced), false);
        if (!Array.isArray(advanced)) {
          projected = projectSupervisionEvent(projected, {
            ...advanced,
            sequence: projected.snapshotSequence + 1,
          });
        }
      }
      assert.equal(projected.leads[0]?.activeThreadId, rotation.replacementThreadId);
      assert.deepEqual(projected.leads[0]?.predecessorThreadIds, [lead.activeThreadId]);
      assert.equal(projected.peers[0]?.rootThreadId, rotation.replacementThreadId);
      assert.equal(projected.peers[0]?.revision, 2);
      assert.equal(projected.rotations[0]?.state, "completed");
    }),
);

it.effect("admits wake lifecycle only from the server runtime", () =>
  Effect.gen(function* () {
    const wake = {
      id: "wake-a" as never,
      missionId: mission.id,
      supervisorSeatId: supervisor.id,
      leadSeatId: lead.id,
      episodeKind: "thread.approval-requested",
      pointers: [
        {
          sequence: 9,
          eventType: "thread.approval-requested",
          aggregateKind: "thread",
          aggregateId: lead.activeThreadId,
        },
      ],
      status: "queued" as const,
      attemptCount: 0,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    const denied = yield* Effect.exit(
      decideSupervisionCommand({
        state,
        command: {
          ...base,
          type: "supervision.wake.enqueue",
          actor: { kind: "user", actorId: "owner" },
          expectedRevision: 0,
          wake,
        },
      }),
    );
    assert.equal(denied._tag, "Failure");
    const accepted = yield* decideSupervisionCommand({
      state,
      command: {
        ...base,
        type: "supervision.wake.enqueue",
        actor: { kind: "server", actorId: "wake-reactor" },
        expectedRevision: 0,
        wake,
      },
    });
    assert.equal(Array.isArray(accepted), false);
  }),
);
