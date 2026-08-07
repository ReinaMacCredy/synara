import { createHash } from "node:crypto";

import type {
  ControlPlaneEvent,
  DerivedSignal,
  MetricSample,
  SubscriptionDefinition,
  SubscriptionEvaluationGroupState,
  SubscriptionEvaluationState,
  SubscriptionEvaluationWindowSample,
  ThresholdSpec,
} from "@synara/contracts";

type WindowSample = SubscriptionEvaluationWindowSample;
export type SubscriptionGroupState = SubscriptionEvaluationGroupState;
export type SubscriptionRuntimeState = SubscriptionEvaluationState;

export interface SubscriptionEvaluationResult {
  readonly matched: boolean;
  readonly state: SubscriptionRuntimeState;
  readonly metricSamples: ReadonlyArray<MetricSample>;
  readonly triggeredSignals: ReadonlyArray<DerivedSignal>;
  readonly resetSignals: ReadonlyArray<DerivedSignal>;
  readonly reasons: ReadonlyArray<string>;
}

export const emptySubscriptionRuntimeState = (): SubscriptionRuntimeState => ({ groups: {} });

const hash = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const stableId = (prefix: string, value: unknown) =>
  `${prefix}:${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32)}`;

function fieldValue(event: ControlPlaneEvent, field: string): unknown {
  const eventRecord = event as unknown as Record<string, unknown>;
  const payload = event.payload as Record<string, unknown>;
  if (field in payload) return payload[field];
  if (field in eventRecord) return eventRecord[field];
  if (field === "scope.kind") return event.scope.kind;
  const parts = field.split(".");
  let current: unknown = field.startsWith("payload.") ? payload : eventRecord;
  for (const part of field.startsWith("payload.") ? parts.slice(1) : parts) {
    if (!current || typeof current !== "object" || !(part in current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function filterMatches(event: ControlPlaneEvent, filter: SubscriptionDefinition["where"][number]) {
  const actual = fieldValue(event, filter.field);
  switch (filter.operator) {
    case "eq":
      return actual === filter.value;
    case "neq":
      return actual !== filter.value;
    case "exists":
      return actual !== undefined && actual !== null;
    case "contains":
      return typeof actual === "string" && actual.includes(String(filter.value));
    case "in":
      return Array.isArray(filter.value) && filter.value.includes(actual);
    case "not_in":
      return Array.isArray(filter.value) && !filter.value.includes(actual);
  }
}

function scopeMatches(subscription: SubscriptionDefinition, event: ControlPlaneEvent) {
  return subscription.scope.some((scope) => {
    if (scope.kind === "global") return true;
    if (scope.kind !== event.scope.kind) return false;
    return JSON.stringify(scope) === JSON.stringify(event.scope);
  });
}

function selectorMatches(subscription: SubscriptionDefinition, event: ControlPlaneEvent) {
  if (subscription.selector.sourceKind === "event") {
    return subscription.selector.names.includes(event.type);
  }
  const metricName = String((event.payload as Record<string, unknown>).metric ?? event.type);
  return (
    subscription.selector.names.includes(metricName) ||
    subscription.selector.names.some((name) => fieldValue(event, name) !== undefined)
  );
}

function thresholdMatches(value: number, threshold: ThresholdSpec) {
  switch (threshold.operator) {
    case "gt":
      return value > threshold.value;
    case "gte":
      return value >= threshold.value;
    case "lt":
      return value < threshold.value;
    case "lte":
      return value <= threshold.value;
    case "eq":
      return value === threshold.value;
    case "neq":
      return value !== threshold.value;
  }
}

function groupKey(subscription: SubscriptionDefinition, event: ControlPlaneEvent) {
  const group = subscription.aggregation.groupBy.map((field) => [field, fieldValue(event, field)]);
  if (group.length === 0) {
    group.push(["subjectId", event.subjectId], ["revision", event.revision]);
  }
  return JSON.stringify(group);
}

function numericValue(subscription: SubscriptionDefinition, event: ControlPlaneEvent) {
  if (subscription.aggregation.function === "count") return 1;
  const candidateField = subscription.aggregation.field ?? subscription.selector.names[0];
  const value = candidateField ? fieldValue(event, candidateField) : undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function aggregate(subscription: SubscriptionDefinition, samples: ReadonlyArray<WindowSample>) {
  const values = samples.map((sample) => sample.value);
  switch (subscription.aggregation.function) {
    case "count":
      return samples.length;
    case "latest":
      return values.at(-1) ?? 0;
    case "sum":
      return values.reduce((total, value) => total + value, 0);
    case "avg":
      return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
    case "min":
      return values.length === 0 ? 0 : Math.min(...values);
    case "max":
      return values.length === 0 ? 0 : Math.max(...values);
    case "rate": {
      if (samples.length < 2) return 0;
      const elapsed = Math.max(
        1,
        Date.parse(samples.at(-1)?.eventTime ?? "") - Date.parse(samples[0]?.eventTime ?? ""),
      );
      return ((values.at(-1) ?? 0) - (values[0] ?? 0)) / (elapsed / 60_000);
    }
  }
}

function signalKind(subscription: SubscriptionDefinition): DerivedSignal["kind"] {
  const names = new Set(subscription.selector.names);
  if (names.has("ReviewCompleted") || names.has("ReviewRejected")) return "ReviewLoopSuspected";
  if (names.has("contextUsagePercent") || names.has("agent.context.measured")) return "ContextPressureHigh";
  if (names.has("noProgressDuration") || names.has("RunStalled")) return "RunProgressStalled";
  if (names.has("budgetBurnRate") || names.has("BudgetConsumed")) return "BudgetBurnAnomaly";
  if (names.has("failureRate") || names.has("RunFailed")) return "RepeatedFailureDetected";
  return "PluginDeliveryUnhealthy";
}

function reviewContext(samples: ReadonlyArray<WindowSample>) {
  const reasons = samples
    .map((sample) => fieldValue(sample.event, "rejectionReason"))
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const reasonCounts = new Map<string, number>();
  for (const reason of reasons) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  const first = samples[0];
  const last = samples.at(-1);
  return {
    taskId: fieldValue(last?.event ?? first!.event, "taskId") ?? null,
    taskNodeId: fieldValue(last?.event ?? first!.event, "taskNodeId") ?? null,
    roomId: fieldValue(last?.event ?? first!.event, "roomId") ?? null,
    leadSeatId: fieldValue(last?.event ?? first!.event, "leadSeatId") ?? null,
    graphRevision: fieldValue(last?.event ?? first!.event, "graphRevision") ?? last?.event.revision ?? null,
    reviewCount: samples.length,
    reviewerSeatIds: [...new Set(samples.map((sample) => fieldValue(sample.event, "reviewerSeatId")).filter(Boolean))],
    rejectionReasons: reasons,
    repeatedProblems: [...reasonCounts.entries()].filter(([, count]) => count > 1).map(([reason]) => reason),
    elapsedMs:
      first && last ? Math.max(0, Date.parse(last.eventTime) - Date.parse(first.eventTime)) : 0,
    costUsd: samples.reduce((total, sample) => {
      const value = fieldValue(sample.event, "costUsd");
      return total + (typeof value === "number" ? value : 0);
    }, 0),
    evidenceRefs: [
      ...new Set(
        samples.flatMap((sample) => {
          const refs = fieldValue(sample.event, "evidenceRefs");
          return Array.isArray(refs) ? refs.filter((ref): ref is string => typeof ref === "string") : [];
        }),
      ),
    ],
  };
}

function signalContext(kind: DerivedSignal["kind"], samples: ReadonlyArray<WindowSample>) {
  if (kind === "ReviewLoopSuspected") return reviewContext(samples);
  if (kind === "ContextPressureHigh") {
    const event = samples.at(-1)?.event;
    return event ? { ...(event.payload as Record<string, unknown>) } : {};
  }
  return { sampleCount: samples.length };
}

function evaluateAt(
  subscription: SubscriptionDefinition,
  prior: SubscriptionRuntimeState,
  event: ControlPlaneEvent,
): SubscriptionEvaluationResult {
  const reasons: string[] = [];
  if (subscription.state !== "enabled") {
    return { matched: false, state: prior, metricSamples: [], triggeredSignals: [], resetSignals: [], reasons: ["Subscription is not enabled."] };
  }
  if (!selectorMatches(subscription, event) || !scopeMatches(subscription, event)) {
    return { matched: false, state: prior, metricSamples: [], triggeredSignals: [], resetSignals: [], reasons: ["Selector or scope did not match."] };
  }
  if (!subscription.where.every((filter) => filterMatches(event, filter))) {
    return { matched: false, state: prior, metricSamples: [], triggeredSignals: [], resetSignals: [], reasons: ["Filter did not match."] };
  }
  const value = numericValue(subscription, event);
  if (value === null) {
    const candidateField = subscription.aggregation.field ?? subscription.selector.names[0] ?? "<none>";
    const candidate = candidateField === "<none>" ? undefined : fieldValue(event, candidateField);
    return {
      matched: false,
      state: prior,
      metricSamples: [],
      triggeredSignals: [],
      resetSignals: [],
      reasons: [
        `Selected metric ${candidateField} is not numeric (received ${candidate === null ? "null" : typeof candidate}).`,
      ],
    };
  }
  const key = groupKey(subscription, event);
  const priorGroup = prior.groups[key] ?? {
    samples: [],
    armed: true,
    nextEligibleAt: null,
    pendingSince: null,
    activeSignal: null,
  };
  if (priorGroup.samples.some((sample) => sample.eventId === event.eventId)) {
    return { matched: true, state: prior, metricSamples: [], triggeredSignals: [], resetSignals: [], reasons: ["Duplicate event was deduplicated."] };
  }
  const candidateSamples = [...priorGroup.samples, { eventId: event.eventId, sequence: event.sequence, eventTime: event.eventTime, value, event }]
    .sort((left, right) => Date.parse(left.eventTime) - Date.parse(right.eventTime) || left.sequence - right.sequence);
  const watermark = Math.max(...candidateSamples.map((sample) => Date.parse(sample.eventTime)));
  const cutoff = watermark - subscription.window.durationMs - subscription.window.allowedLatenessMs;
  const samples = candidateSamples
    .filter((sample) => Date.parse(sample.eventTime) >= cutoff)
    .slice(-subscription.window.maxSamples);
  const aggregatedValue = aggregate(subscription, samples);
  const sourceEventIds = samples.map((sample) => sample.event.eventId);
  const receiptHash = hash({ subscriptionId: subscription.id, key, sourceEventIds, aggregatedValue });
  const metricSample: MetricSample = {
    id: stableId("metric", { subscriptionId: subscription.id, key, sourceEventIds }) as MetricSample["id"],
    metric: subscription.selector.names[0] ?? event.type,
    scope: event.scope,
    subjectId: event.subjectId,
    value: aggregatedValue,
    unit: subscription.aggregation.function === "count" ? "count" : String(fieldValue(event, "unit") ?? "value"),
    eventTime: new Date(watermark).toISOString(),
    computedAt: event.recordedAt,
    sourceEventIds,
    aggregationReceiptHash: receiptHash as MetricSample["aggregationReceiptHash"],
    quality: String(fieldValue(event, "quality") ?? "exact") as MetricSample["quality"],
    confidence: typeof fieldValue(event, "confidence") === "number" ? (fieldValue(event, "confidence") as number) : event.provenance.confidence,
    source: `subscription:${subscription.id}`,
    revision: event.revision,
  };
  const nowMs = Date.parse(event.recordedAt);
  const eligible = priorGroup.nextEligibleAt === null || nowMs >= Date.parse(priorGroup.nextEligibleAt);
  const conditionTrue = thresholdMatches(aggregatedValue, subscription.hysteresis.trigger);
  const resetTrue = thresholdMatches(aggregatedValue, subscription.hysteresis.reset);
  let group: SubscriptionGroupState = { ...priorGroup, samples };
  const triggeredSignals: DerivedSignal[] = [];
  const resetSignals: DerivedSignal[] = [];
  if (!priorGroup.armed && resetTrue && priorGroup.activeSignal) {
    const resetSignal: DerivedSignal = {
      ...priorGroup.activeSignal,
      state: "reset",
      resetAt: event.recordedAt,
      revision: priorGroup.activeSignal.revision + 1,
    };
    resetSignals.push(resetSignal);
    group = { ...group, armed: true, activeSignal: null, pendingSince: null };
    reasons.push(`Measured ${aggregatedValue} satisfied reset condition.`);
  } else if (priorGroup.armed && conditionTrue && eligible) {
    const pendingSince = priorGroup.pendingSince ?? event.recordedAt;
    const debounced = nowMs - Date.parse(pendingSince) >= subscription.debounceMs;
    if (debounced) {
      const kind = signalKind(subscription);
      const signal: DerivedSignal = {
        id: stableId("signal", { subscriptionId: subscription.id, key, watermark, receiptHash }) as DerivedSignal["id"],
        kind,
        subscriptionId: subscription.id,
        scope: event.scope,
        subjectId: event.subjectId,
        state: "triggered",
        measuredValue: aggregatedValue,
        threshold: subscription.condition,
        sourceEventIds,
        metricSampleIds: [metricSample.id],
        aggregationReceiptHash: receiptHash as DerivedSignal["aggregationReceiptHash"],
        context: signalContext(kind, samples),
        triggeredAt: event.recordedAt,
        resetAt: null,
        revision: 0,
      };
      triggeredSignals.push(signal);
      group = {
        ...group,
        armed: false,
        activeSignal: signal,
        pendingSince: null,
        nextEligibleAt: new Date(nowMs + subscription.cooldownMs).toISOString(),
      };
      reasons.push(`Measured ${aggregatedValue} crossed ${subscription.condition.operator} ${subscription.condition.value}.`);
    } else {
      group = { ...group, pendingSince };
      reasons.push("Condition is waiting for debounce duration.");
    }
  } else {
    if (!conditionTrue) group = { ...group, pendingSince: null };
    reasons.push(
      !priorGroup.armed
        ? "Signal remains unarmed until the reset condition is satisfied."
        : !eligible
          ? "Subscription is in cooldown."
          : "Condition did not cross the trigger threshold.",
    );
  }
  return {
    matched: true,
    state: { groups: { ...prior.groups, [key]: group } },
    metricSamples: [metricSample],
    triggeredSignals,
    resetSignals,
    reasons,
  };
}

export function evaluateSubscriptionEvent(
  subscription: SubscriptionDefinition,
  state: SubscriptionRuntimeState,
  event: ControlPlaneEvent,
): SubscriptionEvaluationResult {
  return evaluateAt(subscription, state, event);
}

export function evaluateSyntheticSubscriptionTest(
  subscription: SubscriptionDefinition,
  event: ControlPlaneEvent,
): SubscriptionEvaluationResult {
  const payload = { ...(event.payload as Record<string, unknown>) };
  for (const filter of subscription.where) {
    if (filter.operator === "eq" && !filter.field.includes(".")) {
      payload[filter.field] = filter.value;
    }
  }
  if (subscription.aggregation.function !== "count") {
    const metricField = subscription.aggregation.field ?? subscription.selector.names[0];
    if (
      metricField &&
      !metricField.includes(".") &&
      (typeof payload[metricField] !== "number" || !Number.isFinite(payload[metricField]))
    ) {
      payload[metricField] = subscription.condition.value;
    }
  }
  const normalizedEvent = { ...event, payload };
  const requestedSamples =
    subscription.aggregation.function === "count"
      ? subscription.condition.operator === "gt"
        ? Math.floor(subscription.condition.value) + 1
        : subscription.condition.operator === "gte" || subscription.condition.operator === "eq"
          ? Math.ceil(subscription.condition.value)
          : 1
      : 1;
  const sampleCount = Math.max(1, Math.min(subscription.window.maxSamples, requestedSamples));
  const baseTime = Date.parse(normalizedEvent.eventTime);
  let state = emptySubscriptionRuntimeState();
  let result = evaluateSubscriptionEvent(subscription, state, normalizedEvent);
  const metricSamples: MetricSample[] = [];
  const triggeredSignals: DerivedSignal[] = [];
  const resetSignals: DerivedSignal[] = [];
  const reasons: string[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const eventTime = new Date(baseTime + index * Math.max(1, subscription.debounceMs)).toISOString();
    result = evaluateSubscriptionEvent(subscription, state, {
      ...normalizedEvent,
      sequence: normalizedEvent.sequence + index,
      eventId: `${normalizedEvent.eventId}:${index}` as ControlPlaneEvent["eventId"],
      eventTime,
      recordedAt: eventTime,
    });
    state = result.state;
    metricSamples.push(...result.metricSamples);
    triggeredSignals.push(...result.triggeredSignals);
    resetSignals.push(...result.resetSignals);
    reasons.push(...result.reasons);
    if (triggeredSignals.length > 0) break;
  }
  return {
    matched: result.matched,
    state,
    metricSamples,
    triggeredSignals,
    resetSignals,
    reasons,
  };
}
