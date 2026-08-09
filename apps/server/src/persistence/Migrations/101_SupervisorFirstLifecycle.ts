import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      if (!(yield* columnExists(sql, "supervised_governance_state", "revision"))) {
        yield* sql`
          ALTER TABLE supervised_governance_state
          ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
        `;
      }
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_provider_sessions (
          provider_session_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          seat_id TEXT NOT NULL,
          lifecycle_state TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (workspace_id) REFERENCES projection_supervised_workspaces(workspace_id) ON DELETE CASCADE,
          FOREIGN KEY (seat_id) REFERENCES projection_supervised_agent_seats(seat_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_provider_sessions_seat_state
        ON projection_supervised_provider_sessions(seat_id, lifecycle_state, updated_at DESC)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_handoffs (
          handoff_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          room_id TEXT NOT NULL,
          from_seat_id TEXT NOT NULL,
          to_seat_id TEXT NOT NULL,
          lifecycle_state TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (workspace_id) REFERENCES projection_supervised_workspaces(workspace_id) ON DELETE CASCADE,
          FOREIGN KEY (room_id) REFERENCES projection_supervised_rooms(room_id) ON DELETE CASCADE,
          FOREIGN KEY (from_seat_id) REFERENCES projection_supervised_agent_seats(seat_id) ON DELETE RESTRICT,
          FOREIGN KEY (to_seat_id) REFERENCES projection_supervised_agent_seats(seat_id) ON DELETE RESTRICT
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_role_assumptions (
          role_assumption_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          room_id TEXT NOT NULL,
          actor_seat_id TEXT NOT NULL,
          lifecycle_state TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (workspace_id) REFERENCES projection_supervised_workspaces(workspace_id) ON DELETE CASCADE,
          FOREIGN KEY (room_id) REFERENCES projection_supervised_rooms(room_id) ON DELETE CASCADE,
          FOREIGN KEY (actor_seat_id) REFERENCES projection_supervised_agent_seats(seat_id) ON DELETE RESTRICT
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_lead_replacements (
          replacement_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          room_id TEXT NOT NULL,
          previous_lead_seat_id TEXT NOT NULL,
          replacement_lead_seat_id TEXT NOT NULL,
          lifecycle_state TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (workspace_id) REFERENCES projection_supervised_workspaces(workspace_id) ON DELETE CASCADE,
          FOREIGN KEY (room_id) REFERENCES projection_supervised_rooms(room_id) ON DELETE CASCADE,
          FOREIGN KEY (previous_lead_seat_id) REFERENCES projection_supervised_agent_seats(seat_id) ON DELETE RESTRICT,
          FOREIGN KEY (replacement_lead_seat_id) REFERENCES projection_supervised_agent_seats(seat_id) ON DELETE RESTRICT
        )
      `;
    }),
  );
});
