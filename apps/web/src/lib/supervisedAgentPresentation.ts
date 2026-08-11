import { ThreadId, type AgentSeat } from "@veylen/contracts";

import type { SubagentStatusKind } from "./subagentPresentation";

export const SUPERVISED_AGENT_ROLE_ORDER: Readonly<Record<AgentSeat["identityRole"], number>> = {
  supervisor: 0,
  lead: 1,
  peer: 2,
};

export function supervisedAgentRoleLabel(seat: AgentSeat): "Supervisor" | "Lead" | "Peer" {
  switch (seat.identityRole) {
    case "supervisor":
      return "Supervisor";
    case "lead":
      return "Lead";
    case "peer":
      return "Peer";
  }
}

export function supervisedAgentStatus(seat: AgentSeat): {
  label: string;
  kind: SubagentStatusKind;
  active: boolean;
} {
  if (seat.lifecycleState === "failed" || seat.lifecycleState === "lost") {
    return {
      label: seat.lifecycleState === "lost" ? "Lost" : "Failed",
      kind: "failed",
      active: false,
    };
  }
  if (
    seat.lifecycleState === "requested" ||
    seat.lifecycleState === "provisioning" ||
    seat.lifecycleState === "bootstrapping"
  ) {
    return { label: "Starting", kind: "queued", active: true };
  }
  if (seat.lifecycleState === "recovering") {
    return { label: "Recovering", kind: "running", active: true };
  }
  switch (seat.workState) {
    case "running":
      return { label: "Running", kind: "running", active: true };
    case "assigned":
      return { label: "Assigned", kind: "queued", active: false };
    case "blocked":
      return { label: "Blocked", kind: "stopped", active: false };
    case "waiting_review":
      return { label: "Waiting for review", kind: "idle", active: false };
    case "handing_off":
      return { label: "Handing off", kind: "running", active: true };
  }
  if (seat.lifecycleState === "draining") {
    return { label: "Draining", kind: "stopped", active: false };
  }
  if (seat.lifecycleState === "retained") {
    return { label: "Retained", kind: "idle", active: false };
  }
  return {
    label: seat.lifecycleState === "ready" ? "Ready" : "Active",
    kind: "idle",
    active: false,
  };
}

export function compareSupervisedAgentSeats(left: AgentSeat, right: AgentSeat): number {
  return (
    SUPERVISED_AGENT_ROLE_ORDER[left.identityRole] -
      SUPERVISED_AGENT_ROLE_ORDER[right.identityRole] ||
    (left.displayName ?? left.id).localeCompare(right.displayName ?? right.id)
  );
}

const SUPERVISOR_CONVERSATION_LIFECYCLES = new Set<AgentSeat["lifecycleState"]>([
  "requested",
  "provisioning",
  "bootstrapping",
  "ready",
  "active",
  "draining",
  "recovering",
]);

export function resolvePrimarySupervisorThreadId(seats: readonly AgentSeat[]): ThreadId | null {
  const supervisors = seats.filter(
    (seat) =>
      seat.identityRole === "supervisor" &&
      seat.threadId != null &&
      SUPERVISOR_CONVERSATION_LIFECYCLES.has(seat.lifecycleState),
  );
  const primaryThreadId = supervisors.find((seat) => seat.concern === "primary")?.threadId;
  if (primaryThreadId) return primaryThreadId;
  const fallbackThreadId = supervisors[0]?.threadId;
  return fallbackThreadId ?? null;
}

export function collectSupervisedConversationThreadIds(input: {
  readonly roomIds: readonly string[];
  readonly seats: readonly AgentSeat[];
}): Set<ThreadId> {
  const threadIds = new Set(input.roomIds.map((roomId) => ThreadId.makeUnsafe(roomId)));
  for (const seat of input.seats) {
    if (seat.threadId) threadIds.add(seat.threadId);
  }
  return threadIds;
}
