import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration0095 from "./095_SupervisedPluginHealthCircuit.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("095_SupervisedPluginHealthCircuit", (it) => {
  it.effect("persists the circuit reset deadline across daemon restarts", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 95 });
        const columns = yield* sql<{ readonly name: string }>`
          SELECT name FROM pragma_table_info('supervised_plugin_health')
        `;
        assert.isTrue(columns.some((column) => column.name === "circuit_opened_until"));
        yield* Migration0095;
        const replayedColumns = yield* sql<{ readonly name: string }>`
          SELECT name FROM pragma_table_info('supervised_plugin_health')
          WHERE name = 'circuit_opened_until'
        `;
        assert.strictEqual(replayedColumns.length, 1);
      }),
  );
});
