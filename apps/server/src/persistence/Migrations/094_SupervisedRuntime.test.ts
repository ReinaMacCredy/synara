import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../Layers/Sqlite.ts";

const layer = it.layer(Layer.mergeAll(SqlitePersistenceMemory));
const now = "2026-08-07T00:00:00.000Z";

layer("migration 094", (it) => {
  it.effect("creates the durable Supervised runtime schema and immutable fact log", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const tableRows = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN (
            'projection_supervised_rooms',
            'projection_supervised_tasks',
            'projection_supervised_task_nodes',
            'projection_supervised_runs',
            'projection_context_workspaces',
            'supervised_control_plane_events',
            'projection_supervised_metric_samples',
            'projection_supervised_subscriptions',
            'projection_supervised_subscription_groups',
            'projection_supervised_signals',
            'supervised_subscription_deliveries',
            'supervised_dead_letters',
            'supervised_plugin_installations',
            'supervised_event_schemas'
          )
        ORDER BY name
      `;
      assert.equal(tableRows.length, 14);

      yield* sql`
        INSERT INTO supervised_control_plane_events (
          event_id, schema_id, schema_version, event_type, scope_kind, subject_id,
          event_time, recorded_at, revision, causation_event_id, correlation_id, event_json
        ) VALUES (
          'event-1', 'schema-context', '1.0.0', 'agent.context.measured', 'room', 'lead-1',
          ${now}, ${now}, 1, NULL, NULL, '{}'
        )
      `;
      const updateExit = yield* Effect.exit(sql`
        UPDATE supervised_control_plane_events SET event_type = 'rewritten' WHERE event_id = 'event-1'
      `);
      const deleteExit = yield* Effect.exit(sql`
        DELETE FROM supervised_control_plane_events WHERE event_id = 'event-1'
      `);
      assert.equal(updateExit._tag, "Failure");
      assert.equal(deleteExit._tag, "Failure");
    }),
  );

  it.effect("enforces one delivery per dedupe key and one open signal crossing", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO projection_supervised_subscriptions (
          subscription_id, owner_lead_seat_id, concern, state, armed, replay_policy,
          next_eligible_at, last_triggered_at, last_reset_at, revision, updated_at, entity_json
        ) VALUES (
          'sub-1', NULL, 'delivery', 'enabled', 1, 'observe_only',
          NULL, NULL, NULL, 0, ${now}, '{}'
        )
      `;
      yield* sql`
        INSERT INTO projection_supervised_signals (
          signal_id, subscription_id, kind, subject_id, group_key, state, triggered_at, reset_at,
          revision, aggregation_receipt_hash, entity_json
        ) VALUES (
          'signal-1', 'sub-1', 'ReviewLoopSuspected', 'task-node-1', 'task-node-1:revision-1', 'triggered', ${now}, NULL,
          0, 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '{}'
        )
      `;
      const duplicateSignalExit = yield* Effect.exit(sql`
        INSERT INTO projection_supervised_signals (
          signal_id, subscription_id, kind, subject_id, group_key, state, triggered_at, reset_at,
          revision, aggregation_receipt_hash, entity_json
        ) VALUES (
          'signal-2', 'sub-1', 'ReviewLoopSuspected', 'task-node-1', 'task-node-1:revision-1', 'triggered', ${now}, NULL,
          0, 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '{}'
        )
      `);
      assert.equal(duplicateSignalExit._tag, "Failure");

      yield* sql`
        INSERT INTO supervised_subscription_deliveries (
          delivery_id, subscription_id, signal_id, dedupe_key, status, attempt_count,
          available_at, lease_owner, lease_expires_at, replay, updated_at, entity_json
        ) VALUES (
          'delivery-1', 'sub-1', 'signal-1', 'sub-1:signal-1', 'queued', 0,
          ${now}, NULL, NULL, 0, ${now}, '{}'
        )
      `;
      const duplicateDeliveryExit = yield* Effect.exit(sql`
        INSERT INTO supervised_subscription_deliveries (
          delivery_id, subscription_id, signal_id, dedupe_key, status, attempt_count,
          available_at, lease_owner, lease_expires_at, replay, updated_at, entity_json
        ) VALUES (
          'delivery-2', 'sub-1', 'signal-1', 'sub-1:signal-1', 'queued', 0,
          ${now}, NULL, NULL, 0, ${now}, '{}'
        )
      `);
      assert.equal(duplicateDeliveryExit._tag, "Failure");
    }),
  );

  it.effect("seeds a stopped daemon state with a nonzero epoch", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{
        readonly daemonEpoch: number;
        readonly status: string;
        readonly snapshotSequence: number;
      }>`
        SELECT daemon_epoch AS "daemonEpoch", status, snapshot_sequence AS "snapshotSequence"
        FROM supervised_runtime_state
        WHERE singleton_id = 1
      `;
      assert.equal(rows[0]?.daemonEpoch, 1);
      assert.equal(rows[0]?.status, "stopped");
      assert.equal(rows[0]?.snapshotSequence, 0);
    }),
  );
});
