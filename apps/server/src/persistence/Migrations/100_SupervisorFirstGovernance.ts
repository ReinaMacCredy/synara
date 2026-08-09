import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        CREATE TABLE IF NOT EXISTS supervised_governance_state (
          singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
          updated_at TEXT NOT NULL
        )
      `;
      yield* sql`
        INSERT INTO supervised_governance_state (singleton_id, updated_at)
        VALUES (1, '1970-01-01T00:00:00.000Z')
        ON CONFLICT (singleton_id) DO NOTHING
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_workspaces (
          workspace_id TEXT PRIMARY KEY,
          owner_namespace TEXT NOT NULL,
          lifecycle_state TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json))
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_authority_receipts (
          receipt_id TEXT PRIMARY KEY,
          actor_seat_id TEXT NOT NULL,
          identity_role TEXT NOT NULL CHECK (identity_role IN ('supervisor', 'lead', 'peer')),
          effective_role TEXT NOT NULL CHECK (effective_role IN ('supervisor', 'lead', 'peer', 'acting_root')),
          issued_at TEXT NOT NULL,
          expires_at TEXT,
          revoked_at TEXT,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json))
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_authority_receipts_actor
        ON projection_supervised_authority_receipts(actor_seat_id, issued_at DESC, receipt_id)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_agent_seats (
          seat_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          identity_role TEXT NOT NULL CHECK (identity_role IN ('supervisor', 'lead', 'peer')),
          effective_role TEXT NOT NULL CHECK (effective_role IN ('supervisor', 'lead', 'peer', 'acting_root')),
          profile_id TEXT NOT NULL,
          lifecycle_state TEXT NOT NULL,
          work_state TEXT NOT NULL,
          authority_receipt_id TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (workspace_id) REFERENCES projection_supervised_workspaces(workspace_id) ON DELETE CASCADE,
          FOREIGN KEY (authority_receipt_id) REFERENCES projection_supervised_authority_receipts(receipt_id) ON DELETE RESTRICT
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_agent_seats_workspace_role
        ON projection_supervised_agent_seats(workspace_id, identity_role, lifecycle_state, updated_at DESC)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_root_authority_leases (
          lease_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          room_id TEXT NOT NULL,
          holder_seat_id TEXT NOT NULL,
          status TEXT NOT NULL,
          authority_receipt_id TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (workspace_id) REFERENCES projection_supervised_workspaces(workspace_id) ON DELETE CASCADE,
          FOREIGN KEY (room_id) REFERENCES projection_supervised_rooms(room_id) ON DELETE CASCADE,
          FOREIGN KEY (holder_seat_id) REFERENCES projection_supervised_agent_seats(seat_id) ON DELETE RESTRICT,
          FOREIGN KEY (authority_receipt_id) REFERENCES projection_supervised_authority_receipts(receipt_id) ON DELETE RESTRICT
        )
      `;
      yield* sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_supervised_root_authority_one_active_per_room
        ON projection_supervised_root_authority_leases(room_id)
        WHERE status IN ('active', 'transferring', 'releasing')
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_human_directives (
          directive_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          room_id TEXT,
          status TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (workspace_id) REFERENCES projection_supervised_workspaces(workspace_id) ON DELETE CASCADE,
          FOREIGN KEY (room_id) REFERENCES projection_supervised_rooms(room_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_standing_mandates (
          mandate_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          source_directive_id TEXT NOT NULL,
          subject_seat_id TEXT,
          status TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (workspace_id) REFERENCES projection_supervised_workspaces(workspace_id) ON DELETE CASCADE,
          FOREIGN KEY (source_directive_id) REFERENCES projection_supervised_human_directives(directive_id) ON DELETE RESTRICT,
          FOREIGN KEY (subject_seat_id) REFERENCES projection_supervised_agent_seats(seat_id) ON DELETE SET NULL
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_direct_interventions (
          intervention_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          room_id TEXT NOT NULL,
          supervisor_seat_id TEXT NOT NULL,
          target_peer_seat_id TEXT NOT NULL,
          root_holder_seat_id TEXT NOT NULL,
          lifecycle_state TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (workspace_id) REFERENCES projection_supervised_workspaces(workspace_id) ON DELETE CASCADE,
          FOREIGN KEY (room_id) REFERENCES projection_supervised_rooms(room_id) ON DELETE CASCADE,
          FOREIGN KEY (supervisor_seat_id) REFERENCES projection_supervised_agent_seats(seat_id) ON DELETE RESTRICT,
          FOREIGN KEY (target_peer_seat_id) REFERENCES projection_supervised_agent_seats(seat_id) ON DELETE RESTRICT,
          FOREIGN KEY (root_holder_seat_id) REFERENCES projection_supervised_agent_seats(seat_id) ON DELETE RESTRICT
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_direct_interventions_room_state
        ON projection_supervised_direct_interventions(room_id, lifecycle_state, updated_at DESC)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_notebook_entries (
          entry_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          room_id TEXT,
          task_node_id TEXT,
          concern TEXT NOT NULL,
          kind TEXT NOT NULL,
          author_seat_id TEXT NOT NULL,
          supersedes_entry_id TEXT,
          created_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (workspace_id) REFERENCES projection_supervised_workspaces(workspace_id) ON DELETE CASCADE,
          FOREIGN KEY (room_id) REFERENCES projection_supervised_rooms(room_id) ON DELETE CASCADE,
          FOREIGN KEY (task_node_id) REFERENCES projection_supervised_task_nodes(task_node_id) ON DELETE SET NULL,
          FOREIGN KEY (author_seat_id) REFERENCES projection_supervised_agent_seats(seat_id) ON DELETE RESTRICT,
          FOREIGN KEY (supersedes_entry_id) REFERENCES projection_supervised_notebook_entries(entry_id) ON DELETE SET NULL
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_notebook_scope
        ON projection_supervised_notebook_entries(workspace_id, concern, room_id, created_at DESC)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS supervised_model_capability_profiles (
          profile_id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          version TEXT NOT NULL,
          available INTEGER NOT NULL CHECK (available IN (0, 1)),
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          UNIQUE (provider, model, version)
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS supervised_user_model_preference_profiles (
          preference_profile_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          UNIQUE (user_id)
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS supervised_model_selection_receipts (
          receipt_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          room_id TEXT,
          task_node_id TEXT,
          actor_seat_id TEXT NOT NULL,
          selected_model_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (workspace_id) REFERENCES projection_supervised_workspaces(workspace_id) ON DELETE CASCADE,
          FOREIGN KEY (room_id) REFERENCES projection_supervised_rooms(room_id) ON DELETE SET NULL,
          FOREIGN KEY (task_node_id) REFERENCES projection_supervised_task_nodes(task_node_id) ON DELETE SET NULL,
          FOREIGN KEY (actor_seat_id) REFERENCES projection_supervised_agent_seats(seat_id) ON DELETE RESTRICT,
          FOREIGN KEY (selected_model_id) REFERENCES supervised_model_capability_profiles(profile_id) ON DELETE RESTRICT
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_model_selection_actor_time
        ON supervised_model_selection_receipts(actor_seat_id, created_at DESC, receipt_id)
      `;

      yield* sql`
        INSERT INTO projection_supervised_workspaces (
          workspace_id, owner_namespace, lifecycle_state, revision, updated_at, entity_json
        ) VALUES (
          'workspace:default', 'local', 'active', 0, '1970-01-01T00:00:00.000Z',
          json_object(
            'id', 'workspace:default',
            'ownerNamespace', 'local',
            'title', 'Local Supervised Workspace',
            'lifecycleState', 'active',
            'revision', 0,
            'createdAt', '1970-01-01T00:00:00.000Z',
            'updatedAt', '1970-01-01T00:00:00.000Z'
          )
        )
        ON CONFLICT (workspace_id) DO NOTHING
      `;

      yield* sql`
        INSERT OR IGNORE INTO projection_supervised_authority_receipts (
          receipt_id, actor_seat_id, identity_role, effective_role,
          issued_at, expires_at, revoked_at, entity_json
        )
        SELECT
          'legacy-receipt:' || supervisor_seat_id,
          supervisor_seat_id,
          'supervisor',
          'supervisor',
          COALESCE(json_extract(entity_json, '$.createdAt'), updated_at),
          NULL,
          CASE WHEN status = 'archived' THEN COALESCE(archived_at, updated_at) ELSE NULL END,
          json_object(
            'id', 'legacy-receipt:' || supervisor_seat_id,
            'actorSeatId', supervisor_seat_id,
            'identityRole', 'supervisor',
            'effectiveRole', 'supervisor',
            'workspaceScopes', json_array('workspace:default'),
            'roomScopes', json_array(),
            'taskNodeScopes', json_array(),
            'allowedCommands', json_array(),
            'allowedTools', json_array(),
            'rootLeaseIds', json_array(),
            'mandateIds', json_array(),
            'runPolicyRevision', 0,
            'issuedAt', COALESCE(json_extract(entity_json, '$.createdAt'), updated_at),
            'expiresAt', NULL,
            'revokedAt', CASE WHEN status = 'archived' THEN COALESCE(archived_at, updated_at) ELSE NULL END
          )
        FROM projection_supervision_supervisors
      `;
      yield* sql`
        INSERT OR IGNORE INTO projection_supervised_authority_receipts (
          receipt_id, actor_seat_id, identity_role, effective_role,
          issued_at, expires_at, revoked_at, entity_json
        )
        SELECT
          'legacy-receipt:' || lead_seat_id,
          lead_seat_id,
          'lead',
          'lead',
          COALESCE(json_extract(entity_json, '$.createdAt'), updated_at),
          NULL,
          CASE WHEN status = 'archived' THEN COALESCE(archived_at, updated_at) ELSE NULL END,
          json_object(
            'id', 'legacy-receipt:' || lead_seat_id,
            'actorSeatId', lead_seat_id,
            'identityRole', 'lead',
            'effectiveRole', 'lead',
            'workspaceScopes', json_array('workspace:default'),
            'roomScopes', json(COALESCE((
              SELECT json_group_array(room_id)
              FROM projection_supervised_rooms
              WHERE lead_seat_id = source.lead_seat_id
            ), '[]')),
            'taskNodeScopes', json_array(),
            'allowedCommands', json_array(),
            'allowedTools', json_array(),
            'rootLeaseIds', json(COALESCE((
              SELECT json_group_array('legacy-root-lease:' || room_id || ':' || source.lead_seat_id)
              FROM projection_supervised_rooms
              WHERE lead_seat_id = source.lead_seat_id
            ), '[]')),
            'mandateIds', json_array(),
            'runPolicyRevision', 0,
            'issuedAt', COALESCE(json_extract(entity_json, '$.createdAt'), updated_at),
            'expiresAt', NULL,
            'revokedAt', CASE WHEN status = 'archived' THEN COALESCE(archived_at, updated_at) ELSE NULL END
          )
        FROM projection_supervision_active_leads AS source
      `;
      yield* sql`
        INSERT OR IGNORE INTO projection_supervised_authority_receipts (
          receipt_id, actor_seat_id, identity_role, effective_role,
          issued_at, expires_at, revoked_at, entity_json
        )
        SELECT
          'legacy-receipt:' || thread_id,
          thread_id,
          'peer',
          'peer',
          COALESCE(json_extract(entity_json, '$.createdAt'), updated_at),
          NULL,
          CASE WHEN status = 'archived' THEN COALESCE(archived_at, updated_at) ELSE NULL END,
          json_object(
            'id', 'legacy-receipt:' || thread_id,
            'actorSeatId', thread_id,
            'identityRole', 'peer',
            'effectiveRole', 'peer',
            'workspaceScopes', json_array('workspace:default'),
            'roomScopes', json(COALESCE((
              SELECT json_group_array(room_id)
              FROM projection_supervised_rooms
              WHERE lead_seat_id = source.lead_seat_id
            ), '[]')),
            'taskNodeScopes', json_array(),
            'allowedCommands', json_array(),
            'allowedTools', json_array(),
            'rootLeaseIds', json_array(),
            'mandateIds', json_array(),
            'runPolicyRevision', 0,
            'issuedAt', COALESCE(json_extract(entity_json, '$.createdAt'), updated_at),
            'expiresAt', NULL,
            'revokedAt', CASE WHEN status = 'archived' THEN COALESCE(archived_at, updated_at) ELSE NULL END
          )
        FROM projection_supervision_peers AS source
      `;

      yield* sql`
        INSERT OR IGNORE INTO projection_supervised_agent_seats (
          seat_id, workspace_id, identity_role, effective_role, profile_id,
          lifecycle_state, work_state, authority_receipt_id, revision, updated_at, entity_json
        )
        SELECT
          supervisor_seat_id,
          'workspace:default',
          'supervisor',
          'supervisor',
          json_extract(entity_json, '$.profileSnapshotId'),
          CASE status
            WHEN 'active' THEN 'active'
            WHEN 'queued' THEN 'requested'
            WHEN 'rotating' THEN 'draining'
            ELSE 'retired'
          END,
          'idle',
          'legacy-receipt:' || supervisor_seat_id,
          revision,
          updated_at,
          json_object(
            'id', supervisor_seat_id,
            'workspaceId', 'workspace:default',
            'roomIds', json_array(),
            'identityRole', 'supervisor',
            'effectiveRole', 'supervisor',
            'profileId', json_extract(entity_json, '$.profileSnapshotId'),
            'providerSessionId', NULL,
            'lifecycleState', CASE status
              WHEN 'active' THEN 'active'
              WHEN 'queued' THEN 'requested'
              WHEN 'rotating' THEN 'draining'
              ELSE 'retired'
            END,
            'workState', 'idle',
            'authorityReceiptId', 'legacy-receipt:' || supervisor_seat_id,
            'createdAt', COALESCE(json_extract(entity_json, '$.createdAt'), updated_at),
            'retainedAt', NULL,
            'retiredAt', CASE WHEN status = 'archived' THEN COALESCE(archived_at, updated_at) ELSE NULL END,
            'revision', revision,
            'updatedAt', updated_at
          )
        FROM projection_supervision_supervisors
        WHERE json_extract(entity_json, '$.profileSnapshotId') IS NOT NULL
      `;
      yield* sql`
        INSERT OR IGNORE INTO projection_supervised_agent_seats (
          seat_id, workspace_id, identity_role, effective_role, profile_id,
          lifecycle_state, work_state, authority_receipt_id, revision, updated_at, entity_json
        )
        SELECT
          lead_seat_id,
          'workspace:default',
          'lead',
          'lead',
          profile_snapshot_id,
          CASE status
            WHEN 'active' THEN 'active'
            WHEN 'rotating' THEN 'draining'
            WHEN 'vacant' THEN 'requested'
            ELSE 'retired'
          END,
          'idle',
          'legacy-receipt:' || lead_seat_id,
          revision,
          updated_at,
          json_object(
            'id', lead_seat_id,
            'workspaceId', 'workspace:default',
            'roomIds', json(COALESCE((
              SELECT json_group_array(room_id)
              FROM projection_supervised_rooms
              WHERE lead_seat_id = source.lead_seat_id
            ), '[]')),
            'identityRole', 'lead',
            'effectiveRole', 'lead',
            'profileId', profile_snapshot_id,
            'providerSessionId', NULL,
            'lifecycleState', CASE status
              WHEN 'active' THEN 'active'
              WHEN 'rotating' THEN 'draining'
              WHEN 'vacant' THEN 'requested'
              ELSE 'retired'
            END,
            'workState', 'idle',
            'authorityReceiptId', 'legacy-receipt:' || lead_seat_id,
            'createdAt', COALESCE(json_extract(entity_json, '$.createdAt'), updated_at),
            'retainedAt', NULL,
            'retiredAt', CASE WHEN status = 'archived' THEN COALESCE(archived_at, updated_at) ELSE NULL END,
            'revision', revision,
            'updatedAt', updated_at
          )
        FROM projection_supervision_active_leads AS source
      `;
      yield* sql`
        INSERT OR IGNORE INTO projection_supervised_agent_seats (
          seat_id, workspace_id, identity_role, effective_role, profile_id,
          lifecycle_state, work_state, authority_receipt_id, revision, updated_at, entity_json
        )
        SELECT
          thread_id,
          'workspace:default',
          'peer',
          'peer',
          profile_snapshot_id,
          CASE status WHEN 'active' THEN 'active' ELSE 'retired' END,
          'idle',
          'legacy-receipt:' || thread_id,
          revision,
          updated_at,
          json_object(
            'id', thread_id,
            'workspaceId', 'workspace:default',
            'roomIds', json(COALESCE((
              SELECT json_group_array(room_id)
              FROM projection_supervised_rooms
              WHERE lead_seat_id = source.lead_seat_id
            ), '[]')),
            'identityRole', 'peer',
            'effectiveRole', 'peer',
            'profileId', profile_snapshot_id,
            'providerSessionId', NULL,
            'lifecycleState', CASE status WHEN 'active' THEN 'active' ELSE 'retired' END,
            'workState', 'idle',
            'authorityReceiptId', 'legacy-receipt:' || thread_id,
            'createdAt', COALESCE(json_extract(entity_json, '$.createdAt'), updated_at),
            'retainedAt', NULL,
            'retiredAt', CASE WHEN status = 'archived' THEN COALESCE(archived_at, updated_at) ELSE NULL END,
            'revision', revision,
            'updatedAt', updated_at
          )
        FROM projection_supervision_peers AS source
      `;

      yield* sql`
        INSERT OR IGNORE INTO projection_supervised_root_authority_leases (
          lease_id, workspace_id, room_id, holder_seat_id, status,
          authority_receipt_id, revision, updated_at, entity_json
        )
        SELECT
          'legacy-root-lease:' || room_id || ':' || lead_seat_id,
          'workspace:default',
          room_id,
          lead_seat_id,
          CASE WHEN status IN ('completed', 'archived') THEN 'released' ELSE 'active' END,
          'legacy-receipt:' || lead_seat_id,
          revision,
          updated_at,
          json_object(
            'id', 'legacy-root-lease:' || room_id || ':' || lead_seat_id,
            'workspaceId', 'workspace:default',
            'roomId', room_id,
            'holderSeatId', lead_seat_id,
            'status', CASE WHEN status IN ('completed', 'archived') THEN 'released' ELSE 'active' END,
            'acquiredUnderReceiptId', 'legacy-receipt:' || lead_seat_id,
            'predecessorLeaseId', NULL,
            'acquiredAt', COALESCE(json_extract(entity_json, '$.createdAt'), updated_at),
            'releasedAt', CASE WHEN status IN ('completed', 'archived') THEN updated_at ELSE NULL END,
            'expiresAt', NULL,
            'revision', revision,
            'updatedAt', updated_at
          )
        FROM projection_supervised_rooms
        WHERE lead_seat_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM projection_supervised_agent_seats
            WHERE seat_id = projection_supervised_rooms.lead_seat_id
          )
      `;
    }),
  );
});
