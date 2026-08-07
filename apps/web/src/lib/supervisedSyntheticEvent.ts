import type {
  ControlPlaneEvent,
  SubscriptionDefinition,
} from "@synara/contracts";

export function makeSupervisedSyntheticEvent(
  subscription: SubscriptionDefinition,
  source: string,
  sequence = 1,
): ControlPlaneEvent {
  const selectorNames = subscription.selector.names;
  const isContext = selectorNames.some((name) => name.toLowerCase().includes("context"));
  const isReview = selectorNames.some((name) => name.toLowerCase().includes("review"));
  const thresholdValue = Number.isFinite(subscription.condition.value)
    ? subscription.condition.value
    : 1;
  const now = new Date(Date.now() + sequence).toISOString();
  const payload: Record<string, unknown> = isContext
    ? {
        role: "lead",
        roomId: "room-preview",
        leadSeatId: "lead-preview",
        contextUsagePercent: Math.max(thresholdValue, 80),
        usedTokensEstimate: 80_000,
        providerLimitTokens: 100_000,
        provider: "preview",
        model: "preview",
        measurementSource: "synthetic-preview",
        quality: "estimated",
        confidence: 0.9,
      }
    : isReview
      ? {
          taskId: "task-preview",
          taskNodeId: "task-node-preview",
          graphRevision: 1,
          reviewerSeatId: "reviewer-preview",
          rejectionReason: "Acceptance evidence remains incomplete",
          evidenceRefs: [],
        }
      : {};

  for (const filter of subscription.where) {
    if (filter.operator === "eq" && !filter.field.includes(".")) {
      payload[filter.field] = filter.value;
    }
  }
  if (subscription.aggregation.function !== "count") {
    const metricField = subscription.aggregation.field ?? selectorNames[0];
    if (
      metricField &&
      !metricField.includes(".") &&
      typeof payload[metricField] !== "number"
    ) {
      payload[metricField] = thresholdValue;
    }
  }

  const eventType = isContext
    ? "agent.context.measured"
    : subscription.selector.sourceKind === "event"
      ? (selectorNames[0] ?? "SyntheticEvent")
      : "metric.sampled";
  return {
    sequence,
    eventId: `synthetic:${crypto.randomUUID()}` as ControlPlaneEvent["eventId"],
    schemaId: (isContext
      ? "schema-agent-context-measured-v1"
      : isReview
        ? "schema-review-completed-v1"
        : "schema-synthetic-preview-v1") as ControlPlaneEvent["schemaId"],
    schemaVersion: "1.0.0",
    type: eventType,
    scope: { kind: "global" },
    subjectId: isContext ? "lead-preview" : isReview ? "task-node-preview" : "subject-preview",
    eventTime: now,
    recordedAt: now,
    revision: 1,
    causationEventId: null,
    correlationId: null,
    payload,
    provenance: {
      actor: { kind: "daemon", actorId: "synthetic-preview" },
      source,
      confidence: 1,
    },
  };
}
