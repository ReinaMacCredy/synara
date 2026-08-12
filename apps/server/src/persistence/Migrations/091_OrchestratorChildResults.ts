import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      if (
        !(yield* columnExists(sql, "projection_orchestrator_roots", "last_meaningful_activity_at"))
      ) {
        yield* sql`
          ALTER TABLE projection_orchestrator_roots
          ADD COLUMN last_meaningful_activity_at TEXT
        `;
      }
      if (!(yield* columnExists(sql, "projection_orchestrator_roots", "pinned_at"))) {
        yield* sql`
          ALTER TABLE projection_orchestrator_roots
          ADD COLUMN pinned_at TEXT
        `;
      }
      if (
        !(yield* columnExists(sql, "projection_orchestrator_roots", "latest_activity_revision"))
      ) {
        yield* sql`
          ALTER TABLE projection_orchestrator_roots
          ADD COLUMN latest_activity_revision INTEGER
        `;
      }

      yield* sql`
        UPDATE projection_orchestrator_roots
        SET last_meaningful_activity_at = COALESCE(last_meaningful_activity_at, created_at),
            latest_activity_revision = COALESCE(latest_activity_revision, revision)
      `;

      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_orchestrator_child_results (
          result_id TEXT PRIMARY KEY,
          root_thread_id TEXT NOT NULL,
          child_thread_id TEXT NOT NULL,
          assignment_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          envelope_json TEXT NOT NULL CHECK (json_valid(envelope_json)),
          content_hash TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision > 0),
          review_state TEXT NOT NULL CHECK (
            review_state IN ('pending', 'accepted', 'changes_requested')
          ),
          submitted_at TEXT NOT NULL,
          reviewed_at TEXT,
          FOREIGN KEY (root_thread_id)
            REFERENCES projection_orchestrator_roots(root_thread_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_orchestrator_child_results_root_state
        ON projection_orchestrator_child_results(
          root_thread_id, review_state, submitted_at DESC, result_id
        )
      `;
      yield* sql`
        DROP INDEX IF EXISTS idx_projection_orchestrator_child_results_assignment_revision
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_orchestrator_child_results_assignment_submitted
        ON projection_orchestrator_child_results(assignment_id, submitted_at DESC, result_id)
      `;
    }),
  );
});
