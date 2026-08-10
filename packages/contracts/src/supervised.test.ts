import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Schema } from "effect";

import {
  ControlPlaneEvent,
  ContextView,
  DEFAULT_SUPERVISED_RUN_POLICY,
  DispatchSupervisedCommandInput,
  EventSchema,
  HarnessPatch,
  PluginManifest,
  RlmEpisode,
  SubscriptionDefinition,
  SubscriptionDelivery,
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
  window: {
    kind: "sliding" as const,
    durationMs: 300_000,
    allowedLatenessMs: 10_000,
    maxSamples: 300,
  },
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
      provenance: {
        actor: { kind: "daemon", actorId: "daemon-1" },
        source: "provider-usage",
        confidence: 0.9,
      },
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

  it("round-trips bounded Peer work without encoding TaskNode ownership", () => {
    const requester = {
      kind: "seat" as const,
      actorId: "supervisor-thread-1",
      seatId: "supervisor-seat-1",
    };
    const assignment = Schema.decodeUnknownSync(DispatchSupervisedCommandInput)({
      command: {
        type: "supervised.work.assign",
        commandId: "command-peer-work-1",
        actor: requester,
        authorityReceiptId: "receipt-supervisor-1",
        aggregateId: "intervention-1",
        expectedRevision: 0,
        idempotencyKey: "peer-work-1",
        createdAt: now,
        roomId: "room-1",
        projectId: "project-1",
        leadSeatId: "lead-1",
        leadThreadId: "lead-thread-1",
        peerThreadId: "peer-thread-1",
        intervention: {
          id: "intervention-1",
          roomId: "room-1",
          requestedBy: requester,
          specialistThreadId: "peer-thread-1",
          reason: "Inspect the Supervisor protocol location.",
          material: false,
          evidenceRefs: [],
          status: "open",
          createdAt: now,
          updatedAt: now,
          revision: 0,
        },
        leadNotification: {
          id: "notification-1",
          interventionId: "intervention-1",
          roomId: "room-1",
          leadSeatId: "lead-1",
          status: "queued",
          createdAt: now,
          deliveredAt: null,
          acknowledgedAt: null,
        },
        reconciliation: {
          id: "reconciliation-1",
          interventionId: "intervention-1",
          roomId: "room-1",
          leadSeatId: "lead-1",
          status: "open",
          taskNodeRevisionId: null,
          reason: null,
          createdAt: now,
          resolvedAt: null,
          revision: 0,
        },
      },
    });
    assert.equal(assignment.command.type, "supervised.work.assign");
    if (assignment.command.type !== "supervised.work.assign") return;
    assert.equal(assignment.command.intervention.material, false);
    assert.equal("taskNodeId" in assignment.command, false);

    const encoded = Schema.encodeSync(DispatchSupervisedCommandInput)(assignment);
    assert.equal(encoded.command.type, "supervised.work.assign");
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

  it("decodes durable Harness Patch lifecycle and replay behavior defaults", () => {
    const patch = Schema.decodeUnknownSync(HarnessPatch)({
      id: "patch-stage-6",
      name: "Evidence first",
      patchType: "evaluation",
      scope: { kind: "project", projectId: "project-1" },
      content: "Require durable evidence before completion.",
      basePolicyHash: hash,
      status: "proposed",
      evaluationEvidenceRefs: [],
      version: 1,
      createdBy: actor,
      activatedBy: null,
      createdAt: now,
      updatedAt: now,
    });
    assert.equal(patch.revision, 0);
    assert.equal(patch.lastControlPlaneSequence, 0);
    assert.deepEqual(patch.observationEvidenceRefs, []);

    const delivery = Schema.decodeUnknownSync(SubscriptionDelivery)({
      id: "delivery-stage-6",
      subscriptionId: contextPressureSubscription.id,
      signalId: "signal-stage-6",
      dedupeKey: "stage-6",
      status: "queued",
      attemptCount: 0,
      availableAt: now,
      deliveredAt: null,
      lastError: null,
      payloadHash: hash,
      replay: true,
      createdAt: now,
      updatedAt: now,
    });
    assert.equal(delivery.replayBehavior, "observe_only");
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

  it("records scoped ContextView receipts and canonical RLM lineage", () => {
    const view = Schema.decodeUnknownSync(ContextView)({
      id: "context-view-stage-5",
      workspaceId: "context-workspace-stage-5",
      workspaceRevision: 3,
      actorSeatId: "model-session-branch-a",
      recordIds: ["context-record-a"],
      evidenceRefs: ["evidence-a"],
      activeObligationRecordIds: [],
      provider: "codex",
      model: "gpt-5.6-sol",
      estimatedTokens: 120,
      providerLimitTokens: 128_000,
      confidence: 0.9,
      createdAt: now,
    });
    const episode = Schema.decodeUnknownSync(RlmEpisode)({
      id: "rlm-episode-stage-5",
      runId: "run-stage-5",
      admission: {
        episodeId: "rlm-episode-stage-5",
        requestedMode: "recursive",
        selectedMode: "recursive",
        estimatedContextPercent: 10,
        estimatedInputTokens: 1_000,
        independentEvidenceBranches: 2,
        reasons: ["Execution mode was explicitly forced to recursive."],
        admittedByPolicyId: "policy-stage-5",
        createdAt: now,
      },
      status: "branches_running",
      rootModelSessionId: "model-session-root",
      branchModelSessionIds: ["model-session-a", "model-session-b"],
      branchCount: 2,
      completedBranchCount: 0,
      staleBranchCount: 0,
      coveragePercent: 0,
      contradictionCount: 0,
      evidenceRefs: [],
      failureSummaries: [],
      revision: 3,
      createdAt: now,
      updatedAt: now,
    });

    assert.equal(view.actorSeatId, "model-session-branch-a");
    assert.equal(episode.rootModelSessionId, "model-session-root");
    assert.deepEqual(episode.branchModelSessionIds, ["model-session-a", "model-session-b"]);
  });
});
