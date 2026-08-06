// FILE: orchestratorRoutePromotion.test.ts
// Purpose: Pins deferred orchestrator promote clear (no post-settle remount).

import { describe, expect, it } from "vitest";
import { ThreadId } from "@synara/contracts";

import {
  isOrchestratorTurnFullySettled,
  shouldClearPendingOrchestratorRootPromotion,
} from "./orchestratorRoutePromotion";

const root = ThreadId.makeUnsafe("root-1");
const other = ThreadId.makeUnsafe("root-2");

describe("shouldClearPendingOrchestratorRootPromotion", () => {
  it("does not clear while a turn is in flight", () => {
    expect(
      shouldClearPendingOrchestratorRootPromotion({
        pendingRootThreadId: root,
        currentThreadId: root,
        turnInFlight: true,
        turnFullySettled: true,
      }),
    ).toBe(false);
  });

  it("does not clear on idle gaps without durable settle", () => {
    expect(
      shouldClearPendingOrchestratorRootPromotion({
        pendingRootThreadId: root,
        currentThreadId: root,
        turnInFlight: false,
        turnFullySettled: false,
      }),
    ).toBe(false);
  });

  it("clears once idle and fully settled (no navigate — avoids Worked remount blink)", () => {
    expect(
      shouldClearPendingOrchestratorRootPromotion({
        pendingRootThreadId: root,
        currentThreadId: root,
        turnInFlight: false,
        turnFullySettled: true,
      }),
    ).toBe(true);
  });

  it("ignores pending for a different open thread", () => {
    expect(
      shouldClearPendingOrchestratorRootPromotion({
        pendingRootThreadId: root,
        currentThreadId: other,
        turnInFlight: false,
        turnFullySettled: true,
      }),
    ).toBe(false);
  });

  it("is a no-op without a pending root", () => {
    expect(
      shouldClearPendingOrchestratorRootPromotion({
        pendingRootThreadId: null,
        currentThreadId: root,
        turnInFlight: false,
        turnFullySettled: true,
      }),
    ).toBe(false);
  });
});

describe("isOrchestratorTurnFullySettled", () => {
  it("is true when the transcript ends on an assistant answer", () => {
    expect(
      isOrchestratorTurnFullySettled({
        messages: [{ role: "user" }, { role: "assistant" }],
        latestTurn: null,
      }),
    ).toBe(true);
  });

  it("is false while still waiting on a user tail", () => {
    expect(
      isOrchestratorTurnFullySettled({
        messages: [{ role: "user" }],
        latestTurn: { completedAt: null, state: "running" },
      }),
    ).toBe(false);
  });
});
