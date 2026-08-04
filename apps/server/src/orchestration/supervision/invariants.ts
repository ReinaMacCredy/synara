import type {
  LeadSeat,
  MissionGrant,
  MissionScope,
  SupervisionActor,
  SupervisionMission,
  SupervisionSnapshot,
} from "@synara/contracts";

export const isHumanOrigin = (actor: SupervisionActor): boolean => actor.kind === "user";

export function activeLeadForProject(
  state: SupervisionSnapshot,
  projectId: string,
): LeadSeat | null {
  return (
    state.leads.find(
      (lead) =>
        lead.projectId === projectId && lead.archivedAt === null && lead.status !== "archived",
    ) ?? null
  );
}

export function missionScopeExpands(
  previous: ReadonlyArray<MissionScope>,
  next: ReadonlyArray<MissionScope>,
): boolean {
  if (previous.some((scope) => scope.kind === "all_projects")) return false;
  const keys = new Set(previous.map(missionScopeKey));
  return next.some((scope) => scope.kind === "all_projects" || !keys.has(missionScopeKey(scope)));
}

const missionScopeKey = (scope: MissionScope): string => {
  switch (scope.kind) {
    case "all_projects":
      return scope.kind;
    case "space":
      return `${scope.kind}:${scope.spaceId}`;
    case "project":
      return `${scope.kind}:${scope.projectId}`;
    case "lead":
      return `${scope.kind}:${scope.leadSeatId}`;
  }
};

export function missionGrantsExpand(
  previous: ReadonlyArray<MissionGrant>,
  next: ReadonlyArray<MissionGrant>,
): boolean {
  const existing = new Set(previous);
  return next.some((grant) => !existing.has(grant));
}

export function activeMissionGrant(
  state: SupervisionSnapshot,
  supervisorSeatId: string,
  missionId: string,
  grant: MissionGrant,
): SupervisionMission | null {
  return (
    state.missions.find(
      (mission) =>
        mission.id === missionId &&
        mission.supervisorSeatId === supervisorSeatId &&
        mission.status === "active" &&
        mission.grants.includes(grant),
    ) ?? null
  );
}

export const mayAccessPeerTranscript = (): false => false;
export const mayAcceptProjectOutcome = (): false => false;
