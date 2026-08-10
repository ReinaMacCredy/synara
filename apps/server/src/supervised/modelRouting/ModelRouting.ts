import {
  ModelSelectionReceiptId,
  ModelTelemetryAggregateId,
  type AgentRole,
  type AgentSeatId,
  type ModelCapabilityDimension,
  type ModelCapabilityProfile,
  type ModelCapabilityProfileId,
  type ModelSelectionRankingEntry,
  type ModelSelectionReceipt,
  type ModelTelemetryAggregate,
  type RoomId,
  type RunPolicy,
  type ServerProviderStatus,
  type SynaraProviderCatalog,
  type SupervisedWorkspaceId,
  type TaskNodeId,
  type UserModelPreferenceProfile,
} from "@synara/contracts";

export const MODEL_TELEMETRY_MIN_SAMPLE_SIZE = 20;
export const MODEL_TELEMETRY_MIN_CONFIDENCE = 0.8;

const CAPABILITY_DIMENSIONS: readonly ModelCapabilityDimension[] = [
  "coding",
  "architecture",
  "debugging",
  "review",
  "uiUx",
  "visualUnderstanding",
  "longContext",
  "structuredOutput",
  "agenticEndurance",
  "multilingual",
];

export interface ModelRoutingHardRequirements {
  readonly minimumContextCapacity?: number;
  readonly requiresVision?: boolean;
  readonly requiresTools?: boolean;
  readonly requiresReasoning?: boolean;
  readonly minimumScores?: Readonly<Partial<Record<ModelCapabilityDimension, number>>>;
  readonly requiredRunCapabilities?: readonly string[];
}

export interface ModelAccessPolicy {
  readonly allowedProviders?: readonly string[];
  readonly deniedProviders?: readonly string[];
  readonly allowedModelIds?: readonly ModelCapabilityProfileId[];
  readonly deniedModelIds?: readonly ModelCapabilityProfileId[];
}

export interface ModelFallbackContext {
  readonly fromReceiptId: ModelSelectionReceiptId;
  readonly failedModelIds: readonly ModelCapabilityProfileId[];
  readonly reason: string;
}

export interface ModelRoutingRequest {
  readonly userId: string;
  readonly taskCategory: string;
  readonly agentRole: AgentRole | "reviewer" | "rlmBranch";
  readonly workspaceId: SupervisedWorkspaceId;
  readonly roomId: RoomId | null;
  readonly taskNodeId: TaskNodeId | null;
  readonly actorSeatId: AgentSeatId;
  readonly providerAvailability: Readonly<Record<string, boolean>>;
  readonly workspacePolicy?: ModelAccessPolicy;
  readonly roomPolicy?: ModelAccessPolicy;
  readonly requirements?: ModelRoutingHardRequirements;
  readonly runPolicy: RunPolicy;
  readonly currentRunCostUsd?: number;
  readonly expectedInputTokens?: number;
  readonly expectedOutputTokens?: number;
  readonly routingRevision: number;
  readonly fallback?: ModelFallbackContext;
  readonly overrideReason?: string | null;
  readonly createdAt: string;
}

export interface RejectedModelCandidate {
  readonly modelId: ModelCapabilityProfileId;
  readonly reasons: readonly string[];
}

export interface ModelRecommendation {
  readonly selectedModelId: ModelCapabilityProfileId | null;
  readonly rankedCandidates: readonly ModelSelectionRankingEntry[];
  readonly rejectedCandidates: readonly RejectedModelCandidate[];
  readonly hardConstraints: readonly string[];
  readonly capabilityProfileRevision: number;
  readonly preferenceProfileRevision: number;
  readonly runPolicyRevision: number;
  readonly routingRevision: number;
}

export interface ModelOutcomeInput {
  readonly modelProfileId: ModelCapabilityProfileId;
  readonly category: string;
  readonly succeeded: boolean;
  readonly retries: number;
  readonly latencyMs: number;
  readonly costUsd: number;
  readonly completedAt: string;
}

export const providerAvailabilityFromCatalog = (
  catalogs: readonly SynaraProviderCatalog[],
): Readonly<Record<string, boolean>> =>
  Object.fromEntries(
    catalogs.map((catalog) => [
      catalog.provider,
      catalog.enabled && catalog.available && catalog.error === undefined,
    ]),
  );

export const providerAvailabilityFromHealth = (
  statuses: readonly ServerProviderStatus[],
): Readonly<Record<string, boolean>> =>
  Object.fromEntries(
    statuses.map((status) => [
      status.provider,
      status.available && status.status === "ready" && status.authStatus !== "unauthenticated",
    ]),
  );

