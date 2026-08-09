import assert from "node:assert/strict";

import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import SupervisedOrchestration from "./091_SupervisedOrchestration.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));
const now = "2026-08-03T10:00:00.000Z";

layer("migration 091", (it) => {
  it.effect("creates normalized targets, grants, queue, and one-active-Lead storage", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 91 });

      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
        ) VALUES ('project-a', 'project', 'A', '/workspace/a', '[]', ${now}, ${now})
      `;
      for (const threadId of ["root-a", "supervisor-a"]) {
        yield* sql`
          INSERT INTO projection_threads (
            thread_id, project_id, title, created_at, updated_at,
            runtime_mode, interaction_mode, env_mode
          ) VALUES (
            ${threadId}, 'project-a', ${threadId}, ${now}, ${now},
            'full-access', 'default', 'local'
          )
        `;
      }

      yield* sql`
        INSERT INTO projection_supervision_supervisors (
          supervisor_seat_id, active_thread_id, status, archived_at,
          revision, updated_at, entity_json
        ) VALUES (
          'supervisor-seat-a', 'supervisor-a', 'active', NULL,
          1, ${now}, '{}'
        )
      `;
      yield* sql`
        INSERT INTO projection_supervision_active_leads (
          lead_seat_id, project_id, active_thread_id, profile_snapshot_id,
          status, archived_at, revision, updated_at, entity_json
        ) VALUES (
          'lead-a', 'project-a', 'root-a', 'snapshot-a',
          'active', NULL, 1, ${now}, '{}'
        )
      `;
      yield* sql`
        INSERT INTO projection_supervision_missions (
          mission_id, supervisor_seat_id, status, scope_kind,
          revision, updated_at, entity_json
        ) VALUES (
          'mission-a', 'supervisor-seat-a', 'active', 'multiple',
          1, ${now}, '{}'
        )
      `;
      yield* sql`
        INSERT INTO projection_supervision_mission_targets (
          mission_id, target_index, target_kind, target_id, target_json
        ) VALUES
          ('mission-a', 0, 'project', 'project-a', '{"kind":"project","projectId":"project-a"}'),
          ('mission-a', 1, 'lead', 'lead-a', '{"kind":"lead","leadSeatId":"lead-a"}')
      `;
      yield* sql`
        INSERT INTO projection_supervision_mission_grants (mission_id, grant_name)
        VALUES ('mission-a', 'lead.observe'), ('mission-a', 'lead.advise')
      `;
      yield* sql`
        INSERT INTO projection_supervision_wake_queue (
          wake_id, mission_id, supervisor_seat_id, lead_seat_id,
          episode_kind, status, attempt_count, updated_at, entity_json
        ) VALUES (
          'wake-a', 'mission-a', 'supervisor-seat-a', 'lead-a',
          'thread.approval-requested', 'queued', 0, ${now}, '{}'
        )
      `;

      yield* SupervisedOrchestration;

      const [targets, grants, wakes] = yield* Effect.all([
        sql<{ count: number }>`
          SELECT COUNT(*) AS count FROM projection_supervision_mission_targets
        `,
        sql<{ count: number }>`
          SELECT COUNT(*) AS count FROM projection_supervision_mission_grants
        `,
        sql<{ count: number }>`
          SELECT COUNT(*) AS count FROM projection_supervision_wake_queue
        `,
      ]);
      assert.equal(targets[0]?.count, 2);
      assert.equal(grants[0]?.count, 2);
      assert.equal(wakes[0]?.count, 1);

      const duplicateLead = yield* Effect.exit(sql`
        INSERT INTO projection_supervision_active_leads (
          lead_seat_id, project_id, active_thread_id, profile_snapshot_id,
          status, archived_at, revision, updated_at, entity_json
        ) VALUES (
          'lead-b', 'project-a', 'root-a', 'snapshot-a',
          'active', NULL, 1, ${now}, '{}'
        )
      `);
      assert.equal(duplicateLead._tag, "Failure");
    }),
  );
});
