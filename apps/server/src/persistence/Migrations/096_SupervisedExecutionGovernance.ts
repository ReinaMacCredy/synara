import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_work_claims (
          claim_id TEXT PRIMARY KEY,
          task_node_id TEXT NOT NULL,
          task_node_revision_id TEXT NOT NULL,
          run_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'released', 'expired', 'revoked')),
          expires_at TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (task_node_id) REFERENCES projection_supervised_task_nodes(task_node_id) ON DELETE CASCADE,
          FOREIGN KEY (task_node_revision_id) REFERENCES projection_supervised_task_node_revisions(task_node_revision_id) ON DELETE CASCADE,
          FOREIGN KEY (run_id) REFERENCES projection_supervised_runs(run_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_supervised_work_claims_one_active
        ON projection_supervised_work_claims(task_node_revision_id)
        WHERE status = 'active'
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_work_claims_expiry
        ON projection_supervised_work_claims(status, expires_at, claim_id)
      `;

      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_capability_leases (
          lease_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          holder_seat_id TEXT NOT NULL,
          capability TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'revoked')),
          expires_at TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (run_id) REFERENCES projection_supervised_runs(run_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_capability_leases_expiry
        ON projection_supervised_capability_leases(status, expires_at, lease_id)
      `;

      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_rlm_episodes (
          episode_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('planned', 'running', 'synthesizing', 'completed', 'failed')),
          completed_branch_count INTEGER NOT NULL CHECK (completed_branch_count >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (run_id) REFERENCES projection_supervised_runs(run_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_rlm_episodes_run_status
        ON projection_supervised_rlm_episodes(run_id, status, updated_at DESC)
      `;

      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_interventions (
          intervention_id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          requester_json TEXT NOT NULL CHECK (json_valid(requester_json)),
          specialist_thread_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('open', 'reconciled', 'rejected')),
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (room_id) REFERENCES projection_supervised_rooms(room_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_interventions_room_status
        ON projection_supervised_interventions(room_id, status, updated_at DESC)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_lead_notifications (
          notification_id TEXT PRIMARY KEY,
          intervention_id TEXT NOT NULL,
          room_id TEXT NOT NULL,
          lead_seat_id TEXT,
          status TEXT NOT NULL CHECK (status IN ('queued', 'delivered', 'acknowledged')),
          created_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (intervention_id) REFERENCES projection_supervised_interventions(intervention_id) ON DELETE CASCADE,
          FOREIGN KEY (room_id) REFERENCES projection_supervised_rooms(room_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_reconciliations (
          reconciliation_id TEXT PRIMARY KEY,
          intervention_id TEXT NOT NULL,
          room_id TEXT NOT NULL,
          lead_seat_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('open', 'accepted', 'revised', 'rejected')),
          revision INTEGER NOT NULL CHECK (revision >= 0),
          resolved_at TEXT,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (intervention_id) REFERENCES projection_supervised_interventions(intervention_id) ON DELETE CASCADE,
          FOREIGN KEY (room_id) REFERENCES projection_supervised_rooms(room_id) ON DELETE CASCADE
        )
      `;
    }),
  );
});
