import {
  TaskProcessId,
  type ProjectTaskProjection,
  type SessionProgressItem,
  type TaskProcessGraphProjection,
  type TaskProcessSummary,
  type TaskProcessSummaryProjection,
  type TaskThreadBindingProjection,
  type ThreadId,
} from "@synara/contracts";
import { Effect, Layer, Option } from "effect";

import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { ProjectionTaskProcessRepository } from "../../persistence/Services/ProjectionTaskProcess.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { TaskProcessQuery, type TaskProcessQueryShape } from "../Services/TaskProcessQuery.ts";

const boundedLimit = (value: number | undefined, maximum: number, fallback: number): number =>
  Math.max(1, Math.min(maximum, Math.floor(value ?? fallback)));

const processSummary = (process: TaskProcessGraphProjection["process"]): TaskProcessSummary => ({
  id: process.id,
  projectId: process.projectId,
  title: process.title,
  owner: process.owner,
  state: process.state,
  revision: process.revision,
  updatedAt: process.updatedAt,
});

const taskCounts = (graph: TaskProcessGraphProjection) => ({
  total: graph.tasks.length,
  done: graph.tasks.filter(({ task }) => task.lifecycle === "done").length,
  ready: graph.tasks.filter(
    ({ task, readiness }) => task.lifecycle === "planned" && readiness === "ready",
  ).length,
  blocked: graph.tasks.filter(({ readiness }) => readiness === "blocked").length,
  running: graph.tasks.filter(({ executionHealth }) => executionHealth === "running").length,
  review: graph.tasks.filter(({ task }) => task.lifecycle === "review").length,
  failed: graph.tasks.filter(({ task }) => task.lifecycle === "failed").length,
});

const summaryProjection = (graph: TaskProcessGraphProjection): TaskProcessSummaryProjection => ({
  process: processSummary(graph.process),
  counts: taskCounts(graph),
  graphRevision: graph.graphRevision,
  highWaterCursor: graph.highWaterCursor,
});

const decodeCursor = (cursor: string | undefined): { updatedAt: string; id: string } | null => {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "updatedAt" in parsed &&
      typeof parsed.updatedAt === "string" &&
      "id" in parsed &&
      typeof parsed.id === "string"
    ) {
      return { updatedAt: parsed.updatedAt, id: parsed.id };
    }
  } catch {
    // Converted to one stable public error below.
  }
  throw new Error("Invalid TaskProcess pagination cursor.");
};

const encodeCursor = (value: { readonly updatedAt: string; readonly id: string }): string =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

const taskDepth = (
  task: ProjectTaskProjection,
  tasksById: ReadonlyMap<string, ProjectTaskProjection>,
): number => {
  let depth = 0;
  let parentId = task.task.parentTaskId;
  const visited = new Set<string>();
  while (parentId !== null && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = tasksById.get(parentId);
    if (!parent) break;
    depth += 1;
    parentId = parent.task.parentTaskId;
  }
  return depth;
};

const childFocusTaskIds = (
  graph: TaskProcessGraphProjection,
  roots: ReadonlySet<string>,
): ReadonlySet<string> => {
  const visible = new Set(roots);
  for (const { task } of graph.tasks) {
    if (task.parentTaskId !== null && roots.has(task.parentTaskId)) {
      visible.add(task.id);
    }
  }
  return visible;
};

