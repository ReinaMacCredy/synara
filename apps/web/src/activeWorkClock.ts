// FILE: activeWorkClock.ts
// Purpose: Survives ChatView remounts (orchestrator draft → root route, loading
// shell → OrchestratorSurface) so "Working for Ns" stays continuous and never
// degrades to bare "Working..." when React-local localDispatch is wiped.
// Layer: Chat work-status continuity
// Exports: remember / read / clear / resolve continuous work startedAt

import type { ThreadId } from "@synara/contracts";

const workStartedAtByThreadId = new Map<string, string>();

function parseTime(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

/** Keep the earliest stamp so remount recovery never restarts the timer. */
export function rememberActiveWorkStartedAt(threadId: ThreadId, startedAt: string): void {
  const existing = workStartedAtByThreadId.get(threadId);
  if (!existing || parseTime(startedAt) < parseTime(existing)) {
    workStartedAtByThreadId.set(threadId, startedAt);
  }
}

export function readActiveWorkStartedAt(threadId: ThreadId): string | null {
  return workStartedAtByThreadId.get(threadId) ?? null;
}

export function clearActiveWorkStartedAt(threadId: ThreadId): void {
  workStartedAtByThreadId.delete(threadId);
}

/** Test / HMR isolation only. */
export function resetActiveWorkClockForTests(): void {
  workStartedAtByThreadId.clear();
}

/**
 * Prefer the earliest known origin among local send, durable user message,
 * provider turn, and the remount-surviving clock. Empty candidates → null
 * (caller may still show work UI without a duration only if nothing is known).
 */
export function resolveContinuousWorkStartedAt(input: {
  readonly derivedStartedAt: string | null;
  readonly persistedStartedAt: string | null;
}): string | null {
  const { derivedStartedAt, persistedStartedAt } = input;
  if (derivedStartedAt && persistedStartedAt) {
    return parseTime(derivedStartedAt) <= parseTime(persistedStartedAt)
      ? derivedStartedAt
      : persistedStartedAt;
  }
  return derivedStartedAt ?? persistedStartedAt;
}
