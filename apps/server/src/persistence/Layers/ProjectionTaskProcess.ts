import {
  ActorIdentity,
  ProjectTask,
  ProjectTaskId,
  TaskBlocker,
  TaskDependencyEdge,
  TaskProcessId,
  TaskProgressEntry,
  TaskProgressEntryId,
  TaskThreadBinding,
  ThreadId,
} from "@synara/contracts";
import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { PersistenceSqlError, toPersistenceSqlError } from "../Errors.ts";
import {
  ProjectionTaskProcessRepository,
  type ProjectionTaskProcessRecord,
  type ProjectionTaskProcessRepositoryShape,
} from "../Services/ProjectionTaskProcess.ts";

type ProcessDbRow = {
  readonly processId: string;
  readonly projectId: string;
  readonly title: string;
  readonly ownerKind: "user";
  readonly ownerRootThreadId: string | null;
  readonly state: "active" | "paused" | "completed" | "archived";
  readonly revision: number;
  readonly graphRevision: number;
  readonly highWaterCursor: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type TaskDbRow = {
  readonly taskId: string;
  readonly processId: string;
  readonly parentTaskId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly acceptanceCriteriaJson: string;
  readonly priority: "low" | "normal" | "high" | "critical";
  readonly risk: "low" | "medium" | "high";
  readonly lifecycle:
    | "planned"
    | "in_progress"
    | "review"
    | "done"
    | "paused"
    | "failed"
    | "cancelled";
  readonly orderKey: string;
  readonly createdByJson: string;
  readonly readiness: "ready" | "blocked";
  readonly executionHealth: "idle" | "running" | "waiting" | "stalled";
  readonly evidenceState: "current" | "potentially_stale";
  readonly createdAt: string;
  readonly updatedAt: string;
};

type DependencyDbRow = {
  readonly edgeId: string;
  readonly processId: string;
  readonly dependentTaskId: string;
  readonly prerequisiteTaskId: string;
  readonly state: "active" | "waived";
  readonly createdByJson: string;
  readonly createdAt: string;
  readonly waivedByJson: string | null;
  readonly waivedAt: string | null;
  readonly waiverReason: string | null;
};

type BindingDbRow = {
  readonly bindingId: string;
  readonly processId: string;
  readonly taskId: string;
  readonly threadId: string;
  readonly assignmentId: string | null;
  readonly role: "owner" | "contributor" | "reviewer" | "verifier" | "observer";
  readonly activeFrom: string;
  readonly retiredAt: string | null;
};

type BlockerDbRow = {
  readonly blockerId: string;
  readonly processId: string;
  readonly taskId: string;
  readonly kind: "external" | "user_input" | "permission" | "resource" | "writer_claim";
  readonly summary: string;
  readonly createdByJson: string;
  readonly createdAt: string;
  readonly resolvedByJson: string | null;
  readonly resolvedAt: string | null;
  readonly resolution: string | null;
};

type ProgressDbRow = {
  readonly progressId: string;
  readonly taskId: string;
  readonly assignmentId: string | null;
  readonly threadId: string | null;
  readonly actorJson: string;
  readonly kind: "progress" | "waiting" | "blocker" | "failure" | "completion_evidence";
  readonly summary: string;
  readonly evidenceRefsJson: string;
  readonly createdAt: string;
};

const decodeJson = <S extends Schema.Top>(schema: S, value: string): Schema.Schema.Type<S> =>
  Schema.decodeUnknownSync(schema as never)(JSON.parse(value)) as Schema.Schema.Type<S>;

const toProcessRecord = (row: ProcessDbRow): ProjectionTaskProcessRecord => ({
  process: {
    id: TaskProcessId.makeUnsafe(row.processId),
    projectId: row.projectId as ProjectionTaskProcessRecord["process"]["projectId"],
    title: row.title,
    owner: { kind: "user" },
    state: row.state,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  },
  graphRevision: row.graphRevision,
  highWaterCursor: row.highWaterCursor,
});

const toTask = (row: TaskDbRow): typeof ProjectTask.Type => ({
  id: ProjectTaskId.makeUnsafe(row.taskId),
  processId: TaskProcessId.makeUnsafe(row.processId),
  parentTaskId: row.parentTaskId === null ? null : ProjectTaskId.makeUnsafe(row.parentTaskId),
  title: row.title,
  description: row.description,
  acceptanceCriteria: decodeJson(Schema.Array(Schema.String), row.acceptanceCriteriaJson),
  priority: row.priority,
  risk: row.risk,
  lifecycle: row.lifecycle,
  orderKey: row.orderKey,
  createdBy: decodeJson(ActorIdentity, row.createdByJson),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toDependency = (row: DependencyDbRow): typeof TaskDependencyEdge.Type => ({
  id: row.edgeId as typeof TaskDependencyEdge.Type.id,
  processId: TaskProcessId.makeUnsafe(row.processId),
  dependentTaskId: ProjectTaskId.makeUnsafe(row.dependentTaskId),
  prerequisiteTaskId: ProjectTaskId.makeUnsafe(row.prerequisiteTaskId),
  state: row.state,
  createdBy: decodeJson(ActorIdentity, row.createdByJson),
  createdAt: row.createdAt,
  waivedBy: row.waivedByJson === null ? null : decodeJson(ActorIdentity, row.waivedByJson),
  waivedAt: row.waivedAt,
  waiverReason: row.waiverReason,
});

const toBinding = (row: BindingDbRow): typeof TaskThreadBinding.Type => ({
  id: row.bindingId as typeof TaskThreadBinding.Type.id,
  taskId: ProjectTaskId.makeUnsafe(row.taskId),
  threadId: row.threadId as typeof TaskThreadBinding.Type.threadId,
  assignmentId: row.assignmentId,
  role: row.role,
  activeFrom: row.activeFrom,
  retiredAt: row.retiredAt,
});

const toBlocker = (row: BlockerDbRow): typeof TaskBlocker.Type => ({
  id: row.blockerId as typeof TaskBlocker.Type.id,
  taskId: ProjectTaskId.makeUnsafe(row.taskId),
  kind: row.kind,
  summary: row.summary,
  createdBy: decodeJson(ActorIdentity, row.createdByJson),
  createdAt: row.createdAt,
  resolvedBy: row.resolvedByJson === null ? null : decodeJson(ActorIdentity, row.resolvedByJson),
  resolvedAt: row.resolvedAt,
  resolution: row.resolution,
});

const toProgress = (row: ProgressDbRow): typeof TaskProgressEntry.Type => ({
  id: TaskProgressEntryId.makeUnsafe(row.progressId),
  taskId: ProjectTaskId.makeUnsafe(row.taskId),
  assignmentId: row.assignmentId,
  threadId: row.threadId === null ? null : ThreadId.makeUnsafe(row.threadId),
  actor: decodeJson(ActorIdentity, row.actorJson),
  kind: row.kind,
  summary: row.summary,
  evidenceRefs: decodeJson(Schema.Array(Schema.String), row.evidenceRefsJson),
  createdAt: row.createdAt,
});

const makeProjectionTaskProcessRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProcess: ProjectionTaskProcessRepositoryShape["upsertProcess"] = (row) =>
    Effect.gen(function* () {
      yield* sql`
        INSERT INTO projection_task_processes (
          process_id, project_id, title, owner_kind, owner_root_thread_id,
          state, revision, graph_revision, high_water_cursor, created_at, updated_at
        )
        SELECT
          ${row.process.id}, ${row.process.projectId}, ${row.process.title},
          ${row.process.owner.kind}, ${null}, ${row.process.state},
          ${row.process.revision}, ${row.graphRevision}, ${row.highWaterCursor},
          ${row.process.createdAt}, ${row.process.updatedAt}
        FROM projection_projects
        WHERE project_id = ${row.process.projectId}
          AND kind = 'project'
          AND deleted_at IS NULL
        ON CONFLICT (process_id) DO UPDATE SET
          title = excluded.title,
          owner_kind = excluded.owner_kind,
          owner_root_thread_id = excluded.owner_root_thread_id,
          state = excluded.state,
          revision = excluded.revision,
          graph_revision = excluded.graph_revision,
          high_water_cursor = excluded.high_water_cursor,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
        WHERE projection_task_processes.project_id = excluded.project_id
      `;
      const persisted = yield* sql<{ readonly projectId: string }>`
        SELECT project_id AS "projectId"
        FROM projection_task_processes
        WHERE process_id = ${row.process.id}
      `;
      if (persisted[0]?.projectId !== row.process.projectId) {
        return yield* new PersistenceSqlError({
          operation: "ProjectionTaskProcessRepository.upsertProcess:scope",
          detail: "Process project does not exist or conflicts with the persisted process scope",
        });
      }
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof PersistenceSqlError
          ? cause
          : toPersistenceSqlError("ProjectionTaskProcessRepository.upsertProcess:query")(cause),
      ),
    );

  const getProcess: ProjectionTaskProcessRepositoryShape["getProcess"] = (processId) =>
    sql<ProcessDbRow>`
      SELECT
        process_id AS "processId", project_id AS "projectId", title,
        owner_kind AS "ownerKind", owner_root_thread_id AS "ownerRootThreadId",
        state, revision, graph_revision AS "graphRevision",
        high_water_cursor AS "highWaterCursor", created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projection_task_processes
      WHERE process_id = ${processId}
    `.pipe(
      Effect.map((rows) => (rows[0] ? Option.some(toProcessRecord(rows[0])) : Option.none())),
      Effect.mapError(toPersistenceSqlError("ProjectionTaskProcessRepository.getProcess:query")),
    );

  const listProcesses: ProjectionTaskProcessRepositoryShape["listProcesses"] = (projectId) =>
    sql<ProcessDbRow>`
      SELECT
        process_id AS "processId", project_id AS "projectId", title,
        owner_kind AS "ownerKind", owner_root_thread_id AS "ownerRootThreadId",
        state, revision, graph_revision AS "graphRevision",
        high_water_cursor AS "highWaterCursor", created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projection_task_processes
      WHERE project_id = ${projectId}
      ORDER BY updated_at DESC, process_id
    `.pipe(
      Effect.map((rows) => rows.map(toProcessRecord)),
      Effect.mapError(toPersistenceSqlError("ProjectionTaskProcessRepository.listProcesses:query")),
    );

  const listProcessPage: ProjectionTaskProcessRepositoryShape["listProcessPage"] = (input) => {
    const limit = Math.max(1, Math.min(101, Math.floor(input.limit)));
    const cursorClause =
      input.beforeUpdatedAt === undefined
        ? sql``
        : sql`AND (
            updated_at < ${input.beforeUpdatedAt}
            OR (
              updated_at = ${input.beforeUpdatedAt}
              AND process_id > ${input.afterProcessIdAtTimestamp ?? ""}
            )
          )`;
    const archivedClause = input.includeArchived ? sql`` : sql`AND state <> 'archived'`;
    return sql<ProcessDbRow>`
      SELECT
        process_id AS "processId", project_id AS "projectId", title,
        owner_kind AS "ownerKind", owner_root_thread_id AS "ownerRootThreadId",
        state, revision, graph_revision AS "graphRevision",
        high_water_cursor AS "highWaterCursor", created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projection_task_processes
      WHERE project_id = ${input.projectId}
        ${archivedClause}
        ${cursorClause}
      ORDER BY updated_at DESC, process_id
      LIMIT ${limit}
    `.pipe(
      Effect.map((rows) => rows.map(toProcessRecord)),
      Effect.mapError(
        toPersistenceSqlError("ProjectionTaskProcessRepository.listProcessPage:query"),
      ),
    );
  };

  const findActiveProcessForThread: ProjectionTaskProcessRepositoryShape["findActiveProcessForThread"] =
    (threadId) =>
      sql<{ readonly processId: string }>`
        SELECT process.process_id AS "processId"
        FROM projection_task_bindings AS binding
        JOIN projection_task_processes AS process
          ON process.process_id = binding.process_id
        WHERE binding.thread_id = ${threadId}
          AND binding.retired_at IS NULL
          AND process.state IN ('active', 'paused')
        ORDER BY CASE WHEN process.state = 'active' THEN 0 ELSE 1 END,
                 process.updated_at DESC,
                 process.process_id
        LIMIT 1
      `.pipe(
        Effect.map((rows) =>
          rows[0]
            ? Option.some(TaskProcessId.makeUnsafe(rows[0].processId))
            : Option.none<TaskProcessId>(),
        ),
        Effect.mapError(
          toPersistenceSqlError("ProjectionTaskProcessRepository.findActiveProcessForThread:query"),
        ),
      );

  const upsertTask: ProjectionTaskProcessRepositoryShape["upsertTask"] = (row) => {
    if (row.processId !== row.task.task.processId) {
      return Effect.fail(
        new PersistenceSqlError({
          operation: "ProjectionTaskProcessRepository.upsertTask:scope",
          detail: "Task process scope does not match repository input",
        }),
      );
    }
    const task = row.task.task;
    return sql`
      INSERT INTO projection_project_tasks (
        task_id, process_id, parent_task_id, title, description,
        acceptance_criteria_json, priority, risk, lifecycle, order_key, created_by_json,
        readiness, execution_health, evidence_state, created_at, updated_at
      ) VALUES (
        ${task.id}, ${row.processId}, ${task.parentTaskId}, ${task.title}, ${task.description},
        ${JSON.stringify(task.acceptanceCriteria)}, ${task.priority}, ${task.risk}, ${task.lifecycle},
        ${task.orderKey}, ${JSON.stringify(task.createdBy)}, ${row.task.readiness},
        ${row.task.executionHealth}, ${row.task.evidenceState}, ${task.createdAt}, ${task.updatedAt}
      )
      ON CONFLICT (task_id) DO UPDATE SET
        parent_task_id = excluded.parent_task_id,
        title = excluded.title,
        description = excluded.description,
        acceptance_criteria_json = excluded.acceptance_criteria_json,
        priority = excluded.priority,
        risk = excluded.risk,
        lifecycle = excluded.lifecycle,
        order_key = excluded.order_key,
        readiness = excluded.readiness,
        execution_health = excluded.execution_health,
        evidence_state = excluded.evidence_state,
        updated_at = excluded.updated_at
      WHERE projection_project_tasks.process_id = excluded.process_id
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ProjectionTaskProcessRepository.upsertTask:query")),
    );
  };

  const upsertDependency: ProjectionTaskProcessRepositoryShape["upsertDependency"] = (row) => {
    if (row.processId !== row.dependency.processId) {
      return Effect.fail(
        new PersistenceSqlError({
          operation: "ProjectionTaskProcessRepository.upsertDependency:scope",
          detail: "Dependency process scope does not match repository input",
        }),
      );
    }
    const edge = row.dependency;
    return sql`
      INSERT INTO projection_task_dependencies (
        edge_id, process_id, dependent_task_id, prerequisite_task_id, state,
        created_by_json, created_at, waived_by_json, waived_at, waiver_reason
      ) VALUES (
        ${edge.id}, ${row.processId}, ${edge.dependentTaskId}, ${edge.prerequisiteTaskId},
        ${edge.state}, ${JSON.stringify(edge.createdBy)}, ${edge.createdAt},
        ${edge.waivedBy === null ? null : JSON.stringify(edge.waivedBy)},
        ${edge.waivedAt}, ${edge.waiverReason}
      )
      ON CONFLICT (edge_id) DO UPDATE SET
        state = excluded.state,
        waived_by_json = excluded.waived_by_json,
        waived_at = excluded.waived_at,
        waiver_reason = excluded.waiver_reason
      WHERE projection_task_dependencies.process_id = excluded.process_id
        AND projection_task_dependencies.dependent_task_id = excluded.dependent_task_id
        AND projection_task_dependencies.prerequisite_task_id = excluded.prerequisite_task_id
    `.pipe(
      Effect.asVoid,
      Effect.mapError(
        toPersistenceSqlError("ProjectionTaskProcessRepository.upsertDependency:query"),
      ),
    );
  };

  const upsertBinding: ProjectionTaskProcessRepositoryShape["upsertBinding"] = (row) => {
    const binding = row.binding;
    return sql`
      INSERT INTO projection_task_bindings (
        binding_id, process_id, task_id, thread_id, assignment_id,
        role, active_from, retired_at
      ) VALUES (
        ${binding.id}, ${row.processId}, ${binding.taskId}, ${binding.threadId},
        ${binding.assignmentId}, ${binding.role}, ${binding.activeFrom}, ${binding.retiredAt}
      )
      ON CONFLICT (binding_id) DO UPDATE SET
        assignment_id = excluded.assignment_id,
        role = excluded.role,
        retired_at = excluded.retired_at
      WHERE projection_task_bindings.process_id = excluded.process_id
        AND projection_task_bindings.task_id = excluded.task_id
        AND projection_task_bindings.thread_id = excluded.thread_id
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ProjectionTaskProcessRepository.upsertBinding:query")),
    );
  };

  const appendProgress: ProjectionTaskProcessRepositoryShape["appendProgress"] = (row) => {
    const progress = row.progress;
    return Effect.gen(function* () {
      yield* sql`
        INSERT INTO projection_task_progress (
          progress_id, process_id, task_id, assignment_id, thread_id,
          actor_json, kind, summary, evidence_refs_json, created_at
        ) VALUES (
          ${progress.id}, ${row.processId}, ${progress.taskId}, ${progress.assignmentId},
          ${progress.threadId}, ${JSON.stringify(progress.actor)}, ${progress.kind},
          ${progress.summary}, ${JSON.stringify(progress.evidenceRefs)}, ${progress.createdAt}
        )
        ON CONFLICT (progress_id) DO NOTHING
      `;
      const existing = yield* sql<ProgressDbRow>`
        SELECT
          progress_id AS "progressId", task_id AS "taskId", assignment_id AS "assignmentId",
          thread_id AS "threadId", actor_json AS "actorJson", kind, summary,
          evidence_refs_json AS "evidenceRefsJson", created_at AS "createdAt"
        FROM projection_task_progress
        WHERE progress_id = ${progress.id} AND process_id = ${row.processId}
      `;
      if (
        existing.length !== 1 ||
        JSON.stringify(toProgress(existing[0]!)) !== JSON.stringify(progress)
      ) {
        return yield* new PersistenceSqlError({
          operation: "ProjectionTaskProcessRepository.appendProgress:identity",
          detail: "Progress identity already exists with different immutable content or scope",
        });
      }
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof PersistenceSqlError
          ? cause
          : toPersistenceSqlError("ProjectionTaskProcessRepository.appendProgress:query")(cause),
      ),
    );
  };

  const listProgress: ProjectionTaskProcessRepositoryShape["listProgress"] = (processId) =>
    sql<ProgressDbRow>`
      SELECT
        progress_id AS "progressId", task_id AS "taskId", assignment_id AS "assignmentId",
        thread_id AS "threadId", actor_json AS "actorJson", kind, summary,
        evidence_refs_json AS "evidenceRefsJson", created_at AS "createdAt"
      FROM projection_task_progress
      WHERE process_id = ${processId}
      ORDER BY created_at, progress_id
    `.pipe(
      Effect.map((rows) => rows.map(toProgress)),
      Effect.mapError(toPersistenceSqlError("ProjectionTaskProcessRepository.listProgress:query")),
    );

  const upsertBlocker: ProjectionTaskProcessRepositoryShape["upsertBlocker"] = (row) => {
    const blocker = row.blocker;
    return sql`
      INSERT INTO projection_task_blockers (
        blocker_id, process_id, task_id, kind, summary, created_by_json,
        created_at, resolved_by_json, resolved_at, resolution
      ) VALUES (
        ${blocker.id}, ${row.processId}, ${blocker.taskId}, ${blocker.kind},
        ${blocker.summary}, ${JSON.stringify(blocker.createdBy)}, ${blocker.createdAt},
        ${blocker.resolvedBy === null ? null : JSON.stringify(blocker.resolvedBy)},
        ${blocker.resolvedAt}, ${blocker.resolution}
      )
      ON CONFLICT (blocker_id) DO UPDATE SET
        resolved_by_json = excluded.resolved_by_json,
        resolved_at = excluded.resolved_at,
        resolution = excluded.resolution
      WHERE projection_task_blockers.process_id = excluded.process_id
        AND projection_task_blockers.task_id = excluded.task_id
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ProjectionTaskProcessRepository.upsertBlocker:query")),
    );
  };

  const getGraph: ProjectionTaskProcessRepositoryShape["getGraph"] = (processId) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const process = yield* getProcess(processId);
          if (Option.isNone(process)) return Option.none();
          const tasks = yield* sql<TaskDbRow>`
          SELECT
            task_id AS "taskId", process_id AS "processId", parent_task_id AS "parentTaskId",
            title, description, acceptance_criteria_json AS "acceptanceCriteriaJson",
            priority, risk, lifecycle, order_key AS "orderKey", created_by_json AS "createdByJson",
            readiness, execution_health AS "executionHealth", evidence_state AS "evidenceState",
            created_at AS "createdAt", updated_at AS "updatedAt"
          FROM projection_project_tasks
          WHERE process_id = ${processId}
          ORDER BY order_key, task_id
        `;
          const dependencies = yield* sql<DependencyDbRow>`
          SELECT
            edge_id AS "edgeId", process_id AS "processId",
            dependent_task_id AS "dependentTaskId",
            prerequisite_task_id AS "prerequisiteTaskId", state,
            created_by_json AS "createdByJson", created_at AS "createdAt",
            waived_by_json AS "waivedByJson", waived_at AS "waivedAt",
            waiver_reason AS "waiverReason"
          FROM projection_task_dependencies
          WHERE process_id = ${processId}
          ORDER BY created_at, edge_id
        `;
          const bindings = yield* sql<BindingDbRow>`
          SELECT
            binding_id AS "bindingId", process_id AS "processId", task_id AS "taskId",
            thread_id AS "threadId", assignment_id AS "assignmentId", role,
            active_from AS "activeFrom", retired_at AS "retiredAt"
          FROM projection_task_bindings
          WHERE process_id = ${processId}
          ORDER BY active_from, binding_id
        `;
          const blockers = yield* sql<BlockerDbRow>`
          SELECT
            blocker_id AS "blockerId", process_id AS "processId", task_id AS "taskId",
            kind, summary, created_by_json AS "createdByJson", created_at AS "createdAt",
            resolved_by_json AS "resolvedByJson", resolved_at AS "resolvedAt", resolution
          FROM projection_task_blockers
          WHERE process_id = ${processId}
          ORDER BY created_at, blocker_id
        `;

          const decodedDependencies = dependencies.map(toDependency);
          const decodedBindings = bindings.map(toBinding);
          const decodedBlockers = blockers.map(toBlocker);
          const taskById = new Map(tasks.map((row) => [row.taskId, row]));
          return Option.some({
            process: process.value.process,
            tasks: tasks.map((row) => ({
              task: toTask(row),
              readiness: row.readiness,
              executionHealth: row.executionHealth,
              unmetDependencyIds: decodedDependencies
                .filter(
                  (edge) =>
                    edge.dependentTaskId === row.taskId &&
                    edge.state === "active" &&
                    taskById.get(edge.prerequisiteTaskId)?.lifecycle !== "done",
                )
                .map((edge) => edge.id),
              blockerIds: decodedBlockers
                .filter((blocker) => blocker.taskId === row.taskId && blocker.resolvedAt === null)
                .map((blocker) => blocker.id),
              bindingIds: decodedBindings
                .filter((binding) => binding.taskId === row.taskId && binding.retiredAt === null)
                .map((binding) => binding.id),
              evidenceState: row.evidenceState,
            })),
            dependencies: decodedDependencies,
            bindings: decodedBindings.map((binding) => {
              const task = taskById.get(binding.taskId);
              if (!task) {
                throw new Error(`Missing task ${binding.taskId} for binding ${binding.id}`);
              }
              return {
                binding,
                taskLifecycle: task.lifecycle,
                executionHealth: task.executionHealth,
              };
            }),
            blockers: decodedBlockers,
            graphRevision: process.value.graphRevision,
            highWaterCursor: process.value.highWaterCursor,
          });
        }),
      )
      .pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionTaskProcessRepository.getGraph:query")),
      );

  const deleteTask: ProjectionTaskProcessRepositoryShape["deleteTask"] = (input) =>
    sql`
      DELETE FROM projection_project_tasks
      WHERE process_id = ${input.processId} AND task_id = ${input.taskId}
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ProjectionTaskProcessRepository.deleteTask:query")),
    );

  return {
    upsertProcess,
    getProcess,
    listProcesses,
    listProcessPage,
    findActiveProcessForThread,
    upsertTask,
    upsertDependency,
    upsertBinding,
    appendProgress,
    listProgress,
    upsertBlocker,
    getGraph,
    deleteTask,
  } satisfies ProjectionTaskProcessRepositoryShape;
});

export const ProjectionTaskProcessRepositoryLive = Layer.effect(
  ProjectionTaskProcessRepository,
  makeProjectionTaskProcessRepository,
);