const make = Effect.gen(function* () {
  const eventStore = yield* OrchestrationEventStore;
  const processes = yield* ProjectionTaskProcessRepository;
  const snapshots = yield* ProjectionSnapshotQuery;

  const loadGraph = Effect.fnUntraced(function* (processId) {
    const graph = yield* processes.getGraph(processId).pipe(Effect.mapError((error) => error));
    if (Option.isNone(graph)) {
      return yield* Effect.fail(new Error(`TaskProcess '${processId}' was not found.`));
    }
    const aggregateHighWater = yield* eventStore
      .getAggregateHighWaterSequence({ aggregateKind: "task_process", aggregateId: processId })
      .pipe(Effect.mapError((error) => error));
    return {
      graph: graph.value,
      projectionBehind: Number(graph.value.highWaterCursor) < aggregateHighWater,
    };
  });

  const listProcesses: TaskProcessQueryShape["listProcesses"] = (input) =>
    Effect.gen(function* () {
      const limit = boundedLimit(input.limit, 100, 50);
      const cursor = decodeCursor(input.cursor);
      const page = yield* processes
        .listProcessPage({
          projectId: input.projectId,
          includeArchived: input.includeArchived === true,
          ...(cursor ? { beforeUpdatedAt: cursor.updatedAt } : {}),
          ...(cursor ? { afterProcessIdAtTimestamp: TaskProcessId.makeUnsafe(cursor.id) } : {}),
          limit: limit + 1,
        })
        .pipe(Effect.mapError((error) => error));
      const items = page.slice(0, limit).map((row) => processSummary(row.process));
      const last = page.length > limit ? items.at(-1) : undefined;
      return {
        items,
        nextCursor: last ? encodeCursor({ updatedAt: last.updatedAt, id: last.id }) : null,
        highWaterCursor: String(yield* eventStore.getHighWaterSequence()),
      };
    });

  const getSummary: TaskProcessQueryShape["getSummary"] = (input) =>
    loadGraph(input.processId).pipe(
      Effect.map(({ graph, projectionBehind }) => ({
        summary: summaryProjection(graph),
        projectionBehind,
      })),
    );

  const getGraph: TaskProcessQueryShape["getGraph"] = (input) =>
    loadGraph(input.processId).pipe(
      Effect.map(({ graph, projectionBehind }) => ({ graph, projectionBehind })),
    );

  const resolveProcessForThread = Effect.fnUntraced(function* (
    threadId: ThreadId,
    requestedProcessId: TaskProcessId | undefined,
  ) {
    if (requestedProcessId !== undefined) return Option.some(requestedProcessId);
    return yield* processes.findActiveProcessForThread(threadId);
  });

  const getSessionProgress: TaskProcessQueryShape["getSessionProgress"] = (input) =>
    Effect.gen(function* () {
      const processId = yield* resolveProcessForThread(input.threadId, input.processId);
      if (Option.isNone(processId)) return { progress: null, projectionBehind: false };
      const { graph, projectionBehind } = yield* loadGraph(processId.value);
      const activeBindings = graph.bindings.filter(
        ({ binding }) => binding.retiredAt === null && binding.threadId === input.threadId,
      );
      const scopeIds = childFocusTaskIds(
        graph,
        new Set(activeBindings.map(({ binding }) => binding.taskId)),
      );
      if (scopeIds.size === 0) return { progress: null, projectionBehind };
      const visibleIds = scopeIds;

      const limit = boundedLimit(input.limit, 64, 16);
      const ordered = graph.tasks
        .filter(({ task }) => visibleIds.has(task.id))
        .toSorted(
          (left, right) =>
            left.task.orderKey.localeCompare(right.task.orderKey) ||
            left.task.id.localeCompare(right.task.id),
        );
      const page = ordered.slice(0, limit);
      const tasksById = new Map(graph.tasks.map((task) => [task.task.id, task]));
      const dependencyById = new Map(graph.dependencies.map((edge) => [edge.id, edge]));
      const visibleTasks: SessionProgressItem[] = page.map((task) => ({
        task,
        depth: taskDepth(task, tasksById),
        blockedByTitles: task.unmetDependencyIds.flatMap((dependencyId) => {
          const edge = dependencyById.get(dependencyId);
          const prerequisite = edge ? tasksById.get(edge.prerequisiteTaskId) : undefined;
          return prerequisite ? [prerequisite.task.title] : [];
        }),
      }));
      const primaryBinding = activeBindings.toSorted((left, right) => {
        const rank = (binding: TaskThreadBindingProjection) =>
          binding.binding.role === "owner" ? 0 : 1;
        return (
          rank(left) - rank(right) ||
          left.binding.activeFrom.localeCompare(right.binding.activeFrom)
        );
      })[0];
      const primaryTask = primaryBinding
        ? (tasksById.get(primaryBinding.binding.taskId) ?? null)
        : null;
      const boundThreadIds = [
        ...new Set(
          graph.bindings
            .filter(({ binding }) => binding.retiredAt === null && scopeIds.has(binding.taskId))
            .map(({ binding }) => binding.threadId),
        ),
      ].slice(0, 64);
      const boundThreads = yield* Effect.forEach(
        boundThreadIds,
        (threadId) =>
          snapshots.getThreadShellById(threadId).pipe(
            Effect.map((thread) => {
              const binding = graph.bindings.find(
                (candidate) =>
                  candidate.binding.retiredAt === null && candidate.binding.threadId === threadId,
              );
              if (!binding) return null;
              const shell = Option.getOrNull(thread);
              return {
                threadId,
                taskId: binding.binding.taskId,
                role: binding.binding.role,
                executionHealth: binding.executionHealth,
                provider: shell?.modelSelection.provider ?? null,
                model: shell?.modelSelection.model ?? null,
                lastActivityAt: shell?.updatedAt ?? null,
              };
            }),
            Effect.mapError((error) => error),
          ),
        { concurrency: 8 },
      ).pipe(
        Effect.map((items) =>
          items.filter((item): item is NonNullable<typeof item> => item !== null),
        ),
      );
      const latestProgress = (yield* processes.listProgress(processId.value))
        .filter((entry) => scopeIds.has(entry.taskId))
        .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 50);
      const requestedCursor = input.cursor === undefined ? null : Number(input.cursor);
      const requestedCursorAhead =
        requestedCursor !== null &&
        Number.isSafeInteger(requestedCursor) &&
        requestedCursor > Number(graph.highWaterCursor);
      const sessionProjectionBehind = projectionBehind || requestedCursorAhead;
      const scopedTasks = graph.tasks.filter(({ task }) => scopeIds.has(task.id));
      return {
        progress: {
          threadId: input.threadId,
          processId: processId.value,
          primaryTask,
          visibleTasks,
          boundThreads,
          completedCount: scopedTasks.filter(({ task }) => task.lifecycle === "done").length,
          totalCount: scopedTasks.length,
          latestProgress,
          graphRevision: graph.graphRevision,
          cursor: graph.highWaterCursor,
          hasMore: ordered.length > limit,
          projectionBehind: sessionProjectionBehind,
        },
        projectionBehind: sessionProjectionBehind,
      };
    });

  return {
    listProcesses,
    getSummary,
    getGraph,
    getSessionProgress,
  } satisfies TaskProcessQueryShape;
});

export const TaskProcessQueryLive = Layer.effect(TaskProcessQuery, make);
