import type { SupervisionMission } from "@synara/contracts";
import { useState } from "react";

import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import { disclosureChevronClassName } from "~/lib/disclosureMotion";
import { ChevronRightIcon, EyeIcon } from "~/lib/icons";
import { supervisionScopesLabel } from "~/lib/supervision";
import { cn } from "~/lib/utils";

const statusTone = (status: SupervisionMission["status"]): string =>
  status === "active"
    ? "bg-primary/10 text-primary"
    : status === "paused"
      ? "bg-warning/10 text-warning"
      : "bg-muted text-muted-foreground";

export function MissionStrips(props: { readonly missions: readonly SupervisionMission[] }) {
  const [expandedMissionId, setExpandedMissionId] = useState<string | null>(null);

  if (props.missions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-background/70 px-3 py-2 text-xs text-muted-foreground">
        No active mission. The next owner message can define a new scope and focus.
      </div>
    );
  }

  return (
    <div className="space-y-1.5" aria-label="Active supervision missions">
      {props.missions.map((mission) => {
        const open = expandedMissionId === mission.id;
        return (
          <div
            key={mission.id}
            className="overflow-hidden rounded-xl border bg-background/90 shadow-sm"
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              aria-expanded={open}
              aria-controls={`mission-strip-${mission.id}`}
              onClick={() => setExpandedMissionId(open ? null : mission.id)}
            >
              <EyeIcon className="size-3.5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{mission.focus}</span>
              <span className="hidden truncate text-[11px] text-muted-foreground sm:block">
                {supervisionScopesLabel(mission.scope)}
              </span>
              <span
                className={cn("rounded-full px-1.5 py-0.5 text-[10px]", statusTone(mission.status))}
              >
                {mission.status}
              </span>
              <ChevronRightIcon className={disclosureChevronClassName(open)} />
            </button>
            <DisclosureRegion open={open}>
              <div id={`mission-strip-${mission.id}`} className="border-t px-3 py-2 text-[11px]">
                <p className="leading-relaxed text-muted-foreground">{mission.brief}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {mission.grants.map((grant) => (
                    <span
                      key={grant}
                      className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground"
                    >
                      {grant}
                    </span>
                  ))}
                </div>
              </div>
            </DisclosureRegion>
          </div>
        );
      })}
    </div>
  );
}
