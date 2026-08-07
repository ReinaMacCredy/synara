import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { decideRlmAdmission } from "./RlmAdmission.ts";

const base = {
  episodeId: "rlm-1" as never,
  requestedMode: "auto" as const,
  estimatedContextPercent: 20,
  estimatedInputTokens: 1_000,
  independentEvidenceBranches: 1,
  policyId: "policy-1" as never,
  createdAt: "2026-08-07T00:00:00.000Z",
};

describe("RLM admission", () => {
  it("defaults to direct below all measurable thresholds", () => {
    assert.equal(decideRlmAdmission(base).selectedMode, "direct");
  });

  it("selects recursive at any locked threshold", () => {
    assert.equal(decideRlmAdmission({ ...base, estimatedContextPercent: 65 }).selectedMode, "recursive");
    assert.equal(decideRlmAdmission({ ...base, estimatedInputTokens: 24_000 }).selectedMode, "recursive");
    assert.equal(decideRlmAdmission({ ...base, independentEvidenceBranches: 4 }).selectedMode, "recursive");
  });

  it("honors a Human or Lead override and records it", () => {
    const receipt = decideRlmAdmission({
      ...base,
      requestedMode: "direct",
      estimatedContextPercent: 90,
    });
    assert.equal(receipt.selectedMode, "direct");
    assert.match(receipt.reasons[0] ?? "", /explicitly forced/);
  });
});
