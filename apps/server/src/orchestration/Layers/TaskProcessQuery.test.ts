import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  ProjectTaskId,
  TaskDependencyEdgeId,
  TaskProcessId,
  TaskProgressEntryId,
  TaskThreadBindingId,
  ThreadId,
  type ProjectTaskProjection,
  type TaskProcess,
  type TaskProcessGraphProjection,
} from "@synara/contracts";
import { Effect, Layer, Option } from "effect";
import { expect } from "vitest";

import {
  OrchestrationEventStore,
  type OrchestrationEventStoreShape,
} from "../../persistence/Services/OrchestrationEventStore.ts";
import {
  ProjectionOrchestratorRepository,
  type ProjectionOrchestratorRepositoryShape,
} from "../../persistence/Services/ProjectionOrchestrator.ts";
import {
  ProjectionTaskProcessRepository,
  type ProjectionTaskProcessRecord,
  type ProjectionTaskProcessRepositoryShape,
} from "../../persistence/Services/ProjectionTaskProcess.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../Services/ProjectionSnapshotQuery.ts";
import { TaskProcessQuery } from "../Services/TaskProcessQuery.ts";
import { TaskProcessQueryLive } from "./TaskProcessQuery.ts";

const projectId = ProjectId.makeUnsafe("project-query");
const processId = TaskProcessId.makeUnsafe("process-query");
const rootThreadId = ThreadId.makeUnsafe("thread-root");
const childThreadId = ThreadId.makeUnsafe("thread-child");
const reviewerThreadId = ThreadId.makeUnsafe("thread-reviewer");
const occurredAt = "2026-08-01T10:00:00.000Z";

const task = (
  id: string,
  options: Partial<{
    parentTaskId: ProjectTaskId | null;
    lifecycle: ProjectTaskProjection["task"]["lifecycle"];
    readiness: ProjectTaskProjection["readiness"];
    executionHealth: ProjectTaskProjection["executionHealth"];
    unmetDependencyIds: ReadonlyArray<TaskDependencyEdgeId>;
    orderKey: string;
  }> = {},
): ProjectTaskProjection => ({
  task: {
    id: ProjectTaskId.makeUnsafe(id),
    processId,
    parentTaskId: options.parentTaskId ?? null,
    title: `Task ${id}`,
    description: null,
    acceptanceCriteria: [],
    priority: "normal",
    lifecycle: options.lifecycle ?? "planned",
    orderKey: options.orderKey ?? id,
    createdBy: { kind: "user", actorId: "owner" },
    createdAt: occurredAt,
    updatedAt: occurredAt,
  },
  readiness: options.readiness ?? "ready",
  executionHealth: options.executionHealth ?? "idle",
  unmetDependencyIds: [...(options.unmetDependencyIds ?? [])],
  blockerIds: [],
  bindingIds: [],
  evidenceState: "current",
});

const dependencyId = TaskDependencyEdgeId.makeUnsafe("dependency-child-parent");
const parentTask = task("task-parent", {
  lifecycle: "in_progress",
  executionHealth: "running",
  orderKey: "1",
});
const childTask = task("task-child", {
  parentTaskId: parentTask.task.id,
  readiness: "blocked",
  unmetDependencyIds: [dependencyId],
  orderKey: "2",
});
const grandchildTask = task("task-grandchild", {
  parentTaskId: childTask.task.id,
  lifecycle: "done",
  orderKey: "3",
});

const process = (id: TaskProcessId, updatedAt: string): TaskProcess => ({
  id,
  projectId,
  title: `Process ${id}`,
  owner: { kind: "orchestrator", rootThreadId },
  state: "active",
  revision: 7,
  createdAt: occurredAt,
  updatedAt,
});

