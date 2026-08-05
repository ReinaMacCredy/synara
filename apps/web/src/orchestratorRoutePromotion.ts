// FILE: orchestratorRoutePromotion.ts
// Purpose: Orchestrator first-send must not remount ChatView mid-turn. Normal
// chat keeps one ChatView for Working→Worked; root promotion defers the
// /orchestrator/$rootThreadId navigation until the turn is idle so both modes
// share that continuous work-status path.
// Layer: Orchestrator route timing
// Exports: shouldFlushOrchestratorRootNavigation, ORCHESTRATOR_ROOT_NAV_AFTER_SETTLE_MS

import type { ThreadId } from "@synara/contracts";

/** Let Working→Worked (160ms) + process collapse (~220ms) finish before route change. */
export const ORCHESTRATOR_ROOT_NAV_AFTER_SETTLE_MS = 450;

/**
 * True when a deferred draft→root navigation may run: pending id matches the
 * open thread and no turn is in flight (same idle condition as normal chat).
 */
export function shouldFlushOrchestratorRootNavigation(input: {
  readonly pendingRootThreadId: ThreadId | null;
  readonly currentThreadId: ThreadId;
  readonly turnInFlight: boolean;
}): boolean {
  return (
    input.pendingRootThreadId != null &&
    input.pendingRootThreadId === input.currentThreadId &&
    !input.turnInFlight
  );
}
