// FILE: turnWorkStatus.test.ts
// Purpose: Pins shared Working→Worked gates for normal + Supervised.

import { describe, expect, it, beforeEach } from "vitest";
import { ThreadId, TurnId } from "@veylen/contracts";

import {
  clearTurnWorkStartedAt,
  deriveTurnWorkStatus,
  hasOpenUserTurnAwaitingAnswer,
  readTurnWorkStartedAt,
  rememberTurnWorkStartedAt,
  resetTurnWorkStatusForTests,
} from "./turnWorkStatus";

const thread = ThreadId.makeUnsafe("thread-1");
const turn1 = TurnId.makeUnsafe("turn-1");
const turn2 = TurnId.makeUnsafe("turn-2");

describe("hasOpenUserTurnAwaitingAnswer", () => {
  it("is true after remount when transcript ends on user with no turn yet", () => {
    expect(
      hasOpenUserTurnAwaitingAnswer({
        messages: [{ role: "user", id: "u1", createdAt: "2026-08-05T18:36:00.000Z" }],
        latestTurn: null,
        session: { status: "ready", orchestrationStatus: "ready", activeTurnId: undefined },
      }),
    ).toBe(true);
  });

  it("is false when assistant is the transcript tail even if activeTurnId lingers", () => {
    expect(
      hasOpenUserTurnAwaitingAnswer({
        messages: [
          { role: "user", id: "u1", createdAt: "2026-08-05T18:36:00.000Z" },
          { role: "assistant", id: "a1", createdAt: "2026-08-05T18:36:22.000Z" },
        ],
        latestTurn: {
          turnId: turn1,
          state: "completed",
          startedAt: "2026-08-05T18:36:01.000Z",
          completedAt: "2026-08-05T18:36:22.000Z",
        },
        session: {
          status: "ready",
          orchestrationStatus: "ready",
          // Sticky leftover — must not keep Working alive after the answer.
          activeTurnId: turn1,
        },
      }),
    ).toBe(false);
  });

  it("is false for settled turn with ready session and no bare activeTurnId dependence", () => {
    expect(
      hasOpenUserTurnAwaitingAnswer({
        messages: [
          { role: "user", id: "u1", createdAt: "2026-08-05T18:36:00.000Z" },
          { role: "assistant", id: "a1", createdAt: "2026-08-05T18:36:22.000Z" },
        ],
        latestTurn: {
          turnId: turn1,
          state: "completed",
          startedAt: "2026-08-05T18:36:01.000Z",
          completedAt: "2026-08-05T18:36:22.000Z",
        },
        session: { status: "ready", orchestrationStatus: "ready", activeTurnId: undefined },
      }),
    ).toBe(false);
  });
});

