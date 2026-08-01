import { assert, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration0088 from "./088_OrchestratorMode.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const seedProjectAndThread = (
  sql: SqlClient.SqlClient,
  projectId: string,
  threadId: string,
  kind: "project" | "studio",
) =>
  Effect.gen(function* () {
    yield* sql`
      INSERT INTO projection_projects (
        project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
      ) VALUES (
        ${projectId}, ${kind}, ${projectId}, ${`/workspace/${projectId}`}, '[]',
        '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
      )
    `;
    yield* sql`
      INSERT INTO projection_threads (
        thread_id, project_id, title, created_at, updated_at,
        runtime_mode, interaction_mode, env_mode
      ) VALUES (
        ${threadId}, ${projectId}, ${threadId},
        '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z',
        'full-access', 'default', 'local'
      )
    `;
  });

layer("088_OrchestratorMode", (it) => {
  it.effect("purges exact Studio ownership and preserves unrelated state", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 87 });
      yield* seedProjectAndThread(sql, "studio-project", "studio-thread", "studio");
      yield* seedProjectAndThread(sql, "normal-project", "normal-thread", "project");

      for (const [sequence, projectId, threadId] of [
        [1001, "studio-project", "studio-thread"],
        [1002, "normal-project", "normal-thread"],
      ] as const) {
        yield* sql`
          INSERT INTO orchestration_events (
            sequence, event_id, aggregate_kind, stream_id, stream_version, event_type,
            occurred_at, command_id, actor_kind, payload_json, metadata_json
          ) VALUES (
            ${sequence}, ${`event-${threadId}`}, 'thread', ${threadId}, 1, 'thread.created',
            '2026-08-01T00:00:00.000Z', ${`command-${threadId}`}, 'user', '{}', '{}'
          )
        `;
        yield* sql`
          INSERT INTO orchestration_command_receipts (
            command_id, aggregate_kind, aggregate_id, accepted_at,
            result_sequence, status, error
          ) VALUES (
            ${`command-${threadId}`}, 'thread', ${threadId},
            '2026-08-01T00:00:00.000Z', ${sequence}, 'accepted', NULL
          )
        `;
        yield* sql`
          INSERT INTO projection_thread_messages (
            message_id, thread_id, role, text, is_streaming, created_at, updated_at
          ) VALUES (
            ${`message-${threadId}`}, ${threadId}, 'user', 'hello', 0,
            '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'
          )
        `;
        yield* sql`
          INSERT INTO provider_session_runtime (
            thread_id, provider_name, adapter_key, status, last_seen_at
          ) VALUES (${threadId}, 'codex', 'codex', 'ready', '2026-08-01T00:00:00.000Z')
        `;
      }

      const executed = yield* runMigrations({ toMigrationInclusive: 88 });
      assert.deepStrictEqual(executed, [[88, "OrchestratorMode"]]);

      const projects = yield* sql<{ readonly projectId: string }>`
        SELECT project_id AS "projectId" FROM projection_projects ORDER BY project_id
      `;
      const threads = yield* sql<{ readonly threadId: string }>`
        SELECT thread_id AS "threadId" FROM projection_threads ORDER BY thread_id
      `;
      const messages = yield* sql<{ readonly threadId: string }>`
        SELECT thread_id AS "threadId" FROM projection_thread_messages ORDER BY thread_id
      `;
      const events = yield* sql<{ readonly streamId: string }>`
        SELECT stream_id AS "streamId" FROM orchestration_events ORDER BY stream_id
      `;
      const sessions = yield* sql<{ readonly threadId: string }>`
        SELECT thread_id AS "threadId" FROM provider_session_runtime ORDER BY thread_id
      `;

      assert.deepStrictEqual(projects, [{ projectId: "normal-project" }]);
      assert.deepStrictEqual(threads, [{ threadId: "normal-thread" }]);
      assert.deepStrictEqual(messages, [{ threadId: "normal-thread" }]);
      assert.deepStrictEqual(events, [{ streamId: "normal-thread" }]);
      assert.deepStrictEqual(sessions, [{ threadId: "normal-thread" }]);

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name IN (
            'projection_orchestrator_roots',
            'projection_task_processes',
            'projection_project_tasks',
            'projection_task_dependencies',
            'projection_task_bindings',
            'projection_task_progress',
            'projection_task_blockers',
            'orchestrator_artifacts'
          )
        ORDER BY name
      `;
      assert.strictEqual(tables.length, 8);

      const purgeLog = yield* sql<{ readonly tableName: string; readonly count: number }>`
        SELECT table_name AS "tableName", removed_count AS count
        FROM orchestrator_migration_purge_log
        WHERE migration_id = 88 AND removed_count > 0
        ORDER BY table_name
      `;
      assert.ok(purgeLog.some((row) => row.tableName === "projection_projects" && row.count === 1));
      assert.ok(purgeLog.some((row) => row.tableName === "projection_threads" && row.count === 1));

      yield* Migration0088;
      const projectsAfterReplay = yield* sql<{ readonly projectId: string }>`
        SELECT project_id AS "projectId" FROM projection_projects ORDER BY project_id
      `;
      assert.deepStrictEqual(projectsAfterReplay, [{ projectId: "normal-project" }]);
      yield* sql`DROP TRIGGER trg_projection_projects_no_studio_insert`;
      yield* sql`DROP TRIGGER trg_projection_projects_no_studio_update`;
    }),
  );
});

const rollbackLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

rollbackLayer("088_OrchestratorMode rollback", (it) => {
  it.effect("rolls the purge and schema creation back on failure", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 87 });
      yield* seedProjectAndThread(sql, "studio-project", "studio-thread", "studio");
      yield* sql`
        CREATE TRIGGER fail_studio_project_delete
        BEFORE DELETE ON projection_projects
        WHEN OLD.kind = 'studio'
        BEGIN
          SELECT RAISE(ABORT, 'injected migration failure');
        END
      `;

      const result = yield* Migration0088.pipe(Effect.exit);
      assert.ok(Exit.isFailure(result));

      const projects = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM projection_projects WHERE kind = 'studio'
      `;
      const threads = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM projection_threads WHERE thread_id = 'studio-thread'
      `;
      const newTables = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name = 'projection_orchestrator_roots'
      `;
      assert.strictEqual(projects[0]?.count, 1);
      assert.strictEqual(threads[0]?.count, 1);
      assert.strictEqual(newTables[0]?.count, 0);
    }),
  );
});
