import {
  TaskProcessId,
  type ProjectTaskId,
  type ProjectTaskProjection,
  type SessionProgressProjection,
  type TaskProcessGraphProjection,
  type TaskProcessSummaryProjection,
  type ThreadId,
} from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";

import { PanelStateMessage } from "~/components/chat/PanelStateMessage";
import {
  deriveProcessBoardLane,
  processBoardGroupForLane,
  type ProcessBoardGroup,
  type ProcessBoardLane,
} from "~/components/process/ProcessBoard";
import { TaskRiskBadge } from "~/components/process/TaskRiskBadge";
import { ThreadActivityGlyph, type ThreadActivityState } from "~/components/ThreadActivityGlyph";
import { Button } from "~/components/ui/button";
import {
  sessionProgressQueryOptions,
  taskProcessGraphQueryOptions,
} from "~/lib/serverReactQuery";

import styles from "./RightDockProcessPanel.module.css";

const PULSE_GROUP_ORDER: readonly ProcessBoardGroup[] = ["attention", "active", "ready"];

const GROUP_LABELS: Record<ProcessBoardGroup, string> = {
  attention: "Needs attention",
  active: "Active now",
  ready: "Ready next",
  completed: "Completed",
};

const LANE_LABELS: Record<ProcessBoardLane, string> = {
  ready: "Ready",
  in_progress: "In progress",
  review: "Review required",
  done: "Completed",
  blocked: "Blocked",
  paused: "Paused",
  failed: "Failed",
  cancelled: "Cancelled",
};

function activityStateForLane(lane: ProcessBoardLane): ThreadActivityState {
  if (lane === "in_progress") return "working";
  if (lane === "review" || lane === "done") return "ready";
  if (lane === "blocked" || lane === "paused") return "blocked";
  if (lane === "failed" || lane === "cancelled") return "failed";
  return "idle";
}

function taskGroups(graph: TaskProcessGraphProjection) {
  const groups = new Map<ProcessBoardGroup, ProjectTaskProjection[]>(
    PULSE_GROUP_ORDER.map((group) => [group, []]),
  );
  for (const task of [...graph.tasks].sort((a, b) =>
    a.task.orderKey.localeCompare(b.task.orderKey),
  )) {
    groups.get(processBoardGroupForLane(deriveProcessBoardLane(task)))?.push(task);
  }
  return groups;
}

