import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Schema } from "effect";

import {
  ControlPlaneEvent,
  DEFAULT_SUPERVISED_RUN_POLICY,
  DispatchSupervisedCommandInput,
  EventSchema,
  PluginManifest,
  SubscriptionDefinition,
  TestSubscriptionResult,
} from "./supervised";

const now = "2026-08-07T00:00:00.000Z";
const hash = `sha256:${"a".repeat(64)}`;
const actor = { kind: "user" as const, actorId: "owner" };

const contextPressureSubscription = {
  id: "sub-lead-context",
  schemaVersion: "1.0.0",
  name: "Lead context pressure",
  owner: actor,
  concern: "context",
  ownerLeadSeatId: "lead-context",
  selector: { sourceKind: "metric" as const, names: ["contextUsagePercent"] },
  scope: [{ kind: "room" as const, roomId: "room-1" }],
  where: [
    { field: "role", operator: "eq" as const, value: "lead" },
    { field: "roomId", operator: "eq" as const, value: "room-1" },
  ],
  aggregation: { function: "latest" as const, field: "value", groupBy: ["leadSeatId"] },
  window: { kind: "sliding" as const, durationMs: 300_000, allowedLatenessMs: 10_000, maxSamples: 300 },
  condition: { operator: "gte" as const, value: 80 },
  hysteresis: {
    trigger: { operator: "gte" as const, value: 80 },
    reset: { operator: "lt" as const, value: 65 },
  },
  debounceMs: 0,
  cooldownMs: 600_000,
  destination: { kind: "concern" as const, concern: "context" },
  allowedActionRequests: ["supervised.compaction.request", "supervised.handoff.request"],
  cursor: { lastSequence: 0, lastEventTime: null, lastDeliveryKey: null },
  replayPolicy: "observe_only" as const,
  state: "enabled" as const,
  rateLimitPerMinute: 60,
  maxQueueDepth: 100,
  failurePolicy: { maxAttempts: 3, backoffMs: 1_000, deadLetterAfterAttempts: 3, critical: false },
  armed: true,
  createdBy: actor,
  updatedBy: actor,
  createdAt: now,
  updatedAt: now,
  revision: 0,
};

describe("Supervised contracts", () => {
  it("decodes the normative Lead context-pressure subscription", () => {
    const value = Schema.decodeUnknownSync(SubscriptionDefinition)(contextPressureSubscription);
    assert.equal(value.hysteresis.trigger.value, 80);
    assert.equal(value.hysteresis.reset.value, 65);
    assert.equal(value.cooldownMs, 600_000);
    assert.equal(value.replayPolicy, "observe_only");
  });

  it("rejects an unbounded or empty subscription selector", () => {
    assert.throws(() =>
      Schema.decodeUnknownSync(SubscriptionDefinition)({
        ...contextPressureSubscription,
        selector: { sourceKind: "metric", names: [] },
      }),
    );
  });

  it("keeps raw control-plane telemetry separate from commands", () => {
    const event = Schema.decodeUnknownSync(ControlPlaneEvent)({
      sequence: 21,
      eventId: "event-context-21",
      schemaId: "schema-agent-context",
      schemaVersion: "1.0.0",
      type: "agent.context.measured",
      scope: { kind: "room", roomId: "room-1" },
      subjectId: "lead-1",
      eventTime: now,
      recordedAt: now,
      revision: 4,
      causationEventId: null,
      correlationId: null,
      payload: { role: "lead", contextUsagePercent: 82 },
      provenance: { actor: { kind: "daemon", actorId: "daemon-1" }, source: "provider-usage", confidence: 0.9 },
    });
    assert.equal(event.type, "agent.context.measured");
    assert.equal("commandId" in event, false);
  });

  it("preserves nested JSON schema values across the RPC codec boundary", () => {
    const eventSchema = Schema.decodeUnknownSync(EventSchema)({
      id: "schema-review-completed-v1",
      eventType: "ReviewCompleted",
      version: "1.0.0",
      compatibility: "backward",
      jsonSchema: { type: "object", fields: { taskId: "internal" } },
      fieldClassifications: { taskId: "internal" },
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    const encoded = Schema.encodeSync(EventSchema)(eventSchema);
    assert.deepEqual(encoded.jsonSchema, {
      type: "object",
      fields: { taskId: "internal" },
    });
  });

  it("requires expected revision and idempotency for every typed action", () => {
    const command = Schema.decodeUnknownSync(DispatchSupervisedCommandInput)({
      command: {
        type: "supervised.compaction.request",
        commandId: "command-compact",
        actor: { kind: "seat", actorId: "lead-context", seatId: "lead-context" },
        aggregateId: "room-1",
        expectedRevision: 7,
        idempotencyKey: "compact-room-1-revision-7",
        runPolicyId: "policy-default",
        createdAt: now,
        leadSeatId: "lead-1",
        roomId: "room-1",
        reason: "Context crossed 80 percent",
      },
    });
    assert.equal(command.command.expectedRevision, 7);
    assert.throws(() =>
      Schema.decodeUnknownSync(DispatchSupervisedCommandInput)({
        command: { ...command.command, idempotencyKey: undefined },
      }),
    );
  });

  it("decodes a declarative-only plugin without executable authority", () => {
    const manifest = Schema.decodeUnknownSync(PluginManifest)({
      pluginId: "plugin-context-basics",
      name: "Context basics",
      version: "1.0.0",
      manifestVersion: "1",
      description: "Built-in context observations",
      handler: null,
      eventSchemas: [],
      subscriptions: [contextPressureSubscription],
      requestedCapabilities: ["event.read", "signal.propose"],
      requestedPayloadFields: ["role", "roomId", "contextUsagePercent"],
      resourceLimits: {
        maxRuntimeMs: 1_000,
        maxMemoryMiB: 64,
        maxOutputBytes: 65_536,
        maxConcurrentHandlers: 1,
        maxQueueDepth: 100,
      },
      provenance: { source: "builtin", contentHash: hash, signature: null },
    });
    assert.equal(manifest.handler, null);
    assert.equal(manifest.subscriptions.length, 1);
  });

  it("locks synthetic subscription testing to no production action", () => {
    assert.throws(() =>
      Schema.decodeUnknownSync(TestSubscriptionResult)({
        matched: true,
        wouldTrigger: true,
        reasons: ["82 >= 80"],
        hypotheticalSignal: null,
        productionActionExecuted: true,
      }),
    );
  });

  it("ships finite conservative runtime defaults", () => {
    assert.equal(DEFAULT_SUPERVISED_RUN_POLICY.maxRecursiveCalls, 8);
    assert.equal(DEFAULT_SUPERVISED_RUN_POLICY.maxFanOut, 4);
    assert.equal(DEFAULT_SUPERVISED_RUN_POLICY.replayBehavior, "observe_only");
  });
});
