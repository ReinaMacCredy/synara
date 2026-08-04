import type { LeadRotation, LeadSeat } from "@synara/contracts";

const NEXT_STATES: Readonly<Record<LeadRotation["state"], ReadonlySet<LeadRotation["state"]>>> = {
  requested: new Set(["frozen", "failed"]),
  frozen: new Set(["replacement_created", "failed"]),
  replacement_created: new Set(["validated", "failed"]),
  validated: new Set(["switched", "failed"]),
  switched: new Set(["completed"]),
  completed: new Set(),
  failed: new Set(),
};

export function mayAdvanceLeadRotation(
  previous: LeadRotation["state"],
  next: LeadRotation["state"],
): boolean {
  return NEXT_STATES[previous].has(next);
}

export function switchLeadSeatForRotation(input: {
  readonly lead: LeadSeat;
  readonly rotation: LeadRotation;
  readonly occurredAt: string;
}): LeadSeat {
  if (input.rotation.state !== "validated" && input.rotation.state !== "switched") {
    throw new Error("Lead pointer can switch only after replacement validation.");
  }
  if (input.lead.activeThreadId !== input.rotation.predecessorThreadId) {
    throw new Error("Lead rotation predecessor no longer owns the active pointer.");
  }
  return {
    ...input.lead,
    activeThreadId: input.rotation.replacementThreadId,
    predecessorThreadIds: [...input.lead.predecessorThreadIds, input.lead.activeThreadId],
    profileSnapshotId: input.rotation.replacementProfileSnapshotId,
    status: "active",
    updatedAt: input.occurredAt,
    revision: input.lead.revision + 1,
  };
}
