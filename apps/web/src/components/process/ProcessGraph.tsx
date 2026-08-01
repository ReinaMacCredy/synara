import type {
  ProjectTaskId,
  ProjectTaskProjection,
  TaskProcessGraphProjection,
} from "@synara/contracts";

export interface ProcessGraphWave {
  readonly index: number;
  readonly tasks: readonly ProjectTaskProjection[];
}

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

export function ProcessGraph(props: {
  readonly graph: TaskProcessGraphProjection;
  readonly onSelectTask: (taskId: ProjectTaskId) => void;
}) {
  const waves = buildDependencyWaves(props.graph);
  const outgoing = new Map<ProjectTaskId, ProjectTaskId[]>();
  for (const edge of props.graph.dependencies) {
    if (edge.state !== "active") continue;
    const targets = outgoing.get(edge.prerequisiteTaskId) ?? [];
    targets.push(edge.dependentTaskId);
    outgoing.set(edge.prerequisiteTaskId, targets);
  }

  return (
    <div
      className="flex min-w-max items-start gap-10 overflow-auto p-5"
      data-process-view="graph"
      data-layout="dependency-only"
    >
      {waves.map((wave) => (
        <section key={wave.index} className="w-64 shrink-0">
          <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Wave {wave.index + 1}
          </h2>
          <div className="grid gap-3">
            {wave.tasks.map((task) => (
              <button
                key={task.task.id}
                type="button"
                className="rounded-xl border border-border bg-background p-3 text-left shadow-sm"
                onClick={() => props.onSelectTask(task.task.id)}
                data-process-graph-task={task.task.id}
              >
                <span className="text-[10px] text-muted-foreground">{task.task.id}</span>
                <span className="mt-1 block text-xs font-medium">{task.task.title}</span>
                <span className="mt-2 block text-[10px] capitalize text-muted-foreground">
                  {task.readiness} · {task.task.lifecycle}
                </span>
                {(outgoing.get(task.task.id)?.length ?? 0) > 0 ? (
                  <span className="mt-2 block border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
                    Unblocks {outgoing.get(task.task.id)?.join(", ")}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
