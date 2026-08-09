import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration0106 from "./106_SupervisedRuntimeDeliveryAndIngestion.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("106_SupervisedRuntimeDeliveryAndIngestion", (it) => {
  it.effect("adds indexed delivery timestamps and a durable source cursor", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 105 });
      yield* Migration0106;
      yield* Migration0106;

      const deliveryColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(supervised_subscription_deliveries)
      `;
      assert.strictEqual(
        deliveryColumns.some((column) => column.name === "delivered_at"),
        true,
      );
      const cursorTables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'supervised_runtime_ingestion_cursors'
      `;
      assert.strictEqual(cursorTables.length, 1);
      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name IN (
          'idx_supervised_deliveries_rate',
          'idx_supervised_rlm_episodes_status_run'
        )
      `;
      assert.strictEqual(indexes.length, 2);
    }),
  );
});
