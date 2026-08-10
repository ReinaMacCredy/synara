import assert from "node:assert/strict";

import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../Layers/Sqlite.ts";
import migrateLeadSubscriptionOwnership from "./097_LeadSubscriptionOwnership.ts";

const layer = it.layer(Layer.mergeAll(SqlitePersistenceMemory));

layer("migration 097", (it) => {
  it.effect("folds draft-era subscription ownership and destinations into Lead semantics", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DROP TABLE projection_supervised_subscriptions`;
      yield* sql`
        CREATE TABLE projection_supervised_subscriptions (
          subscription_id TEXT PRIMARY KEY,
          supervisor_seat_id TEXT,
          concern TEXT NOT NULL,
          state TEXT NOT NULL,
          armed INTEGER NOT NULL,
          replay_policy TEXT NOT NULL,
          next_eligible_at TEXT,
          last_triggered_at TEXT,
          last_reset_at TEXT,
          revision INTEGER NOT NULL,
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json))
        )
      `;
      yield* sql`
        INSERT INTO projection_supervised_subscriptions (
          subscription_id, supervisor_seat_id, concern, state, armed, replay_policy,
          revision, updated_at, entity_json
        ) VALUES (
          'sub-legacy', 'lead-context', 'context', 'enabled', 1, 'observe_only', 0,
          '2026-08-07T00:00:00.000Z',
          ${JSON.stringify({
            id: "sub-legacy",
            supervisorSeatId: "lead-context",
            destination: { kind: "supervisor_seat", supervisorSeatId: "lead-context" },
          })}
        )
      `;

      yield* migrateLeadSubscriptionOwnership;

      const columns = yield* sql<{ readonly name: string }>`
        SELECT name FROM pragma_table_info('projection_supervised_subscriptions')
      `;
      assert.equal(
        columns.some((column) => column.name === "owner_lead_seat_id"),
        true,
      );
      assert.equal(
        columns.some((column) => column.name === "supervisor_seat_id"),
        false,
      );

      const rows = yield* sql<{ readonly entityJson: string }>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_subscriptions
        WHERE subscription_id = 'sub-legacy'
      `;
      const entity = JSON.parse(rows[0]?.entityJson ?? "{}") as Record<string, unknown>;
      assert.equal(entity.ownerLeadSeatId, "lead-context");
      assert.deepEqual(entity.destination, { kind: "lead_seat", leadSeatId: "lead-context" });
      assert.equal("supervisorSeatId" in entity, false);
    }),
  );
});
