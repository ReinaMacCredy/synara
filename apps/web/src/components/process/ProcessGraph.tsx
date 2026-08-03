import type {
  ProjectTaskId,
  ProjectTaskProjection,
  TaskDependencyEdgeId,
  TaskProcessGraphProjection,
} from "@synara/contracts";
import { useId } from "react";

export interface ProcessGraphWave {
  readonly index: number;
  readonly tasks: readonly ProjectTaskProjection[];
}

interface ProcessGraphNodeLayout {
  readonly task: ProjectTaskProjection;
  readonly left: number;
  readonly top: number;
}

interface ProcessGraphEdgeLayout {
  readonly id: TaskDependencyEdgeId;
  readonly prerequisiteTaskId: ProjectTaskId;
  readonly dependentTaskId: ProjectTaskId;
  readonly path: string;
}

export interface ProcessDependencyLayout {
  readonly waves: readonly ProcessGraphWave[];
  readonly nodes: readonly ProcessGraphNodeLayout[];
  readonly edges: readonly ProcessGraphEdgeLayout[];
  readonly width: number;
  readonly height: number;
}

const NODE_WIDTH = 264;
const NODE_HEIGHT = 132;
const WAVE_GAP = 112;
const ROW_GAP = 24;
const GRAPH_PADDING = 12;
const WAVE_HEADING_HEIGHT = 34;

export function buildDependencyWaves(graph: TaskProcessGraphProjection): ProcessGraphWave[] {
  const taskById = new Map(graph.tasks.map((task) => [task.task.id, task] as const));
  const prerequisites = new Map<ProjectTaskId, Set<ProjectTaskId>>(
    graph.tasks.map((task) => [task.task.id, new Set<ProjectTaskId>()]),
  );
  for (const edge of graph.dependencies) {
    if (
      edge.state === "active" &&
      taskById.has(edge.dependentTaskId) &&
      taskById.has(edge.prerequisiteTaskId)
    ) {
      prerequisites.get(edge.dependentTaskId)?.add(edge.prerequisiteTaskId);
    }
  }

  const depthByTaskId = new Map<ProjectTaskId, number>();
  const visit = (taskId: ProjectTaskId, path: Set<ProjectTaskId>): number => {
    const existing = depthByTaskId.get(taskId);
    if (existing !== undefined) return existing;
    if (path.has(taskId)) return 0;
    const nextPath = new Set(path).add(taskId);
    const required = prerequisites.get(taskId) ?? new Set<ProjectTaskId>();
    const depth =
      required.size === 0 ? 0 : 1 + Math.max(...[...required].map((id) => visit(id, nextPath)));
    depthByTaskId.set(taskId, depth);
    return depth;
  };
  for (const task of graph.tasks) visit(task.task.id, new Set());

  const waves = new Map<number, ProjectTaskProjection[]>();
  for (const task of graph.tasks) {
    const depth = depthByTaskId.get(task.task.id) ?? 0;
    const tasks = waves.get(depth) ?? [];
    tasks.push(task);
    waves.set(depth, tasks);
  }
  return [...waves.entries()]
    .toSorted(([left], [right]) => left - right)
    .map(([index, tasks]) => ({
      index,
      tasks: tasks.toSorted((left, right) => left.task.orderKey.localeCompare(right.task.orderKey)),
    }));
}

export function buildDependencyLayout(graph: TaskProcessGraphProjection): ProcessDependencyLayout {
  const waves = buildDependencyWaves(graph);
  const nodes = waves.flatMap((wave, waveIndex) =>
    wave.tasks.map((task, rowIndex) => ({
      task,
      left: GRAPH_PADDING + waveIndex * (NODE_WIDTH + WAVE_GAP),
      top: WAVE_HEADING_HEIGHT + rowIndex * (NODE_HEIGHT + ROW_GAP),
    })),
  );
  const nodeByTaskId = new Map(nodes.map((node) => [node.task.task.id, node] as const));
  const activeEdges = graph.dependencies.filter(
    (edge) =>
      edge.state === "active" &&
      nodeByTaskId.has(edge.prerequisiteTaskId) &&
      nodeByTaskId.has(edge.dependentTaskId),
  );
  const outgoingTotals = new Map<ProjectTaskId, number>();
  const incomingTotals = new Map<ProjectTaskId, number>();
  for (const edge of activeEdges) {
    outgoingTotals.set(edge.prerequisiteTaskId, (outgoingTotals.get(edge.prerequisiteTaskId) ?? 0) + 1);
    incomingTotals.set(edge.dependentTaskId, (incomingTotals.get(edge.dependentTaskId) ?? 0) + 1);
  }
  const outgoingIndexes = new Map<ProjectTaskId, number>();
  const incomingIndexes = new Map<ProjectTaskId, number>();
  const portOffset = (index: number, total: number) => (index - (total - 1) / 2) * 18;
  const edges = activeEdges.map((edge) => {
    const source = nodeByTaskId.get(edge.prerequisiteTaskId)!;
    const target = nodeByTaskId.get(edge.dependentTaskId)!;
    const outgoingIndex = outgoingIndexes.get(edge.prerequisiteTaskId) ?? 0;
    const incomingIndex = incomingIndexes.get(edge.dependentTaskId) ?? 0;
    outgoingIndexes.set(edge.prerequisiteTaskId, outgoingIndex + 1);
    incomingIndexes.set(edge.dependentTaskId, incomingIndex + 1);
    const startX = source.left + NODE_WIDTH;
    const startY =
      source.top +
      NODE_HEIGHT / 2 +
      portOffset(outgoingIndex, outgoingTotals.get(edge.prerequisiteTaskId) ?? 1);
    const endX = target.left;
    const endY =
      target.top +
      NODE_HEIGHT / 2 +
      portOffset(incomingIndex, incomingTotals.get(edge.dependentTaskId) ?? 1);
    const bend = Math.max(44, (endX - startX) * 0.48);
    return {
      id: edge.id,
      prerequisiteTaskId: edge.prerequisiteTaskId,
      dependentTaskId: edge.dependentTaskId,
      path: `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`,
    };
  });
  const tallestWave = Math.max(1, ...waves.map((wave) => wave.tasks.length));
  return {
    waves,
    nodes,
    edges,
    width:
      GRAPH_PADDING * 2 +
      Math.max(1, waves.length) * NODE_WIDTH +
      Math.max(0, waves.length - 1) * WAVE_GAP,
    height:
      WAVE_HEADING_HEIGHT + tallestWave * NODE_HEIGHT + Math.max(0, tallestWave - 1) * ROW_GAP,
  };
}

