import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_message_deltas (
      thread_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      event_sequence INTEGER NOT NULL,
      delta TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, message_id, event_sequence),
      FOREIGN KEY (thread_id, message_id)
        REFERENCES projection_thread_messages(thread_id, message_id)
        ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_message_deltas_sequence
    ON projection_thread_message_deltas(thread_id, message_id, event_sequence)
  `;
});