const categoryDimension = (category: string): ModelCapabilityDimension | null => {
  const tokens = category
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  const hasPrefix = (prefix: string) => tokens.some((token) => token.startsWith(prefix));
  if (hasPrefix("architect")) return "architecture";
  if (hasPrefix("debug")) return "debugging";
  if (hasPrefix("review")) return "review";
  if (tokens.includes("ui") || tokens.includes("ux")) return "uiUx";
  if (hasPrefix("visual") || hasPrefix("vision")) return "visualUnderstanding";
  if (tokens.includes("longcontext") || (tokens.includes("long") && tokens.includes("context"))) {
    return "longContext";
  }
  if (hasPrefix("structured")) return "structuredOutput";
  if (hasPrefix("multilingual") || hasPrefix("translation")) return "multilingual";
  if (hasPrefix("agent")) return "agenticEndurance";
  if (
    tokens.some((token) =>
      ["build", "code", "coding", "develop", "development", "implement", "implementation"].includes(
        token,
      ),
    )
  ) {
    return "coding";
  }
  return null;
};

const roundScore = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

const compareStableIds = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const estimatedCostUsd = (
  profile: ModelCapabilityProfile,
  request: ModelRoutingRequest,
): number | null => {
  if (
    request.runPolicy.maxCostUsd !== null &&
    (request.expectedInputTokens === undefined || request.expectedOutputTokens === undefined)
  ) {
    return null;
  }
  const inputTokens = request.expectedInputTokens ?? 0;
  const outputTokens = request.expectedOutputTokens ?? 0;
  if (inputTokens > 0 && profile.inputCostUsdPerMillionTokens === null) return null;
  if (outputTokens > 0 && profile.outputCostUsdPerMillionTokens === null) return null;
  return (
    (inputTokens / 1_000_000) * (profile.inputCostUsdPerMillionTokens ?? 0) +
    (outputTokens / 1_000_000) * (profile.outputCostUsdPerMillionTokens ?? 0)
  );
};

const policyReasons = (
  profile: ModelCapabilityProfile,
  policy: ModelAccessPolicy | undefined,
  scope: "workspace" | "room",
): string[] => {
  if (!policy) return [];
  const reasons: string[] = [];
  if (policy.allowedProviders?.length && !policy.allowedProviders.includes(profile.provider)) {
    reasons.push(`${scope} policy does not allow provider '${profile.provider}'.`);
  }
  if (policy.deniedProviders?.includes(profile.provider)) {
    reasons.push(`${scope} policy denies provider '${profile.provider}'.`);
  }
  if (policy.allowedModelIds?.length && !policy.allowedModelIds.includes(profile.id)) {
    reasons.push(`${scope} policy does not allow model '${profile.id}'.`);
  }
  if (policy.deniedModelIds?.includes(profile.id)) {
    reasons.push(`${scope} policy denies model '${profile.id}'.`);
  }
  return reasons;
};

const rejectReasons = (profile: ModelCapabilityProfile, request: ModelRoutingRequest): string[] => {
  const requirements = request.requirements;
  const reasons: string[] = [];
  if (!profile.available) reasons.push("Capability profile marks the model unavailable.");
  if (request.providerAvailability[profile.provider] !== true) {
    reasons.push(`Provider '${profile.provider}' is unavailable.`);
  }
  reasons.push(...policyReasons(profile, request.workspacePolicy, "workspace"));
  reasons.push(...policyReasons(profile, request.roomPolicy, "room"));
  if (request.fallback?.failedModelIds.includes(profile.id)) {
    reasons.push("Model was excluded by the current fallback attempt.");
  }
  if (
    requirements?.minimumContextCapacity &&
    profile.contextCapacity < requirements.minimumContextCapacity
  ) {
    reasons.push(
      `Context capacity ${profile.contextCapacity} is below ${requirements.minimumContextCapacity}.`,
    );
  }
  if (requirements?.requiresVision && !profile.supportsVision) reasons.push("Vision is required.");
  if (requirements?.requiresTools && !profile.supportsTools) reasons.push("Tool use is required.");
  if (requirements?.requiresReasoning && !profile.supportsReasoning) {
    reasons.push("Reasoning support is required.");
  }
  for (const [dimension, minimum] of Object.entries(requirements?.minimumScores ?? {})) {
    const score = profile.scores[dimension as ModelCapabilityDimension];
    if (minimum !== undefined && score < minimum) {
      reasons.push(`${dimension} score ${score} is below ${minimum}.`);
    }
  }
  for (const capability of requirements?.requiredRunCapabilities ?? []) {
    if (!request.runPolicy.allowedCapabilities.includes(capability)) {
      reasons.push(`RunPolicy does not allow capability '${capability}'.`);
    }
  }
  const estimatedCost = estimatedCostUsd(profile, request);
  if (request.runPolicy.maxCostUsd !== null) {
    if (estimatedCost === null) {
      reasons.push("Model cost is unknown under a bounded RunPolicy.");
    } else {
      const projectedCost = (request.currentRunCostUsd ?? 0) + estimatedCost;
      if (projectedCost >= request.runPolicy.maxCostUsd) {
        reasons.push(
          `Projected run cost ${projectedCost.toFixed(6)} reaches RunPolicy limit ${request.runPolicy.maxCostUsd.toFixed(6)}.`,
        );
      }
    }
  }
  return reasons;
};

