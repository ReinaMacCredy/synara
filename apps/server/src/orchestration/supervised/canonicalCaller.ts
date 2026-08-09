import type {
  AgentSeat,
  EffectiveAuthorityReceipt,
  SupervisedGovernanceSnapshot,
  OrchestrationThread,
  ThreadId,
} from "@synara/contracts";

export interface ProjectedSupervisedCaller {
  readonly role: "supervisor" | "lead" | "peer";
  readonly seatId: string;
  readonly profileSnapshotId: string;
  readonly leadSeatId: string | undefined;
}

export function resolveProjectedSupervisedCaller(input: {
  readonly governance: SupervisedGovernanceSnapshot;
  readonly threadId: ThreadId;
}): ProjectedSupervisedCaller | undefined {
  const seat = input.governance.agentSeats.find(
    (candidate) =>
      candidate.threadId === input.threadId &&
      candidate.profileSnapshotId !== null &&
      candidate.lifecycleState !== "retired",
  );
  if (seat?.profileSnapshotId) {
    const room = seat.roomIds
      .map((roomId) => input.governance.rootLeases.find((lease) => lease.roomId === roomId))
      .find((lease) => lease !== undefined);
    return {
      role: seat.identityRole,
      seatId: seat.id,
      profileSnapshotId: seat.profileSnapshotId,
      leadSeatId:
        seat.identityRole === "lead"
          ? seat.id
          : seat.identityRole === "peer"
            ? room?.holderSeatId
            : undefined,
    };
  }

  const rotation = input.governance.orchestration.rotations.find(
    (candidate) =>
      candidate.replacementThreadId === input.threadId &&
      candidate.state !== "completed" &&
      candidate.state !== "failed",
  );
  if (!rotation) return undefined;
  const rotationLead = input.governance.agentSeats.find(
    (candidate) => candidate.id === rotation.leadSeatId && candidate.identityRole === "lead",
  );
  if (!rotationLead) return undefined;
  return {
    role: "lead",
    seatId: rotationLead.id,
    profileSnapshotId: rotation.replacementProfileSnapshotId,
    leadSeatId: rotationLead.id,
  };
}

export function resolveProjectedSupervisedCallerForThread(input: {
  readonly governance: SupervisedGovernanceSnapshot;
  readonly threads: ReadonlyArray<
    Pick<OrchestrationThread, "id" | "creationSource" | "sourceThreadId">
  >;
  readonly threadId: ThreadId;
}): {
  readonly caller: ProjectedSupervisedCaller | undefined;
  readonly requiresCanonicalAuthority: boolean;
} {
  const direct = resolveProjectedSupervisedCaller({
    governance: input.governance,
    threadId: input.threadId,
  });
  if (direct) return { caller: direct, requiresCanonicalAuthority: true };
  const thread = input.threads.find((candidate) => candidate.id === input.threadId);
  if (thread?.creationSource !== "supervised_native") {
    return { caller: undefined, requiresCanonicalAuthority: false };
  }
  const threadById = new Map(input.threads.map((candidate) => [candidate.id, candidate]));
  const visited = new Set<ThreadId>([input.threadId]);
  let sourceThreadId = thread.sourceThreadId;
  while (sourceThreadId !== null && !visited.has(sourceThreadId)) {
    const caller = resolveProjectedSupervisedCaller({
      governance: input.governance,
      threadId: sourceThreadId,
    });
    if (caller) return { caller, requiresCanonicalAuthority: true };
    visited.add(sourceThreadId);
    const sourceThread = threadById.get(sourceThreadId);
    if (sourceThread?.creationSource !== "supervised_native") break;
    sourceThreadId = sourceThread.sourceThreadId;
  }
  return { caller: undefined, requiresCanonicalAuthority: true };
}

export function resolveEffectiveCanonicalAuthority(input: {
  readonly governance: SupervisedGovernanceSnapshot;
  readonly seatId: string;
  readonly at: string;
}):
  | { readonly seat: AgentSeat; readonly receipt: EffectiveAuthorityReceipt }
  | undefined {
  const seat = input.governance.agentSeats.find((candidate) => candidate.id === input.seatId);
  if (!seat || !["ready", "active"].includes(seat.lifecycleState)) return undefined;
  const receipt = input.governance.authorityReceipts.find(
    (candidate) => candidate.id === seat.authorityReceiptId,
  );
  if (
    !receipt ||
    receipt.actorSeatId !== seat.id ||
    receipt.identityRole !== seat.identityRole ||
    receipt.effectiveRole !== seat.effectiveRole ||
    !receipt.workspaceScopes.includes(seat.workspaceId) ||
    receipt.revokedAt !== null ||
    (receipt.expiresAt !== null && receipt.expiresAt <= input.at)
  ) {
    return undefined;
  }
  return { seat, receipt };
}
