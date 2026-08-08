import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  if (!(yield* columnExists(sql, "supervised_plugin_health", "circuit_opened_until"))) {
    yield* sql`
      ALTER TABLE supervised_plugin_health
      ADD COLUMN circuit_opened_until TEXT
    `;
  }
});
