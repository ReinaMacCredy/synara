import type {
  ProjectTaskId,
  ProjectTaskLifecycle,
  ProjectTaskProjection,
  TaskBlocker,
  TaskProcessGraphProjection,
} from "@veylen/contracts";
import { useState } from "react";

import { ThreadActivityGlyph, type ThreadActivityState } from "~/components/ThreadActivityGlyph";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import type { TaskProcessFilter } from "~/taskProcessStore";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";

import { TaskRiskBadge } from "./TaskRiskBadge";

export type ProcessBoardLane =
  | "ready"
  | "in_progress"
  | "review"
  | "done"
  | "blocked"
  | "paused"
  | "failed"
  | "cancelled";

export const PROCESS_BOARD_LANES: readonly ProcessBoardLane[] = [
  "ready",
  "in_progress",
  "review",
  "done",
  "blocked",
  "paused",
  "failed",
  "cancelled",
];

const LANE_LABELS: Record<ProcessBoardLane, string> = {
  ready: "Ready",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
  blocked: "Blocked",
  paused: "Paused",
  failed: "Failed",
  cancelled: "Cancelled",
};

export type ProcessBoardGroup = "active" | "attention" | "ready" | "completed";

const PROCESS_BOARD_GROUPS: readonly ProcessBoardGroup[] = [
  "active",
  "attention",
  "ready",
  "completed",
];

const GROUP_LABELS: Record<ProcessBoardGroup, string> = {
  active: "Active",
  attention: "Needs attention",
  ready: "Ready next",
  completed: "Completed",
};

export function processBoardGroupForLane(lane: ProcessBoardLane): ProcessBoardGroup {
  if (lane === "in_progress" || lane === "paused") return "active";
  if (lane === "review" || lane === "blocked" || lane === "failed") return "attention";
  if (lane === "done" || lane === "cancelled") return "completed";
  return "ready";
}

function activityStateForLane(lane: ProcessBoardLane): ThreadActivityState {
  if (lane === "in_progress") return "working";
  if (lane === "review" || lane === "done") return "ready";
  if (lane === "blocked" || lane === "paused") return "blocked";
  if (lane === "failed" || lane === "cancelled") return "failed";
  return "idle";
}

export function deriveProcessBoardLane(task: ProjectTaskProjection): ProcessBoardLane {
  if (
    task.readiness === "blocked" &&
    task.task.lifecycle !== "done" &&
    task.task.lifecycle !== "cancelled"
  ) {
    return "blocked";
  }
  return task.task.lifecycle === "planned" ? "ready" : task.task.lifecycle;
}

export function groupProcessBoardTasks(
  graph: TaskProcessGraphProjection,
  filter: TaskProcessFilter,
): Map<ProcessBoardLane, ProjectTaskProjection[]> {
  const inputBlockedTaskIds = new Set(
    graph.blockers
      .filter((blocker) => blocker.resolvedAt === null && blocker.kind === "user_input")
      .map((blocker) => blocker.taskId),
  );
  const lanes = new Map<ProcessBoardLane, ProjectTaskProjection[]>(
    PROCESS_BOARD_LANES.map((lane) => [lane, []]),
  );
  for (const task of [...graph.tasks].sort((a, b) =>
    a.task.orderKey.localeCompare(b.task.orderKey),
  )) {
    const lane = deriveProcessBoardLane(task);
    if (filter === "ready" && lane !== "ready") continue;
    if (filter === "blocked" && lane !== "blocked") continue;
    if (filter === "input" && !inputBlockedTaskIds.has(task.task.id)) continue;
    lanes.get(lane)?.push(task);
  }
  return lanes;
}

