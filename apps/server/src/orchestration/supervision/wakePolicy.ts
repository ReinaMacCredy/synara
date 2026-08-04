export const SUPERVISION_WAKE_EVENT_TYPES = new Set([
  "orchestrator.child.attached",
  "orchestrator.child.retired",
  "orchestrator.assignment.status-reported",
  "orchestrator.assignment.verified",
  "orchestrator.child-result.resolved",
  "orchestrator.link-requested",
  "orchestrator.link-set",
  "supervision.workflow-conflicted",
  "supervision.lead-replaced",
  "thread.approval-requested",
  "thread.user-input-requested",
]);

export const SUPERVISION_IGNORED_EVENT_TYPES = new Set([
  "thread.activity-appended",
  "thread.turn-diff-completed",
  "thread.session-set",
  "thread.message-sent",
]);

export function isEligibleSupervisionWake(input: {
  readonly eventType: string;
  readonly aggregateThreadId: string | null;
  readonly leadThreadIds: ReadonlySet<string>;
  readonly peerThreadIds: ReadonlySet<string>;
}): boolean {
  if (SUPERVISION_IGNORED_EVENT_TYPES.has(input.eventType)) return false;
  if (!SUPERVISION_WAKE_EVENT_TYPES.has(input.eventType)) return false;
  if (input.aggregateThreadId === null) {
    return input.eventType.startsWith("supervision.");
  }
  if (input.peerThreadIds.has(input.aggregateThreadId)) return false;
  return input.leadThreadIds.has(input.aggregateThreadId);
}

export function coalesceSupervisionWakePointers<
  Pointer extends { readonly sequence: number; readonly eventType: string },
>(pointers: readonly Pointer[]): readonly Pointer[] {
  const byType = new Map<string, Pointer>();
  for (const pointer of pointers) {
    const current = byType.get(pointer.eventType);
    if (!current || pointer.sequence > current.sequence) byType.set(pointer.eventType, pointer);
  }
  return [...byType.values()].toSorted((left, right) => left.sequence - right.sequence);
}
