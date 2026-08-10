import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import {
  AgentSeatId,
  ModelCapabilityProfile,
  ModelSelectionReceiptId,
  ModelTelemetryAggregate,
  RoomId,
  SupervisedWorkspaceId,
  UserModelPreferenceProfile,
  type ModelCapabilityProfile as ModelCapabilityProfileType,
  type UserModelPreferenceProfile as UserModelPreferenceProfileType,
} from "@synara/contracts";
import { Schema } from "effect";

import { builtInRunPolicy } from "../signal/BuiltInSubscriptions.ts";
import {
  MODEL_TELEMETRY_MIN_CONFIDENCE,
  MODEL_TELEMETRY_MIN_SAMPLE_SIZE,
  aggregateModelOutcome,
  createModelSelectionReceipt,
  providerAvailabilityFromCatalog,
  providerAvailabilityFromHealth,
  recommendModels,
  type ModelRoutingRequest,
} from "./ModelRouting.ts";

const now = "2026-08-09T04:00:00.000Z";

const model = (
  id: string,
  overrides: Partial<ModelCapabilityProfileType> = {},
): ModelCapabilityProfileType =>
  Schema.decodeUnknownSync(ModelCapabilityProfile)({
    id,
    provider: "codex",
    model: id,
    version: "2026-08-09",
    available: true,
    contextCapacity: 128_000,
    supportsVision: true,
    supportsTools: true,
    supportsReasoning: true,
    latencyScore: 5,
    costScore: 5,
    inputCostUsdPerMillionTokens: 2,
    outputCostUsdPerMillionTokens: 4,
    failureRate: 0.05,
    retryRate: 0.05,
    scores: {
      coding: 8,
      architecture: 8,
      debugging: 8,
      review: 8,
      uiUx: 8,
      visualUnderstanding: 8,
      longContext: 8,
      structuredOutput: 8,
      agenticEndurance: 8,
      multilingual: 8,
    },
    provenance: ["owner-curated", "provider-metadata"],
    confidence: 0.9,
    revision: 3,
    updatedAt: now,
    ...overrides,
  });

const alpha = model("model-alpha", {
  model: "alpha",
  scores: { ...model("alpha-base").scores, coding: 9 },
});
const beta = model("model-beta", {
  model: "beta",
  contextCapacity: 200_000,
  latencyScore: 8,
  costScore: 8,
  inputCostUsdPerMillionTokens: 0.5,
  outputCostUsdPerMillionTokens: 1,
});
const invalid = model("model-invalid", {
  model: "invalid",
  supportsTools: false,
  scores: { ...model("invalid-base").scores, coding: 10 },
});

const sol = model("model-sol", {
  provider: "codex",
  model: "gpt-5.6-sol",
});
const fable = model("model-fable", {
  provider: "claudeAgent",
  model: "claude-fable-5",
});

const preference = (
  id: string,
  userId: string,
  preferredModelId: ModelCapabilityProfileType["id"],
  otherModelId: ModelCapabilityProfileType["id"],
): UserModelPreferenceProfileType =>
  Schema.decodeUnknownSync(UserModelPreferenceProfile)({
    id,
    userId,
    revision: 4,
    ratings: { [preferredModelId]: 10, [otherModelId]: 0, [invalid.id]: 10 },
    relativePreferences: [
      {
        preferredModelId,
        overModelId: otherModelId,
        category: "implementation",
        reason: "Personal fit for implementation.",
      },
    ],
    preferredFor: { implementation: [preferredModelId] },
    avoidFor: { implementation: [otherModelId] },
    priorities: { quality: 10, speed: 5, cost: 5, contextCapacity: 5 },
    defaultModels: { peer: preferredModelId },
    fallbackChains: { implementation: [otherModelId, preferredModelId] },
    updatedAt: now,
  });

