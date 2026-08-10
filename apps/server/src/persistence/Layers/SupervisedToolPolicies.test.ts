import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { SupervisedToolPolicy } from "@synara/contracts";
import { Effect, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SupervisedToolPolicyRepository } from "../Services/SupervisedToolPolicies.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { SupervisedToolPolicyRepositoryLive } from "./SupervisedToolPolicies.ts";

const testLayer = it.layer(
  Layer.mergeAll(
    SupervisedToolPolicyRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

const now = "2026-08-09T09:00:00.000Z";
const audit = (policy: SupervisedToolPolicy) => ({
  action: "tool.policy.update",
  actor: { kind: "user" as const, actorId: "owner" },
  targetKind: "supervised-tool",
  targetId: policy.toolId,
  outcome: "succeeded",
  detail: { state: policy.state, revision: policy.revision },
  occurredAt: policy.updatedAt,
});

testLayer("SupervisedToolPolicyRepository", (it) => {
  it.effect("persists policy with optimistic revision enforcement", () =>
    Effect.gen(function* () {
      const repository = yield* SupervisedToolPolicyRepository;
      const sql = yield* SqlClient.SqlClient;
      const disabled: SupervisedToolPolicy = {
        toolId: "supervised.topology.read",
        state: "disabled",
        revision: 1,
        reason: "Owner paused topology reads.",
        updatedAt: now,
        revokedAt: null,
      };

      assert.deepEqual(yield* repository.list(), []);
      yield* repository.put({ policy: disabled, expectedRevision: 0, audit: audit(disabled) });
      const loaded = yield* repository.getByToolId(disabled.toolId);
      assert.ok(Option.isSome(loaded));
      assert.equal(loaded.value.state, "disabled");
      assert.equal(loaded.value.revision, 1);

      const conflict = yield* repository
        .put({
          policy: { ...disabled, revision: 2 },
          expectedRevision: 0,
          audit: audit({ ...disabled, revision: 2 }),
        })
        .pipe(Effect.flip);
      assert.match(conflict.message, /revision conflict/);

      const enabledPolicy: SupervisedToolPolicy = {
        ...disabled,
        state: "enabled",
        revision: 2,
        reason: null,
        updatedAt: "2026-08-09T09:01:00.000Z",
      };
      const enabled = yield* repository.put({
        policy: enabledPolicy,
        expectedRevision: 1,
        audit: audit(enabledPolicy),
      });
      assert.equal(enabled.state, "enabled");
      assert.equal((yield* repository.list())[0]?.revision, 2);

      const revokedPolicy: SupervisedToolPolicy = {
        ...enabledPolicy,
        state: "revoked",
        revision: 3,
        reason: "Owner permanently revoked the tool.",
        updatedAt: "2026-08-09T09:02:00.000Z",
        revokedAt: "2026-08-09T09:02:00.000Z",
      };
      yield* repository.put({
        policy: revokedPolicy,
        expectedRevision: 2,
        audit: audit(revokedPolicy),
      });
      const revokedUpdate = yield* repository
        .put({
          policy: { ...revokedPolicy, state: "enabled", revision: 4, revokedAt: null },
          expectedRevision: 3,
          audit: audit({ ...revokedPolicy, state: "enabled", revision: 4, revokedAt: null }),
        })
        .pipe(Effect.flip);
      assert.match(revokedUpdate.message, /permanently revoked/);

      const auditRows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM supervised_runtime_audit
        WHERE action = 'tool.policy.update'
      `;
      assert.equal(auditRows[0]?.count, 3);
    }),
  );

  it.effect("rolls back the policy when its required audit row cannot be written", () =>
    Effect.gen(function* () {
      const repository = yield* SupervisedToolPolicyRepository;
      const sql = yield* SqlClient.SqlClient;
      const policy: SupervisedToolPolicy = {
        toolId: "supervised.context.read" as never,
        state: "disabled",
        revision: 1,
        reason: "Atomicity test",
        updatedAt: now,
        revokedAt: null,
      };
      yield* sql`
        CREATE TRIGGER reject_tool_policy_audit
        BEFORE INSERT ON supervised_runtime_audit
        WHEN NEW.action = 'tool.policy.update'
        BEGIN
          SELECT RAISE(FAIL, 'simulated audit failure');
        END
      `;

      const result = yield* Effect.exit(
        repository.put({ policy, expectedRevision: 0, audit: audit(policy) }),
      );
      assert.equal(result._tag, "Failure");
      assert.ok(Option.isNone(yield* repository.getByToolId(policy.toolId)));
      yield* sql`DROP TRIGGER reject_tool_policy_audit`;
    }),
  );
});
