import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { HarnessPatch } from "@synara/contracts";
import { Schema } from "effect";

import {
  harnessPatchLifecycleSummary,
  harnessPatchScopeLabel,
} from "./SupervisedRuntimeSettingsPanel";

const patch = Schema.decodeUnknownSync(HarnessPatch)({
  id: "patch-settings",
  name: "Review evidence first",
  patchType: "evaluation",
  scope: { kind: "project", projectId: "project-1" },
  content: "Require durable evidence before accepting review.",
  basePolicyHash: `sha256:${"a".repeat(64)}`,
  status: "awaiting_approval",
  observationEvidenceRefs: ["evidence-observation"],
  evaluationEvidenceRefs: ["evidence-sandbox"],
  sandboxEvaluation: {
    passed: true,
    basePolicyHash: `sha256:${"a".repeat(64)}`,
    evidenceRefs: ["evidence-sandbox"],
    regressions: [],
    evaluatedBy: { kind: "daemon", actorId: "runtime" },
    evaluatedAt: "2026-08-10T00:01:00.000Z",
    eventId: "event-sandbox",
    controlPlaneSequence: 1,
  },
  approval: null,
  canary: null,
  rollback: null,
  lastControlPlaneSequence: 1,
  version: 1,
  revision: 3,
  createdBy: { kind: "seat", actorId: "supervisor", seatId: "supervisor" },
  activatedBy: null,
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:02:00.000Z",
});

describe("SupervisedRuntimeSettingsPanel Harness Patch lifecycle", () => {
  it("states that awaiting approval requires explicit Human action", () => {
    assert.deepEqual(harnessPatchLifecycleSummary(patch), {
      label: "Awaiting approval",
      detail: "Explicit Human approval is required before canary activation",
    });
    assert.equal(harnessPatchScopeLabel(patch.scope), "Project project-1");
  });

  it("reports real canary counters and retained rollback reasons", () => {
    const canary = Schema.decodeUnknownSync(HarnessPatch)({
      ...patch,
      status: "canary",
      approval: {
        approvedBy: { kind: "user", actorId: "owner" },
        approvedAt: "2026-08-10T00:03:00.000Z",
      },
      canary: {
        startedAt: "2026-08-10T00:03:00.000Z",
        failureThreshold: 3,
        observedFailures: 1,
        successfulEvaluations: 2,
        evidenceRefs: ["evidence-canary"],
        lastEvaluationAt: "2026-08-10T00:04:00.000Z",
        lastControlPlaneSequence: 2,
      },
      activatedBy: { kind: "user", actorId: "owner" },
    });
    assert.deepEqual(harnessPatchLifecycleSummary(canary), {
      label: "Canary",
      detail: "2 passed · 1/3 failed",
    });

    const rolledBack = Schema.decodeUnknownSync(HarnessPatch)({
      ...canary,
      status: "rolled_back",
      rollback: {
        reason: "Canary failure threshold reached.",
        evidenceRefs: ["evidence-regression"],
        rolledBackBy: { kind: "daemon", actorId: "runtime" },
        rolledBackAt: "2026-08-10T00:05:00.000Z",
      },
    });
    assert.deepEqual(harnessPatchLifecycleSummary(rolledBack), {
      label: "Rolled back",
      detail: "Canary failure threshold reached.",
    });
  });
});
