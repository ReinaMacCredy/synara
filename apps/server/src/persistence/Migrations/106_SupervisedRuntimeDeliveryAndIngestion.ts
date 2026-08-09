import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      const deliveryColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(supervised_subscription_deliveries)
      `;
      if (!deliveryColumns.some((column) => column.name === "delivered_at")) {
        yield* sql`
          ALTER TABLE supervised_subscription_deliveries
          ADD COLUMN delivered_at TEXT
        `;
      }
      yield* sql`
        UPDATE supervised_subscription_deliveries
        SET delivered_at = json_extract(entity_json, '$.deliveredAt')
        WHERE delivered_at IS NULL AND status = 'delivered'
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_deliveries_rate
        ON supervised_subscription_deliveries(subscription_id, delivered_at)
        WHERE status = 'delivered'
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS supervised_runtime_ingestion_cursors (
          cursor_key TEXT PRIMARY KEY,
          source_sequence INTEGER NOT NULL CHECK (source_sequence >= 0),
          updated_at TEXT NOT NULL
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_rlm_episodes_status_run
        ON projection_supervised_rlm_episodes(status, run_id, updated_at)
      `;
    }),
  );
});
