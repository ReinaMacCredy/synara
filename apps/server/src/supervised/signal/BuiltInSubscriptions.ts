import {
  DEFAULT_SUPERVISED_RUN_POLICY,
  EventSchema,
  RunPolicy,
  SubscriptionDefinition,
  type SupervisedActor,
} from "@veylen/contracts";
import { Schema } from "effect";

const daemon: SupervisedActor = { kind: "daemon", actorId: "supervised-runtime" };

export function builtInRunPolicy(at: string) {
  return Schema.decodeUnknownSync(RunPolicy)({
    id: "supervised-default-v1",
    name: "Supervised default",
    ...DEFAULT_SUPERVISED_RUN_POLICY,
    maxCostUsd: null,
    allowedCapabilities: ["filesystem.read"],
    allowedPluginActions: [
      "supervised.compaction.request",
      "supervised.handoff.request",
      "supervised.intervention.propose",
    ],
    revision: 0,
    createdAt: at,
    updatedAt: at,
  });
}

export function builtInEventSchemas(at: string) {
  const make = (id: string, eventType: string, fields: Record<string, string>) =>
    Schema.decodeUnknownSync(EventSchema)({
      id,
      eventType,
      version: "1.0.0",
      compatibility: "backward",
      jsonSchema: { type: "object", fields },
      fieldClassifications: fields,
      status: "active",
      createdAt: at,
      updatedAt: at,
    });
  return [
    make("schema-review-completed-v1", "ReviewCompleted", {
      taskId: "internal",
      taskNodeId: "internal",
      graphRevision: "internal",
      roomId: "internal",
      leadSeatId: "internal",
      reviewerSeatId: "internal",
      evidenceRefs: "protected",
    }),
    make("schema-review-rejected-v1", "ReviewRejected", {
      taskId: "internal",
      taskNodeId: "internal",
      graphRevision: "internal",
      roomId: "internal",
      leadSeatId: "internal",
      reviewerSeatId: "internal",
      rejectionReason: "protected",
      evidenceRefs: "protected",
    }),
    make("schema-agent-context-measured-v1", "agent.context.measured", {
      role: "internal",
      roomId: "internal",
      leadSeatId: "internal",
      contextUsagePercent: "internal",
      usedTokensEstimate: "internal",
      providerLimitTokens: "internal",
      activeObligations: "protected",
      unsummarizedEvidenceRefs: "protected",
    }),
    make("schema-supervised-signal-derived-v1", "supervised.signal.derived", {
      signalId: "internal",
      signalKind: "internal",
      measuredValue: "internal",
      threshold: "internal",
      context: "protected",
      sourceEventIds: "protected",
    }),
    make("schema-harness-patch-evaluated-v1", "HarnessPatchEvaluated", {
      patchId: "internal",
      phase: "internal",
      passed: "internal",
      basePolicyHash: "protected",
      evidenceRefs: "protected",
      regressions: "protected",
    }),
  ];
}

export function builtInSubscriptions(at: string) {
  const shared = {
    schemaVersion: "1.0.0",
    owner: daemon,
    scope: [{ kind: "global" as const }],
    debounceMs: 0,
    replayPolicy: "observe_only" as const,
    state: "enabled" as const,
    rateLimitPerMinute: 60,
    maxQueueDepth: 1_000,
    failurePolicy: {
      maxAttempts: 3,
      backoffMs: 1_000,
      deadLetterAfterAttempts: 3,
      critical: false,
    },
    armed: true,
    createdBy: daemon,
    updatedBy: daemon,
    createdAt: at,
    updatedAt: at,
    revision: 0,
  };
  return [
    Schema.decodeUnknownSync(SubscriptionDefinition)({
      ...shared,
      id: "builtin-review-loop-v1",
      name: "Review loop suspected",
      concern: "delivery",
      ownerLeadSeatId: null,
      selector: { sourceKind: "event", names: ["ReviewCompleted", "ReviewRejected"] },
      where: [],
      aggregation: {
        function: "count",
        field: null,
        groupBy: ["taskNodeId", "graphRevision"],
      },
      window: {
        kind: "sliding",
        durationMs: 3_600_000,
        allowedLatenessMs: 60_000,
        maxSamples: 10_000,
      },
      condition: { operator: "gt", value: 3 },
      hysteresis: {
        trigger: { operator: "gt", value: 3 },
        reset: { operator: "lte", value: 1 },
      },
      cooldownMs: 600_000,
      destination: { kind: "concern", concern: "delivery" },
      allowedActionRequests: ["supervised.intervention.propose"],
      cursor: { lastSequence: 0, lastEventTime: null, lastDeliveryKey: null },
    }),
    Schema.decodeUnknownSync(SubscriptionDefinition)({
      ...shared,
      id: "builtin-lead-context-pressure-v1",
      name: "Lead context pressure",
      concern: "context",
      ownerLeadSeatId: null,
      selector: { sourceKind: "metric", names: ["contextUsagePercent"] },
      where: [{ field: "role", operator: "eq", value: "lead" }],
      aggregation: {
        function: "latest",
        field: "contextUsagePercent",
        groupBy: ["leadSeatId", "roomId"],
      },
      window: {
        kind: "sliding",
        durationMs: 300_000,
        allowedLatenessMs: 30_000,
        maxSamples: 300,
      },
      condition: { operator: "gte", value: 80 },
      hysteresis: {
        trigger: { operator: "gte", value: 80 },
        reset: { operator: "lt", value: 65 },
      },
      cooldownMs: 600_000,
      destination: { kind: "concern", concern: "context" },
      allowedActionRequests: ["supervised.compaction.request", "supervised.handoff.request"],
      cursor: { lastSequence: 0, lastEventTime: null, lastDeliveryKey: null },
    }),
  ];
}
