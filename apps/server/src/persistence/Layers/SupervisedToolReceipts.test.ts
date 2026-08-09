import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  AgentSeatId,
  EffectiveAuthorityReceiptId,
  SupervisedToolInvocationReceiptId,
  type SupervisedToolInvocationReceipt,
} from "@synara/contracts";
import { Effect, Layer, Option } from "effect";

import { SupervisedToolReceiptRepository } from "../Services/SupervisedToolReceipts.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { SupervisedToolReceiptRepositoryLive } from "./SupervisedToolReceipts.ts";

const testLayer = it.layer(
  Layer.mergeAll(
    SupervisedToolReceiptRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

const requestedAt = "2026-08-09T00:00:00.000Z";

testLayer("SupervisedToolReceiptRepository", (it) => {
  it.effect("persists the requested-to-projected audit lifecycle", () =>
    Effect.gen(function* () {
      const repository = yield* SupervisedToolReceiptRepository;
      const receipt: SupervisedToolInvocationReceipt = {
        id: SupervisedToolInvocationReceiptId.makeUnsafe("tool-receipt-1"),
        toolId: "supervised.topology.read",
        providerToolName: "read_supervision_state",
        schemaVersion: "1.0.0",
        actorSeatId: AgentSeatId.makeUnsafe("retired-seat-1"),
        authorityReceiptId: EffectiveAuthorityReceiptId.makeUnsafe("retired-authority-1"),
        workspaceId: null,
        roomId: null,
        callerThreadId: "thread-1",
        callerTurnId: "turn-1",
        state: "requested",
        requestedAt,
        completedAt: null,
        errorCode: null,
        errorMessage: null,
      };

      yield* repository.insert(receipt);
      const completed = yield* repository.complete({
        id: receipt.id,
        state: "projected",
        completedAt: "2026-08-09T00:00:01.000Z",
        errorCode: null,
        errorMessage: null,
      });
      const loaded = yield* repository.getById(receipt.id);
      const recent = yield* repository.listRecent(10);

      assert.equal(completed.state, "projected");
      assert.ok(Option.isSome(loaded));
      assert.equal(loaded.value.state, "projected");
      assert.equal(loaded.value.actorSeatId, "retired-seat-1");
      assert.equal(loaded.value.authorityReceiptId, "retired-authority-1");
      assert.equal(recent.length, 1);
      assert.equal(recent[0]?.id, receipt.id);
    }),
  );
});