const preferenceContribution = (
  profile: ModelCapabilityProfile,
  request: ModelRoutingRequest,
  preference: UserModelPreferenceProfile | undefined,
): { readonly score: number; readonly effects: readonly string[] } => {
  if (!preference) return { score: 0, effects: [] };
  let score = 0;
  const effects: string[] = [];
  const rating = preference.ratings[profile.id];
  if (rating !== undefined) {
    const contribution = (rating - 5) * 0.5;
    score += contribution;
    effects.push(`Personal rating ${rating}/10 contributed ${roundScore(contribution)}.`);
  }
  if (preference.preferredFor[request.taskCategory]?.includes(profile.id)) {
    score += 2;
    effects.push(`Preferred for '${request.taskCategory}' contributed 2.`);
  }
  if (preference.avoidFor[request.taskCategory]?.includes(profile.id)) {
    score -= 4;
    effects.push(`Avoid for '${request.taskCategory}' contributed -4.`);
  }
  for (const relative of preference.relativePreferences) {
    if (relative.category !== request.taskCategory) continue;
    if (relative.preferredModelId === profile.id) {
      score += 1;
      effects.push(`Relative preference over '${relative.overModelId}' contributed 1.`);
    } else if (relative.overModelId === profile.id) {
      score -= 1;
      effects.push(`Relative preference for '${relative.preferredModelId}' contributed -1.`);
    }
  }
  const defaultModelId = preference.defaultModels[request.agentRole];
  if (defaultModelId === profile.id) {
    score += 0.75;
    effects.push(`Default for '${request.agentRole}' contributed 0.75.`);
  }
  if (request.fallback) {
    const chainIndex = preference.fallbackChains[request.taskCategory]?.indexOf(profile.id) ?? -1;
    if (chainIndex >= 0) {
      const contribution = Math.max(0.25, 2 - chainIndex * 0.25);
      score += contribution;
      effects.push(`Fallback chain position ${chainIndex + 1} contributed ${contribution}.`);
    }
  }
  return { score: roundScore(score), effects };
};

const objectiveContribution = (
  profile: ModelCapabilityProfile,
  request: ModelRoutingRequest,
  preference: UserModelPreferenceProfile | undefined,
) => {
  const selectedDimension = categoryDimension(request.taskCategory);
  const rawQuality = selectedDimension
    ? profile.scores[selectedDimension]
    : CAPABILITY_DIMENSIONS.reduce((total, dimension) => total + profile.scores[dimension], 0) /
      CAPABILITY_DIMENSIONS.length;
  const quality = 5 + (rawQuality - 5) * profile.confidence;
  const reliability = Math.max(
    0,
    10 * (1 - ((profile.failureRate ?? 0) + (profile.retryRate ?? 0)) / 2),
  );
  const qualityAndReliability = (quality * 3 + reliability) / 4;
  const context = Math.min(10, (profile.contextCapacity / 200_000) * 10);
  const priorities = preference?.priorities ?? {
    quality: 10,
    speed: 5,
    cost: 5,
    contextCapacity: 5,
  };
  const weight =
    priorities.quality + priorities.speed + priorities.cost + priorities.contextCapacity || 1;
  return {
    score: roundScore(
      (qualityAndReliability * priorities.quality +
        profile.latencyScore * priorities.speed +
        profile.costScore * priorities.cost +
        context * priorities.contextCapacity) /
        weight,
    ),
    quality: roundScore(qualityAndReliability),
    speed: profile.latencyScore,
    cost: profile.costScore,
    context: roundScore(context),
  };
};

