import type {
  LeadSeat,
  MissionScope,
  OrchestrationProject,
  SupervisionMission,
} from "@synara/contracts";

export function missionScopeContainsLead(input: {
  readonly scope: readonly MissionScope[];
  readonly lead: LeadSeat;
  readonly projects: readonly OrchestrationProject[];
}): boolean {
  return input.scope.some((scope) => {
    switch (scope.kind) {
      case "all_projects":
        return true;
      case "lead":
        return scope.leadSeatId === input.lead.id;
      case "project":
        return scope.projectId === input.lead.projectId;
      case "space":
        return (
          input.projects.find((project) => project.id === input.lead.projectId)?.spaceId ===
          scope.spaceId
        );
    }
  });
}

export function activeMissionsCoveringLead(input: {
  readonly missions: readonly SupervisionMission[];
  readonly lead: LeadSeat;
  readonly projects: readonly OrchestrationProject[];
}): SupervisionMission[] {
  return input.missions.filter(
    (mission) =>
      mission.status === "active" &&
      missionScopeContainsLead({
        scope: mission.scope,
        lead: input.lead,
        projects: input.projects,
      }),
  );
}
