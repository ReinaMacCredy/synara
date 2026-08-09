import type {
  AgentSeat,
  EffectiveAuthorityReceipt,
  SupervisedGovernanceSnapshot,
  SupervisionSnapshot,
  ThreadId,
} from "@synara/contracts";

type SupervisorSeat = SupervisionSnapshot["supervisors"][number];
type LeadSeat = SupervisionSnapshot["leads"][number];
type PeerBinding = SupervisionSnapshot["peers"][number];
type LeadRotation = SupervisionSnapshot["rotations"][number];

export type ProjectedSupervisionCaller =
  | {
      readonly role: "supervisor";
      readonly seatId: string;
      readonly profileSnapshotId: string;
      readonly supervisor: SupervisorSeat;
    }
  | {
      readonly role: "lead";
      readonly seatId: string;
      readonly profileSnapshotId: string;
      readonly lead: LeadSeat;
      readonly rotation: LeadRotation | undefined;
    }
  | {
      readonly role: "peer";
      readonly seatId: string;
      readonly profileSnapshotId: string;
      readonly leadSeatId: string;
      readonly peer: PeerBinding;
    };

export function resolveProjectedSupervisionCaller(input: {
  readonly supervision: SupervisionSnapshot;
  readonly threadId: ThreadId;
}): ProjectedSupervisionCaller | undefined {
  const supervisor = input.supervision.supervisors.find(
    (seat) =>
      seat.activeThreadId === input.threadId &&
      seat.status !== "archived" &&
      seat.archivedAt === null,
  );
  if (supervisor) {
    return {
      role: "supervisor",
      seatId: supervisor.id,
      profileSnapshotId: supervisor.profileSnapshotId,
      supervisor,
    };
  }

  const lead = input.supervision.leads.find(
    (seat) =>
      seat.activeThreadId === input.threadId &&
      seat.status !== "archived" &&
      seat.archivedAt === null,
  );
  if (lead) {
    return {
      role: "lead",
      seatId: lead.id,
      profileSnapshotId: lead.profileSnapshotId,
      lead,
      rotation: undefined,
    };
  }

  const peer = input.supervision.peers.find(
    (binding) => binding.threadId === input.threadId && binding.status === "active",
  );
  if (peer) {
    return {
      role: "peer",
      seatId: peer.threadId,
      profileSnapshotId: peer.profileSnapshotId,
      leadSeatId: peer.leadSeatId,
      peer,
    };
  }

  const rotation = input.supervision.rotations.find(
    (candidate) =>
      candidate.replacementThreadId === input.threadId &&
      candidate.state !== "completed" &&
      candidate.state !== "failed",
  );
  if (!rotation) return undefined;
  const rotationLead = input.supervision.leads.find(
    (candidate) => candidate.id === rotation.leadSeatId,
  );
  if (!rotationLead) return undefined;
  return {
    role: "lead",
    seatId: rotationLead.id,
    profileSnapshotId: rotation.replacementProfileSnapshotId,
    lead: rotationLead,
    rotation,
  };
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
