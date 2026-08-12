import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS provider_model_catalog_cache (
      cache_key TEXT PRIMARY KEY,
      provider_kind TEXT NOT NULL,
      schema_version INTEGER NOT NULL CHECK (schema_version > 0),
      revision INTEGER NOT NULL CHECK (revision > 0),
      result_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_provider_model_catalog_cache_provider
    ON provider_model_catalog_cache(provider_kind, updated_at DESC)
  `;
});
