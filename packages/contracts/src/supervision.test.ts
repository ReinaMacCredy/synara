import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  ClientOrchestrationCommand,
  OrchestrationShellStreamEvent,
  ProviderInteractionMode,
  SupervisionCommand,
  SupervisionSnapshot,
  emptySupervisionSnapshot,
} from "./index";

const now = "2026-08-03T10:00:00.000Z";

it.effect("round-trips a many-target mission and durable wake queue", () =>
  Effect.gen(function* () {
    const snapshot = yield* Schema.decodeUnknownEffect(SupervisionSnapshot)({
      ...emptySupervisionSnapshot(now),
      missions: [
        {
          id: "mission-release",
          supervisorSeatId: "supervisor-c",
          brief: "Observe today's release",
          focus: "Backward compatibility and user response",
          scope: [
            { kind: "project", projectId: "project-tech" },
            { kind: "lead", leadSeatId: "lead-tech" },
          ],
          grants: ["lead.observe", "lead.advise", "lead.replace"],
          endCondition: { kind: "manual" },
          status: "active",
          sourceMessageId: "message-owner",
          createdAt: now,
          updatedAt: now,
          completedAt: null,
          revision: 1,
        },
      ],
      wakeQueue: [
        {
          id: "wake-release",
          missionId: "mission-release",
          supervisorSeatId: "supervisor-c",
          leadSeatId: "lead-tech",
          episodeKind: "supervised.specialist.created",
          pointers: [
            {
              sequence: 41,
              eventType: "supervised.specialist.created",
              aggregateKind: "specialist",
              aggregateId: "root-tech",
            },
          ],
          status: "queued",
          attemptCount: 0,
          error: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    assert.equal(snapshot.missions[0]?.scope.length, 2);
    assert.equal(snapshot.wakeQueue[0]?.status, "queued");
  }),
);

it.effect("decodes live supervision shell updates", () =>
  Effect.gen(function* () {
    const supervision = emptySupervisionSnapshot(now);
    const event = yield* Schema.decodeUnknownEffect(OrchestrationShellStreamEvent)({
      kind: "supervision-updated",
      sequence: 42,
      supervision,
    });

    assert.equal(event.kind, "supervision-updated");
    if (event.kind === "supervision-updated") {
      assert.equal(event.supervision.updatedAt, now);
    }
  }),
);

it.effect("keeps Supervise outside ProviderInteractionMode", () =>
  Effect.gen(function* () {
    assert.equal(yield* Schema.decodeUnknownEffect(ProviderInteractionMode)("plan"), "plan");
    assert.equal(
      (yield* Effect.exit(Schema.decodeUnknownEffect(ProviderInteractionMode)("supervise")))._tag,
      "Failure",
    );
  }),
);

it.effect("decodes atomic Lead first-send bootstrap on a client turn", () =>
  Effect.gen(function* () {
    const command = yield* Schema.decodeUnknownEffect(ClientOrchestrationCommand)({
      type: "thread.turn.start",
      commandId: "first-send-lead",
      threadId: "root-tech",
      message: {
        messageId: "message-first",
        role: "user",
        text: "Own the release outcome",
        attachments: [],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      threadBootstrap: {
        projectId: "project-tech",
        title: "Tech release",
        modelSelection: { provider: "codex", model: "gpt-5.6-sol" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: now,
      },
      supervisionBootstrap: {
        kind: "lead",
        profilePresetId: "profile-lead-default",
        lead: {
          id: "lead-tech",
          projectId: "project-tech",
          activeThreadId: "root-tech",
          predecessorThreadIds: [],
          profileSnapshotId: "snapshot-lead-tech",
          status: "active",
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          revision: 0,
        },
      },
      createdAt: now,
    });
    assert.equal(command.type, "thread.turn.start");
    assert.equal(command.threadBootstrap?.projectId, "project-tech");
    assert.equal(command.supervisionBootstrap?.kind, "lead");
  }),
);

it.effect("decodes server-only queue and rotation lifecycle commands", () =>
  Effect.gen(function* () {
    const command = yield* Schema.decodeUnknownEffect(SupervisionCommand)({
      type: "supervision.wake.enqueue",
      commandId: "enqueue-wake",
      aggregateId: "supervision",
      actor: { kind: "server", actorId: "wake-reactor" },
      expectedRevision: 0,
      createdAt: now,
      wake: {
        id: "wake-1",
        missionId: "mission-1",
        supervisorSeatId: "supervisor-1",
        leadSeatId: "lead-1",
        episodeKind: "thread.approval-requested",
        pointers: [
          {
            sequence: 7,
            eventType: "thread.approval-requested",
            aggregateKind: "thread",
            aggregateId: "root-1",
          },
        ],
        status: "queued",
        attemptCount: 0,
        error: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    assert.equal(command.type, "supervision.wake.enqueue");
  }),
);