export function ProcessGraph(props: {
  readonly graph: TaskProcessGraphProjection;
  readonly onSelectTask: (taskId: ProjectTaskId) => void;
}) {
  const markerId = `process-dependency-arrow-${useId().replaceAll(":", "")}`;
  const layout = buildDependencyLayout(props.graph);
  const taskById = new Map(props.graph.tasks.map((task) => [task.task.id, task] as const));
  const incoming = new Map<ProjectTaskId, ProjectTaskId[]>();
  const outgoing = new Map<ProjectTaskId, ProjectTaskId[]>();
  for (const edge of props.graph.dependencies) {
    if (edge.state !== "active") continue;
    const sources = incoming.get(edge.dependentTaskId) ?? [];
    sources.push(edge.prerequisiteTaskId);
    incoming.set(edge.dependentTaskId, sources);
    const targets = outgoing.get(edge.prerequisiteTaskId) ?? [];
    targets.push(edge.dependentTaskId);
    outgoing.set(edge.prerequisiteTaskId, targets);
  }

  return (
    <div
      className="h-full overflow-auto p-5"
      data-process-view="graph"
      data-layout="dependency-only"
    >
      <div className="relative min-w-max" style={{ width: layout.width, height: layout.height }}>
        <svg
          aria-label={`${layout.edges.length} active task dependencies`}
          className="pointer-events-none absolute inset-0 overflow-visible text-muted-foreground/70"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
        >
          <defs>
            <marker
              id={markerId}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          {layout.edges.map((edge) => (
            <path
              key={edge.id}
              d={edge.path}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              markerEnd={`url(#${markerId})`}
              data-process-dependency={`${edge.prerequisiteTaskId}->${edge.dependentTaskId}`}
            />
          ))}
        </svg>
        {layout.waves.map((wave, index) => (
          <h2
            key={wave.index}
            className="absolute top-0 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
            style={{ left: GRAPH_PADDING + index * (NODE_WIDTH + WAVE_GAP), width: NODE_WIDTH }}
          >
            Wave {wave.index + 1}
          </h2>
        ))}
        {layout.nodes.map(({ task, left, top }) => {
          const prerequisiteIds = incoming.get(task.task.id) ?? [];
          const prerequisiteTitles = prerequisiteIds.map(
            (taskId) => taskById.get(taskId)?.task.title ?? taskId,
          );
          const targetTitles = (outgoing.get(task.task.id) ?? []).map(
            (taskId) => taskById.get(taskId)?.task.title ?? taskId,
          );
          return (
            <button
              key={task.task.id}
              type="button"
              className="absolute flex flex-col rounded-xl border border-border bg-background p-3 text-left shadow-sm transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ left, top, width: NODE_WIDTH, height: NODE_HEIGHT }}
              onClick={() => props.onSelectTask(task.task.id)}
              data-process-graph-task={task.task.id}
            >
              <span className="truncate text-[10px] text-muted-foreground">{task.task.id}</span>
              <span className="mt-1 block truncate text-xs font-medium">{task.task.title}</span>
              <span className="mt-2 block text-[10px] capitalize text-muted-foreground">
                {task.readiness} · {task.task.lifecycle}
              </span>
              {prerequisiteTitles.length > 0 ? (
                <span className="mt-auto block truncate border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
                  {task.readiness === "blocked" ? "Blocked by" : "Depends on"}{" "}
                  {prerequisiteTitles.join(", ")}
                </span>
              ) : targetTitles.length > 0 ? (
                <span className="mt-auto block truncate border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
                  Unblocks {targetTitles.join(", ")}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
