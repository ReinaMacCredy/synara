import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { SupervisedToolPolicy } from "@synara/contracts";
import { Effect, Layer, Option } from "effect";

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

testLayer("SupervisedToolPolicyRepository", (it) => {
  it.effect("persists policy with optimistic revision enforcement", () =>
    Effect.gen(function* () {
      const repository = yield* SupervisedToolPolicyRepository;
      const disabled: SupervisedToolPolicy = {
        toolId: "supervised.topology.read",
        state: "disabled",
        revision: 1,
        reason: "Owner paused topology reads.",
        updatedAt: now,
        revokedAt: null,
      };

      assert.deepEqual(yield* repository.list(), []);
      yield* repository.put({ policy: disabled, expectedRevision: 0 });
      const loaded = yield* repository.getByToolId(disabled.toolId);
      assert.ok(Option.isSome(loaded));
      assert.equal(loaded.value.state, "disabled");
      assert.equal(loaded.value.revision, 1);

      const conflict = yield* repository
        .put({ policy: { ...disabled, revision: 2 }, expectedRevision: 0 })
        .pipe(Effect.flip);
      assert.match(conflict.message, /revision conflict/);

      const enabled = yield* repository.put({
        policy: {
          ...disabled,
          state: "enabled",
          revision: 2,
          reason: null,
          updatedAt: "2026-08-09T09:01:00.000Z",
        },
        expectedRevision: 1,
      });
      assert.equal(enabled.state, "enabled");
      assert.equal((yield* repository.list())[0]?.revision, 2);
    }),
  );
});
