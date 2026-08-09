import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS supervised_tool_invocation_receipts (
      receipt_id TEXT PRIMARY KEY,
      canonical_tool_id TEXT NOT NULL,
      actor_seat_id TEXT,
      authority_receipt_id TEXT,
      caller_thread_id TEXT NOT NULL,
      state TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      completed_at TEXT,
      entity_json TEXT NOT NULL CHECK (json_valid(entity_json))
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_supervised_tool_receipts_thread_time
    ON supervised_tool_invocation_receipts(caller_thread_id, requested_at DESC, receipt_id)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_supervised_tool_receipts_authority
    ON supervised_tool_invocation_receipts(authority_receipt_id, requested_at DESC, receipt_id)
  `;
});
