import type { SupervisorSeatId } from "@synara/contracts";

import { AddPlusIcon, EyeIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { useStore } from "~/store";
import {
  SIDEBAR_ROW_ACTIVE_CLASS_NAME,
  SIDEBAR_ROW_HOVER_CLASS_NAME,
  SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME,
  SIDEBAR_SECTION_LABEL_CLASS_NAME,
} from "~/sidebarRowStyles";
import { SidebarIconButton } from "./SidebarIconButton";
import { SidebarLeadingIcon } from "./SidebarLeadingIcon";
import { SidebarSectionToolbar } from "./SidebarSectionToolbar";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "./ui/sidebar";

export function SupervisorSidebarSection(props: {
  readonly activeSupervisorSeatId: string | null;
  readonly onCreateSupervisor: () => void;
  readonly onOpenSupervisor: (supervisorSeatId: SupervisorSeatId) => void;
}) {
  const supervision = useStore((store) => store.supervision);
  const activeSupervisors = supervision.supervisors.filter(
    (supervisor) => supervisor.status !== "archived",
  );

  return (
    <div className="mb-4">
      <div className="group/project-header relative my-1">
        <div
          className={cn(
            "flex h-7 w-full min-w-0 items-center px-2 py-0.5 pr-[4.75rem]",
            SIDEBAR_SECTION_LABEL_CLASS_NAME,
          )}
        >
          <span className="truncate">Supervisors</span>
        </div>
        <SidebarSectionToolbar placement="overlay" revealOnHover>
          <SidebarIconButton
            icon={AddPlusIcon}
            label="New Supervisor"
            tooltip="New Supervisor"
            tooltipSide="right"
            onClick={props.onCreateSupervisor}
          />
        </SidebarSectionToolbar>
      </div>
      {activeSupervisors.length > 0 ? (
        <SidebarMenu className="gap-0.5">
          {activeSupervisors.map((supervisor) => {
            const missions = supervision.missions.filter(
              (mission) =>
                mission.supervisorSeatId === supervisor.id &&
                (mission.status === "active" || mission.status === "paused"),
            );
            const openConflicts = supervision.workflowConflicts.filter(
              (conflict) =>
                conflict.status === "open" &&
                supervision.workflowDirectives.some(
                  (directive) =>
                    directive.supervisorSeatId === supervisor.id &&
                    conflict.directiveIds.includes(directive.id),
                ),
            ).length;
            const queuedWakeCount = supervision.wakeQueue.filter(
              (wake) =>
                wake.supervisorSeatId === supervisor.id &&
                (wake.status === "queued" || wake.status === "dispatching"),
            ).length;
            const summary =
              missions.length === 0
                ? "No active mission"
                : missions.length === 1
                  ? missions[0]!.focus
                  : `${missions.length} active missions · ${missions[0]!.focus}`;
            const active = props.activeSupervisorSeatId === supervisor.id;
            return (
              <SidebarMenuItem key={supervisor.id}>
                <SidebarMenuButton
                  size="sm"
                  data-active={active}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "h-auto min-h-10 py-1.5",
                    active
                      ? SIDEBAR_ROW_ACTIVE_CLASS_NAME
                      : cn(SIDEBAR_ROW_IDLE_TEXT_CLASS_NAME, SIDEBAR_ROW_HOVER_CLASS_NAME),
                  )}
                  onClick={() => props.onOpenSupervisor(supervisor.id)}
                >
                  <SidebarLeadingIcon size="sm" tone="text-inherit">
                    <EyeIcon className="size-3.5" />
                  </SidebarLeadingIcon>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[length:var(--app-font-size-ui,12px)] font-medium">
                      {supervisor.name}
                    </span>
                    <span className="truncate text-[10px] text-muted-foreground/70">{summary}</span>
                  </span>
                  {openConflicts > 0 || queuedWakeCount > 0 ? (
                    <span
                      className="ml-auto rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning"
                      title={
                        openConflicts > 0
                          ? `${openConflicts} workflow conflicts need attention`
                          : `${queuedWakeCount} supervision wakes queued`
                      }
                    >
                      {openConflicts > 0 ? openConflicts : queuedWakeCount}
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "ml-auto size-1.5 rounded-full",
                        supervisor.status === "queued" ? "bg-warning" : "bg-emerald-500",
                      )}
                      title={`Runtime ${supervisor.status}`}
                    />
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      ) : (
        <button
          type="button"
          className="w-full rounded-md px-2 py-2 text-left text-[11px] text-muted-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={props.onCreateSupervisor}
        >
          Add a Supervisor for situational oversight
        </button>
      )}
    </div>
  );
}
