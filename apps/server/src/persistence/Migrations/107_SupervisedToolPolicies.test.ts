import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration0107 from "./107_SupervisedToolPolicies.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("107_SupervisedToolPolicies", (it) => {
  it.effect("creates an idempotent durable canonical-tool policy registry", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 106 });
      yield* Migration0107;
      yield* Migration0107;

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(supervised_tool_policies)
      `;
      assert.includeMembers(
        columns.map((column) => column.name),
        ["canonical_tool_id", "state", "revision", "updated_at", "entity_json"],
      );
    }),
  );
});
