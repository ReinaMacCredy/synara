import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervision_state (
          singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
          snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
          snapshot_sequence INTEGER NOT NULL CHECK (snapshot_sequence >= 0),
          updated_at TEXT NOT NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_supervision_state (
          singleton_id, snapshot_json, snapshot_sequence, updated_at
        ) VALUES (
          1,
          '{"snapshotSequence":0,"profiles":[],"profileSnapshots":[],"supervisors":[],"leads":[],"peers":[],"missions":[],"workflowDirectives":[],"workflowConflicts":[],"advice":[],"observationCursors":[],"wakeQueue":[],"rotations":[],"updatedAt":"1970-01-01T00:00:00.000Z"}',
          0,
          '1970-01-01T00:00:00.000Z'
        )
        ON CONFLICT (singleton_id) DO NOTHING
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervision_active_leads (
          lead_seat_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          active_thread_id TEXT NOT NULL,
          profile_snapshot_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'rotating', 'vacant', 'archived')),
          archived_at TEXT,
          revision INTEGER NOT NULL CHECK (revision > 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (project_id) REFERENCES projection_projects(project_id) ON DELETE CASCADE,
          FOREIGN KEY (active_thread_id) REFERENCES projection_threads(thread_id) ON DELETE RESTRICT
        )
      `;
      yield* sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_supervision_one_active_lead_per_project
        ON projection_supervision_active_leads(project_id)
        WHERE archived_at IS NULL AND status IN ('active', 'rotating')
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervision_profiles (
          profile_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          provider TEXT NOT NULL,
          archived_at TEXT,
          revision INTEGER NOT NULL CHECK (revision > 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json))
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervision_profile_snapshots (
          snapshot_id TEXT PRIMARY KEY,
          source_profile_id TEXT,
          content_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json))
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervision_supervisors (
          supervisor_seat_id TEXT PRIMARY KEY,
          active_thread_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'queued', 'rotating', 'archived')),
          archived_at TEXT,
          revision INTEGER NOT NULL CHECK (revision > 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (active_thread_id) REFERENCES projection_threads(thread_id) ON DELETE RESTRICT
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervision_missions (
          mission_id TEXT PRIMARY KEY,
          supervisor_seat_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'expired', 'cancelled')),
          scope_kind TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision > 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (supervisor_seat_id)
            REFERENCES projection_supervision_supervisors(supervisor_seat_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervision_missions_seat_state
        ON projection_supervision_missions(supervisor_seat_id, status, updated_at DESC)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervision_mission_targets (
          mission_id TEXT NOT NULL,
          target_index INTEGER NOT NULL CHECK (target_index >= 0),
          target_kind TEXT NOT NULL CHECK (target_kind IN ('all_projects', 'space', 'project', 'lead')),
          target_id TEXT,
          target_json TEXT NOT NULL CHECK (json_valid(target_json)),
          PRIMARY KEY (mission_id, target_index),
          FOREIGN KEY (mission_id) REFERENCES projection_supervision_missions(mission_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervision_mission_targets_lookup
        ON projection_supervision_mission_targets(target_kind, target_id, mission_id)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervision_mission_grants (
          mission_id TEXT NOT NULL,
          grant_name TEXT NOT NULL,
          PRIMARY KEY (mission_id, grant_name),
          FOREIGN KEY (mission_id) REFERENCES projection_supervision_missions(mission_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervision_workflow_directives (
          directive_id TEXT PRIMARY KEY,
          lead_seat_id TEXT NOT NULL,
          slot TEXT NOT NULL,
          status TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision > 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json))
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervision_workflow_conflicts (
          conflict_id TEXT PRIMARY KEY,
          lead_seat_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
          created_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json))
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervision_advice (
          advice_id TEXT PRIMARY KEY,
          supervisor_seat_id TEXT NOT NULL,
          lead_seat_id TEXT NOT NULL,
          mission_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json))
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervision_observation_cursors (
          observation_id TEXT PRIMARY KEY,
          mission_id TEXT NOT NULL,
          lead_seat_id TEXT NOT NULL,
          last_sequence INTEGER NOT NULL CHECK (last_sequence >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json))
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervision_rotations (
          rotation_id TEXT PRIMARY KEY,
          lead_seat_id TEXT NOT NULL,
          state TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision > 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json))
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervision_wake_queue (
          wake_id TEXT PRIMARY KEY,
          mission_id TEXT NOT NULL,
          supervisor_seat_id TEXT NOT NULL,
          lead_seat_id TEXT NOT NULL,
          episode_kind TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('queued', 'dispatching', 'delivered', 'failed')),
          attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (mission_id) REFERENCES projection_supervision_missions(mission_id) ON DELETE CASCADE,
          FOREIGN KEY (supervisor_seat_id) REFERENCES projection_supervision_supervisors(supervisor_seat_id) ON DELETE CASCADE,
          FOREIGN KEY (lead_seat_id) REFERENCES projection_supervision_active_leads(lead_seat_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervision_wake_queue_delivery
        ON projection_supervision_wake_queue(status, updated_at, supervisor_seat_id)
      `;
    }),
  );
});