const graph: TaskProcessGraphProjection = {
  process: process(processId, "2026-08-01T10:03:00.000Z"),
  tasks: [parentTask, childTask, grandchildTask],
  dependencies: [
    {
      id: dependencyId,
      processId,
      dependentTaskId: childTask.task.id,
      prerequisiteTaskId: parentTask.task.id,
      state: "active",
      createdBy: { kind: "user", actorId: "owner" },
      createdAt: occurredAt,
      waivedBy: null,
      waivedAt: null,
      waiverReason: null,
    },
  ],
  bindings: [
    {
      binding: {
        id: TaskThreadBindingId.makeUnsafe("binding-owner"),
        taskId: parentTask.task.id,
        threadId: childThreadId,
        assignmentId: null,
        role: "owner",
        activeFrom: occurredAt,
        retiredAt: null,
      },
      taskLifecycle: parentTask.task.lifecycle,
      executionHealth: parentTask.executionHealth,
    },
    {
      binding: {
        id: TaskThreadBindingId.makeUnsafe("binding-reviewer"),
        taskId: childTask.task.id,
        threadId: reviewerThreadId,
        assignmentId: null,
        role: "reviewer",
        activeFrom: occurredAt,
        retiredAt: null,
      },
      taskLifecycle: childTask.task.lifecycle,
      executionHealth: childTask.executionHealth,
    },
  ],
  blockers: [],
  graphRevision: 7,
  highWaterCursor: "10",
};

const processRows: ReadonlyArray<ProjectionTaskProcessRecord> = [
  { process: graph.process, graphRevision: 7, highWaterCursor: "10" },
  {
    process: process(TaskProcessId.makeUnsafe("process-second"), "2026-08-01T10:02:00.000Z"),
    graphRevision: 1,
    highWaterCursor: "8",
  },
  {
    process: process(TaskProcessId.makeUnsafe("process-third"), "2026-08-01T10:01:00.000Z"),
    graphRevision: 1,
    highWaterCursor: "6",
  },
];

const taskProcesses = {
  listProcessPage: (
    input: Parameters<ProjectionTaskProcessRepositoryShape["listProcessPage"]>[0],
  ) => {
    const rows = processRows
      .filter(({ process: row }) => row.projectId === input.projectId)
      .filter(({ process: row }) => {
        if (input.beforeUpdatedAt === undefined) return true;
        return (
          row.updatedAt < input.beforeUpdatedAt ||
          (row.updatedAt === input.beforeUpdatedAt &&
            input.afterProcessIdAtTimestamp !== undefined &&
            row.id > input.afterProcessIdAtTimestamp)
        );
      })
      .slice(0, input.limit);
    return Effect.succeed(rows);
  },
  getGraph: (requestedProcessId: TaskProcessId) =>
    Effect.succeed(requestedProcessId === processId ? Option.some(graph) : Option.none()),
  findActiveProcessForThread: () => Effect.succeed(Option.none()),
  listProgress: () =>
    Effect.succeed([
      {
        id: TaskProgressEntryId.makeUnsafe("progress-child"),
        taskId: childTask.task.id,
        assignmentId: null,
        threadId: childThreadId,
        actor: { kind: "thread" as const, threadId: childThreadId },
        kind: "blocker" as const,
        summary: "Waiting for the parent task",
        evidenceRefs: [],
        createdAt: "2026-08-01T10:04:00.000Z",
      },
    ]),
} as unknown as ProjectionTaskProcessRepositoryShape;

const orchestrators = {
  findRootForThread: (threadId: ThreadId) =>
    Effect.succeed(
      threadId === rootThreadId || threadId === childThreadId || threadId === reviewerThreadId
        ? Option.some(rootThreadId)
        : Option.none(),
    ),
  getCore: (requestedRootThreadId: ThreadId) =>
    Effect.succeed(
      requestedRootThreadId === rootThreadId
        ? Option.some({ root: { root: { activeProcessId: processId } } } as never)
        : Option.none(),
    ),
} as unknown as ProjectionOrchestratorRepositoryShape;

const eventStore = {
  getHighWaterSequence: () => Effect.succeed(20),
  getAggregateHighWaterSequence: () => Effect.succeed(12),
} as unknown as OrchestrationEventStoreShape;

