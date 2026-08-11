import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { ControlPlaneEvent, SubscriptionDefinition } from "@veylen/contracts";

import {
  emptySubscriptionRuntimeState,
  evaluateSubscriptionEvent,
  evaluateSyntheticSubscriptionTest,
} from "./SubscriptionEvaluator.ts";

const at = (minute: number) => `2026-08-07T00:${String(minute).padStart(2, "0")}:00.000Z`;
const actor = { kind: "user" as const, actorId: "owner" };

const reviewSubscription = {
  id: "sub-review",
  schemaVersion: "1.0.0",
  name: "Review loop",
  owner: actor,
  concern: "delivery",
  ownerLeadSeatId: null,
  selector: { sourceKind: "event", names: ["ReviewCompleted", "ReviewRejected"] },
  scope: [{ kind: "global" }],
  where: [],
  aggregation: { function: "count", field: null, groupBy: ["taskNodeId", "graphRevision"] },
  window: { kind: "sliding", durationMs: 3_600_000, allowedLatenessMs: 60_000, maxSamples: 100 },
  condition: { operator: "gt", value: 3 },
  hysteresis: { trigger: { operator: "gt", value: 3 }, reset: { operator: "lte", value: 1 } },
  debounceMs: 0,
  cooldownMs: 600_000,
  destination: { kind: "concern", concern: "delivery" },
  allowedActionRequests: [],
  cursor: { lastSequence: 0, lastEventTime: null, lastDeliveryKey: null },
  replayPolicy: "observe_only",
  state: "enabled",
  rateLimitPerMinute: 100,
  maxQueueDepth: 100,
  failurePolicy: { maxAttempts: 3, backoffMs: 1_000, deadLetterAfterAttempts: 3, critical: false },
  armed: true,
  createdBy: actor,
  updatedBy: actor,
  createdAt: at(0),
  updatedAt: at(0),
  revision: 0,
} as unknown as SubscriptionDefinition;

function reviewEvent(index: number, graphRevision = 1): ControlPlaneEvent {
  return {
    sequence: index,
    eventId: `review-${graphRevision}-${index}` as never,
    schemaId: "schema-review" as never,
    schemaVersion: "1.0.0",
    type: index % 2 === 0 ? "ReviewRejected" : "ReviewCompleted",
    scope: { kind: "task_node", taskNodeId: "node-1" as never },
    subjectId: "node-1",
    eventTime: at(index),
    recordedAt: at(index),
    revision: graphRevision,
    causationEventId: null,
    correlationId: null,
    payload: {
      taskId: "task-1",
      taskNodeId: "node-1",
      graphRevision,
      reviewerSeatId: `reviewer-${index % 2}`,
      rejectionReason: index % 2 === 0 ? "Missing evidence" : null,
      evidenceRefs: [`evidence-${index}`],
      costUsd: 0.1,
    },
    provenance: { actor: { kind: "daemon", actorId: "daemon-1" }, source: "review", confidence: 1 },
  };
}

