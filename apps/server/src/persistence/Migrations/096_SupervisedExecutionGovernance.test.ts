import assert from "node:assert/strict";

import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../Layers/Sqlite.ts";

const layer = it.layer(Layer.mergeAll(SqlitePersistenceMemory));

layer("migration 096", (it) => {
  it.effect("creates durable execution and governance projections with one active claim", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const tables = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN (
            'projection_supervised_work_claims',
            'projection_supervised_capability_leases',
            'projection_supervised_rlm_episodes',
            'projection_supervised_interventions',
            'projection_supervised_lead_notifications',
            'projection_supervised_reconciliations'
          )
        ORDER BY name
      `;
      assert.equal(tables.length, 6);

      const indexes = yield* sql<{ readonly sql: string }>`
        SELECT sql
        FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_supervised_work_claims_one_active'
      `;
      assert.match(indexes[0]?.sql ?? "", /WHERE status = 'active'/);

      const interventionColumns = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM pragma_table_info('projection_supervised_interventions')
        ORDER BY cid
      `;
      assert.deepEqual(
        interventionColumns.map(({ name }) => name),
        [
          "intervention_id",
          "room_id",
          "requester_json",
          "specialist_thread_id",
          "status",
          "revision",
          "updated_at",
          "entity_json",
        ],
      );
    }),
  );
});
