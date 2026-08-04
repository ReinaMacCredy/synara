import type { SupervisionSnapshot, SupervisorSeatId } from "@synara/contracts";
import type { ReactNode } from "react";

import { activeMissionsForSupervisor, supervisionScopesLabel } from "~/lib/supervision";

function Section(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="border-b px-4 py-4 last:border-b-0">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

export function SupervisionPanel(props: {
  readonly snapshot: SupervisionSnapshot;
  readonly supervisorSeatId: SupervisorSeatId;
}) {
  const seat = props.snapshot.supervisors.find(
    (candidate) => candidate.id === props.supervisorSeatId,
  );
  const missions = activeMissionsForSupervisor(props.snapshot, props.supervisorSeatId);
  const missionIds = new Set(missions.map((mission) => mission.id));
  const cursors = props.snapshot.observationCursors.filter((cursor) =>
    missionIds.has(cursor.missionId),
  );
  const directives = props.snapshot.workflowDirectives.filter((directive) =>
    missionIds.has(directive.missionId),
  );
  const directiveIds = new Set(directives.map((directive) => directive.id));
  const conflicts = props.snapshot.workflowConflicts.filter((conflict) =>
    conflict.directiveIds.some((directiveId) => directiveIds.has(directiveId)),
  );
  const rotations = props.snapshot.rotations.filter(
    (rotation) => rotation.missionId !== null && missionIds.has(rotation.missionId),
  );
  const wakes = props.snapshot.wakeQueue.filter((wake) => missionIds.has(wake.missionId));

  return (
    <div className="h-full overflow-y-auto bg-background text-xs" data-testid="supervision-panel">
      <Section title="Seat">
        {seat ? (
          <div className="space-y-1">
            <div className="font-medium text-foreground">{seat.name}</div>
            <div className="text-muted-foreground">Runtime: {seat.status}</div>
            <div className="break-all text-[11px] text-muted-foreground">
              Profile snapshot: {seat.profileSnapshotId}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground">Supervisor seat unavailable.</p>
        )}
      </Section>
      <Section title="Missions">
        <div className="space-y-3">
          {missions.map((mission) => (
            <div key={mission.id} className="rounded-lg border bg-muted/20 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-foreground">{mission.focus}</span>
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                  {mission.status}
                </span>
              </div>
              <p className="mt-1 leading-relaxed text-muted-foreground">{mission.brief}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Scope: {supervisionScopesLabel(mission.scope)}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {mission.grants.map((grant) => (
                  <span key={grant} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                    {grant}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {missions.length === 0 ? (
            <p className="text-muted-foreground">No active mission.</p>
          ) : null}
        </div>
      </Section>
      <Section title="Observation cursors">
        {cursors.length === 0 ? (
          <p className="text-muted-foreground">No Lead event has been observed yet.</p>
        ) : (
          <div className="space-y-1.5">
            {cursors.map((cursor) => (
              <div key={cursor.id} className="flex justify-between gap-3">
                <span className="truncate text-muted-foreground">{cursor.leadSeatId}</span>
                <span className="tabular-nums text-foreground">#{cursor.lastSequence}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section title="Observation queue">
        {wakes.length === 0 ? (
          <p className="text-muted-foreground">No queued Lead event.</p>
        ) : (
          <div className="space-y-1.5">
            {wakes.slice(-12).map((wake) => (
              <div key={wake.id} className="rounded-lg border p-2">
                <div className="flex justify-between gap-2">
                  <span className="truncate font-medium">{wake.episodeKind}</span>
                  <span className="text-muted-foreground">{wake.status}</span>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {wake.leadSeatId} · {wake.pointers.length} pointer
                  {wake.pointers.length === 1 ? "" : "s"} · attempt {wake.attemptCount}
                </div>
                {wake.error ? <div className="mt-1 text-destructive">{wake.error}</div> : null}
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section title="Workflow">
        <div className="space-y-2">
          {directives.map((directive) => (
            <div key={directive.id} className="rounded-lg border p-2">
              <div className="flex justify-between gap-2">
                <span className="font-medium">{directive.slot}</span>
                <span className="text-muted-foreground">{directive.status}</span>
              </div>
              <p className="mt-1 text-muted-foreground">{directive.instruction}</p>
            </div>
          ))}
          {conflicts.map((conflict) => (
            <div key={conflict.id} className="rounded-lg border border-warning/40 bg-warning/5 p-2">
              Conflict in {conflict.slot}: {conflict.status}
            </div>
          ))}
          {directives.length === 0 && conflicts.length === 0 ? (
            <p className="text-muted-foreground">No active workflow directive.</p>
          ) : null}
        </div>
      </Section>
      <Section title="Lead rotations">
        {rotations.length === 0 ? (
          <p className="text-muted-foreground">No Lead rotation for these missions.</p>
        ) : (
          <div className="space-y-2">
            {rotations.map((rotation) => (
              <div key={rotation.id} className="rounded-lg border p-2">
                <div className="font-medium">{rotation.leadSeatId}</div>
                <div className="mt-1 text-muted-foreground">{rotation.state}</div>
                {rotation.error ? (
                  <div className="mt-1 text-destructive">{rotation.error}</div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