function ProcessTaskCard(props: {
  readonly task: ProjectTaskProjection;
  readonly bindings: TaskProcessGraphProjection["bindings"];
  readonly blockers: readonly TaskBlocker[];
  readonly canEdit: boolean;
  readonly onSelect: (taskId: ProjectTaskId) => void;
  readonly onMove?: (taskId: ProjectTaskId, direction: "up" | "down") => void;
}) {
  const taskBindings = props.bindings.filter(
    (binding) =>
      binding.binding.taskId === props.task.task.id && binding.binding.retiredAt === null,
  );
  const blockers = props.blockers.filter(
    (blocker) => blocker.taskId === props.task.task.id && blocker.resolvedAt === null,
  );
  const lane = deriveProcessBoardLane(props.task);
  return (
    <article
      className="rounded-xl border border-border/75 bg-background/75 px-3 py-2.5 shadow-sm transition-colors hover:border-border"
      data-process-task-id={props.task.task.id}
    >
      <button
        type="button"
        className="w-full text-left"
        onClick={() => props.onSelect(props.task.task.id)}
      >
        <div className="flex items-start gap-2">
          <ThreadActivityGlyph state={activityStateForLane(lane)} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium text-foreground">
              {props.task.task.title}
            </span>
            <span className="mt-1 block text-[10px] text-muted-foreground">
              {LANE_LABELS[lane]} · {props.task.executionHealth}
              {taskBindings.length > 0
                ? ` · ${taskBindings.length} bound thread${taskBindings.length === 1 ? "" : "s"}`
                : ""}
            </span>
          </span>
          <TaskRiskBadge risk={props.task.task.risk} compact />
        </div>
        {blockers.length > 0 ? (
          <p className="ml-6 mt-1 text-[10px] text-warning">{blockers[0]?.summary}</p>
        ) : null}
      </button>
      {props.canEdit && props.onMove ? (
        <div className="mt-2 flex gap-1 border-t border-border/60 pt-2">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => props.onMove?.(props.task.task.id, "up")}
          >
            Move up
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => props.onMove?.(props.task.task.id, "down")}
          >
            Move down
          </Button>
        </div>
      ) : null}
    </article>
  );
}

export function ProcessBoard(props: {
  readonly graph: TaskProcessGraphProjection;
  readonly filter: TaskProcessFilter;
  readonly canEdit: boolean;
  readonly onSelectTask: (taskId: ProjectTaskId) => void;
  readonly onMoveTask?: (taskId: ProjectTaskId, direction: "up" | "down") => void;
}) {
  const lanes = groupProcessBoardTasks(props.graph, props.filter);
  const [completedOpen, setCompletedOpen] = useState(false);
  const grouped = new Map<ProcessBoardGroup, ProjectTaskProjection[]>(
    PROCESS_BOARD_GROUPS.map((group) => [group, []]),
  );
  for (const lane of PROCESS_BOARD_LANES) {
    grouped.get(processBoardGroupForLane(lane))?.push(...(lanes.get(lane) ?? []));
  }
  const visibleGroups = PROCESS_BOARD_GROUPS.filter(
    (group) => (grouped.get(group)?.length ?? 0) > 0,
  );

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-5 p-4" data-process-view="board">
      {visibleGroups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
          No tasks match this filter.
        </div>
      ) : null}
      {visibleGroups.map((group) => {
        const tasks = grouped.get(group) ?? [];
        const collapsible = group === "completed";
        const open = !collapsible || completedOpen;
        return (
          <section key={group} data-process-group={group}>
            <button
              type="button"
              className={cn(
                "mb-2 flex w-full items-center gap-2 text-left",
                !collapsible && "cursor-default",
              )}
              aria-expanded={collapsible ? open : undefined}
              onClick={() => {
                if (collapsible) setCompletedOpen((value) => !value);
              }}
            >
              {collapsible ? <DisclosureChevron open={open} /> : null}
              <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {GROUP_LABELS[group]}
              </h2>
              <span className="text-[10px] tabular-nums text-muted-foreground">{tasks.length}</span>
            </button>
            <DisclosureRegion open={open}>
              <div className="grid gap-2 sm:grid-cols-2">
                {tasks.map((task) => (
                  <ProcessTaskCard
                    key={task.task.id}
                    task={task}
                    bindings={props.graph.bindings}
                    blockers={props.graph.blockers}
                    canEdit={props.canEdit}
                    onSelect={props.onSelectTask}
                    {...(props.onMoveTask ? { onMove: props.onMoveTask } : {})}
                  />
                ))}
              </div>
            </DisclosureRegion>
          </section>
        );
      })}
    </div>
  );
}

export function lifecycleForBoardLane(lane: ProcessBoardLane): ProjectTaskLifecycle | null {
  if (lane === "blocked") return null;
  return lane === "ready" ? "planned" : lane;
}
