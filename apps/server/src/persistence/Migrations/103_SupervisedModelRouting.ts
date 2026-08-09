import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS supervised_model_telemetry_aggregates (
      aggregate_id TEXT PRIMARY KEY,
      model_profile_id TEXT NOT NULL,
      category TEXT NOT NULL,
      sample_count INTEGER NOT NULL CHECK (sample_count >= 0),
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      revision INTEGER NOT NULL CHECK (revision >= 0),
      updated_at TEXT NOT NULL,
      entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
      UNIQUE (model_profile_id, category),
      FOREIGN KEY (model_profile_id) REFERENCES supervised_model_capability_profiles(profile_id)
        ON DELETE CASCADE
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_supervised_model_telemetry_eligibility
    ON supervised_model_telemetry_aggregates(
      model_profile_id, category, sample_count DESC, confidence DESC
    )
  `;
});
