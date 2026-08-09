import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS supervised_tool_policies (
      canonical_tool_id TEXT PRIMARY KEY,
      state TEXT NOT NULL CHECK (state IN ('enabled', 'disabled', 'revoked')),
      revision INTEGER NOT NULL CHECK (revision >= 1),
      reason TEXT,
      updated_at TEXT NOT NULL,
      revoked_at TEXT,
      entity_json TEXT NOT NULL
    )
  `;
});
