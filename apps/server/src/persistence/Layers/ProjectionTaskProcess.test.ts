import {
  ProjectId,
  ProjectTaskId,
  TaskBlockerId,
  TaskDependencyEdgeId,
  TaskProcessId,
  TaskProgressEntryId,
  TaskThreadBindingId,
  ThreadId,
} from "@synara/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Exit, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionTaskProcessRepositoryLive } from "./ProjectionTaskProcess.ts";
import { ProjectionTaskProcessRepository } from "../Services/ProjectionTaskProcess.ts";

const layer = it.layer(
  Layer.mergeAll(
    ProjectionTaskProcessRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

const now = "2026-08-01T00:00:00.000Z";
const actor = { kind: "user" as const, actorId: "owner" };

layer("ProjectionTaskProcessRepository", (it) => {
  it.effect("keeps normalized process scope, graph relations, and append-only progress", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionTaskProcessRepository;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
        ) VALUES
          ('project-a', 'project', 'A', '/workspace/a', '[]', ${now}, ${now}),
          ('project-b', 'project', 'B', '/workspace/b', '[]', ${now}, ${now})
      `;

      const processId = TaskProcessId.makeUnsafe("process-a");
      yield* repository.upsertProcess({
        process: {
          id: processId,
          projectId: ProjectId.makeUnsafe("project-a"),
          title: "Build Orchestrator",
          owner: { kind: "user" },
          state: "active",
          revision: 3,
          createdAt: now,
          updatedAt: now,
        },
        graphRevision: 3,
        highWaterCursor: "cursor-3",
      });

      const taskA = ProjectTaskId.makeUnsafe("task-a");
      const taskB = ProjectTaskId.makeUnsafe("task-b");
      for (const [id, orderKey] of [
        [taskA, "a"],
        [taskB, "b"],
      ] as const) {
        yield* repository.upsertTask({
          processId,
          task: {
            task: {
              id,
              processId,
              parentTaskId: null,
              title: id,
              description: null,
              acceptanceCriteria: ["verified"],
              priority: "normal",
              risk: id === taskA ? "high" : "medium",
              lifecycle: id === taskA ? "in_progress" : "planned",
              orderKey,
              createdBy: actor,
              createdAt: now,
              updatedAt: now,
            },
            readiness: id === taskA ? "ready" : "blocked",
            executionHealth: id === taskA ? "running" : "idle",
            unmetDependencyIds: [],
            blockerIds: [],
            bindingIds: [],
            evidenceState: "current",
          },
        });
      }

      const dependencyId = TaskDependencyEdgeId.makeUnsafe("dependency-b-a");
      yield* repository.upsertDependency({
        processId,
        dependency: {
          id: dependencyId,
          processId,
          dependentTaskId: taskB,
          prerequisiteTaskId: taskA,
          state: "active",
          createdBy: actor,
          createdAt: now,
          waivedBy: null,
          waivedAt: null,
          waiverReason: null,
        },
      });
      yield* repository.upsertBinding({
        processId,
        binding: {
          id: TaskThreadBindingId.makeUnsafe("binding-a"),
          taskId: taskA,
          threadId: ThreadId.makeUnsafe("thread-a"),
          assignmentId: null,
          role: "owner",
          activeFrom: now,
          retiredAt: null,
        },
      });
      yield* repository.upsertBlocker({
        processId,
        blocker: {
          id: TaskBlockerId.makeUnsafe("blocker-b"),
          taskId: taskB,
          kind: "external",
          summary: "Awaiting dependency",
          createdBy: actor,
          createdAt: now,
          resolvedBy: null,
          resolvedAt: null,
          resolution: null,
        },
      });
      const progress = {
        id: TaskProgressEntryId.makeUnsafe("progress-a"),
        taskId: taskA,
        assignmentId: null,
        threadId: ThreadId.makeUnsafe("thread-a"),
        actor,
        kind: "progress" as const,
        summary: "Implemented persistence",
        evidenceRefs: ["test:projection"],
        createdAt: now,
      };
      yield* repository.appendProgress({ processId, progress });
      const duplicate = yield* repository
        .appendProgress({ processId, progress: { ...progress, summary: "must not overwrite" } })
        .pipe(Effect.exit);
      assert.ok(Exit.isFailure(duplicate));

      const graph = yield* repository.getGraph(processId);
      assert.ok(Option.isSome(graph));
      if (Option.isNone(graph)) return;
      assert.strictEqual(graph.value.tasks.length, 2);
      assert.deepStrictEqual(
        graph.value.tasks.map((task) => task.task.risk),
        ["high", "medium"],
      );
      assert.deepStrictEqual(graph.value.tasks[1]?.unmetDependencyIds, [dependencyId]);
      assert.strictEqual(graph.value.tasks[1]?.blockerIds.length, 1);
      assert.strictEqual(graph.value.bindings.length, 1);

      const activeProcessForThread = yield* repository.findActiveProcessForThread(
        ThreadId.makeUnsafe("thread-a"),
      );
      assert.deepStrictEqual(activeProcessForThread, Option.some(processId));

      const progressRows = yield* sql<{ readonly summary: string }>`
        SELECT summary FROM projection_task_progress WHERE progress_id = 'progress-a'
      `;
      assert.deepStrictEqual(progressRows, [{ summary: "Implemented persistence" }]);

      const wrongScope = yield* repository
        .upsertProcess({
          process: {
            ...graph.value.process,
            projectId: ProjectId.makeUnsafe("project-b"),
          },
          graphRevision: 4,
          highWaterCursor: "cursor-4",
        })
        .pipe(Effect.exit);
      assert.ok(Exit.isFailure(wrongScope));
    }),
  );
});
