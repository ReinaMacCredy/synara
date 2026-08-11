export const SUPERVISED_WAKE_EVENT_TYPES = new Set([
  "supervised.peer-upserted",
  // Legacy journal compatibility; projected through the Peer v1 upcaster.
  "supervised.specialist-upserted",
  "supervised.signal-derived",
  "supervised.signal-reset",
  // TODO(veylen): Remove these legacy governance event names on or after 2027-08-09
  // once every supported database has replayed migration 108.
  "supervision.workflow-conflicted",
  "supervision.lead-replaced",
  "supervised.workflow-conflicted",
  "supervised.lead-replaced",
  "thread.approval-requested",
  "thread.user-input-requested",
]);

export const SUPERVISED_IGNORED_EVENT_TYPES = new Set([
  "thread.activity-appended",
  "thread.turn-diff-completed",
  "thread.session-set",
  "thread.message-sent",
]);

export function isEligibleSupervisedWake(input: {
  readonly eventType: string;
  readonly aggregateThreadId: string | null;
  readonly leadThreadIds: ReadonlySet<string>;
  readonly peerThreadIds: ReadonlySet<string>;
}): boolean {
  if (SUPERVISED_IGNORED_EVENT_TYPES.has(input.eventType)) return false;
  if (!SUPERVISED_WAKE_EVENT_TYPES.has(input.eventType)) return false;
  if (input.aggregateThreadId === null) return true;
  if (input.peerThreadIds.has(input.aggregateThreadId)) return false;
  return input.leadThreadIds.has(input.aggregateThreadId);
}

export function coalesceSupervisedWakePointers<
  Pointer extends { readonly sequence: number; readonly eventType: string },
>(pointers: readonly Pointer[]): readonly Pointer[] {
  const byType = new Map<string, Pointer>();
  for (const pointer of pointers) {
    const current = byType.get(pointer.eventType);
    if (!current || pointer.sequence > current.sequence) byType.set(pointer.eventType, pointer);
  }
  return [...byType.values()].toSorted((left, right) => left.sequence - right.sequence);
}