const snapshots = {
  getThreadShellById: (threadId: ThreadId) =>
    Effect.succeed(
      Option.some({
        modelSelection:
          threadId === reviewerThreadId
            ? { provider: "claudeAgent", model: "opus" }
            : { provider: "codex", model: "gpt" },
        updatedAt: occurredAt,
      } as never),
    ),
} as unknown as ProjectionSnapshotQueryShape;

const TestLayer = TaskProcessQueryLive.pipe(
  Layer.provide(Layer.succeed(OrchestrationEventStore, eventStore)),
  Layer.provide(Layer.succeed(ProjectionOrchestratorRepository, orchestrators)),
  Layer.provide(Layer.succeed(ProjectionTaskProcessRepository, taskProcesses)),
  Layer.provide(Layer.succeed(ProjectionSnapshotQuery, snapshots)),
);

it.effect("pages TaskProcesses with an opaque bounded cursor", () =>
  Effect.gen(function* () {
    const query = yield* TaskProcessQuery;
    const first = yield* query.listProcesses({ projectId, limit: 2 });
    assert.deepStrictEqual(
      first.items.map((item) => item.id),
      [processId, TaskProcessId.makeUnsafe("process-second")],
    );
    assert.equal(first.highWaterCursor, "20");
    assert.isNotNull(first.nextCursor);

    const second = yield* query.listProcesses({
      projectId,
      limit: 2,
      cursor: first.nextCursor!,
    });
    assert.deepStrictEqual(
      second.items.map((item) => item.id),
      [TaskProcessId.makeUnsafe("process-third")],
    );
    assert.isNull(second.nextCursor);

    const invalid = yield* query
      .listProcesses({ projectId, cursor: "not-a-cursor" })
      .pipe(Effect.exit);
    assert.equal(invalid._tag, "Failure");
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("returns revisioned summary and full graph with an explicit projection lag flag", () =>
  Effect.gen(function* () {
    const query = yield* TaskProcessQuery;
    const summary = yield* query.getSummary({ processId });
    assert.equal(summary.summary.graphRevision, 7);
    assert.deepStrictEqual(summary.summary.counts, {
      total: 3,
      done: 1,
      ready: 0,
      blocked: 1,
      running: 1,
      review: 0,
      failed: 0,
    });
    assert.isTrue(summary.projectionBehind);

    const fullGraph = yield* query.getGraph({ processId });
    assert.equal(fullGraph.graph.tasks.length, 3);
    assert.equal(fullGraph.graph.highWaterCursor, "10");
    assert.isTrue(fullGraph.projectionBehind);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect(
  "keeps child focus bounded to its task and direct steps while Root gets active focus",
  () =>
    Effect.gen(function* () {
      const query = yield* TaskProcessQuery;
      const child = yield* query.getSessionProgress({ threadId: childThreadId, limit: 16 });
      expect(child.progress).not.toBeNull();
      assert.deepStrictEqual(
        child.progress!.visibleTasks.map(({ task: item }) => item.task.id),
        [parentTask.task.id, childTask.task.id],
      );
      assert.equal(child.progress!.visibleTasks[1]?.blockedByTitles[0], parentTask.task.title);
      assert.equal(child.progress!.completedCount, 0);
      assert.equal(child.progress!.totalCount, 2);
      assert.deepStrictEqual(
        child.progress!.boundThreads.map((thread) => thread.provider),
        ["codex", "claudeAgent"],
      );

      const root = yield* query.getSessionProgress({ threadId: rootThreadId, limit: 1 });
      expect(root.progress).not.toBeNull();
      assert.deepStrictEqual(
        root.progress!.visibleTasks.map(({ task: item }) => item.task.id),
        [parentTask.task.id],
      );
      assert.equal(root.progress!.completedCount, 1);
      assert.equal(root.progress!.totalCount, 3);
      assert.isTrue(root.progress!.hasMore);
    }).pipe(Effect.provide(TestLayer)),
);
