// FILE: orchestratorRoutePromotion.ts
// Purpose: Orchestrator first-send must not remount ChatView for Working→Worked.
// Normal chat never remounts on settle; draft→/orchestrator/$root must not either
// (post-settle navigate flashed a blank then reloaded Worked). Pending promote is
// cleared in place; URL upgrades only when the user opens the root elsewhere.
// Layer: Orchestrator route timing
// Exports: shouldClearPendingOrchestratorRootPromotion, isOrchestratorTurnFullySettled

import type { ThreadId } from "@synara/contracts";

/**
 * True when a deferred first-send promote may clear its pending flag.
 * Does **not** mean "navigate now" — navigating remounts ChatView and reloads
 * Worked (the post-settle blink). Clear pending only; stay on the draft surface.
 */
export function shouldClearPendingOrchestratorRootPromotion(input: {
  readonly pendingRootThreadId: ThreadId | null;
  readonly currentThreadId: ThreadId;
  readonly turnInFlight: boolean;
  readonly turnFullySettled: boolean;
}): boolean {
  return (
    input.pendingRootThreadId != null &&
    input.pendingRootThreadId === input.currentThreadId &&
    !input.turnInFlight &&
    input.turnFullySettled
  );
}

/** Pure helper for ChatView: durable settle for deferred orchestrator URL upgrade. */
export function isOrchestratorTurnFullySettled(input: {
  readonly messages: ReadonlyArray<{ readonly role: string }>;
  readonly latestTurn: {
    readonly completedAt?: string | null;
    readonly state?: string | null;
  } | null;
  readonly threadError?: string | null;
}): boolean {
  if (input.threadError) {
    return true;
  }
  let lastRole: string | null = null;
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index];
    if (!message) continue;
    if (message.role !== "user" && message.role !== "assistant") continue;
    lastRole = message.role;
    break;
  }
  if (lastRole === "assistant") {
    return true;
  }
  const state = input.latestTurn?.state ?? null;
  if (state === "interrupted" || state === "error") {
    return true;
  }
  if (input.latestTurn?.completedAt != null && lastRole !== "user") {
    return true;
  }
  return false;
}
