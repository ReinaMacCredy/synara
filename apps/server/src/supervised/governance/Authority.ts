import type {
  SupervisedCommand,
  SupervisedGovernanceSnapshot,
  SupervisedRuntimeSnapshot,
} from "@synara/contracts";

const rootOwnedCommands = new Set<SupervisedCommand["type"]>([
  "supervised.room.update",
  "supervised.task.create",
  "supervised.task-graph.create",
  "supervised.task.delegate",
  "supervised.review.accept",
  "supervised.compaction.request",
  "supervised.handoff.request",
]);

function commandRoomId(
  command: SupervisedCommand,
  runtime: SupervisedRuntimeSnapshot,
): string | null {
  switch (command.type) {
    case "supervised.room.create":
    case "supervised.room.update":
      return command.room.id;
    case "supervised.role.assume":
      return command.roomId;
    case "supervised.lead.create":
      return command.room.id;
    case "supervised.task.create":
      return command.task.roomId;
    case "supervised.task-graph.create":
      return command.task.roomId;
    case "supervised.task-node.commit":
      return command.taskNode.roomId;
    case "supervised.run.request":
      return command.run.roomId;
    case "supervised.task.delegate":
      return command.roomId;
    case "supervised.run.start":
    case "supervised.run.submit":
    case "supervised.review.accept":
      return runtime.runs.find((run) => run.id === command.runId)?.roomId ?? null;
    case "supervised.run.transition":
      return runtime.runs.find((run) => run.id === command.runId)?.roomId ?? null;
    case "supervised.context.workspace-upsert":
      return command.workspace.roomId;
    case "supervised.context.append":
      return (
        runtime.contextWorkspaces.find((workspace) => workspace.id === command.record.workspaceId)
          ?.roomId ?? null
      );
    case "supervised.evidence.publish":
      return command.evidence.scope.kind === "room" ? command.evidence.scope.roomId : null;
    case "supervised.rlm.upsert":
      return runtime.runs.find((run) => run.id === command.episode.runId)?.roomId ?? null;
    case "supervised.model-session.upsert":
      return command.modelSession.roomId;
    case "supervised.claim.acquire":
      return runtime.runs.find((run) => run.id === command.claim.runId)?.roomId ?? null;
    case "supervised.claim.release":
    case "supervised.claim.revoke":
    case "supervised.claim.expire": {
      const claim = runtime.workClaims.find((candidate) => candidate.id === command.claimId);
      return claim === undefined
        ? null
        : (runtime.runs.find((run) => run.id === claim.runId)?.roomId ?? null);
    }
    case "supervised.lease.grant":
      return runtime.runs.find((run) => run.id === command.lease.runId)?.roomId ?? null;
    case "supervised.lease.revoke":
    case "supervised.lease.expire": {
      const lease = runtime.capabilityLeases.find((candidate) => candidate.id === command.leaseId);
      return lease === undefined
        ? null
        : (runtime.runs.find((run) => run.id === lease.runId)?.roomId ?? null);
    }
    case "supervised.peer.create":
    case "supervised.work.assign":
    case "supervised.work.complete":
    case "supervised.compaction.request":
    case "supervised.handoff.request":
      return command.roomId;
    case "supervised.intervention.propose":
      return command.intervention.roomId;
    case "supervised.intervention.reconcile":
      return command.reconciliation.roomId;
    default:
      return null;
  }
}

export function validateSupervisedSeatAuthority(input: {
  readonly command: SupervisedCommand;
  readonly runtime: SupervisedRuntimeSnapshot;
  readonly governance: SupervisedGovernanceSnapshot | undefined;
}): string | null {
  const { command, runtime, governance } = input;
  if (command.actor.kind !== "seat") return null;
  if (governance === undefined) return "Seat command authority state is unavailable.";
  if (command.authorityReceiptId === undefined) {
    return "Seat commands require an EffectiveAuthorityReceipt.";
  }

  const seatId = command.actor.seatId;
  if (seatId === undefined) return "Seat commands require an acting AgentSeat id.";
  const seat = governance.agentSeats.find((candidate) => candidate.id === seatId);
  if (!seat || (seat.lifecycleState !== "ready" && seat.lifecycleState !== "active")) {
    return "The acting AgentSeat is not ready or active.";
  }
  if (
    seat.threadId !== null &&
    seat.threadId !== undefined &&
    seat.threadId !== command.actor.actorId
  ) {
    return "The command actor thread does not match the acting AgentSeat.";
  }
  if (seat.authorityReceiptId !== command.authorityReceiptId) {
    return "The command does not use the AgentSeat's current authority receipt.";
  }

  const receipt = governance.authorityReceipts.find(
    (candidate) => candidate.id === command.authorityReceiptId,
  );
  if (!receipt || receipt.actorSeatId !== seat.id) {
    return "The authority receipt does not belong to the acting AgentSeat.";
  }
  if (
    receipt.revokedAt !== null ||
    (receipt.expiresAt !== null && receipt.expiresAt <= command.createdAt)
  ) {
    return "The authority receipt is revoked or expired.";
  }
  if (!receipt.workspaceScopes.includes(seat.workspaceId)) {
    return "The authority receipt does not cover the AgentSeat workspace.";
  }
  if (!receipt.allowedCommands.includes(command.type)) {
    return `The authority receipt does not grant '${command.type}'.`;
  }

  const roomId = commandRoomId(command, runtime);
  const createsSupervisorRoom =
    seat.identityRole === "supervisor" &&
    (command.type === "supervised.room.create" || command.type === "supervised.lead.create");
  if (roomId !== null && !createsSupervisorRoom && !receipt.roomScopes.includes(roomId as never)) {
    return "The authority receipt does not cover the command Room.";
  }
  if (roomId !== null && rootOwnedCommands.has(command.type)) {
    const rootLease = governance.rootLeases.find(
      (lease) =>
        lease.roomId === roomId &&
        lease.holderSeatId === seat.id &&
        (lease.status === "active" ||
          lease.status === "transferring" ||
          lease.status === "releasing"),
    );
    if (!rootLease || !receipt.rootLeaseIds.includes(rootLease.id)) {
      return "The command requires the Room's current Root authority lease.";
    }
  }
  return null;
}
