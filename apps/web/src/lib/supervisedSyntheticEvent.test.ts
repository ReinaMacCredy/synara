import assert from "node:assert/strict";

import { Schema } from "effect";
import { describe, it } from "vitest";

import { SubscriptionDefinition } from "@synara/contracts";
import { makeSupervisedSyntheticEvent } from "./supervisedSyntheticEvent";

const actor = { kind: "daemon" as const, actorId: "test" };
const base = {
  id: "subscription-test",
  schemaVersion: "1.0.0",
  name: "test",
  owner: actor,
  concern: "context",
  ownerLeadSeatId: null,
  scope: [{ kind: "global" as const }],
  window: { kind: "sliding" as const, durationMs: 300_000, allowedLatenessMs: 0, maxSamples: 100 },
  condition: { operator: "gte" as const, value: 80 },
  hysteresis: {
    trigger: { operator: "gte" as const, value: 80 },
    reset: { operator: "lt" as const, value: 65 },
  },
  debounceMs: 0,
  cooldownMs: 600_000,
  destination: { kind: "concern" as const, concern: "context" },
  allowedActionRequests: [],
  replayPolicy: "observe_only" as const,
  state: "enabled" as const,
  rateLimitPerMinute: 60,
  maxQueueDepth: 100,
  failurePolicy: { maxAttempts: 3, backoffMs: 100, deadLetterAfterAttempts: 3, critical: false },
  cursor: { lastSequence: 0, lastEventTime: null, lastDeliveryKey: null },
  armed: true,
  createdBy: actor,
  updatedBy: actor,
  createdAt: "2026-08-07T00:00:00.000Z",
  updatedAt: "2026-08-07T00:00:00.000Z",
  revision: 0,
};

describe("makeSupervisedSyntheticEvent", () => {
  it("supplies the numeric field and equality filters required by a metric rule", () => {
    const subscription = Schema.decodeUnknownSync(SubscriptionDefinition)({
      ...base,
      selector: { sourceKind: "metric", names: ["customPressure"] },
      where: [{ field: "role", operator: "eq", value: "lead" }],
      aggregation: { function: "latest", field: "customPressure", groupBy: ["role"] },
    });
    const event = makeSupervisedSyntheticEvent(subscription, "test");
    assert.equal(event.payload.customPressure, 80);
    assert.equal(event.payload.role, "lead");
  });
});
