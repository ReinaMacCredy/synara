import { emptySupervisedRuntimeSnapshot } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  supervisedRoomPeerSessions,
  supervisedRoomRuns,
} from "./supervisedTopologyProjection";

const now = "2026-08-09T00:00:00.000Z";

describe("supervised topology projection", () => {
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