const telemetryContribution = (
  profile: ModelCapabilityProfile,
  request: ModelRoutingRequest,
  telemetry: readonly ModelTelemetryAggregate[],
): { readonly score: number; readonly applied: boolean } => {
  const aggregate = telemetry.find(
    (candidate) =>
      candidate.modelProfileId === profile.id && candidate.category === request.taskCategory,
  );
  if (
    !aggregate ||
    aggregate.sampleCount < MODEL_TELEMETRY_MIN_SAMPLE_SIZE ||
    aggregate.confidence < MODEL_TELEMETRY_MIN_CONFIDENCE
  ) {
    return { score: 0, applied: false };
  }
  const successRate = aggregate.successCount / aggregate.sampleCount;
  const retryRate = aggregate.retryCount / aggregate.sampleCount;
  return { score: roundScore((successRate * 10 - retryRate * 2 - 5) * 0.5), applied: true };
};

const hardConstraintSummary = (request: ModelRoutingRequest): string[] => {
  const requirements = request.requirements;
  const constraints = [
    "provider availability",
    "capability profile availability",
    "workspace model policy",
    "room model policy",
    `RunPolicy revision ${request.runPolicy.revision}`,
  ];
  if (requirements?.minimumContextCapacity) {
    constraints.push(`context capacity >= ${requirements.minimumContextCapacity}`);
  }
  if (requirements?.requiresVision) constraints.push("vision support");
  if (requirements?.requiresTools) constraints.push("tool support");
  if (requirements?.requiresReasoning) constraints.push("reasoning support");
  for (const [dimension, minimum] of Object.entries(requirements?.minimumScores ?? {})) {
    constraints.push(`${dimension} score >= ${minimum}`);
  }
  for (const capability of requirements?.requiredRunCapabilities ?? []) {
    constraints.push(`RunPolicy capability '${capability}'`);
  }
  if (request.runPolicy.maxCostUsd !== null) {
    constraints.push(`projected run cost < ${request.runPolicy.maxCostUsd}`);
  }
  if (request.fallback) constraints.push("failed fallback models excluded");
  return constraints;
};

export function recommendModels(
  profiles: readonly ModelCapabilityProfile[],
  preference: UserModelPreferenceProfile | undefined,
  telemetry: readonly ModelTelemetryAggregate[],
  request: ModelRoutingRequest,
): ModelRecommendation {
  if (preference && preference.userId !== request.userId) {
    throw new Error(
      `Preference profile '${preference.id}' does not belong to user '${request.userId}'.`,
    );
  }
  const rejectedCandidates: RejectedModelCandidate[] = [];
  const valid = profiles.flatMap((profile) => {
    const reasons = rejectReasons(profile, request);
    if (reasons.length > 0) {
      rejectedCandidates.push({ modelId: profile.id, reasons });
      return [];
    }
    const objective = objectiveContribution(profile, request, preference);
    const personal = preferenceContribution(profile, request, preference);
    const runtime = telemetryContribution(profile, request, telemetry);
    return [
      {
        profile,
        entry: {
          modelId: profile.id,
          rank: 1,
          totalScore: roundScore(objective.score + personal.score + runtime.score),
          objectiveScore: objective.score,
          qualityScore: objective.quality,
          speedScore: objective.speed,
          costScore: objective.cost,
          contextScore: objective.context,
          preferenceScore: personal.score,
          telemetryScore: runtime.score,
          estimatedCostUsd: (() => {
            const estimated = estimatedCostUsd(profile, request);
            return estimated === null ? null : roundScore(estimated);
          })(),
          capabilityMatches: hardConstraintSummary(request),
          preferenceEffects: personal.effects,
          telemetryApplied: runtime.applied,
        } satisfies ModelSelectionRankingEntry,
      },
    ];
  });
  valid.sort(
    (left, right) =>
      right.entry.totalScore - left.entry.totalScore ||
      compareStableIds(left.profile.id, right.profile.id),
  );
  const rankedCandidates = valid.map(({ entry }, index) => ({ ...entry, rank: index + 1 }));
  return {
    selectedModelId: rankedCandidates[0]?.modelId ?? null,
    rankedCandidates,
    rejectedCandidates: rejectedCandidates.toSorted((left, right) =>
      compareStableIds(left.modelId, right.modelId),
    ),
    hardConstraints: hardConstraintSummary(request),
    capabilityProfileRevision: profiles.reduce(
      (highestRevision, profile) => Math.max(highestRevision, profile.revision),
      0,
    ),
    preferenceProfileRevision: preference?.revision ?? 0,
    runPolicyRevision: request.runPolicy.revision,
    routingRevision: request.routingRevision,
  };
}

