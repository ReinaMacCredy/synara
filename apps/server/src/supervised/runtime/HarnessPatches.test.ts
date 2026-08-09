import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { HarnessPatch, SupervisedActor } from "@synara/contracts";

import {
  applyHarnessPatchSandboxEvaluation,
  awaitHarnessPatchApproval,
  mayPromoteHarnessPatch,
  promoteHarnessPatch,
  recordHarnessPatchCanaryEvaluation,
  revertHarnessPatch,
  startHarnessPatchCanary,
  validateHarnessPatchUpdate,
  type HarnessPatchEvaluation,
} from "./HarnessPatches.ts";

const hash = `sha256:${"a".repeat(64)}` as HarnessPatch["basePolicyHash"];
const now = "2026-08-07T00:00:00.000Z";
const owner: SupervisedActor = { kind: "user", actorId: "owner" };
const daemon: SupervisedActor = { kind: "daemon", actorId: "supervised-runtime" };
const proposed = {
  id: "patch-1",
  name: "Review evidence first",
  patchType: "evaluation",
  scope: { kind: "project", projectId: "project-1" },
  content: "Require evidence references before review.",
  basePolicyHash: hash,
  status: "proposed",
  observationEvidenceRefs: ["evidence-observation"],
  evaluationEvidenceRefs: [],
  sandboxEvaluation: null,
  approval: null,
  canary: null,
  rollback: null,
  lastControlPlaneSequence: 0,
  version: 1,
  revision: 0,
  createdBy: { kind: "seat", actorId: "supervisor-1", seatId: "supervisor-1" },
  activatedBy: null,
  createdAt: now,
  updatedAt: now,
} as HarnessPatch;

const evaluation = (input: {
  readonly passed: boolean;
  readonly sequence: number;
  readonly evidence: string;
  readonly regressions?: ReadonlyArray<string>;
}): HarnessPatchEvaluation => ({
  passed: input.passed,
  basePolicyHash: hash,
  evidenceRefs: [input.evidence as never],
  regressions: input.regressions ?? [],
  evaluatedBy: daemon,
  evaluatedAt: `2026-08-07T00:0${input.sequence}:00.000Z`,
  eventId: `event-patch-${input.sequence}` as never,
  controlPlaneSequence: input.sequence,
});

function sandboxedPatch() {
  const patch = { ...proposed, status: "sandboxed" as const, revision: 1 };
  validateHarnessPatchUpdate(proposed, patch, daemon);
  return patch;
}

describe("Harness Patches", () => {
  it("runs the governed proposal, sandbox, approval, canary, promotion, and rollback lifecycle", () => {
    validateHarnessPatchUpdate(null, proposed, proposed.createdBy);
    const evaluated = applyHarnessPatchSandboxEvaluation(
      sandboxedPatch(),
      evaluation({ passed: true, sequence: 1, evidence: "evidence-sandbox" }),
    );
    validateHarnessPatchUpdate(sandboxedPatch(), evaluated, daemon);
    const awaiting = awaitHarnessPatchApproval(evaluated, daemon, "2026-08-07T00:02:00.000Z");
    const canary = startHarnessPatchCanary(
      awaiting,
      owner,
      "2026-08-07T00:03:00.000Z",
      2,
    );
    const observed = recordHarnessPatchCanaryEvaluation(
      canary,
      evaluation({ passed: true, sequence: 2, evidence: "evidence-canary" }),
    );
    validateHarnessPatchUpdate(canary, observed, daemon);
    const promoted = promoteHarnessPatch(observed, owner, "2026-08-07T00:05:00.000Z");
    assert.equal(promoted.status, "promoted");
    assert.equal(promoted.canary?.successfulEvaluations, 1);
    const rolledBack = revertHarnessPatch(
      promoted,
      owner,
      "2026-08-07T00:06:00.000Z",
      ["evidence-rollback" as never],
    );
    assert.equal(rolledBack.status, "rolled_back");
    assert.equal(rolledBack.rollback?.rolledBackBy.kind, "user");
    assert.equal(rolledBack.basePolicyHash, hash);
  });

  it("rolls a failed canary back when its durable threshold is reached", () => {
    const evaluated = applyHarnessPatchSandboxEvaluation(
      sandboxedPatch(),
      evaluation({ passed: true, sequence: 1, evidence: "evidence-sandbox" }),
    );
    const awaiting = awaitHarnessPatchApproval(evaluated, daemon, "2026-08-07T00:02:00.000Z");
    let canary = startHarnessPatchCanary(awaiting, owner, "2026-08-07T00:03:00.000Z", 2);
    canary = recordHarnessPatchCanaryEvaluation(
      canary,
      evaluation({ passed: false, sequence: 2, evidence: "evidence-failure-1" }),
    );
    assert.equal(canary.status, "canary");
    const rolledBack = recordHarnessPatchCanaryEvaluation(
      canary,
      evaluation({
        passed: false,
        sequence: 3,
        evidence: "evidence-failure-2",
        regressions: ["Review acceptance regressed"],
      }),
    );
    validateHarnessPatchUpdate(canary, rolledBack, daemon);
    assert.equal(rolledBack.status, "rolled_back");
    assert.equal(rolledBack.rollback?.reason, "Canary failure threshold reached.");
  });

  it("rejects base-policy mutation and promotion without Human approval", () => {
    const mutated = {
      ...sandboxedPatch(),
      basePolicyHash: `sha256:${"b".repeat(64)}` as HarnessPatch["basePolicyHash"],
      revision: 2,
    };
    assert.throws(
      () => validateHarnessPatchUpdate(sandboxedPatch(), mutated, daemon),
      /immutable base policy hash/,
    );
    assert.throws(
      () =>
        applyHarnessPatchSandboxEvaluation(sandboxedPatch(), {
          ...evaluation({ passed: true, sequence: 1, evidence: "evidence-sandbox" }),
          basePolicyHash: `sha256:${"b".repeat(64)}` as HarnessPatch["basePolicyHash"],
        }),
      /immutable base policy hash/,
    );
  });

  it("blocks automatic cross-Project promotion", () => {
    assert.equal(
      mayPromoteHarnessPatch({
        patch: proposed,
        targetProjectId: "project-2",
        actor: daemon,
        explicitHumanApproval: false,
        evaluationScopeCreated: true,
      }),
      false,
    );
    assert.equal(
      mayPromoteHarnessPatch({
        patch: proposed,
        targetProjectId: "project-2",
        actor: owner,
        explicitHumanApproval: true,
        evaluationScopeCreated: true,
      }),
      true,
    );
  });
});