const request = (userId: string): ModelRoutingRequest => ({
  userId,
  taskCategory: "implementation",
  agentRole: "peer",
  workspaceId: SupervisedWorkspaceId.makeUnsafe("workspace-1"),
  roomId: RoomId.makeUnsafe("room-1"),
  taskNodeId: null,
  actorSeatId: AgentSeatId.makeUnsafe("seat-1"),
  providerAvailability: { codex: true },
  workspacePolicy: { allowedProviders: ["codex"] },
  roomPolicy: { allowedModelIds: [alpha.id, beta.id, invalid.id] },
  requirements: { requiresTools: true, minimumScores: { coding: 7 } },
  runPolicy: builtInRunPolicy(now),
  expectedInputTokens: 1_000,
  expectedOutputTokens: 1_000,
  routingRevision: 7,
  createdAt: now,
});

describe("Supervisor-first model routing", () => {
  it("ranks Sol over Fable for User A and Fable over Sol for User B", () => {
    const scenarioRequest = (userId: string): ModelRoutingRequest => ({
      ...request(userId),
      providerAvailability: { codex: true, claudeAgent: true },
      workspacePolicy: { allowedProviders: ["codex", "claudeAgent"] },
      roomPolicy: { allowedModelIds: [sol.id, fable.id] },
    });

    const userA = recommendModels(
      [sol, fable],
      preference("preference-user-a", "user-a", sol.id, fable.id),
      [],
      scenarioRequest("user-a"),
    );
    const userB = recommendModels(
      [sol, fable],
      preference("preference-user-b", "user-b", fable.id, sol.id),
      [],
      scenarioRequest("user-b"),
    );

    assert.deepEqual(
      userA.rankedCandidates.map((candidate) => candidate.modelId),
      [sol.id, fable.id],
    );
    assert.deepEqual(
      userB.rankedCandidates.map((candidate) => candidate.modelId),
      [fable.id, sol.id],
    );
  });

  it("gives two users different valid rankings without bypassing hard constraints", () => {
    const first = recommendModels(
      [alpha, beta, invalid],
      preference("preference-a", "user-a", alpha.id, beta.id),
      [],
      request("user-a"),
    );
    const second = recommendModels(
      [alpha, beta, invalid],
      preference("preference-b", "user-b", beta.id, alpha.id),
      [],
      request("user-b"),
    );

    assert.equal(first.selectedModelId, alpha.id);
    assert.equal(second.selectedModelId, beta.id);
    assert.deepEqual(
      first.rankedCandidates.map((candidate) => candidate.modelId),
      [alpha.id, beta.id],
    );
    assert.deepEqual(
      second.rankedCandidates.map((candidate) => candidate.modelId),
      [beta.id, alpha.id],
    );
    assert.match(
      first.rejectedCandidates.find((candidate) => candidate.modelId === invalid.id)!.reasons[0]!,
      /Tool use is required/,
    );
    assert.throws(() =>
      recommendModels(
        [alpha, beta],
        preference("preference-a", "user-a", alpha.id, beta.id),
        [],
        request("user-b"),
      ),
    );
  });

  it("derives hard provider availability from the live provider catalog", () => {
    const availability = providerAvailabilityFromCatalog([
      {
        provider: "codex",
        defaultModel: "alpha",
        models: [],
        enabled: true,
        available: true,
      },
      {
        provider: "claudeAgent",
        defaultModel: null,
        models: [],
        enabled: false,
        available: true,
      },
    ]);

    assert.deepEqual(availability, { codex: true, claudeAgent: false });
  });

  it("fails provider availability closed from live health", () => {
    const availability = providerAvailabilityFromHealth([
      {
        provider: "codex",
        status: "ready",
        available: true,
        authStatus: "authenticated",
        checkedAt: now,
      },
      {
        provider: "claudeAgent",
        status: "error",
        available: true,
        authStatus: "unauthenticated",
        checkedAt: now,
      },
    ]);

    assert.deepEqual(availability, { codex: true, claudeAgent: false });
    assert.equal("cursor" in availability, false);
  });

  it("keeps RunPolicy cost limits ahead of a user's model preference", () => {
    const constrained = {
      ...request("user-a"),
      runPolicy: { ...builtInRunPolicy(now), maxCostUsd: 0.002 },
    };
    const recommendation = recommendModels(
      [alpha, beta],
      preference("preference-a", "user-a", alpha.id, beta.id),
      [],
      constrained,
    );

    assert.equal(recommendation.selectedModelId, beta.id);
    assert.match(
      recommendation.rejectedCandidates.find((candidate) => candidate.modelId === alpha.id)!
        .reasons[0]!,
      /RunPolicy limit/,
    );

    const unknownCost = model("model-unknown-cost", {
      inputCostUsdPerMillionTokens: null,
      outputCostUsdPerMillionTokens: null,
    });
    const failClosed = recommendModels([unknownCost], undefined, [], {
      ...constrained,
      roomPolicy: { allowedModelIds: [unknownCost.id] },
    });
    assert.equal(failClosed.selectedModelId, null);
    assert.match(failClosed.rejectedCandidates[0]!.reasons[0]!, /cost is unknown/);

    const {
      expectedInputTokens: _expectedInputTokens,
      expectedOutputTokens: _expectedOutputTokens,
      ...withoutEstimates
    } = constrained;
    const missingEstimate = recommendModels([alpha], undefined, [], {
      ...withoutEstimates,
      roomPolicy: { allowedModelIds: [alpha.id] },
    });
    assert.equal(missingEstimate.selectedModelId, null);
    assert.match(missingEstimate.rejectedCandidates[0]!.reasons[0]!, /cost is unknown/);
  });

  it("classifies build work as coding and breaks ties by locale-independent id order", () => {
    const coding = model("model-Z-coding", {
      scores: { ...alpha.scores, coding: 10, uiUx: 0 },
    });
    const ui = model("model-a-ui", {
      scores: { ...alpha.scores, coding: 0, uiUx: 10 },
    });
    const buildRequest = {
      ...request("user-a"),
      taskCategory: "build",
      roomPolicy: { allowedModelIds: [coding.id, ui.id] },
    };

    assert.equal(
      recommendModels([ui, coding], undefined, [], buildRequest).selectedModelId,
      coding.id,
    );

    const tiedUpper = model("model-Z");
    const tiedLower = model("model-a");
    const tieRequest = {
      ...request("user-a"),
      roomPolicy: { allowedModelIds: [tiedLower.id, tiedUpper.id] },
    };
    assert.deepStrictEqual(
      recommendModels([tiedLower, tiedUpper], undefined, [], tieRequest).rankedCandidates.map(
        (candidate) => candidate.modelId,
      ),
      [tiedUpper.id, tiedLower.id],
    );
  });

  it("uses telemetry only after both sample-size and confidence gates", () => {
    const lowSample = Schema.decodeUnknownSync(ModelTelemetryAggregate)({
      id: "telemetry-alpha",
      modelProfileId: alpha.id,
      category: "implementation",
      sampleCount: MODEL_TELEMETRY_MIN_SAMPLE_SIZE - 1,
      successCount: 0,
      failureCount: MODEL_TELEMETRY_MIN_SAMPLE_SIZE - 1,
      retryCount: 0,
      totalLatencyMs: 10,
      totalCostUsd: 0,
      confidence: 1,
      revision: 19,
      updatedAt: now,
    });
    const lowConfidence = { ...lowSample, sampleCount: 20, confidence: 0.79 };
    const eligible = {
      ...lowSample,
      sampleCount: MODEL_TELEMETRY_MIN_SAMPLE_SIZE,
      failureCount: MODEL_TELEMETRY_MIN_SAMPLE_SIZE,
      confidence: MODEL_TELEMETRY_MIN_CONFIDENCE,
    };

    const withoutEvidence = recommendModels([alpha], undefined, [lowSample], request("user-a"));
    const withoutConfidence = recommendModels(
      [alpha],
      undefined,
      [lowConfidence],
      request("user-a"),
    );
    const withEvidence = recommendModels([alpha], undefined, [eligible], request("user-a"));

    assert.equal(withoutEvidence.rankedCandidates[0]!.telemetryApplied, false);
    assert.equal(withoutConfidence.rankedCandidates[0]!.telemetryApplied, false);
    assert.equal(withEvidence.rankedCandidates[0]!.telemetryApplied, true);
    assert.equal(withoutEvidence.rankedCandidates[0]!.telemetryScore, 0);
    assert.ok(withEvidence.rankedCandidates[0]!.telemetryScore < 0);
  });

  it("records an explainable fallback lineage without relaxing constraints", () => {
    const original = recommendModels(
      [alpha, beta],
      preference("preference-a", "user-a", alpha.id, beta.id),
      [],
      request("user-a"),
    );
    const previousReceiptId = ModelSelectionReceiptId.makeUnsafe("selection-original");
    const fallbackRequest: ModelRoutingRequest = {
      ...request("user-a"),
      fallback: {
        fromReceiptId: previousReceiptId,
        failedModelIds: [original.selectedModelId!],
        reason: "The provider returned a retryable capacity error.",
      },
    };
    const fallback = recommendModels(
      [alpha, beta, invalid],
      preference("preference-a", "user-a", alpha.id, beta.id),
      [],
      fallbackRequest,
    );
    const receipt = createModelSelectionReceipt(
      ModelSelectionReceiptId.makeUnsafe("selection-fallback"),
      fallback,
      fallbackRequest,
    );

    assert.equal(receipt.selectedModelId, beta.id);
    assert.equal(receipt.fallbackFromReceiptId, previousReceiptId);
    assert.match(receipt.fallbackReason!, /capacity error/);
    assert.match(receipt.rejectedReasons[alpha.id]!, /fallback attempt/);
    assert.deepEqual(receipt.candidateModelIds, [beta.id, alpha.id, invalid.id]);
    assert.match(receipt.explanation, /Personal rating|Preferred for|Relative preference/);
    assert.ok((receipt.rankedCandidates?.[0]?.preferenceEffects.length ?? 0) > 0);
  });

  it("builds confidence from durable outcome sample counts", () => {
    let aggregate;
    for (let index = 0; index < MODEL_TELEMETRY_MIN_SAMPLE_SIZE; index += 1) {
      aggregate = aggregateModelOutcome(aggregate, {
        modelProfileId: alpha.id,
        category: "implementation",
        succeeded: index > 0,
        retries: index === 0 ? 1 : 0,
        latencyMs: 100,
        costUsd: 0.001,
        completedAt: now,
      });
    }

    assert.equal(aggregate!.sampleCount, MODEL_TELEMETRY_MIN_SAMPLE_SIZE);
    assert.equal(aggregate!.successCount, MODEL_TELEMETRY_MIN_SAMPLE_SIZE - 1);
    assert.equal(aggregate!.failureCount, 1);
    assert.equal(aggregate!.retryCount, 1);
    assert.equal(aggregate!.confidence, MODEL_TELEMETRY_MIN_CONFIDENCE);

    assert.throws(() =>
      aggregateModelOutcome(undefined, {
        modelProfileId: alpha.id,
        category: "implementation",
        succeeded: true,
        retries: 0,
        latencyMs: Number.NaN,
        costUsd: 0,
        completedAt: now,
      }),
    );
    assert.throws(() =>
      aggregateModelOutcome(undefined, {
        modelProfileId: alpha.id,
        category: "implementation",
        succeeded: true,
        retries: 0,
        latencyMs: 1,
        costUsd: Number.POSITIVE_INFINITY,
        completedAt: now,
      }),
    );
  });
});
