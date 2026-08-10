import type {
  OrchestrationProject,
  OrchestrationThread,
  SupervisedGovernanceSnapshot,
  SupervisionMission,
  ThreadId,
} from "@synara/contracts";

import { missionScopeContainsLead } from "./missionScope.ts";

export type SupervisedCallerAuthority =
  | {
      readonly role: "supervisor";
      readonly callerThreadId: ThreadId;
      readonly supervisorSeatId: string;
      readonly missions: readonly SupervisionMission[];
    }
  | {
      readonly role: "lead";
      readonly callerThreadId: ThreadId;
      readonly leadSeatId: string;
      readonly missions: readonly SupervisionMission[];
    }
  | {
      readonly role: "peer";
      readonly callerThreadId: ThreadId;
      readonly peerSeatId: string;
      readonly roomIds: readonly string[];
    };

export function resolveSupervisedCallerAuthority(input: {
  readonly snapshot: SupervisedGovernanceSnapshot;
  readonly projects: readonly OrchestrationProject[];
  readonly callerThreadId: ThreadId;
}): SupervisedCallerAuthority | null {
  const supervisor = input.snapshot.agentSeats.find(
    (seat) =>
      seat.identityRole === "supervisor" &&
      seat.threadId === input.callerThreadId &&
      seat.lifecycleState !== "retired",
  );
  if (supervisor) {
    return {
      role: "supervisor",
      callerThreadId: input.callerThreadId,
      supervisorSeatId: supervisor.id,
      missions: input.snapshot.orchestration.missions.filter(
        (mission) =>
          mission.supervisorSeatId === supervisor.id &&
          (mission.status === "active" || mission.status === "paused"),
      ),
    };
  }

  const lead = input.snapshot.agentSeats.find(
    (seat) =>
      seat.identityRole === "lead" &&
      seat.threadId === input.callerThreadId &&
      seat.projectId !== null &&
      seat.lifecycleState !== "retired",
  );
  if (lead) {
    return {
      role: "lead",
      callerThreadId: input.callerThreadId,
      leadSeatId: lead.id,
      missions: input.snapshot.orchestration.missions.filter(
        (mission) =>
          mission.status === "active" &&
          missionScopeContainsLead({ scope: mission.scope, lead, projects: input.projects }),
      ),
    };
  }

  const peer = input.snapshot.agentSeats.find(
    (seat) =>
      seat.identityRole === "peer" &&
      seat.threadId === input.callerThreadId &&
      seat.lifecycleState !== "retired",
  );
  return peer
    ? {
        role: "peer",
        callerThreadId: input.callerThreadId,
        peerSeatId: peer.id,
        roomIds: peer.roomIds,
      }
    : null;
}

export function currentTurnHasHumanOrigin(input: {
  readonly thread: OrchestrationThread;
  readonly callerTurnId: string | null;
}): boolean {
  if (!input.callerTurnId) return false;
  return input.thread.messages.some(
    (message) =>
      message.turnId === input.callerTurnId &&
      message.role === "user" &&
      (message.dispatchOrigin === undefined || message.dispatchOrigin === "user"),
  );
}

export const supervisedToolMayAccessPeer = (): false => false;
export const supervisedToolMayAcceptOutcome = (): false => false;
