import { assert, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { AgentSeat, SupervisedOrchestrationSnapshot } from "@synara/contracts";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import SupervisedCanonicalCutover from "./108_SupervisedCanonicalCutover.ts";

const now = "2026-08-09T00:00:00.000Z";
const freshSchemaLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));
const upgradeSchemaLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const profile = {
  id: "profile-lead",
  name: "Lead",
  roleHints: ["lead"],
  runtime: {
    provider: "codex",
    model: "gpt-5.6-luna",
    reasoningEffort: "low",
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
    developerInstructions: "Lead the Room.",
  },
  isDefault: false,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  revision: 1,
};

freshSchemaLayer("migration 108 Supervised canonical cutover on a fresh database", (it) => {
  it.effect("creates an idempotent empty canonical orchestration slice on a fresh database", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();

      const before = yield* sql<{ readonly orchestrationJson: string }>`
        SELECT orchestration_json AS "orchestrationJson"
        FROM supervised_governance_state
        WHERE singleton_id = 1
      `;
      const snapshot = Schema.decodeUnknownSync(SupervisedOrchestrationSnapshot)(
        JSON.parse(before[0]!.orchestrationJson),
      );
      assert.equal(snapshot.revision, 0);
      assert.deepStrictEqual(snapshot.agentSeats, []);
      assert.deepStrictEqual(snapshot.profiles, []);

      yield* SupervisedCanonicalCutover;
      const after = yield* sql<{ readonly orchestrationJson: string }>`
        SELECT orchestration_json AS "orchestrationJson"
        FROM supervised_governance_state
        WHERE singleton_id = 1
      `;
      assert.equal(after[0]!.orchestrationJson, before[0]!.orchestrationJson);
    }),
  );
});

