import type { LeadSeatId, SupervisionSnapshot, ProjectId } from "@synara/contracts";

import { EyeIcon } from "~/lib/icons";

export function LeadSupervisionBadge(props: {
  readonly snapshot: SupervisionSnapshot;
  readonly projectId: ProjectId;
  readonly leadSeatId: LeadSeatId;
}) {
  const missions = props.snapshot.missions.filter(
    (mission) =>
      mission.status === "active" &&
      mission.scope.some(
        (scope) =>
          scope.kind === "all_projects" ||
          (scope.kind === "project" && scope.projectId === props.projectId) ||
          (scope.kind === "lead" && scope.leadSeatId === props.leadSeatId),
      ),
  );
  const supervisorCount = new Set(missions.map((mission) => mission.supervisorSeatId)).size;
  const advice = props.snapshot.advice.filter((entry) => entry.leadSeatId === props.leadSeatId);

  if (supervisorCount === 0 && advice.length === 0) return null;

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-primary/[0.035] px-3 text-xs">
      <EyeIcon className="size-3.5 text-primary" />
      <span className="font-medium text-foreground">
        {supervisorCount} active {supervisorCount === 1 ? "Supervisor" : "Supervisors"}
      </span>
      {advice.length > 0 ? (
        <span className="truncate text-muted-foreground">Latest advice: {advice.at(-1)?.text}</span>
      ) : (
        <span className="text-muted-foreground">No advice yet</span>
      )}
    </div>
  );
}
