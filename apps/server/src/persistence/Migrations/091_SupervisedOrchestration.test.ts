import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { emptySupervisionSnapshot } from "@synara/contracts";

import { SqlitePersistenceMemory } from "../Layers/Sqlite.ts";
import { ProjectionSupervisionRepositoryLive } from "../Layers/ProjectionSupervision.ts";
import { ProjectionSupervisionRepository } from "../Services/ProjectionSupervision.ts";

const layer = it.layer(
  Layer.mergeAll(
    ProjectionSupervisionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

const now = "2026-08-03T10:00:00.000Z";

layer("migration 091", (it) => {
  it.effect("creates normalized targets, grants, queue, and one-active-Lead storage", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const repository = yield* ProjectionSupervisionRepository;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
        ) VALUES ('project-a', 'project', 'A', '/workspace/a', '[]', ${now}, ${now})
      `;
      for (const threadId of ["root-a", "supervisor-a", "peer-a"]) {
        yield* sql`
          INSERT INTO projection_threads (
            thread_id, project_id, title, created_at, updated_at,
            runtime_mode, interaction_mode, env_mode
          ) VALUES (
            ${threadId}, 'project-a', ${threadId}, ${now}, ${now},
            'full-access', 'default', 'local'
          )
        `;
      }
      const profileSnapshot = {
        id: "snapshot-a" as never,
        sourcePresetId: "profile-lead-default" as never,
        sourcePresetName: "Lead Default",
        runtime: {
          provider: "codex" as const,
          model: "gpt-5.6-sol",
          reasoningEffort: "medium",
          sandboxMode: "danger-full-access" as const,
          approvalPolicy: "never" as const,
          developerInstructions: "Lead",
          providerOptions: {},
        },
        contentHash: "sha256-a",
        createdAt: now,
      };
      const snapshot = {
        ...emptySupervisionSnapshot(now),
        snapshotSequence: 91,
        profileSnapshots: [profileSnapshot],
        supervisors: [
          {
            id: "supervisor-seat-a" as never,
            name: "A",
            activeThreadId: "supervisor-a" as never,
            predecessorThreadIds: [],
            profileSnapshotId: profileSnapshot.id,
            status: "active" as const,
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
            revision: 1,
          },
        ],
        leads: [
          {
            id: "lead-a" as never,
            projectId: "project-a" as never,
            activeThreadId: "root-a" as never,
            predecessorThreadIds: [],
            profileSnapshotId: profileSnapshot.id,
            status: "active" as const,
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
            revision: 1,
          },
        ],
        peers: [
          {
            threadId: "peer-a" as never,
            projectId: "project-a" as never,
            leadSeatId: "lead-a" as never,
            rootThreadId: "root-a" as never,
            profileSnapshotId: profileSnapshot.id,
            status: "active" as const,
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
            revision: 1,
          },
        ],
        missions: [
          {
            id: "mission-a" as never,
            supervisorSeatId: "supervisor-seat-a" as never,
            brief: "Watch release",
            focus: "Compatibility",
            scope: [
              { kind: "project" as const, projectId: "project-a" as never },
              { kind: "lead" as const, leadSeatId: "lead-a" as never },
            ],
            grants: ["lead.observe" as const, "lead.advise" as const],
            endCondition: { kind: "manual" as const },
            status: "active" as const,
            sourceMessageId: "message-a" as never,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            revision: 1,
          },
        ],
        wakeQueue: [
          {
            id: "wake-a" as never,
            missionId: "mission-a" as never,
            supervisorSeatId: "supervisor-seat-a" as never,
            leadSeatId: "lead-a" as never,
            episodeKind: "thread.approval-requested",
            pointers: [
              {
                sequence: 91,
                eventType: "thread.approval-requested",
                aggregateKind: "thread",
                aggregateId: "root-a",
              },
            ],
            status: "queued" as const,
            attemptCount: 0,
            error: null,
            createdAt: now,
            updatedAt: now,
          },
        ],
      };

      yield* repository.replaceSnapshot(snapshot);
      yield* repository.replaceSnapshot(snapshot);

      const targets = yield* sql<{ count: number }>`
        SELECT COUNT(*) AS count FROM projection_supervision_mission_targets
      `;
      const grants = yield* sql<{ count: number }>`
        SELECT COUNT(*) AS count FROM projection_supervision_mission_grants
      `;
      const wakes = yield* sql<{ count: number }>`
        SELECT COUNT(*) AS count FROM projection_supervision_wake_queue
      `;
      const peers = yield* sql<{ count: number }>`
        SELECT COUNT(*) AS count FROM projection_supervision_peers
      `;
      assert.equal(targets[0]?.count, 2);
      assert.equal(grants[0]?.count, 2);
      assert.equal(wakes[0]?.count, 1);
      assert.equal(peers[0]?.count, 1);

      const duplicateLead = yield* Effect.exit(sql`
        INSERT INTO projection_supervision_active_leads (
          lead_seat_id, project_id, active_thread_id, profile_snapshot_id,
          status, archived_at, revision, updated_at, entity_json
        ) VALUES (
          'lead-b', 'project-a', 'root-a', 'snapshot-a',
          'active', NULL, 1, ${now}, '{}'
        )
      `);
      assert.equal(duplicateLead._tag, "Failure");

      const restored = yield* repository.getSnapshot();
      assert.equal(restored.snapshotSequence, 91);
      assert.equal(restored.wakeQueue[0]?.id, "wake-a");
      assert.ok(restored.profiles.length >= 4);
    }),
  );
});
