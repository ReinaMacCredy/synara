import type { GetOrchestratorSnapshotResult } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { resolveOrchestratorRootRouteState } from "./-orchestratorRootRouteState";

const result = {
  snapshot: {},
  projectionBehind: false,
} as GetOrchestratorSnapshotResult;

describe("resolveOrchestratorRootRouteState", () => {
  it("renders a visible loading state before the first snapshot arrives", () => {
    expect(
      resolveOrchestratorRootRouteState({ data: undefined, isPending: true, isError: false }),
    ).toEqual({ kind: "loading" });
  });

  it("keeps the last valid snapshot when a background refetch fails", () => {
    expect(
      resolveOrchestratorRootRouteState({ data: result, isPending: false, isError: true }),
    ).toEqual({ kind: "ready", result, projectionBehind: true });
  });

  it("shows a fatal state only when no valid snapshot is available", () => {
    expect(
      resolveOrchestratorRootRouteState({ data: undefined, isPending: false, isError: true }),
    ).toEqual({ kind: "fatal" });
  });

  it("preserves a projection-behind signal from a successful snapshot", () => {
    const behindResult = { ...result, projectionBehind: true };
    expect(
      resolveOrchestratorRootRouteState({
        data: behindResult,
        isPending: false,
        isError: false,
      }),
    ).toEqual({ kind: "ready", result: behindResult, projectionBehind: true });
  });
});