describe("deriveTurnWorkStatus", () => {
  it("is idle when the assistant answer is the transcript tail", () => {
    const status = deriveTurnWorkStatus({
      messages: [
        { role: "user", id: "u1", createdAt: "2026-08-05T18:36:00.000Z" },
        { role: "assistant", id: "a1", createdAt: "2026-08-05T18:36:22.000Z" },
      ],
      latestTurn: {
        turnId: turn1,
        state: "completed",
        startedAt: "2026-08-05T18:36:01.000Z",
        completedAt: "2026-08-05T18:36:22.000Z",
        requestedAt: "2026-08-05T18:36:00.500Z",
      },
      session: { status: "ready", orchestrationStatus: "ready", activeTurnId: undefined },
      localDispatchActive: false,
      localDispatchStartedAt: null,
      isConnecting: false,
      hasLiveTurn: false,
      hasLiveTurnTail: false,
      persistedStartedAtForTurn: null,
    });
    expect(status.activeTurnInProgress).toBe(false);
    expect(status.activeWorkStartedAt).toBeNull();
    expect(status.isWorking).toBe(false);
  });

  it("stays idle when hasLiveTurn flaps after a true idle settle", () => {
    // First frame: true idle → sticky. Second: hasLiveTurn flap must not re-open.
    const base = {
      messages: [
        { role: "user" as const, id: "u1", createdAt: "2026-08-05T18:36:00.000Z" },
        { role: "assistant" as const, id: "a1", createdAt: "2026-08-05T18:36:22.000Z" },
      ],
      latestTurn: {
        turnId: turn1,
        state: "completed" as const,
        startedAt: "2026-08-05T18:36:01.000Z",
        completedAt: "2026-08-05T18:36:22.000Z",
        requestedAt: "2026-08-05T18:36:00.500Z",
      },
      localDispatchActive: false,
      localDispatchStartedAt: null as string | null,
      isConnecting: false,
      hasStreamingAssistantText: false,
      persistedStartedAtForTurn: "2026-08-05T18:36:00.000Z" as string | null,
    };
    const idle = deriveTurnWorkStatus({
      ...base,
      session: { status: "ready", orchestrationStatus: "ready", activeTurnId: undefined },
      hasLiveTurn: false,
      hasLiveTurnTail: false,
    });
    expect(idle.activeTurnInProgress).toBe(false);

    const flap = deriveTurnWorkStatus({
      ...base,
      session: { status: "running", orchestrationStatus: "running", activeTurnId: turn1 },
      hasLiveTurn: true,
      hasLiveTurnTail: true,
    });
    expect(flap.activeTurnInProgress).toBe(false);
    expect(flap.isWorking).toBe(false);
  });

  it("uses the latest user message as startedAt for a live turn", () => {
    const userAt = "2026-08-05T19:00:00.000Z";
    const status = deriveTurnWorkStatus({
      messages: [{ role: "user", id: "u2", createdAt: userAt }],
      latestTurn: null,
      session: { status: "running", orchestrationStatus: "running", activeTurnId: turn2 },
      localDispatchActive: false,
      localDispatchStartedAt: null,
      isConnecting: false,
      hasLiveTurn: true,
      hasLiveTurnTail: false,
      persistedStartedAtForTurn: null,
    });
    expect(status.activeTurnInProgress).toBe(true);
    expect(status.activeWorkStartedAt).toBe(userAt);
    expect(status.turnKey).toBe("u2");
  });

  it("does not inherit a previous turn's user timestamp when last role is still assistant", () => {
    const status = deriveTurnWorkStatus({
      messages: [
        { role: "user", id: "u1", createdAt: "2026-08-05T18:00:00.000Z" },
        { role: "assistant", id: "a1", createdAt: "2026-08-05T18:03:46.000Z" },
      ],
      latestTurn: {
        turnId: turn1,
        state: "completed",
        startedAt: "2026-08-05T18:00:01.000Z",
        completedAt: "2026-08-05T18:03:46.000Z",
      },
      session: { status: "ready", orchestrationStatus: "ready", activeTurnId: undefined },
      localDispatchActive: true,
      localDispatchStartedAt: "2026-08-05T19:10:00.100Z",
      isConnecting: false,
      hasLiveTurn: false,
      hasLiveTurnTail: false,
      persistedStartedAtForTurn: null,
    });
    expect(status.activeTurnInProgress).toBe(true);
    // Must be the new send, not the prior turn's multi-minute origin.
    expect(status.activeWorkStartedAt).toBe("2026-08-05T19:10:00.100Z");
    expect(status.turnKey).toBe("send:2026-08-05T19:10:00.100Z");
  });

  it("uses the new user message once it is the transcript tail", () => {
    const status = deriveTurnWorkStatus({
      messages: [
        { role: "user", id: "u1", createdAt: "2026-08-05T18:00:00.000Z" },
        { role: "assistant", id: "a1", createdAt: "2026-08-05T18:03:46.000Z" },
        { role: "user", id: "u2", createdAt: "2026-08-05T19:10:00.000Z" },
      ],
      latestTurn: null,
      session: { status: "running", orchestrationStatus: "starting", activeTurnId: null },
      localDispatchActive: true,
      localDispatchStartedAt: "2026-08-05T19:10:00.100Z",
      isConnecting: false,
      hasLiveTurn: false,
      hasLiveTurnTail: false,
      persistedStartedAtForTurn: null,
    });
    expect(status.activeWorkStartedAt).toBe("2026-08-05T19:10:00.000Z");
    expect(status.turnKey).toBe("u2");
  });

  it("keeps the user-message origin while the assistant is streaming (no clock jump)", () => {
    const userAt = "2026-08-05T19:10:00.000Z";
    const status = deriveTurnWorkStatus({
      messages: [
        { role: "user", id: "u1", createdAt: userAt },
        { role: "assistant", id: "a1", createdAt: "2026-08-05T19:10:05.000Z" },
      ],
      latestTurn: {
        turnId: turn1,
        state: "running",
        startedAt: "2026-08-05T19:10:01.000Z",
        completedAt: null,
        requestedAt: "2026-08-05T19:10:00.500Z",
      },
      session: {
        status: "running",
        orchestrationStatus: "running",
        activeTurnId: turn1,
      },
      localDispatchActive: false,
      localDispatchStartedAt: null,
      isConnecting: false,
      hasLiveTurn: true,
      hasLiveTurnTail: false,
      persistedStartedAtForTurn: null,
    });
    expect(status.activeTurnInProgress).toBe(true);
    // Must stay on the user prompt time — jumping to turn.startedAt restarts
    // Working for and flicks the morning Working→Worked handoff.
    expect(status.activeWorkStartedAt).toBe(userAt);
    expect(status.turnKey).toBe("u1");
  });

  it("keeps Working mounted when session flaps off but assistant is still streaming", () => {
    const userAt = "2026-08-05T19:10:00.000Z";
    const status = deriveTurnWorkStatus({
      messages: [
        { role: "user", id: "u1", createdAt: userAt },
        { role: "assistant", id: "a1", createdAt: "2026-08-05T19:10:05.000Z" },
      ],
      latestTurn: {
        turnId: turn1,
        state: "completed",
        startedAt: "2026-08-05T19:10:01.000Z",
        completedAt: "2026-08-05T19:10:06.000Z",
        requestedAt: "2026-08-05T19:10:00.500Z",
      },
      session: {
        status: "ready",
        orchestrationStatus: "ready",
        activeTurnId: undefined,
      },
      localDispatchActive: false,
      localDispatchStartedAt: null,
      isConnecting: false,
      hasLiveTurn: false,
      hasLiveTurnTail: false,
      hasStreamingAssistantText: true,
      persistedStartedAtForTurn: null,
    });
    expect(status.activeTurnInProgress).toBe(true);
    expect(status.activeWorkStartedAt).toBe(userAt);
  });

  it("prefers earlier remount seed within the same turn", () => {
    const status = deriveTurnWorkStatus({
      messages: [{ role: "user", id: "u1", createdAt: "2026-08-05T19:10:00.200Z" }],
      latestTurn: null,
      session: null,
      localDispatchActive: true,
      localDispatchStartedAt: "2026-08-05T19:10:00.200Z",
      isConnecting: false,
      hasLiveTurn: false,
      hasLiveTurnTail: false,
      persistedStartedAtForTurn: "2026-08-05T19:10:00.000Z",
    });
    expect(status.activeWorkStartedAt).toBe("2026-08-05T19:10:00.000Z");
  });
});

