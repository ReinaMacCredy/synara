import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration0104 from "./104_SupervisedContextNotebookRlm.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("104_SupervisedContextNotebookRlm", (it) => {
  it.effect("adds durable context, notebook, evidence, and RLM lineage storage idempotently", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 104 });

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'projection_context_compaction_receipts',
          'projection_supervised_evidence',
          'projection_supervised_notebook_cursors',
          'projection_supervised_notebook_compactions'
        )
        ORDER BY name
      `;
      const rlmColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_supervised_rlm_episodes)
      `;
      const modelSessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_supervised_model_sessions)
      `;

      assert.strictEqual(tables.length, 4);
      assert.ok(rlmColumns.some((column) => column.name === "revision"));
      assert.ok(modelSessionColumns.some((column) => column.name === "thread_id"));

      yield* Migration0104;
      const replayedTables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'projection_supervised_evidence'
      `;
      assert.strictEqual(replayedTables.length, 1);
    }),
  );
});

const legacyLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

legacyLayer("104_SupervisedContextNotebookRlm legacy upgrade", (it) => {
  it.effect("retains and canonicalizes existing RLM and model-session lineage", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-08-09T00:00:00.000Z";
      yield* runMigrations({ toMigrationInclusive: 103 });

      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
        ) VALUES ('project-existing', 'project', 'Existing', '/tmp/existing', '[]', ${now}, ${now})
      `;
      yield* sql`
        INSERT INTO projection_supervised_rooms (
          room_id, project_id, lead_seat_id, status, graph_revision, revision, updated_at, entity_json
        ) VALUES ('room-existing', 'project-existing', NULL, 'active', 0, 0, ${now}, '{}')
      `;
      yield* sql`
        INSERT INTO projection_supervised_tasks (
          task_id, room_id, lifecycle, graph_revision, revision, updated_at, entity_json
        ) VALUES ('task-existing', 'room-existing', 'active', 0, 0, ${now}, '{}')
      `;
      yield* sql`
        INSERT INTO projection_supervised_runs (
          run_id, room_id, task_id, task_node_id, status, daemon_epoch,
          revision, last_progress_at, updated_at, entity_json
        ) VALUES (
          'run-existing', 'room-existing', 'task-existing', NULL, 'running', 1,
          0, ${now}, ${now}, '{}'
        )
      `;
      yield* sql`
        INSERT INTO projection_supervised_rlm_episodes (
          episode_id, run_id, status, completed_branch_count, updated_at, entity_json
        ) VALUES (
          'episode-existing', 'run-existing', 'planned', 0, ${now},
          '{"id":"episode-existing","runId":"run-existing","status":"planned","completedBranchCount":0}'
        )
      `;
      yield* sql`
        INSERT INTO projection_supervised_model_sessions (
          model_session_id, room_id, run_id, task_node_id, rlm_episode_id,
          parent_session_id, role, status, revision, updated_at, entity_json
        ) VALUES (
          'session-existing', 'room-existing', 'run-existing', NULL, 'episode-existing',
          NULL, 'rlm_root', 'created', 0, ${now},
          '{"id":"session-existing","threadId":"thread-existing"}'
        )
      `;

      yield* Migration0104;

      const [episode] = yield* sql<{
        readonly status: string;
        readonly revision: number;
        readonly entityStatus: string;
        readonly entityRevision: number;
      }>`
        SELECT
          status,
          revision,
          json_extract(entity_json, '$.status') AS entityStatus,
          json_extract(entity_json, '$.revision') AS entityRevision
        FROM projection_supervised_rlm_episodes
        WHERE episode_id = 'episode-existing'
      `;
      const [session] = yield* sql<{ readonly threadId: string | null }>`
        SELECT thread_id AS threadId
        FROM projection_supervised_model_sessions
        WHERE model_session_id = 'session-existing'
      `;

      assert.deepStrictEqual(episode, {
        status: "requested",
        revision: 0,
        entityStatus: "requested",
        entityRevision: 0,
      });
      assert.strictEqual(session?.threadId, "thread-existing");
    }),
  );
});
