import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { HarnessPatch } from "@synara/contracts";

import { activateHarnessPatch, mayPromoteHarnessPatch, revertHarnessPatch } from "./HarnessPatches.ts";

const hash = `sha256:${"a".repeat(64)}` as HarnessPatch["basePolicyHash"];
const now = "2026-08-07T00:00:00.000Z";
const patch = {
  id: "patch-1",
  name: "Review evidence first",
  patchType: "evaluation",
  scope: { kind: "project", projectId: "project-1" },
  content: "Require evidence references before review.",
  basePolicyHash: hash,
  status: "draft",
  evaluationEvidenceRefs: [],
  version: 1,
  createdBy: { kind: "user", actorId: "owner" },
  activatedBy: null,
  createdAt: now,
  updatedAt: now,
} as HarnessPatch;

describe("Harness Patches", () => {
  it("activates only against the immutable evaluated base", () => {
    const active = activateHarnessPatch(
      patch,
      { passed: true, basePolicyHash: hash, evidenceRefs: ["evidence-1" as never], regressions: [] },
      { kind: "user", actorId: "owner" },
      now,
    );
    assert.equal(active.status, "active");
    assert.equal(revertHarnessPatch(active, now).status, "reverted");
  });

  it("blocks automatic cross-Project promotion", () => {
    assert.equal(
      mayPromoteHarnessPatch({
        patch,
        targetProjectId: "project-2",
        actor: { kind: "daemon", actorId: "daemon-1" },
        explicitHumanApproval: false,
        evaluationScopeCreated: true,
      }),
      false,
    );
    assert.equal(
      mayPromoteHarnessPatch({
        patch,
        targetProjectId: "project-2",
        actor: { kind: "user", actorId: "owner" },
        explicitHumanApproval: true,
        evaluationScopeCreated: true,
      }),
      true,
    );
  });
});
