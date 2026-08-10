import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ModelCapabilityProfile, type ModelCapabilityProfile as Profile } from "@veylen/contracts";
import { Schema } from "effect";

import {
  ModelCapabilityProvisioningError,
  prepareOwnerCuratedModelCapabilityProfile,
} from "./ModelCapabilityProvisioning.ts";

const now = "2026-08-10T05:00:00.000Z";

const profile = (overrides: Partial<Profile> = {}): Profile =>
  Schema.decodeUnknownSync(ModelCapabilityProfile)({
    id: "model-sol",
    provider: "codex",
    model: "gpt-5.6-sol",
    version: "owner-profile-v1",
    available: true,
    contextCapacity: 200_000,
    supportsVision: true,
    supportsTools: true,
    supportsReasoning: true,
    latencyScore: 5,
    costScore: 5,
    inputCostUsdPerMillionTokens: null,
    outputCostUsdPerMillionTokens: null,
    scores: {
      coding: 5,
      architecture: 5,
      debugging: 5,
      review: 5,
      uiUx: 5,
      visualUnderstanding: 5,
      longContext: 5,
      structuredOutput: 5,
      agenticEndurance: 5,
      multilingual: 5,
    },
    provenance: ["owner-curated"],
    confidence: 0.7,
    revision: 0,
    updatedAt: now,
    ...overrides,
  });

describe("owner-curated model capability provisioning", () => {
  it("adds only truthful catalog provenance and preserves owner capability evidence", () => {
    const input = profile();
    const prepared = prepareOwnerCuratedModelCapabilityProfile({
      profile: input,
      catalog: {
        models: [{ slug: "gpt-5.6-sol", name: "GPT-5.6 Sol" }],
        source: "codex.model/list",
        cached: false,
      },
      updatedAt: "2026-08-10T05:01:00.000Z",
    });

    assert.equal(prepared.catalogStatus, "catalog_matched");
    assert.equal(prepared.catalogSource, "codex.model/list");
    assert.deepEqual(prepared.profile.scores, input.scores);
    assert.equal(prepared.profile.confidence, input.confidence);
    assert.deepEqual(prepared.profile.provenance, [
      "owner-curated",
      "provider-catalog:codex:codex.model/list",
    ]);
  });

  it("reports owner-curated-only when discovery has no capability-bearing model catalog", () => {
    const prepared = prepareOwnerCuratedModelCapabilityProfile({
      profile: profile(),
      catalog: { models: [], source: "unsupported", cached: false },
      updatedAt: now,
    });

    assert.equal(prepared.catalogStatus, "owner_curated_only");
    assert.equal(prepared.catalogSource, null);
    assert.deepEqual(prepared.profile.provenance, ["owner-curated"]);
  });

  it("rejects invented score provenance and a mismatch with a non-empty live catalog", () => {
    assert.throws(
      () =>
        prepareOwnerCuratedModelCapabilityProfile({
          profile: profile({ provenance: ["provider-metadata"] }),
          catalog: null,
          updatedAt: now,
        }),
      (error) =>
        error instanceof ModelCapabilityProvisioningError &&
        error.code === "owner_curated_provenance_required",
    );
    assert.throws(
      () =>
        prepareOwnerCuratedModelCapabilityProfile({
          profile: profile(),
          catalog: {
            models: [{ slug: "gpt-5.6-luna", name: "GPT-5.6 Luna" }],
            source: "codex.model/list",
          },
          updatedAt: now,
        }),
      (error) =>
        error instanceof ModelCapabilityProvisioningError &&
        error.code === "catalog_model_mismatch",
    );
  });
});
