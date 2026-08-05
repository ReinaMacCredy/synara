// FILE: orchestratorRoutePromotion.test.ts
// Purpose: Pins deferred orchestrator root navigation (no mid-turn remount).

import { describe, expect, it } from "vitest";
import { ThreadId } from "@synara/contracts";

import { shouldFlushOrchestratorRootNavigation } from "./orchestratorRoutePromotion";

const root = ThreadId.makeUnsafe("root-1");
const other = ThreadId.makeUnsafe("root-2");

describe("shouldFlushOrchestratorRootNavigation", () => {
  it("does not flush while a turn is in flight (keeps ChatView mounted)", () => {
    expect(
      shouldFlushOrchestratorRootNavigation({
        pendingRootThreadId: root,
        currentThreadId: root,
        turnInFlight: true,
      }),
    ).toBe(false);
  });

  it("flushes once the matching thread is idle", () => {
    expect(
      shouldFlushOrchestratorRootNavigation({
        pendingRootThreadId: root,
        currentThreadId: root,
        turnInFlight: false,
      }),
    ).toBe(true);
  });

  it("ignores pending navigation for a different open thread", () => {
    expect(
      shouldFlushOrchestratorRootNavigation({
        pendingRootThreadId: root,
        currentThreadId: other,
        turnInFlight: false,
      }),
    ).toBe(false);
  });

  it("is a no-op without a pending root", () => {
    expect(
      shouldFlushOrchestratorRootNavigation({
        pendingRootThreadId: null,
        currentThreadId: root,
        turnInFlight: false,
      }),
    ).toBe(false);
  });
});
