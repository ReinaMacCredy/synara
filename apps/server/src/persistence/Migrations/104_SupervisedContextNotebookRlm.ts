import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      const rlmColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_supervised_rlm_episodes)
      `;
      if (!rlmColumns.some((column) => column.name === "revision")) {
        yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_rlm_episodes_v104 (
          episode_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN (
            'requested', 'admitted', 'branching', 'branches_running', 'synthesizing',
            'completed', 'partially_completed', 'stalled', 'failed', 'cancelled',
            'planned', 'running'
          )),
          completed_branch_count INTEGER NOT NULL CHECK (completed_branch_count >= 0),
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (run_id) REFERENCES projection_supervised_runs(run_id) ON DELETE CASCADE
        )
      `;
        yield* sql`
        INSERT INTO projection_supervised_rlm_episodes_v104 (
          episode_id, run_id, status, completed_branch_count, revision, updated_at, entity_json
        )
        SELECT
          episode_id,
          run_id,
          CASE status WHEN 'planned' THEN 'requested' WHEN 'running' THEN 'branches_running' ELSE status END,
          completed_branch_count,
          COALESCE(json_extract(entity_json, '$.revision'), 0),
          updated_at,
          json_set(
            entity_json,
            '$.status',
            CASE status WHEN 'planned' THEN 'requested' WHEN 'running' THEN 'branches_running' ELSE status END,
            '$.revision',
            COALESCE(json_extract(entity_json, '$.revision'), 0)
          )
        FROM projection_supervised_rlm_episodes
      `;
        yield* sql`DROP TABLE projection_supervised_rlm_episodes`;
        yield* sql`
        ALTER TABLE projection_supervised_rlm_episodes_v104
        RENAME TO projection_supervised_rlm_episodes
      `;
      }
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_rlm_episodes_run_status
        ON projection_supervised_rlm_episodes(run_id, status, updated_at DESC)
      `;

      const modelSessionColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_supervised_model_sessions)
      `;
      if (!modelSessionColumns.some((column) => column.name === "thread_id")) {
        yield* sql`ALTER TABLE projection_supervised_model_sessions ADD COLUMN thread_id TEXT`;
      }
      yield* sql`
        UPDATE projection_supervised_model_sessions
        SET thread_id = json_extract(entity_json, '$.threadId')
        WHERE thread_id IS NULL
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_model_sessions_thread
        ON projection_supervised_model_sessions(thread_id, updated_at DESC, model_session_id)
      `;

      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_context_compaction_receipts (
          receipt_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          summary_record_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (workspace_id) REFERENCES projection_context_workspaces(workspace_id) ON DELETE CASCADE,
          FOREIGN KEY (summary_record_id) REFERENCES projection_context_records(record_id) ON DELETE RESTRICT
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_context_compaction_workspace_time
        ON projection_context_compaction_receipts(workspace_id, created_at DESC, receipt_id)
      `;

      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_evidence (
          evidence_id TEXT PRIMARY KEY,
          model_session_id TEXT,
          created_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json))
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_evidence_session_time
        ON projection_supervised_evidence(model_session_id, created_at DESC, evidence_id)
      `;

      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_notebook_cursors (
          cursor_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          seat_id TEXT NOT NULL,
          last_created_at TEXT,
          last_entry_id TEXT,
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          UNIQUE (workspace_id, seat_id),
          FOREIGN KEY (workspace_id) REFERENCES projection_supervised_workspaces(workspace_id) ON DELETE CASCADE,
          FOREIGN KEY (seat_id) REFERENCES projection_supervised_agent_seats(seat_id) ON DELETE CASCADE,
          FOREIGN KEY (last_entry_id) REFERENCES projection_supervised_notebook_entries(entry_id) ON DELETE SET NULL
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_notebook_compactions (
          receipt_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          summary_entry_id TEXT NOT NULL,
          created_by_seat_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (workspace_id) REFERENCES projection_supervised_workspaces(workspace_id) ON DELETE CASCADE,
          FOREIGN KEY (summary_entry_id) REFERENCES projection_supervised_notebook_entries(entry_id) ON DELETE RESTRICT,
          FOREIGN KEY (created_by_seat_id) REFERENCES projection_supervised_agent_seats(seat_id) ON DELETE RESTRICT
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_notebook_compactions_scope_time
        ON projection_supervised_notebook_compactions(workspace_id, created_at DESC, receipt_id)
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_notebook_seat_time
        ON projection_supervised_notebook_entries(workspace_id, author_seat_id, created_at DESC, entry_id)
      `;
    }),
  );
});
