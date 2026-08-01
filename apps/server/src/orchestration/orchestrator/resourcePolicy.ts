export const ORCHESTRATOR_RESOURCE_POLICY_V1 = {
  version: 1,
  maxActiveSessions: 16,
  maxActiveTurns: 8,
  maxActiveWriters: 4,
  maxMailboxDepthPerThread: 256,
  maxMessagesPerCorrelation: 64,
  maxMessageBytes: 65_536,
  maxDeliveryAttempts: 5,
  maxHopCount: 32,
  maxActiveMonitorsPerRoot: 128,
  maxArtifactBytes: 65_536,
  maxCouncilParticipants: 16,
  maxCouncilDisagreementRounds: 1,
  maxChildReadItems: 200,
} as const;

export const ORCHESTRATOR_MONITOR_POLICY_V1 = {
  minCadenceMs: 1_000,
  maxCadenceMs: 86_400_000,
  maxRunsPerMonitor: 128,
  reconcileIntervalMs: 500,
} as const;

export type OrchestratorResourceCeiling = keyof Omit<
  typeof ORCHESTRATOR_RESOURCE_POLICY_V1,
  "version"
>;

export interface ResourceUsageInput {
  readonly activeSessions?: number;
  readonly activeTurns?: number;
  readonly activeWriters?: number;
  readonly mailboxDepthForThread?: number;
  readonly messagesForCorrelation?: number;
  readonly messageBytes?: number;
  readonly deliveryAttempts?: number;
  readonly hopCount?: number;
  readonly activeMonitorsForRoot?: number;
  readonly artifactBytes?: number;
  readonly councilParticipants?: number;
  readonly councilDisagreementRounds?: number;
  readonly childReadItems?: number;
}

const USAGE_TO_CEILING = {
  activeSessions: "maxActiveSessions",
  activeTurns: "maxActiveTurns",
  activeWriters: "maxActiveWriters",
  mailboxDepthForThread: "maxMailboxDepthPerThread",
  messagesForCorrelation: "maxMessagesPerCorrelation",
  messageBytes: "maxMessageBytes",
  deliveryAttempts: "maxDeliveryAttempts",
  hopCount: "maxHopCount",
  activeMonitorsForRoot: "maxActiveMonitorsPerRoot",
  artifactBytes: "maxArtifactBytes",
  councilParticipants: "maxCouncilParticipants",
  councilDisagreementRounds: "maxCouncilDisagreementRounds",
  childReadItems: "maxChildReadItems",
} as const;

export interface ResourceCeilingViolation {
  readonly ceiling: OrchestratorResourceCeiling;
  readonly observed: number;
  readonly limit: number;
}

export const resourceCeilingViolations = (
  usage: ResourceUsageInput,
): ReadonlyArray<ResourceCeilingViolation> =>
  Object.entries(USAGE_TO_CEILING).flatMap(([usageField, ceiling]) => {
    const observed = usage[usageField as keyof ResourceUsageInput];
    const limit = ORCHESTRATOR_RESOURCE_POLICY_V1[ceiling];
    return observed !== undefined && observed > limit ? [{ ceiling, observed, limit }] : [];
  });

export type CacheTelemetryFact =
  | { readonly state: "unknown"; readonly reason: string; readonly observedAt: string }
  | {
      readonly state: "reusable" | "expiring" | "expired";
      readonly observedAt: string;
      readonly expiresAt: string;
      readonly ttlSeconds: number;
    };

export const cacheTelemetryFact = (input: {
  readonly observedAt: string;
  readonly now: string;
  readonly ttlSeconds: number | null;
  readonly expiringWithinSeconds?: number;
}): CacheTelemetryFact => {
  if (input.ttlSeconds === null || !Number.isFinite(input.ttlSeconds) || input.ttlSeconds <= 0) {
    return {
      state: "unknown",
      reason: "Provider did not expose a positive cache TTL.",
      observedAt: input.observedAt,
    };
  }
  const expiresAtMs = Date.parse(input.observedAt) + input.ttlSeconds * 1_000;
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs)) {
    return {
      state: "unknown",
      reason: "Cache timestamps are invalid.",
      observedAt: input.observedAt,
    };
  }
  const expiresAt = new Date(expiresAtMs).toISOString();
  if (nowMs >= expiresAtMs) {
    return {
      state: "expired",
      observedAt: input.observedAt,
      expiresAt,
      ttlSeconds: input.ttlSeconds,
    };
  }
  const expiringWithinMs = (input.expiringWithinSeconds ?? 120) * 1_000;
  return {
    state: expiresAtMs - nowMs <= expiringWithinMs ? "expiring" : "reusable",
    observedAt: input.observedAt,
    expiresAt,
    ttlSeconds: input.ttlSeconds,
  };
};
