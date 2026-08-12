import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS checkpoint_ref_cleanup_queue (
      cwd TEXT NOT NULL,
      checkpoint_ref TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      ref_kind TEXT NOT NULL CHECK (ref_kind IN ('turn', 'turn_start', 'message_start')),
      state TEXT NOT NULL CHECK (state IN ('pending', 'deleted', 'failed')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (cwd, checkpoint_ref)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_checkpoint_ref_cleanup_queue_pending
    ON checkpoint_ref_cleanup_queue(state, updated_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_checkpoint_ref_cleanup_queue_thread
    ON checkpoint_ref_cleanup_queue(thread_id, checkpoint_ref, state)
  `;
});
