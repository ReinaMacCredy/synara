import type { GetOrchestratorSnapshotResult } from "@synara/contracts";

export type OrchestratorRootRouteState =
  | { readonly kind: "loading" }
  | { readonly kind: "fatal" }
  | {
      readonly kind: "ready";
      readonly result: GetOrchestratorSnapshotResult;
      readonly projectionBehind: boolean;
    };

export function resolveOrchestratorRootRouteState(input: {
  readonly data: GetOrchestratorSnapshotResult | undefined;
  readonly isPending: boolean;
  readonly isError: boolean;
}): OrchestratorRootRouteState {
  if (input.data) {
    return {
      kind: "ready",
      result: input.data,
      projectionBehind: input.data.projectionBehind || input.isError,
    };
  }
  return input.isPending ? { kind: "loading" } : { kind: "fatal" };
}
