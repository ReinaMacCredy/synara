import { assert, it } from "@effect/vitest";
import { Effect, Exit, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  AgentSeat,
  EffectiveAuthorityReceipt,
  RootAuthorityLease,
} from "@synara/contracts";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const now = "2026-08-09T00:00:00.000Z";

const schemaLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

schemaLayer("migration 100 Supervisor-first governance", (it) => {
  it.effect("upcasts legacy seats and Root ownership without granting executable authority", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 99 });
      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
        ) VALUES ('project-1', 'project', 'Project', '/tmp/project', '[]', ${now}, ${now})
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, created_at, updated_at,
          runtime_mode, interaction_mode, env_mode
        ) VALUES ('lead-thread', 'project-1', 'Lead', ${now}, ${now}, 'full-access', 'default', 'local')
      `;
      yield* sql`
        INSERT INTO projection_supervision_active_leads (
          lead_seat_id, project_id, active_thread_id, profile_snapshot_id,
          status, archived_at, revision, updated_at, entity_json
        ) VALUES (
          'lead-seat-1', 'project-1', 'lead-thread', 'profile-snapshot-1',
          'active', NULL, 1, ${now},
          ${JSON.stringify({
            id: "lead-seat-1",
            projectId: "project-1",
            activeThreadId: "lead-thread",
            predecessorThreadIds: [],
            profileSnapshotId: "profile-snapshot-1",
            status: "active",
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
            revision: 1,
          })}
        )
      `;
      yield* sql`
        INSERT INTO projection_supervised_rooms (
          room_id, project_id, lead_seat_id, status, graph_revision,
          revision, updated_at, entity_json
        ) VALUES (
          'room-1', 'project-1', 'lead-seat-1', 'active', 0, 1, ${now},
          ${JSON.stringify({
            id: "room-1",
            projectId: "project-1",
            title: "Room",
            leadSeatId: "lead-seat-1",
            status: "active",
            graphRevision: 0,
            revision: 1,
            createdAt: now,
            updatedAt: now,
          })}
        )
      `;

      yield* runMigrations();

      const seatRows = yield* sql<{ readonly entityJson: string }>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_agent_seats
        WHERE seat_id = 'lead-seat-1'
      `;
      const receiptRows = yield* sql<{ readonly entityJson: string }>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_authority_receipts
        WHERE receipt_id = 'legacy-receipt:lead-seat-1'
      `;
      const leaseRows = yield* sql<{ readonly entityJson: string }>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_root_authority_leases
        WHERE room_id = 'room-1'
      `;

      const seat = Schema.decodeUnknownSync(AgentSeat)(JSON.parse(seatRows[0]!.entityJson));
      const receipt = Schema.decodeUnknownSync(EffectiveAuthorityReceipt)(
        JSON.parse(receiptRows[0]!.entityJson),
      );
      const lease = Schema.decodeUnknownSync(RootAuthorityLease)(JSON.parse(leaseRows[0]!.entityJson));

      assert.equal(seat.identityRole, "lead");
      assert.deepStrictEqual(seat.roomIds, ["room-1"]);
      assert.deepStrictEqual(receipt.allowedCommands, []);
      assert.deepStrictEqual(receipt.allowedTools, []);
      assert.equal(lease.holderSeatId, "lead-seat-1");
      assert.equal(lease.status, "active");

      const duplicateLease = yield* Effect.exit(sql`
        INSERT INTO projection_supervised_root_authority_leases (
          lease_id, workspace_id, room_id, holder_seat_id, status,
          authority_receipt_id, revision, updated_at, entity_json
        ) VALUES (
          'lease-duplicate', 'workspace:default', 'room-1', 'lead-seat-1', 'active',
          'legacy-receipt:lead-seat-1', 0, ${now}, '{}'
        )
      `);
      assert.equal(Exit.isFailure(duplicateLease), true);
    }),
  );
});
