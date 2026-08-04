import type {
  OrchestrationProject,
  OrchestrationThread,
  SupervisionMission,
  SupervisionSnapshot,
  ThreadId,
} from "@synara/contracts";

import { missionScopeContainsLead } from "./missionScope.ts";

export type SupervisionCallerAuthority =
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
    };

export function resolveSupervisionCallerAuthority(input: {
  readonly snapshot: SupervisionSnapshot;
  readonly projects: readonly OrchestrationProject[];
  readonly callerThreadId: ThreadId;
}): SupervisionCallerAuthority | null {
  const supervisor = input.snapshot.supervisors.find(
    (seat) =>
      seat.activeThreadId === input.callerThreadId &&
      seat.status !== "archived" &&
      seat.archivedAt === null,
  );
  if (supervisor) {
    return {
      role: "supervisor",
      callerThreadId: input.callerThreadId,
      supervisorSeatId: supervisor.id,
      missions: input.snapshot.missions.filter(
        (mission) =>
          mission.supervisorSeatId === supervisor.id &&
          (mission.status === "active" || mission.status === "paused"),
      ),
    };
  }

  const lead = input.snapshot.leads.find(
    (seat) =>
      seat.activeThreadId === input.callerThreadId &&
      seat.status !== "archived" &&
      seat.archivedAt === null,
  );
  if (!lead) return null;
  return {
    role: "lead",
    callerThreadId: input.callerThreadId,
    leadSeatId: lead.id,
    missions: input.snapshot.missions.filter(
      (mission) =>
        mission.status === "active" &&
        missionScopeContainsLead({ scope: mission.scope, lead, projects: input.projects }),
    ),
  };
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

export const supervisionToolMayAccessPeer = (): false => false;
export const supervisionToolMayAcceptOutcome = (): false => false;
