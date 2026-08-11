import assert from "node:assert/strict";

import {
  emptySupervisedGovernanceSnapshot,
  emptySupervisedRuntimeSnapshot,
  type OrchestrationCommand,
  type ProjectId,
  type Room,
  type SupervisedGovernanceSnapshot,
} from "@veylen/contracts";
import { Effect } from "effect";
import { describe, it } from "vitest";

import { decideSupervisedRoomLifecycleForThreadCommand } from "./roomLifecycle.ts";

const now = "2026-08-09T00:00:00.000Z";
const projectId = "project-1" as ProjectId;
const room = (status: Room["status"], leadSeatId: Room["leadSeatId"] = null): Room => ({
  id: "thread-1" as Room["id"],
  projectId,
  title: "Room",
  leadSeatId,
  status,
  graphRevision: 0,
  revision: status === "draft" ? 0 : 1,
  createdAt: now,
  updatedAt: now,
});
const governance: SupervisedGovernanceSnapshot = {
  ...emptySupervisedGovernanceSnapshot(now),
  agentSeats: [
    {
      id: "lead-1" as SupervisedGovernanceSnapshot["agentSeats"][number]["id"],
      workspaceId:
        "workspace-1" as SupervisedGovernanceSnapshot["agentSeats"][number]["workspaceId"],
      roomIds: ["thread-1" as Room["id"]],
      identityRole: "lead",
      effectiveRole: "lead",
      profileId: "profile-1" as SupervisedGovernanceSnapshot["agentSeats"][number]["profileId"],
      providerSessionId: null,
      lifecycleState: "active",
      workState: "idle",
      authorityReceiptId:
        "receipt-1" as SupervisedGovernanceSnapshot["agentSeats"][number]["authorityReceiptId"],
      threadId: "thread-1" as SupervisedGovernanceSnapshot["agentSeats"][number]["threadId"],
      projectId,
      profileSnapshotId:
        "profile-1" as SupervisedGovernanceSnapshot["agentSeats"][number]["profileSnapshotId"],
      predecessorThreadIds: [],
      displayName: null,
      createdAt: now,
      retainedAt: null,
      retiredAt: null,
      revision: 0,
      updatedAt: now,
    },
  ],
};
const turnStart = {
  type: "thread.turn.start",
  commandId: "command-turn",
  threadId: "thread-1",
  message: { messageId: "message-1", role: "user", text: "start", attachments: [] },
  runtimeMode: "full-access",
  interactionMode: "default",
  createdAt: now,
} as unknown as OrchestrationCommand;
const sessionSet = (status: "ready" | "running" | "error") =>
  ({
    type: "thread.session.set",
    commandId: `command-session-${status}`,
    threadId: "thread-1",
    session: {
      threadId: "thread-1",
      status,
      providerName: "codex",
      runtimeMode: "full-access",
      activeTurnId: status === "running" ? "turn-1" : null,
      lastError: status === "error" ? "provider failed" : null,
      updatedAt: now,
    },
    createdAt: now,
  }) as OrchestrationCommand;

describe("server-owned Lead Room lifecycle", () => {
  it("binds the Lead and enters provisioning atomically with the first turn", async () => {
    const events = await Effect.runPromise(
      decideSupervisedRoomLifecycleForThreadCommand({
        command: turnStart as Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
        projectId,
        governance,
        runtime: { ...emptySupervisedRuntimeSnapshot(now), rooms: [room("draft")] },
      }),
    );

    assert.equal(events.length, 1);
    assert.equal(events[0]?.payload.room?.status, "provisioning");
    assert.equal(events[0]?.payload.room?.leadSeatId, "lead-1");
  });

  it("only enters ready and active after the provider reports ready", async () => {
    const events = await Effect.runPromise(
      decideSupervisedRoomLifecycleForThreadCommand({
        command: sessionSet("ready") as Extract<
          OrchestrationCommand,
          { type: "thread.session.set" }
        >,
        projectId,
        governance,
        runtime: {
          ...emptySupervisedRuntimeSnapshot(now),
          rooms: [room("provisioning", "lead-1" as Room["leadSeatId"])],
        },
      }),
    );

    assert.deepEqual(
      events.map((event) => event.payload.room?.status),
      ["ready", "active"],
    );
  });

  it("fails provisioning when provider startup fails", async () => {
    const events = await Effect.runPromise(
      decideSupervisedRoomLifecycleForThreadCommand({
        command: sessionSet("error") as Extract<
          OrchestrationCommand,
          { type: "thread.session.set" }
        >,
        projectId,
        governance,
        runtime: {
          ...emptySupervisedRuntimeSnapshot(now),
          rooms: [room("provisioning", "lead-1" as Room["leadSeatId"])],
        },
      }),
    );

    assert.equal(events[0]?.payload.room?.status, "failed");
  });

  it("rejects an active Room whose Root holder differs from the active Lead", async () => {
    const exit = await Effect.runPromiseExit(
      decideSupervisedRoomLifecycleForThreadCommand({
        command: turnStart as Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
        projectId,
        governance,
        runtime: {
          ...emptySupervisedRuntimeSnapshot(now),
          rooms: [room("active", "lead-stale" as Room["leadSeatId"])],
        },
      }),
    );

    assert.equal(exit._tag, "Failure");
  });
});
