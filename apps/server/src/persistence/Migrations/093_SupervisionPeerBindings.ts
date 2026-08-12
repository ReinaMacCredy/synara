import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervision_peers (
          thread_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          lead_seat_id TEXT NOT NULL,
          root_thread_id TEXT NOT NULL,
          profile_snapshot_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
          archived_at TEXT,
          revision INTEGER NOT NULL CHECK (revision > 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (project_id) REFERENCES projection_projects(project_id) ON DELETE CASCADE,
          FOREIGN KEY (thread_id) REFERENCES projection_threads(thread_id) ON DELETE RESTRICT,
          FOREIGN KEY (lead_seat_id) REFERENCES projection_supervision_active_leads(lead_seat_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervision_peers_lead
        ON projection_supervision_peers(lead_seat_id, status, updated_at DESC)
      `;
    }),
  );
});