export function createModelSelectionReceipt(
  id: ModelSelectionReceiptId,
  recommendation: ModelRecommendation,
  request: ModelRoutingRequest,
): ModelSelectionReceipt {
  const selected = recommendation.rankedCandidates[0];
  if (!selected) throw new Error("No model satisfies the hard routing constraints.");
  const rejectedReasons = Object.fromEntries(
    recommendation.rejectedCandidates.map((candidate) => [
      candidate.modelId,
      candidate.reasons.join(" "),
    ]),
  );
  const fallbackText = request.fallback
    ? ` Fallback from '${request.fallback.fromReceiptId}' because ${request.fallback.reason}`
    : "";
  const preferenceText =
    selected.preferenceEffects.length === 0
      ? "No model-specific personal preference effect was applied."
      : selected.preferenceEffects.join(" ");
  return {
    id,
    workspaceId: request.workspaceId,
    roomId: request.roomId,
    taskNodeId: request.taskNodeId,
    actorSeatId: request.actorSeatId,
    selectedModelId: selected.modelId,
    candidateModelIds: [
      ...recommendation.rankedCandidates.map((candidate) => candidate.modelId),
      ...recommendation.rejectedCandidates.map((candidate) => candidate.modelId),
    ],
    hardConstraints: [...recommendation.hardConstraints],
    explanation:
      `Selected '${selected.modelId}' at score ${selected.totalScore}; ` +
      `objective ${selected.objectiveScore} (quality ${selected.qualityScore}, ` +
      `speed ${selected.speedScore}, cost ${selected.costScore}, context ${selected.contextScore}), ` +
      `personal ${selected.preferenceScore}, ` +
      `telemetry ${selected.telemetryScore}, estimated cost ${
        selected.estimatedCostUsd === null ? "unknown" : `$${selected.estimatedCostUsd.toFixed(6)}`
      }. ${preferenceText}` +
      fallbackText,
    rejectedReasons,
    capabilityProfileRevision: recommendation.capabilityProfileRevision,
    preferenceProfileRevision: recommendation.preferenceProfileRevision,
    runPolicyRevision: recommendation.runPolicyRevision,
    routingRevision: recommendation.routingRevision,
    rankedCandidates: [...recommendation.rankedCandidates],
    fallbackFromReceiptId: request.fallback?.fromReceiptId ?? null,
    fallbackReason: request.fallback?.reason ?? null,
    overrideReason: request.overrideReason ?? null,
    createdAt: request.createdAt,
  };
}

export function aggregateModelOutcome(
  current: ModelTelemetryAggregate | undefined,
  outcome: ModelOutcomeInput,
): ModelTelemetryAggregate {
  if (
    current &&
    (current.modelProfileId !== outcome.modelProfileId || current.category !== outcome.category)
  ) {
    throw new Error("Telemetry aggregate identity does not match the recorded outcome.");
  }
  if (outcome.retries < 0 || !Number.isInteger(outcome.retries)) {
    throw new Error("Telemetry retries must be a non-negative integer.");
  }
  if (
    !Number.isFinite(outcome.latencyMs) ||
    !Number.isFinite(outcome.costUsd) ||
    outcome.latencyMs < 0 ||
    outcome.costUsd < 0
  ) {
    throw new Error("Telemetry latency and cost must be finite and non-negative.");
  }
  const sampleCount = (current?.sampleCount ?? 0) + 1;
  return {
    id:
      current?.id ??
      ModelTelemetryAggregateId.makeUnsafe(
        `model-telemetry:${outcome.modelProfileId}:${encodeURIComponent(outcome.category)}`,
      ),
    modelProfileId: outcome.modelProfileId,
    category: outcome.category,
    sampleCount,
    successCount: (current?.successCount ?? 0) + (outcome.succeeded ? 1 : 0),
    failureCount: (current?.failureCount ?? 0) + (outcome.succeeded ? 0 : 1),
    retryCount: (current?.retryCount ?? 0) + outcome.retries,
    totalLatencyMs: (current?.totalLatencyMs ?? 0) + outcome.latencyMs,
    totalCostUsd: (current?.totalCostUsd ?? 0) + outcome.costUsd,
    confidence: Math.min(1, sampleCount / 25),
    revision: (current?.revision ?? 0) + 1,
    updatedAt: outcome.completedAt,
  };
}

export const makeModelSelectionReceiptId = (value: string) =>
  ModelSelectionReceiptId.makeUnsafe(value);
