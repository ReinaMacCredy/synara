import type {
  ProjectTaskId,
  ProjectTaskLifecycle,
  ProjectTaskProjection,
  TaskBlocker,
  TaskProcessGraphProjection,
} from "@synara/contracts";

import type { TaskProcessFilter } from "~/taskProcessStore";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";

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
  return (
    <article
      className="rounded-xl border border-border/75 bg-background/75 p-3 shadow-sm"
      data-process-task-id={props.task.task.id}
    >
      <button
        type="button"
        className="w-full text-left"
        onClick={() => props.onSelect(props.task.task.id)}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {props.task.task.id}
          </span>
          <span className="text-[10px] capitalize text-muted-foreground">
            {props.task.task.priority}
          </span>
        </div>
        <p className="mt-1 text-xs font-medium text-foreground">{props.task.task.title}</p>
        <p className="mt-2 text-[10px] text-muted-foreground">
          {props.task.executionHealth}
          {taskBindings.length > 0
            ? ` · ${taskBindings.length} bound thread${taskBindings.length === 1 ? "" : "s"}`
            : ""}
        </p>
        {blockers.length > 0 ? (
          <p className="mt-1 text-[10px] text-warning">{blockers[0]?.summary}</p>
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
  const visibleLanes = PROCESS_BOARD_LANES.filter((lane) => (lanes.get(lane)?.length ?? 0) > 0);

  return (
    <div
      className="grid min-w-max grid-flow-col auto-cols-[minmax(15rem,1fr)] gap-3 p-4"
      data-process-view="board"
    >
      {visibleLanes.length === 0 ? (
        <div className="w-[22rem] rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          No tasks match this filter.
        </div>
      ) : null}
      {visibleLanes.map((lane) => (
        <section
          key={lane}
          className={cn(
            "rounded-2xl border border-border/70 bg-muted/20 p-2",
            lane === "blocked" && "border-warning/30 bg-warning/5",
          )}
          data-process-lane={lane}
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {LANE_LABELS[lane]}
            </h2>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {lanes.get(lane)?.length ?? 0}
            </span>
          </div>
          <div className="grid gap-2">
            {lanes.get(lane)?.map((task) => (
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
        </section>
      ))}
    </div>
  );
}

export function lifecycleForBoardLane(lane: ProcessBoardLane): ProjectTaskLifecycle | null {
  if (lane === "blocked") return null;
  return lane === "ready" ? "planned" : lane;
}