upgradeSchemaLayer("migration 108 Supervised canonical cutover upgrade", (it) => {
  it.effect("upcasts legacy profiles and actor linkage without retaining duplicate seat arrays", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 99 });
      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
        ) VALUES ('project-1', 'project', 'Project', '/tmp/project', '[]', ${now}, ${now})
      `;
      for (const [threadId, title] of [
        ["supervisor-thread", "Supervisor"],
        ["lead-thread", "Lead"],
        ["peer-thread", "Peer"],
      ] as const) {
        yield* sql`
          INSERT INTO projection_threads (
            thread_id, project_id, title, created_at, updated_at,
            runtime_mode, interaction_mode, env_mode
          ) VALUES (
            ${threadId}, 'project-1', ${title}, ${now}, ${now},
            'full-access', 'default', 'local'
          )
        `;
      }
      yield* sql`
        UPDATE projection_supervision_state
        SET snapshot_json = ${JSON.stringify({
          snapshotSequence: 42,
          profiles: [profile],
          profileSnapshots: [],
          supervisors: [{ id: "supervisor-seat" }],
          leads: [{ id: "lead-seat" }],
          peers: [{ threadId: "peer-thread" }],
          missions: [],
          workflowDirectives: [],
          workflowConflicts: [],
          advice: [],
          observationCursors: [],
          wakeQueue: [],
          rotations: [],
          updatedAt: now,
        })}, snapshot_sequence = 42, updated_at = ${now}
        WHERE singleton_id = 1
      `;
      yield* sql`
        INSERT INTO projection_supervision_supervisors (
          supervisor_seat_id, active_thread_id, status, archived_at,
          revision, updated_at, entity_json
        ) VALUES (
          'supervisor-seat', 'supervisor-thread', 'active', NULL, 1, ${now},
          ${JSON.stringify({
            id: "supervisor-seat",
            name: "Primary Supervisor",
            activeThreadId: "supervisor-thread",
            predecessorThreadIds: ["supervisor-predecessor"],
            profileSnapshotId: "snapshot-supervisor",
            status: "active",
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
            revision: 1,
          })}
        )
      `;
      yield* sql`
        INSERT INTO projection_supervision_active_leads (
          lead_seat_id, project_id, active_thread_id, profile_snapshot_id,
          status, archived_at, revision, updated_at, entity_json
        ) VALUES (
          'lead-seat', 'project-1', 'lead-thread', 'snapshot-lead',
          'active', NULL, 1, ${now},
          ${JSON.stringify({
            id: "lead-seat",
            projectId: "project-1",
            activeThreadId: "lead-thread",
            predecessorThreadIds: ["lead-predecessor"],
            profileSnapshotId: "snapshot-lead",
            status: "active",
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
            revision: 1,
          })}
        )
      `;
      yield* sql`
        INSERT INTO projection_supervision_peers (
          thread_id, project_id, lead_seat_id, root_thread_id, profile_snapshot_id,
          status, archived_at, revision, updated_at, entity_json
        ) VALUES (
          'peer-thread', 'project-1', 'lead-seat', 'lead-thread', 'snapshot-peer',
          'active', NULL, 1, ${now},
          ${JSON.stringify({
            threadId: "peer-thread",
            projectId: "project-1",
            leadSeatId: "lead-seat",
            rootThreadId: "lead-thread",
            profileSnapshotId: "snapshot-peer",
            status: "active",
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
            revision: 1,
          })}
        )
      `;
      yield* sql`
        UPDATE projection_threads
        SET subagent_role = 'specialist'
        WHERE thread_id = 'peer-thread'
      `;
      yield* sql`
        INSERT INTO projection_retained_specialists (
          specialist_id, profile_preset_id, concern, status, latest_snapshot_id,
          expires_at, revision, updated_at, entity_json
        ) VALUES (
          'specialty-1', 'profile-lead', 'review', 'retained', 'specialty-snapshot-1',
          '2027-08-09T00:00:00.000Z', 1, ${now},
          ${JSON.stringify({
            id: "specialty-1",
            profilePresetId: "profile-lead",
            concern: "review",
            status: "retained",
            allowedScopes: [{ kind: "seat", role: "specialist", seatId: "peer-thread" }],
            latestSnapshotId: "specialty-snapshot-1",
            expiresAt: "2027-08-09T00:00:00.000Z",
            revision: 1,
            createdAt: now,
            updatedAt: now,
          })}
        )
      `;
      yield* sql`
        INSERT INTO projection_specialist_snapshots (
          specialist_snapshot_id, specialist_id, profile_content_hash, expires_at, entity_json
        ) VALUES (
          'specialty-snapshot-1', 'specialty-1', 'sha256:legacy',
          '2027-08-09T00:00:00.000Z',
          ${JSON.stringify({
            id: "specialty-snapshot-1",
            specialistId: "specialty-1",
            profileContentHash: "sha256:legacy",
            contextRefs: [],
            evidenceRefs: [],
            sanitized: true,
            compatibleSchemaVersions: ["1.0.0"],
            createdAt: now,
            expiresAt: "2027-08-09T00:00:00.000Z",
          })}
        )
      `;

      yield* runMigrations();

      const stateRows = yield* sql<{ readonly orchestrationJson: string }>`
        SELECT orchestration_json AS "orchestrationJson"
        FROM supervised_governance_state
        WHERE singleton_id = 1
      `;
      const rawState = JSON.parse(stateRows[0]!.orchestrationJson) as Record<string, unknown>;
      const snapshot = Schema.decodeUnknownSync(SupervisedOrchestrationSnapshot)(rawState);
      assert.equal(snapshot.revision, 42);
      assert.deepStrictEqual(snapshot.profiles.map((candidate) => candidate.id), ["profile-lead"]);
      assert.equal("supervisors" in rawState, false);
      assert.equal("leads" in rawState, false);
      assert.equal("peers" in rawState, false);

      const seatRows = yield* sql<{ readonly seatId: string; readonly entityJson: string }>`
        SELECT seat_id AS "seatId", entity_json AS "entityJson"
        FROM projection_supervised_agent_seats
        WHERE seat_id IN ('supervisor-seat', 'lead-seat', 'peer-thread')
        ORDER BY seat_id
      `;
      const seats = new Map(
        seatRows.map((row) => [
          row.seatId,
          Schema.decodeUnknownSync(AgentSeat)(JSON.parse(row.entityJson)),
        ]),
      );
      assert.equal(seats.get("supervisor-seat")!.threadId, "supervisor-thread");
      assert.equal(seats.get("supervisor-seat")!.displayName, "Primary Supervisor");
      assert.deepStrictEqual(seats.get("lead-seat")!.predecessorThreadIds, ["lead-predecessor"]);
      assert.equal(seats.get("lead-seat")!.projectId, "project-1");
      assert.equal(seats.get("peer-thread")!.identityRole, "peer");
      assert.equal(seats.get("peer-thread")!.profileSnapshotId, "snapshot-peer");

      const peerThreadRows = yield* sql<{ readonly subagentRole: string | null }>`
        SELECT subagent_role AS "subagentRole"
        FROM projection_threads
        WHERE thread_id = 'peer-thread'
      `;
      assert.equal(peerThreadRows[0]!.subagentRole, "peer");
      const specialtySnapshotRows = yield* sql<{ readonly entityJson: string }>`
        SELECT entity_json AS "entityJson"
        FROM projection_specialist_snapshots
        WHERE specialist_snapshot_id = 'specialty-snapshot-1'
      `;
      assert.deepStrictEqual(JSON.parse(specialtySnapshotRows[0]!.entityJson), {
        id: "specialty-snapshot-1",
        peerSpecialtyId: "specialty-1",
        profileContentHash: "sha256:legacy",
        contextRefs: [],
        evidenceRefs: [],
        sanitized: true,
        compatibleSchemaVersions: ["1.0.0"],
        createdAt: now,
        expiresAt: "2027-08-09T00:00:00.000Z",
      });
      const specialtyRows = yield* sql<{ readonly entityJson: string }>`
        SELECT entity_json AS "entityJson"
        FROM projection_retained_specialists
        WHERE specialist_id = 'specialty-1'
      `;
      assert.deepStrictEqual(
        (JSON.parse(specialtyRows[0]!.entityJson) as { allowedScopes: unknown[] }).allowedScopes,
        [{ kind: "seat", role: "peer", seatId: "peer-thread" }],
      );

      yield* SupervisedCanonicalCutover;
      const rerunRows = yield* sql<{ readonly orchestrationJson: string }>`
        SELECT orchestration_json AS "orchestrationJson"
        FROM supervised_governance_state
        WHERE singleton_id = 1
      `;
      assert.equal(rerunRows[0]!.orchestrationJson, stateRows[0]!.orchestrationJson);
    }),
  );
});
