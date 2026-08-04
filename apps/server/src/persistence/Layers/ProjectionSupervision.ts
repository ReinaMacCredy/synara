import { SupervisionSnapshot, emptySupervisionSnapshot } from "@synara/contracts";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { DEFAULT_SUPERVISION_PROFILES } from "../../orchestration/supervision/profileSeeds.ts";
import {
  isPersistenceError,
  toPersistenceDecodeCauseError,
  toPersistenceSqlError,
} from "../Errors.ts";
import {
  ProjectionSupervisionRepository,
  type ProjectionSupervisionRepositoryShape,
} from "../Services/ProjectionSupervision.ts";

type SnapshotRow = { readonly snapshotJson: string };

const decodeSnapshot = (value: string) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(SupervisionSnapshot)(JSON.parse(value)),
    catch: toPersistenceDecodeCauseError("ProjectionSupervision.getSnapshot:decode"),
  });

const withSeedProfiles = (snapshot: typeof SupervisionSnapshot.Type) => {
  const existing = new Set(snapshot.profiles.map((profile) => profile.id));
  const missing = DEFAULT_SUPERVISION_PROFILES.filter((profile) => !existing.has(profile.id));
  return missing.length === 0
    ? snapshot
    : { ...snapshot, profiles: [...snapshot.profiles, ...missing] };
};

const makeProjectionSupervisionRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const getSnapshot: ProjectionSupervisionRepositoryShape["getSnapshot"] = () =>
    sql<SnapshotRow>`
      SELECT snapshot_json AS "snapshotJson"
      FROM projection_supervision_state
      WHERE singleton_id = 1
    `.pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionSupervision.getSnapshot:query")),
      Effect.flatMap((rows) =>
        rows[0]
          ? decodeSnapshot(rows[0].snapshotJson)
          : Effect.succeed(emptySupervisionSnapshot(new Date(0).toISOString())),
      ),
      Effect.map(withSeedProfiles),
    );

  const replaceSnapshot: ProjectionSupervisionRepositoryShape["replaceSnapshot"] = (snapshot) =>
    Effect.gen(function* () {
      yield* sql`
          INSERT INTO projection_supervision_state (
            singleton_id, snapshot_json, snapshot_sequence, updated_at
          ) VALUES (
            1, ${JSON.stringify(snapshot)}, ${snapshot.snapshotSequence}, ${snapshot.updatedAt}
          )
          ON CONFLICT (singleton_id) DO UPDATE SET
            snapshot_json = excluded.snapshot_json,
            snapshot_sequence = excluded.snapshot_sequence,
            updated_at = excluded.updated_at
        `;

      yield* sql`DELETE FROM projection_supervision_wake_queue`;
      yield* sql`DELETE FROM projection_supervision_mission_grants`;
      yield* sql`DELETE FROM projection_supervision_mission_targets`;
      yield* sql`DELETE FROM projection_supervision_advice`;
      yield* sql`DELETE FROM projection_supervision_observation_cursors`;
      yield* sql`DELETE FROM projection_supervision_workflow_conflicts`;
      yield* sql`DELETE FROM projection_supervision_workflow_directives`;
      yield* sql`DELETE FROM projection_supervision_rotations`;
      yield* sql`DELETE FROM projection_supervision_missions`;
      yield* sql`DELETE FROM projection_supervision_supervisors`;
      yield* sql`DELETE FROM projection_supervision_peers`;
      yield* sql`DELETE FROM projection_supervision_active_leads`;
      yield* Effect.forEach(
        snapshot.leads,
        (lead) => sql`
          INSERT INTO projection_supervision_active_leads (
            lead_seat_id, project_id, active_thread_id, profile_snapshot_id,
            status, archived_at, revision, updated_at, entity_json
          ) VALUES (
            ${lead.id}, ${lead.projectId}, ${lead.activeThreadId}, ${lead.profileSnapshotId},
            ${lead.status}, ${lead.archivedAt}, ${lead.revision}, ${lead.updatedAt},
            ${JSON.stringify(lead)}
          )
        `,
        { concurrency: 1, discard: true },
      );

      yield* Effect.forEach(
        snapshot.peers,
        (peer) => sql`
          INSERT INTO projection_supervision_peers (
            thread_id, project_id, lead_seat_id, root_thread_id, profile_snapshot_id,
            status, archived_at, revision, updated_at, entity_json
          ) VALUES (
            ${peer.threadId}, ${peer.projectId}, ${peer.leadSeatId}, ${peer.rootThreadId},
            ${peer.profileSnapshotId}, ${peer.status}, ${peer.archivedAt}, ${peer.revision},
            ${peer.updatedAt}, ${JSON.stringify(peer)}
          )
        `,
        { concurrency: 1, discard: true },
      );

      yield* sql`DELETE FROM projection_supervision_profiles`;
      yield* Effect.forEach(
        snapshot.profiles,
        (profile) => sql`
          INSERT INTO projection_supervision_profiles (
            profile_id, name, provider, archived_at, revision, updated_at, entity_json
          ) VALUES (
            ${profile.id}, ${profile.name}, ${profile.runtime.provider}, ${profile.archivedAt},
            ${profile.revision}, ${profile.updatedAt}, ${JSON.stringify(profile)}
          )
        `,
        { concurrency: 1, discard: true },
      );

      yield* sql`DELETE FROM projection_supervision_profile_snapshots`;
      yield* Effect.forEach(
        snapshot.profileSnapshots,
        (profile) => sql`
          INSERT INTO projection_supervision_profile_snapshots (
            snapshot_id, source_profile_id, content_hash, created_at, entity_json
          ) VALUES (
            ${profile.id}, ${profile.sourcePresetId}, ${profile.contentHash},
            ${profile.createdAt}, ${JSON.stringify(profile)}
          )
        `,
        { concurrency: 1, discard: true },
      );

      yield* Effect.forEach(
        snapshot.supervisors,
        (seat) => sql`
          INSERT INTO projection_supervision_supervisors (
            supervisor_seat_id, active_thread_id, status, archived_at,
            revision, updated_at, entity_json
          ) VALUES (
            ${seat.id}, ${seat.activeThreadId}, ${seat.status}, ${seat.archivedAt},
            ${seat.revision}, ${seat.updatedAt}, ${JSON.stringify(seat)}
          )
        `,
        { concurrency: 1, discard: true },
      );

      yield* Effect.forEach(
        snapshot.missions,
        (mission) => sql`
          INSERT INTO projection_supervision_missions (
            mission_id, supervisor_seat_id, status, scope_kind,
            revision, updated_at, entity_json
          ) VALUES (
            ${mission.id}, ${mission.supervisorSeatId}, ${mission.status},
            ${mission.scope.length === 1 ? (mission.scope[0]?.kind ?? "all_projects") : "multiple"},
            ${mission.revision}, ${mission.updatedAt}, ${JSON.stringify(mission)}
          )
        `,
        { concurrency: 1, discard: true },
      );

      yield* Effect.forEach(
        snapshot.missions,
        (mission) =>
          Effect.forEach(
            mission.scope,
            (target, targetIndex) => {
              const targetId =
                target.kind === "space"
                  ? target.spaceId
                  : target.kind === "project"
                    ? target.projectId
                    : target.kind === "lead"
                      ? target.leadSeatId
                      : null;
              return sql`
              INSERT INTO projection_supervision_mission_targets (
                mission_id, target_index, target_kind, target_id, target_json
              ) VALUES (
                ${mission.id}, ${targetIndex}, ${target.kind}, ${targetId}, ${JSON.stringify(target)}
              )
            `;
            },
            { concurrency: 1, discard: true },
          ),
        { concurrency: 1, discard: true },
      );
      yield* Effect.forEach(
        snapshot.missions,
        (mission) =>
          Effect.forEach(
            mission.grants,
            (grant) => sql`
            INSERT INTO projection_supervision_mission_grants (mission_id, grant_name)
            VALUES (${mission.id}, ${grant})
          `,
            { concurrency: 1, discard: true },
          ),
        { concurrency: 1, discard: true },
      );

      yield* Effect.forEach(
        snapshot.workflowDirectives,
        (directive) => sql`
          INSERT INTO projection_supervision_workflow_directives (
            directive_id, lead_seat_id, slot, status, revision, updated_at, entity_json
          ) VALUES (
            ${directive.id}, ${directive.leadSeatId}, ${directive.slot}, ${directive.status},
            ${directive.revision}, ${directive.updatedAt}, ${JSON.stringify(directive)}
          )
        `,
        { concurrency: 1, discard: true },
      );

      yield* Effect.forEach(
        snapshot.workflowConflicts,
        (conflict) => sql`
          INSERT INTO projection_supervision_workflow_conflicts (
            conflict_id, lead_seat_id, status, created_at, entity_json
          ) VALUES (
            ${conflict.id}, ${conflict.leadSeatId}, ${conflict.status},
            ${conflict.createdAt}, ${JSON.stringify(conflict)}
          )
        `,
        { concurrency: 1, discard: true },
      );

      yield* Effect.forEach(
        snapshot.advice,
        (advice) => sql`
          INSERT INTO projection_supervision_advice (
            advice_id, supervisor_seat_id, lead_seat_id, mission_id, created_at, entity_json
          ) VALUES (
            ${advice.id}, ${advice.supervisorSeatId}, ${advice.leadSeatId},
            ${advice.missionId}, ${advice.createdAt}, ${JSON.stringify(advice)}
          )
        `,
        { concurrency: 1, discard: true },
      );

      yield* Effect.forEach(
        snapshot.observationCursors,
        (cursor) => sql`
          INSERT INTO projection_supervision_observation_cursors (
            observation_id, mission_id, lead_seat_id, last_sequence, updated_at, entity_json
          ) VALUES (
            ${cursor.id}, ${cursor.missionId}, ${cursor.leadSeatId}, ${cursor.lastSequence},
            ${cursor.updatedAt}, ${JSON.stringify(cursor)}
          )
        `,
        { concurrency: 1, discard: true },
      );

      yield* Effect.forEach(
        snapshot.rotations,
        (rotation) => sql`
          INSERT INTO projection_supervision_rotations (
            rotation_id, lead_seat_id, state, revision, updated_at, entity_json
          ) VALUES (
            ${rotation.id}, ${rotation.leadSeatId}, ${rotation.state},
            ${rotation.revision}, ${rotation.updatedAt}, ${JSON.stringify(rotation)}
          )
        `,
        { concurrency: 1, discard: true },
      );

      yield* Effect.forEach(
        snapshot.wakeQueue,
        (wake) => sql`
          INSERT INTO projection_supervision_wake_queue (
            wake_id, mission_id, supervisor_seat_id, lead_seat_id, episode_kind,
            status, attempt_count, updated_at, entity_json
          ) VALUES (
            ${wake.id}, ${wake.missionId}, ${wake.supervisorSeatId}, ${wake.leadSeatId},
            ${wake.episodeKind}, ${wake.status}, ${wake.attemptCount}, ${wake.updatedAt},
            ${JSON.stringify(wake)}
          )
        `,
        { concurrency: 1, discard: true },
      );
    }).pipe(
      Effect.mapError((error) =>
        isPersistenceError(error)
          ? error
          : toPersistenceSqlError("ProjectionSupervision.replaceSnapshot")(error),
      ),
    );

  return { getSnapshot, replaceSnapshot } satisfies ProjectionSupervisionRepositoryShape;
});

export const ProjectionSupervisionRepositoryLive = Layer.effect(
  ProjectionSupervisionRepository,
  makeProjectionSupervisionRepository,
);
