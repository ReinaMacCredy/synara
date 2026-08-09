import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration0105 from "./105_SupervisedSignalPluginLearning.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("105_SupervisedSignalPluginLearning", (it) => {
  it.effect("normalizes legacy Harness Patch states without changing patch content", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 104 });
      const legacy = {
        id: "patch-legacy",
        name: "Legacy patch",
        patchType: "evaluation",
        scope: { kind: "project", projectId: "project-1" },
        content: "Preserve this content.",
        basePolicyHash: `sha256:${"a".repeat(64)}`,
        status: "active",
        evaluationEvidenceRefs: [],
        version: 1,
        createdBy: { kind: "user", actorId: "owner" },
        activatedBy: { kind: "user", actorId: "owner" },
        createdAt: "2026-08-09T00:00:00.000Z",
        updatedAt: "2026-08-09T00:00:00.000Z",
      };
      yield* sql`
        INSERT INTO projection_harness_patches (
          patch_id, scope_kind, scope_id, status, version, base_policy_hash, updated_at, entity_json
        ) VALUES (
          ${legacy.id}, 'project', 'project-1', 'active', 1, ${legacy.basePolicyHash},
          ${legacy.updatedAt}, ${JSON.stringify(legacy)}
        )
      `;

      yield* Migration0105;
      const rows = yield* sql<{
        readonly status: string;
        readonly entityJson: string;
      }>`
        SELECT status, entity_json AS "entityJson"
        FROM projection_harness_patches
        WHERE patch_id = ${legacy.id}
      `;
      const migrated = JSON.parse(rows[0]!.entityJson) as Record<string, unknown>;
      assert.strictEqual(rows[0]?.status, "revoked");
      assert.strictEqual(migrated.status, "revoked");
      assert.strictEqual(migrated.revision, 0);
      assert.strictEqual(migrated.content, legacy.content);

      yield* Migration0105;
      const replayed = yield* sql<{ readonly status: string }>`
        SELECT status FROM projection_harness_patches WHERE patch_id = ${legacy.id}
      `;
      assert.strictEqual(replayed[0]?.status, "revoked");
    }),
  );
});
