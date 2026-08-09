import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration0103 from "./103_SupervisedModelRouting.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("103_SupervisedModelRouting", (it) => {
  it.effect("adds durable model telemetry without changing existing routing entities", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 103 });

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'supervised_model_telemetry_aggregates'
      `;
      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_supervised_model_telemetry_eligibility'
      `;
      assert.strictEqual(tables.length, 1);
      assert.strictEqual(indexes.length, 1);

      yield* Migration0103;
      const replayedTables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'supervised_model_telemetry_aggregates'
      `;
      assert.strictEqual(replayedTables.length, 1);
    }),
  );
});
