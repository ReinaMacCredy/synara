import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_model_sessions (
          model_session_id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          run_id TEXT NOT NULL,
          task_node_id TEXT,
          rlm_episode_id TEXT,
          parent_session_id TEXT,
          role TEXT NOT NULL CHECK (role IN ('lead', 'specialist', 'rlm_root', 'rlm_branch')),
          status TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (room_id) REFERENCES projection_supervised_rooms(room_id) ON DELETE CASCADE,
          FOREIGN KEY (run_id) REFERENCES projection_supervised_runs(run_id) ON DELETE CASCADE,
          FOREIGN KEY (task_node_id) REFERENCES projection_supervised_task_nodes(task_node_id) ON DELETE SET NULL
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_model_sessions_room_role
        ON projection_supervised_model_sessions(room_id, role, updated_at DESC, model_session_id)
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_model_sessions_task_node
        ON projection_supervised_model_sessions(task_node_id, updated_at DESC, model_session_id)
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_model_sessions_rlm_episode
        ON projection_supervised_model_sessions(rlm_episode_id, parent_session_id, updated_at, model_session_id)
      `;
    }),
  );
});
