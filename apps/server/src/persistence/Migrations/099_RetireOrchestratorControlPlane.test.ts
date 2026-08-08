import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration0099 from "./099_RetireOrchestratorControlPlane.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));
const now = "2026-08-08T00:00:00.000Z";

const legacyTableNames = [
  "orchestrator_artifacts",
  "orchestrator_migration_purge_log",
  "projection_orchestrator_assignments",
  "projection_orchestrator_capacity",
  "projection_orchestrator_child_results",
  "projection_orchestrator_links",
  "projection_orchestrator_messages",
  "projection_orchestrator_monitors",
  "projection_orchestrator_ownership_edges",
  "projection_orchestrator_provider_capabilities",
  "projection_orchestrator_roots",
  "projection_orchestrator_runs",
  "projection_orchestrator_writer_claims",
] as const;

const insertThread = (sql: SqlClient.SqlClient, threadId: string, creationSource?: string) =>
  sql`
    INSERT INTO projection_threads (
      thread_id, project_id, title, created_at, updated_at,
      runtime_mode, interaction_mode, env_mode, creation_source
    ) VALUES (
      ${threadId}, 'project-1', ${threadId}, ${now}, ${now},
      'full-access', 'default', 'local', ${creationSource ?? null}
    )
  `;

layer("migration 099", (it) => {
  it.effect("permanently purges populated Orchestrator state and preserves Normal and Supervised state", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 98 });
      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
        ) VALUES ('project-1', 'project', 'Project', '/workspace/project-1', '[]', ${now}, ${now})
      `;
      yield* insertThread(sql, "normal-thread");
      yield* insertThread(sql, "legacy-root", "orchestrator_native");
      yield* insertThread(sql, "legacy-child", "orchestrator_native");

      yield* sql`
        INSERT INTO projection_task_processes (
          process_id, project_id, title, owner_kind, owner_root_thread_id, state,
          revision, graph_revision, high_water_cursor, created_at, updated_at
        ) VALUES
          ('normal-process', 'project-1', 'Normal process', 'user', NULL, 'active', 0, 0, '0', ${now}, ${now}),
          ('legacy-process', 'project-1', 'Legacy process', 'orchestrator', 'legacy-root', 'active', 0, 0, '0', ${now}, ${now})
      `;
      yield* sql`
        INSERT INTO projection_orchestrator_roots (
          root_thread_id, project_id, protocol_version, state, active_process_id,
          resource_policy_version, revision, high_water_cursor, created_at,
          last_meaningful_activity_at, latest_activity_revision
        ) VALUES (
          'legacy-root', 'project-1', 1, 'active', 'legacy-process',
          1, 0, '0', ${now}, ${now}, 0
        )
      `;
      yield* sql`
        INSERT INTO projection_orchestrator_ownership_edges (
          root_thread_id, parent_thread_id, child_thread_id, role, capabilities_json,
          contract_version, source_thread_id, active_from, decision_reason_json
        ) VALUES (
          'legacy-root', 'legacy-root', 'legacy-child', 'worker', '[]',
          1, 'legacy-root', ${now}, '{}'
        )
      `;
      yield* sql`
        INSERT INTO projection_orchestrator_child_results (
          result_id, root_thread_id, child_thread_id, assignment_id, task_id,
          envelope_json, content_hash, revision, review_state, submitted_at
        ) VALUES (
          'legacy-result', 'legacy-root', 'legacy-child', 'assignment-1', 'task-1',
          '{}', 'sha256:legacy', 1, 'pending', ${now}
        )
      `;
      yield* sql`
        INSERT INTO projection_supervised_rooms (
          room_id, project_id, lead_seat_id, status, graph_revision, revision, updated_at, entity_json
        ) VALUES ('room-1', 'project-1', NULL, 'draft', 0, 0, ${now}, '{}')
      `;
      yield* sql`
        INSERT INTO provider_session_runtime (
          thread_id, provider_name, adapter_key, status, last_seen_at, runtime_payload_json
        ) VALUES
          ('normal-thread', 'codex', 'codex', 'ready', ${now}, ${JSON.stringify({
            keep: "normal",
            orchestratorContext: { rootThreadId: "legacy-root" },
          })}),
          ('legacy-root', 'codex', 'codex', 'ready', ${now}, '{}')
      `;

      for (const [eventId, aggregateKind, streamId, eventType, commandId] of [
        ["event-normal", "thread", "normal-thread", "thread.created", "command-normal"],
        ["event-root", "orchestrator", "legacy-root", "orchestrator.root-created", "command-root"],
        ["event-child", "thread", "legacy-child", "thread.created", "command-child"],
        ["event-process", "task_process", "legacy-process", "task-process.created", "command-process"],
      ] as const) {
        yield* sql`
          INSERT INTO orchestration_events (
            event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
            command_id, actor_kind, payload_json, metadata_json
          ) VALUES (
            ${eventId}, ${aggregateKind}, ${streamId}, 1, ${eventType}, ${now},
            ${commandId}, 'user', '{}', '{}'
          )
        `;
        const sequence = yield* sql<{ readonly sequence: number }>`
          SELECT sequence FROM orchestration_events WHERE event_id = ${eventId}
        `;
        yield* sql`
          INSERT INTO orchestration_command_receipts (
            command_id, aggregate_kind, aggregate_id, accepted_at, result_sequence, status
          ) VALUES (
            ${commandId}, ${aggregateKind}, ${streamId}, ${now}, ${sequence[0]?.sequence ?? 0}, 'accepted'
          )
        `;
      }

      assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 99 }), [
        [99, "RetireOrchestratorControlPlane"],
      ]);

      const threads = yield* sql<{ readonly threadId: string }>`
        SELECT thread_id AS "threadId" FROM projection_threads ORDER BY thread_id
      `;
      assert.deepStrictEqual(threads, [{ threadId: "normal-thread" }]);
      const processes = yield* sql<{ readonly processId: string }>`
        SELECT process_id AS "processId" FROM projection_task_processes ORDER BY process_id
      `;
      assert.deepStrictEqual(processes, [{ processId: "normal-process" }]);
      assert.strictEqual(
        (yield* sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM projection_supervised_rooms`)[0]
          ?.count,
        1,
      );
      const runtimeRows = yield* sql<{ readonly payload: string }>`
        SELECT runtime_payload_json AS payload FROM provider_session_runtime WHERE thread_id = 'normal-thread'
      `;
      assert.deepStrictEqual(JSON.parse(runtimeRows[0]?.payload ?? "{}"), { keep: "normal" });
      const events = yield* sql<{ readonly eventId: string }>`
        SELECT event_id AS "eventId" FROM orchestration_events ORDER BY event_id
      `;
      assert.deepStrictEqual(events, [{ eventId: "event-normal" }]);
      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN ${sql.in(legacyTableNames)}
      `;
      assert.deepStrictEqual(tables, []);

      yield* Migration0099;
      assert.deepStrictEqual(
        yield* sql<{ readonly threadId: string }>`
          SELECT thread_id AS "threadId" FROM projection_threads ORDER BY thread_id
        `,
        [{ threadId: "normal-thread" }],
      );
    }),
  );
});
