import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS provider_runtime_event_deliveries (
      consumer_name TEXT NOT NULL,
      event_sequence INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('accepted', 'retry', 'dead_letter')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      first_failed_at TEXT,
      last_failed_at TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (consumer_name, event_sequence),
      FOREIGN KEY (event_sequence) REFERENCES provider_runtime_events(sequence) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_provider_runtime_event_deliveries_pending
    ON provider_runtime_event_deliveries(consumer_name, status, event_sequence)
  `;

  yield* sql`
    INSERT INTO provider_runtime_event_deliveries (
      consumer_name, event_sequence, status, attempt_count, updated_at
    )
    SELECT consumer.consumer_name, event.sequence, 'accepted', 0, consumer.updated_at
    FROM provider_runtime_event_consumers AS consumer
    INNER JOIN provider_runtime_events AS event
      ON event.sequence <= consumer.last_acked_sequence
    ON CONFLICT (consumer_name, event_sequence) DO NOTHING
  `;
});
