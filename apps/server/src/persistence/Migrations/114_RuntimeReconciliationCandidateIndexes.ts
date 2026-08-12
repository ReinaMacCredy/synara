import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_sessions_reconciliation
    ON projection_thread_sessions(updated_at, thread_id)
    WHERE active_turn_id IS NOT NULL AND status <> 'error'
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_turns_running_thread
    ON projection_turns(thread_id, turn_id)
    WHERE state = 'running'
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_provider_session_runtime_active_turn
    ON provider_session_runtime(thread_id)
    WHERE json_extract(runtime_payload_json, '$.activeTurnId') IS NOT NULL
  `;
});