describe("SubscriptionEvaluator", () => {
  it("emits review-loop exactly once on the fourth review", () => {
    let state = emptySubscriptionRuntimeState();
    let triggers = 0;
    for (let index = 1; index <= 5; index += 1) {
      const result = evaluateSubscriptionEvent(reviewSubscription, state, reviewEvent(index));
      state = result.state;
      triggers += result.triggeredSignals.length;
      if (index === 4) {
        assert.equal(result.triggeredSignals[0]?.measuredValue, 4);
        assert.equal(result.triggeredSignals[0]?.kind, "ReviewLoopSuspected");
        assert.equal(result.triggeredSignals[0]?.context.reviewCount, 4);
      }
    }
    assert.equal(triggers, 1);
  });

  it("builds enough isolated samples for a count-rule preview without production effects", () => {
    const result = evaluateSyntheticSubscriptionTest(reviewSubscription, reviewEvent(1));
    assert.equal(result.triggeredSignals.length, 1);
    assert.equal(result.triggeredSignals[0]?.measuredValue, 4);
    assert.equal(result.triggeredSignals[0]?.context.reviewCount, 4);
  });

  it("normalizes a missing numeric metric for a safe synthetic preview", () => {
    const subscription = {
      ...reviewSubscription,
      id: "sub-context-preview",
      selector: { sourceKind: "metric", names: ["contextUsagePercent"] },
      aggregation: { function: "latest", field: "contextUsagePercent", groupBy: [] },
      condition: { operator: "gte", value: 80 },
      hysteresis: { trigger: { operator: "gte", value: 80 }, reset: { operator: "lt", value: 65 } },
      where: [{ field: "role", operator: "eq", value: "lead" }],
    } as unknown as SubscriptionDefinition;
    const event = {
      ...reviewEvent(1),
      type: "metric.sampled",
      payload: { role: null, contextUsagePercent: null },
    };
    const result = evaluateSyntheticSubscriptionTest(subscription, event);
    assert.equal(result.triggeredSignals[0]?.kind, "ContextPressureHigh");
    assert.equal(result.triggeredSignals[0]?.measuredValue, 80);
  });

  it("separates review counters by graph revision", () => {
    let state = emptySubscriptionRuntimeState();
    for (let index = 1; index <= 4; index += 1) {
      state = evaluateSubscriptionEvent(reviewSubscription, state, reviewEvent(index, 1)).state;
    }
    let newRevisionTriggers = 0;
    for (let index = 1; index <= 4; index += 1) {
      const result = evaluateSubscriptionEvent(
        reviewSubscription,
        state,
        reviewEvent(index + 10, 2),
      );
      state = result.state;
      newRevisionTriggers += result.triggeredSignals.length;
    }
    assert.equal(newRevisionTriggers, 1);
  });

  it("deduplicates at-least-once events", () => {
    const first = evaluateSubscriptionEvent(
      reviewSubscription,
      emptySubscriptionRuntimeState(),
      reviewEvent(1),
    );
    const duplicate = evaluateSubscriptionEvent(reviewSubscription, first.state, reviewEvent(1));
    assert.equal(duplicate.metricSamples.length, 0);
    assert.match(duplicate.reasons[0] ?? "", /deduplicated/);
  });

  it("bounds persisted aggregation groups and preserves groups with active signals", () => {
    const inertGroups = Object.fromEntries(
      Array.from({ length: 10_000 }, (_, index) => [
        `inert-${index}`,
        {
          samples: [],
          armed: true,
          nextEligibleAt: null,
          pendingSince: null,
          activeSignal: null,
        },
      ]),
    );
    const evicted = evaluateSubscriptionEvent(
      reviewSubscription,
      { groups: inertGroups },
      reviewEvent(1),
    );
    assert.equal(Object.keys(evicted.state.groups).length, 10_000);
    assert.equal("inert-0" in evicted.state.groups, false);

    const activeGroups = Object.fromEntries(
      Array.from({ length: 10_000 }, (_, index) => [
        `active-${index}`,
        {
          samples: [],
          armed: false,
          nextEligibleAt: null,
          pendingSince: null,
          activeSignal: {} as never,
        },
      ]),
    );
    const rejected = evaluateSubscriptionEvent(
      reviewSubscription,
      { groups: activeGroups },
      reviewEvent(1),
    );
    assert.equal(rejected.matched, false);
    assert.match(rejected.reasons[0] ?? "", /capacity is exhausted/);
    assert.equal(Object.keys(rejected.state.groups).length, 10_000);
  });

  it("uses threshold crossing, hysteresis reset, and cooldown for Lead context", () => {
    const subscription = {
      ...reviewSubscription,
      id: "sub-context",
      selector: { sourceKind: "metric", names: ["contextUsagePercent"] },
      aggregation: {
        function: "latest",
        field: "contextUsagePercent",
        groupBy: ["leadSeatId", "roomId"],
      },
      condition: { operator: "gte", value: 80 },
      hysteresis: { trigger: { operator: "gte", value: 80 }, reset: { operator: "lt", value: 65 } },
      cooldownMs: 600_000,
      where: [{ field: "role", operator: "eq", value: "lead" }],
    } as unknown as SubscriptionDefinition;
    const contextEvent = (sequence: number, value: number, minute: number): ControlPlaneEvent => ({
      sequence,
      eventId: `context-${sequence}` as never,
      schemaId: "schema-context" as never,
      schemaVersion: "1.0.0",
      type: "agent.context.measured",
      scope: { kind: "room", roomId: "room-1" as never },
      subjectId: "lead-1",
      eventTime: at(minute),
      recordedAt: at(minute),
      revision: 1,
      causationEventId: null,
      correlationId: null,
      payload: {
        metric: "contextUsagePercent",
        contextUsagePercent: value,
        role: "lead",
        leadSeatId: "lead-1",
        roomId: "room-1",
        provider: "codex",
        model: "gpt-5.6-luna",
        providerLimitTokens: 100_000,
        usedTokensEstimate: value * 1_000,
        quality: "estimated",
      },
      provenance: {
        actor: { kind: "daemon", actorId: "daemon-1" },
        source: "usage",
        confidence: 0.8,
      },
    });
    let state = emptySubscriptionRuntimeState();
    const first = evaluateSubscriptionEvent(subscription, state, contextEvent(1, 80, 0));
    state = first.state;
    assert.equal(first.triggeredSignals.length, 1);
    const noisy = evaluateSubscriptionEvent(subscription, state, contextEvent(2, 82, 1));
    state = noisy.state;
    assert.equal(noisy.triggeredSignals.length, 0);
    const reset = evaluateSubscriptionEvent(subscription, state, contextEvent(3, 64, 2));
    state = reset.state;
    assert.equal(reset.resetSignals.length, 1);
    const duringCooldown = evaluateSubscriptionEvent(subscription, state, contextEvent(4, 83, 3));
    state = duringCooldown.state;
    assert.equal(duringCooldown.triggeredSignals.length, 0);
    const rearmed = evaluateSubscriptionEvent(subscription, state, contextEvent(5, 84, 11));
    assert.equal(rearmed.triggeredSignals.length, 1);
  });
});
