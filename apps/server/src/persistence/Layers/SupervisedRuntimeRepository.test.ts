import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";

import {
  ControlPlaneEvent,
  DerivedSignal,
  SubscriptionDefinition,
  SubscriptionDelivery,
} from "@synara/contracts";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { SupervisedRuntimeRepositoryLive } from "./SupervisedRuntimeRepository.ts";
import { SupervisedRuntimeRepository } from "../Services/SupervisedRuntimeRepository.ts";

const testLayer = it.layer(
  Layer.mergeAll(
    SupervisedRuntimeRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

const now = "2026-08-07T00:00:00.000Z";
const hash = `sha256:${"a".repeat(64)}`;
const actor = { kind: "user" as const, actorId: "owner" };

const subscription = Schema.decodeUnknownSync(SubscriptionDefinition)({
  id: "sub-review-loop",
  schemaVersion: "1.0.0",
  name: "Review loop",
  owner: actor,
  concern: "delivery",
  ownerLeadSeatId: null,
  selector: { sourceKind: "event", names: ["ReviewCompleted", "ReviewRejected"] },
  scope: [{ kind: "global" }],
  where: [],
  aggregation: { function: "count", field: null, groupBy: ["taskNodeId", "graphRevision"] },
  window: { kind: "sliding", durationMs: 3_600_000, allowedLatenessMs: 60_000, maxSamples: 10_000 },
  condition: { operator: "gt", value: 3 },
  hysteresis: { trigger: { operator: "gt", value: 3 }, reset: { operator: "lte", value: 1 } },
  debounceMs: 0,
  cooldownMs: 600_000,
  destination: { kind: "concern", concern: "delivery" },
  allowedActionRequests: ["supervised.intervention.propose"],
  cursor: { lastSequence: 0, lastEventTime: null, lastDeliveryKey: null },
  replayPolicy: "observe_only",
  state: "enabled",
  rateLimitPerMinute: 60,
  maxQueueDepth: 100,
  failurePolicy: { maxAttempts: 3, backoffMs: 1_000, deadLetterAfterAttempts: 3, critical: false },
  armed: true,
  createdBy: actor,
  updatedBy: actor,
  createdAt: now,
  updatedAt: now,
  revision: 0,
});

testLayer("SupervisedRuntimeRepository", (it) => {
  it.effect("appends facts idempotently and replays from a durable cursor", () =>
    Effect.gen(function* () {
      const repository = yield* SupervisedRuntimeRepository;
      const event = Schema.decodeUnknownSync(ControlPlaneEvent)({
        sequence: 0,
        eventId: "event-review-1",
        schemaId: "schema-review",
        schemaVersion: "1.0.0",
        type: "ReviewCompleted",
        scope: { kind: "task_node", taskNodeId: "node-1" },
        subjectId: "node-1",
        eventTime: now,
        recordedAt: now,
        revision: 2,
        causationEventId: null,
        correlationId: null,
        payload: { graphRevision: 2, reviewerSeatId: "reviewer-1" },
        provenance: { actor: { kind: "daemon", actorId: "daemon-1" }, source: "review", confidence: 1 },
      });
      const first = yield* repository.appendControlPlaneEvent(event);
      const duplicate = yield* repository.appendControlPlaneEvent(event);
      assert.equal(first, duplicate);
      const events = yield* repository.listControlPlaneEvents({ afterSequence: 0, limit: 20 });
      assert.equal(events.length, 1);
      assert.equal(events[0]?.sequence, first);
    }),
  );

  it.effect("claims one at-least-once delivery once and keeps its durable projection", () =>
    Effect.gen(function* () {
      const repository = yield* SupervisedRuntimeRepository;
      yield* repository.upsertSubscription(subscription);
      const signal = Schema.decodeUnknownSync(DerivedSignal)({
        id: "signal-review-loop",
        kind: "ReviewLoopSuspected",
        subscriptionId: subscription.id,
        scope: { kind: "task_node", taskNodeId: "node-1" },
        subjectId: "node-1",
        state: "triggered",
        measuredValue: 4,
        threshold: { operator: "gt", value: 3 },
        sourceEventIds: ["event-review-1"],
        metricSampleIds: [],
        aggregationReceiptHash: hash,
        context: { graphRevision: 2 },
        triggeredAt: now,
        resetAt: null,
        revision: 0,
      });
      yield* repository.upsertSignal(signal);
      const delivery = Schema.decodeUnknownSync(SubscriptionDelivery)({
        id: "delivery-review-loop",
        subscriptionId: subscription.id,
        signalId: signal.id,
        dedupeKey: "sub-review-loop:node-1:revision-2:crossing-1",
        status: "queued",
        attemptCount: 0,
        availableAt: now,
        deliveredAt: null,
        lastError: null,
        payloadHash: hash,
        replay: false,
        createdAt: now,
        updatedAt: now,
      });
      assert.equal(yield* repository.enqueueDelivery(delivery), true);
      assert.equal(yield* repository.enqueueDelivery(delivery), false);

      const claimed = yield* repository.claimDeliveries({
        workerId: "daemon-1",
        now,
        leaseExpiresAt: "2026-08-07T00:01:00.000Z",
        limit: 10,
      });
      assert.equal(claimed.length, 1);
      assert.equal(claimed[0]?.status, "delivering");
      const secondClaim = yield* repository.claimDeliveries({
        workerId: "daemon-2",
        now,
        leaseExpiresAt: "2026-08-07T00:01:00.000Z",
        limit: 10,
      });
      assert.equal(secondClaim.length, 0);

      const snapshot = yield* repository.getSnapshot({ includeDisabled: true });
      assert.equal(snapshot.subscriptions.length, 1);
      assert.equal(snapshot.signals.length, 1);
      assert.equal(snapshot.deliveries[0]?.status, "delivering");
    }),
  );

  it.effect("persists bounded evaluator group state across daemon restarts", () =>
    Effect.gen(function* () {
      const repository = yield* SupervisedRuntimeRepository;
      yield* repository.upsertSubscription(subscription);
      yield* repository.putSubscriptionEvaluationState(
        subscription.id,
        {
          groups: {
            '[\"taskNodeId\",\"node-1\"]': {
              samples: [],
              armed: false,
              nextEligibleAt: "2026-08-07T00:10:00.000Z",
              pendingSince: null,
              activeSignal: null,
            },
          },
        },
        now,
      );
      const reloaded = yield* repository.getSubscriptionEvaluationState(subscription.id);
      const group = reloaded.groups['[\"taskNodeId\",\"node-1\"]'];
      assert.equal(group?.armed, false);
      assert.equal(group?.nextEligibleAt, "2026-08-07T00:10:00.000Z");
    }),
  );
});
