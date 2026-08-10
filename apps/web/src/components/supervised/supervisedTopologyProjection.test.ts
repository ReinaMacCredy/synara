import {
  emptySupervisedGovernanceSnapshot,
  emptySupervisedRuntimeSnapshot,
} from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  supervisedRoomPeerSessions,
  supervisedRoomRoot,
  supervisedRoomRuns,
} from "./supervisedTopologyProjection";

const now = "2026-08-09T00:00:00.000Z";

describe("supervised topology projection", () => {
  it("projects an acting-root Supervisor from the canonical live Root lease", () => {
    const governance = {
      ...emptySupervisedGovernanceSnapshot(now),
      agentSeats: [
        {
          id: "lead-previous",
          identityRole: "lead",
          effectiveRole: "lead",
          displayName: "Previous Lead",
        },
        {
          id: "lead-shaped-seat-id",
          identityRole: "supervisor",
          effectiveRole: "acting_root",
          displayName: "Primary Supervisor",
          threadId: "supervisor-root-thread",
        },
      ],
      rootLeases: [
        {
          id: "lease-previous",
          roomId: "room-a",
          holderSeatId: "lead-previous",
          status: "released",
        },
        {
          id: "lease-acting-root",
          roomId: "room-a",
          holderSeatId: "lead-shaped-seat-id",
          status: "active",
        },
      ],
    } as never;

    expect(supervisedRoomRoot(governance, "room-a")).toMatchObject({
      resolution: "resolved",
      holderSeatId: "lead-shaped-seat-id",
      leaseId: "lease-acting-root",
      identityRole: "supervisor",
      roleLabel: "Supervisor acting as Root",
      conversationKind: "supervisor",
      threadId: "supervisor-root-thread",
      displayName: "Primary Supervisor",
    });
  });

  it("keeps a canonical Lead Root labeled and routed as Lead", () => {
    const governance = {
      ...emptySupervisedGovernanceSnapshot(now),
      agentSeats: [
        {
          id: "lead-current",
          identityRole: "lead",
          effectiveRole: "lead",
          displayName: "Room Lead",
          threadId: "lead-root-thread",
        },
      ],
      rootLeases: [
        {
          id: "lease-lead",
          roomId: "room-a",
          holderSeatId: "lead-current",
          status: "active",
        },
      ],
    } as never;

    expect(supervisedRoomRoot(governance, "room-a")).toMatchObject({
      resolution: "resolved",
      holderSeatId: "lead-current",
      identityRole: "lead",
      roleLabel: "Lead",
      conversationKind: "lead",
      threadId: "lead-root-thread",
    });
  });

  it("does not invent a Root identity when the canonical lease and seat disagree", () => {
    const governance = {
      ...emptySupervisedGovernanceSnapshot(now),
      agentSeats: [
        {
          id: "supervisor-without-assumption",
          identityRole: "supervisor",
          effectiveRole: "supervisor",
          displayName: "Primary Supervisor",
        },
      ],
      rootLeases: [
        {
          id: "lease-inconsistent",
          roomId: "room-a",
          holderSeatId: "supervisor-without-assumption",
          status: "active",
        },
      ],
    } as never;

    expect(supervisedRoomRoot(governance, "room-a")).toEqual({
      resolution: "unresolved",
      holderSeatId: "supervisor-without-assumption",
      reason: "inconsistent_holder_role",
    });
  });

  it("keeps run activity scoped to the selected Room", () => {
    const snapshot = {
      ...emptySupervisedRuntimeSnapshot(now),
      tasks: [
        { id: "task-a", roomId: "room-a" },
        { id: "task-b", roomId: "room-b" },
      ],
      runs: [
        { id: "run-a", roomId: "room-a", taskId: "task-a" },
        { id: "run-b", roomId: "room-b", taskId: "task-b" },
      ],
    } as never;

    expect(supervisedRoomRuns(snapshot, "room-a").map((run) => run.id)).toEqual(["run-a"]);
  });

  it("shows only real, latest Peer model sessions for the selected Room", () => {
    const snapshot = {
      ...emptySupervisedRuntimeSnapshot(now),
      peerSpecialties: [
        { id: "retained-config-without-runtime-session", allowedScopes: [] },
      ],
      modelSessions: [
        {
          id: "peer-old",
          roomId: "room-a",
          role: "peer",
          threadId: "peer-thread",
          peerSpecialtyId: "peer-specialty",
          updatedAt: "2026-08-09T00:00:00.000Z",
        },
        {
          id: "peer-latest",
          roomId: "room-a",
          role: "peer",
          threadId: "peer-thread",
          peerSpecialtyId: "peer-specialty",
          updatedAt: "2026-08-09T00:01:00.000Z",
        },
        {
          id: "lead-session",
          roomId: "room-a",
          role: "lead",
          threadId: "lead-thread",
          updatedAt: "2026-08-09T00:02:00.000Z",
        },
        {
          id: "peer-other-room",
          roomId: "room-b",
          role: "peer",
          threadId: "peer-thread-b",
          updatedAt: "2026-08-09T00:03:00.000Z",
        },
      ],
    } as never;

    expect(supervisedRoomPeerSessions(snapshot, "room-a").map((session) => session.id)).toEqual([
      "peer-latest",
    ]);
  });
});
