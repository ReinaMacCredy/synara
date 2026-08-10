import type {
  RootAuthorityLease,
  SupervisedGovernanceSnapshot,
  SupervisedRuntimeSnapshot,
} from "@synara/contracts";

import { isPeerModelSessionRole } from "~/lib/supervisedOrchestration";

const LIVE_ROOT_LEASE_STATUSES = new Set<RootAuthorityLease["status"]>([
  "active",
  "transferring",
  "releasing",
]);

export type SupervisedRoomRootProjection =
  | {
      readonly resolution: "resolved";
      readonly holderSeatId: string;
      readonly leaseId: string;
      readonly leaseStatus: RootAuthorityLease["status"];
      readonly identityRole: "lead" | "supervisor";
      readonly roleLabel: "Lead" | "Supervisor acting as Root";
      readonly conversationKind: "lead" | "supervisor";
      readonly threadId: string | null;
      readonly displayName: string | null;
    }
  | {
      readonly resolution: "unresolved";
      readonly holderSeatId: string | null;
      readonly reason:
        | "missing_live_lease"
        | "multiple_live_leases"
        | "missing_holder_seat"
        | "inconsistent_holder_role";
    };

export function supervisedRoomRoot(
  governance: SupervisedGovernanceSnapshot,
  roomId: string,
): SupervisedRoomRootProjection {
  const liveLeases = governance.rootLeases.filter(
    (lease) => lease.roomId === roomId && LIVE_ROOT_LEASE_STATUSES.has(lease.status),
  );
  if (liveLeases.length === 0) {
    return { resolution: "unresolved", holderSeatId: null, reason: "missing_live_lease" };
  }
  if (liveLeases.length !== 1) {
    return { resolution: "unresolved", holderSeatId: null, reason: "multiple_live_leases" };
  }

  const lease = liveLeases[0]!;
  const seat = governance.agentSeats.find((candidate) => candidate.id === lease.holderSeatId);
  if (!seat) {
    return {
      resolution: "unresolved",
      holderSeatId: lease.holderSeatId,
      reason: "missing_holder_seat",
    };
  }
  if (seat.identityRole === "lead" && seat.effectiveRole === "lead") {
    return {
      resolution: "resolved",
      holderSeatId: seat.id,
      leaseId: lease.id,
      leaseStatus: lease.status,
      identityRole: "lead",
      roleLabel: "Lead",
      conversationKind: "lead",
      threadId: seat.threadId ?? null,
      displayName: seat.displayName ?? null,
    };
  }
  if (seat.identityRole === "supervisor" && seat.effectiveRole === "acting_root") {
    return {
      resolution: "resolved",
      holderSeatId: seat.id,
      leaseId: lease.id,
      leaseStatus: lease.status,
      identityRole: "supervisor",
      roleLabel: "Supervisor acting as Root",
      conversationKind: "supervisor",
      threadId: seat.threadId ?? null,
      displayName: seat.displayName ?? null,
    };
  }
  return {
    resolution: "unresolved",
    holderSeatId: lease.holderSeatId,
    reason: "inconsistent_holder_role",
  };
}

export function supervisedRoomRuns(
  snapshot: SupervisedRuntimeSnapshot,
  roomId: string,
): SupervisedRuntimeSnapshot["runs"] {
  const taskIds = new Set(
    snapshot.tasks.filter((task) => task.roomId === roomId).map((task) => task.id),
  );
  return snapshot.runs.filter(
    (run) => run.roomId === roomId || taskIds.has(run.taskId),
  );
}

export function supervisedRoomPeerSessions(
  snapshot: SupervisedRuntimeSnapshot,
  roomId: string,
): SupervisedRuntimeSnapshot["modelSessions"] {
  return snapshot.modelSessions
    .filter((session) => session.roomId === roomId && isPeerModelSessionRole(session.role))
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .filter(
      (session, index, sessions) =>
        sessions.findIndex(
          (candidate) =>
            (candidate.threadId ?? candidate.peerSpecialtyId ?? candidate.id) ===
            (session.threadId ?? session.peerSpecialtyId ?? session.id),
        ) === index,
    );
}