describe("per-turn remount seed", () => {
  beforeEach(() => {
    resetTurnWorkStatusForTests();
  });

  it("replaces seed when the turnKey changes (no multi-minute carry)", () => {
    rememberTurnWorkStartedAt(thread, "u1", "2026-08-05T18:00:00.000Z");
    rememberTurnWorkStartedAt(thread, "u2", "2026-08-05T19:10:00.000Z");
    expect(readTurnWorkStartedAt(thread, "u1")).toBeNull();
    expect(readTurnWorkStartedAt(thread, "u2")).toBe("2026-08-05T19:10:00.000Z");
  });

  it("keeps the earliest stamp within the same turn", () => {
    rememberTurnWorkStartedAt(thread, "u1", "2026-08-05T19:10:00.200Z");
    rememberTurnWorkStartedAt(thread, "u1", "2026-08-05T19:10:00.000Z");
    expect(readTurnWorkStartedAt(thread, "u1")).toBe("2026-08-05T19:10:00.000Z");
  });

  it("clears on settle", () => {
    rememberTurnWorkStartedAt(thread, "u1", "2026-08-05T19:10:00.000Z");
    clearTurnWorkStartedAt(thread);
    expect(readTurnWorkStartedAt(thread, "u1")).toBeNull();
  });
});
