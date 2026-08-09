import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";
import {
  ensurePeerModelSessionRoleConstraint,
  repairCanonicalProfiles,
} from "./supervisedCanonicalRepair.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      if (!(yield* columnExists(sql, "supervised_governance_state", "orchestration_json"))) {
        yield* sql`
          ALTER TABLE supervised_governance_state
          ADD COLUMN orchestration_json TEXT NOT NULL DEFAULT '{"revision":0,"agentSeats":[],"profiles":[],"profileSnapshots":[],"missions":[],"workflowDirectives":[],"workflowConflicts":[],"advice":[],"observationCursors":[],"wakeQueue":[],"rotations":[],"updatedAt":"1970-01-01T00:00:00.000Z"}'
            CHECK (json_valid(orchestration_json))
        `;
      }

      yield* sql`
        UPDATE supervised_governance_state
        SET orchestration_json = COALESCE(
          (
            SELECT json_object(
              'revision', COALESCE(json_extract(snapshot_json, '$.snapshotSequence'), 0),
              'agentSeats', json_array(),
              'profiles', json(COALESCE(json_extract(snapshot_json, '$.profiles'), '[]')),
              'profileSnapshots', json(COALESCE(json_extract(snapshot_json, '$.profileSnapshots'), '[]')),
              'missions', json(COALESCE(json_extract(snapshot_json, '$.missions'), '[]')),
              'workflowDirectives', json(COALESCE(json_extract(snapshot_json, '$.workflowDirectives'), '[]')),
              'workflowConflicts', json(COALESCE(json_extract(snapshot_json, '$.workflowConflicts'), '[]')),
              'advice', json(COALESCE(json_extract(snapshot_json, '$.advice'), '[]')),
              'observationCursors', json(COALESCE(json_extract(snapshot_json, '$.observationCursors'), '[]')),
              'wakeQueue', json(COALESCE(json_extract(snapshot_json, '$.wakeQueue'), '[]')),
              'rotations', json(COALESCE(json_extract(snapshot_json, '$.rotations'), '[]')),
              'updatedAt', COALESCE(
                json_extract(snapshot_json, '$.updatedAt'), '1970-01-01T00:00:00.000Z'
              )
            )
            FROM projection_supervision_state
            WHERE singleton_id = 1
          ),
          orchestration_json
        )
        WHERE singleton_id = 1
          AND json_array_length(json_extract(orchestration_json, '$.profiles')) = 0
          AND json_array_length(json_extract(orchestration_json, '$.profileSnapshots')) = 0
      `;
      yield* repairCanonicalProfiles(sql);

      yield* sql`
        UPDATE projection_supervised_agent_seats AS target
        SET entity_json = json_set(
          target.entity_json,
          '$.threadId', source.active_thread_id,
          '$.projectId', NULL,
          '$.profileSnapshotId', json_extract(source.entity_json, '$.profileSnapshotId'),
          '$.predecessorThreadIds', COALESCE(
            json_extract(source.entity_json, '$.predecessorThreadIds'), json_array()
          ),
          '$.displayName', json_extract(source.entity_json, '$.name')
        )
        FROM projection_supervision_supervisors AS source
        WHERE target.seat_id = source.supervisor_seat_id
          AND target.identity_role = 'supervisor'
      `;

      yield* sql`
        UPDATE projection_supervised_agent_seats AS target
        SET entity_json = json_set(
          target.entity_json,
          '$.threadId', source.active_thread_id,
          '$.projectId', source.project_id,
          '$.profileSnapshotId', source.profile_snapshot_id,
          '$.predecessorThreadIds', COALESCE(
            json_extract(source.entity_json, '$.predecessorThreadIds'), json_array()
          ),
          '$.displayName', NULL
        )
        FROM projection_supervision_active_leads AS source
        WHERE target.seat_id = source.lead_seat_id
          AND target.identity_role = 'lead'
      `;

      yield* sql`
        UPDATE projection_supervised_agent_seats AS target
        SET entity_json = json_set(
          target.entity_json,
          '$.threadId', source.thread_id,
          '$.projectId', source.project_id,
          '$.profileSnapshotId', source.profile_snapshot_id,
          '$.predecessorThreadIds', json_array(),
          '$.displayName', NULL
        )
        FROM projection_supervision_peers AS source
        WHERE target.seat_id = source.thread_id
          AND target.identity_role = 'peer'
      `;

      yield* sql`
        UPDATE projection_threads
        SET subagent_role = 'peer'
        WHERE subagent_role = 'specialist'
      `;

      yield* ensurePeerModelSessionRoleConstraint(sql);
      yield* sql`
        UPDATE projection_supervised_model_sessions
        SET role = 'peer',
            entity_json = json_remove(
              json_set(
                entity_json,
                '$.role', 'peer',
                '$.peerSpecialtyId', json_extract(entity_json, '$.specialistId')
              ),
              '$.specialistId'
            )
        WHERE role = 'specialist'
           OR json_extract(entity_json, '$.role') = 'specialist'
      `;

      yield* sql`
        UPDATE projection_specialist_snapshots
        SET entity_json = json_remove(
          json_set(
            entity_json,
            '$.peerSpecialtyId', json_extract(entity_json, '$.specialistId')
          ),
          '$.specialistId'
        )
        WHERE json_type(entity_json, '$.specialistId') IS NOT NULL
          AND json_type(entity_json, '$.peerSpecialtyId') IS NULL
      `;

      yield* sql`
        UPDATE projection_retained_specialists
        SET entity_json = json_set(
          entity_json,
          '$.allowedScopes',
          (
            SELECT json_group_array(
              CASE
                WHEN json_extract(value, '$.kind') = 'seat'
                  AND json_extract(value, '$.role') = 'specialist'
                  THEN json(json_set(value, '$.role', 'peer'))
                ELSE json(value)
              END
            )
            FROM json_each(entity_json, '$.allowedScopes')
          )
        )
        WHERE EXISTS (
          SELECT 1
          FROM json_each(entity_json, '$.allowedScopes')
          WHERE json_extract(value, '$.kind') = 'seat'
            AND json_extract(value, '$.role') = 'specialist'
        )
      `;
    }),
  );
});