function taskSignal(
  task: ProjectTaskProjection,
  graph: TaskProcessGraphProjection,
  progress: SessionProgressProjection | null,
): string {
  const lane = deriveProcessBoardLane(task);
  const blocker = graph.blockers.find(
    (candidate) => candidate.taskId === task.task.id && candidate.resolvedAt === null,
  );
  if (blocker) return blocker.summary;
  if (lane === "blocked" && task.unmetDependencyIds.length > 0) {
    return `${task.unmetDependencyIds.length} prerequisite${task.unmetDependencyIds.length === 1 ? "" : "s"} unresolved`;
  }
  const latestProgress = progress?.latestProgress
    .filter((entry) => entry.taskId === task.task.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (latestProgress) return latestProgress.summary;
  if (lane === "review") return "A review decision is required";
  if (lane === "in_progress") return "Work is currently in motion";
  if (lane === "ready") return "Ready to start with no active blockers";
  return LANE_LABELS[lane];
}

function TaskPulseItem(props: {
  readonly task: ProjectTaskProjection;
  readonly graph: TaskProcessGraphProjection;
  readonly progress: SessionProgressProjection | null;
  readonly onOpenTask: (taskId: ProjectTaskId) => void;
}) {
  const lane = deriveProcessBoardLane(props.task);
  return (
    <button
      type="button"
      className="group flex min-w-0 items-start gap-2 rounded-lg border border-border/70 px-2.5 py-2 text-left transition-colors hover:bg-muted/45"
      data-task-dock-id={props.task.task.id}
      onClick={() => props.onOpenTask(props.task.task.id)}
    >
      <ThreadActivityGlyph state={activityStateForLane(lane)} className="mt-0.5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-medium">{props.task.task.title}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {LANE_LABELS[lane]}
          </span>
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[10px] leading-relaxed text-muted-foreground">
          {taskSignal(props.task, props.graph, props.progress)}
        </span>
      </span>
      <TaskRiskBadge risk={props.task.task.risk} compact />
    </button>
  );
}

function PulseSection(props: {
  readonly group: ProcessBoardGroup;
  readonly tasks: readonly ProjectTaskProjection[];
  readonly graph: TaskProcessGraphProjection;
  readonly progress: SessionProgressProjection | null;
  readonly onOpenTask: (taskId: ProjectTaskId) => void;
}) {
  if (props.tasks.length === 0) return null;
  return (
    <section className="grid content-start gap-1.5" data-task-pulse-group={props.group}>
      <div className="flex items-center gap-2 px-1">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {GROUP_LABELS[props.group]}
        </h3>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {props.tasks.length}
        </span>
      </div>
      {props.tasks.slice(0, 3).map((task) => (
        <TaskPulseItem
          key={task.task.id}
          task={task}
          graph={props.graph}
          progress={props.progress}
          onOpenTask={props.onOpenTask}
        />
      ))}
    </section>
  );
}

export function RightDockProcessPanelView(props: {
  readonly summary: TaskProcessSummaryProjection | null;
  readonly graph: TaskProcessGraphProjection | null;
  readonly progress: SessionProgressProjection | null;
  readonly loading?: boolean;
  readonly onOpenTask?: (taskId: ProjectTaskId) => void;
  readonly onOpenProcess: (processId: TaskProcessId) => void;
}) {
  if (!props.summary) {
    return <PanelStateMessage>No active task plan is attached to this Root.</PanelStateMessage>;
  }
  const summaryCounts = props.summary.counts;
  const graphGroups = props.graph ? taskGroups(props.graph) : null;
  const graphLanes = props.graph?.tasks.map(deriveProcessBoardLane) ?? null;
  const counts = graphLanes
    ? {
        total: graphLanes.length,
        done: graphLanes.filter((lane) => lane === "done").length,
        active: graphGroups?.get("active")?.length ?? 0,
        attention: graphGroups?.get("attention")?.length ?? 0,
        ready: graphGroups?.get("ready")?.length ?? 0,
      }
    : {
        total: summaryCounts.total,
        done: summaryCounts.done,
        active: summaryCounts.running,
        attention: summaryCounts.blocked + summaryCounts.review + summaryCounts.failed,
        ready: summaryCounts.ready,
      };
  const percent = counts.total === 0 ? 0 : Math.round((counts.done / counts.total) * 100);
  return (
    <div className={styles.root} data-orchestrator-panel="process">
      <header className="border-b border-border/70 px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Task pulse
            </p>
            <p className="mt-0.5 truncate text-xs font-semibold">{props.summary.process.title}</p>
          </div>
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            {counts.done}/{counts.total} complete
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-foreground transition-[width]" style={{ width: `${percent}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          <span>{counts.active} active</span>
          <span>{counts.attention} attention</span>
          <span>{counts.ready} ready</span>
          <span>{counts.done} done</span>
        </div>
      </header>
      <div className={styles.body}>
        {props.loading ? (
          <p className="p-4 text-xs text-muted-foreground">Loading task focus…</p>
        ) : props.graph && props.graph.tasks.length > 0 ? (
          <div className={styles.pulse} data-task-dock-region="pulse">
            {(() => {
              const groups = taskGroups(props.graph);
              const openTask = props.onOpenTask ?? (() => undefined);
              return PULSE_GROUP_ORDER.map((group) => (
                <PulseSection
                  key={group}
                  group={group}
                  tasks={groups.get(group) ?? []}
                  graph={props.graph!}
                  progress={props.progress}
                  onOpenTask={openTask}
                />
              ));
            })()}
          </div>
        ) : (
          <PanelStateMessage>No tasks are attached to this process.</PanelStateMessage>
        )}
      </div>
      <footer className="border-t border-border p-3">
        <Button
          className="w-full"
          size="sm"
          variant="outline"
          onClick={() => props.onOpenProcess(props.summary!.process.id)}
        >
          Open task board
        </Button>
      </footer>
    </div>
  );
}

export function RightDockProcessPanel(props: {
  readonly rootThreadId: ThreadId;
  readonly summary: TaskProcessSummaryProjection | null;
  readonly onOpenTask: (taskId: ProjectTaskId) => void;
  readonly onOpenProcess: (processId: TaskProcessId) => void;
}) {
  const processId = props.summary?.process.id;
  const inactiveProcessId = TaskProcessId.makeUnsafe("inactive-task-process");
  const progressQuery = useQuery(
    sessionProgressQueryOptions({
      threadId: props.rootThreadId,
      ...(processId ? { processId } : {}),
      enabled: processId !== undefined,
      limit: 50,
    }),
  );
  const graphQuery = useQuery({
    ...taskProcessGraphQueryOptions(processId ?? inactiveProcessId),
    enabled: processId !== undefined,
  });
  return (
    <RightDockProcessPanelView
      summary={props.summary}
      graph={graphQuery.data?.graph ?? null}
      progress={progressQuery.data?.progress ?? null}
      loading={(graphQuery.isPending || progressQuery.isPending) && processId !== undefined}
      onOpenTask={props.onOpenTask}
      onOpenProcess={props.onOpenProcess}
    />
  );
}
