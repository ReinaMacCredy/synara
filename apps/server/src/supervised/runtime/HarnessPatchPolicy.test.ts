import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";

import type { HarnessPatch } from "@synara/contracts";

import {
  resolveEffectiveHarnessPatchOverlays,
  SUPERVISED_BASE_POLICY,
  SUPERVISED_BASE_POLICY_HASH,
  SUPERVISED_BASE_POLICY_LAWS,
} from "./HarnessPatchPolicy.ts";

const owner = { kind: "user", actorId: "owner" } as const;
const daemon = { kind: "daemon", actorId: "supervised-runtime" } as const;

function activePatch(input: {
  readonly id: string;
  readonly scope: HarnessPatch["scope"];
  readonly status?: "canary" | "promoted";
  readonly successfulEvaluations?: number;
}): HarnessPatch {
  const status = input.status ?? "canary";
  return {
    id: input.id as never,
    name: `Patch ${input.id}`,
    patchType: "instruction",
    scope: input.scope,
    content: `Apply ${input.id} as a reversible overlay.`,
    basePolicyHash: SUPERVISED_BASE_POLICY_HASH,
    status,
    observationEvidenceRefs: [`evidence-observation-${input.id}` as never],
    evaluationEvidenceRefs: [`evidence-sandbox-${input.id}` as never],
    sandboxEvaluation: {
      passed: true,
      basePolicyHash: SUPERVISED_BASE_POLICY_HASH,
      evidenceRefs: [`evidence-sandbox-${input.id}` as never],
      regressions: [],
      evaluatedBy: daemon,
      evaluatedAt: "2026-08-10T00:01:00.000Z",
      eventId: `event-sandbox-${input.id}` as never,
      controlPlaneSequence: 1,
    },
    approval: { approvedBy: owner, approvedAt: "2026-08-10T00:02:00.000Z" },
    canary: {
      startedAt: "2026-08-10T00:03:00.000Z",
      failureThreshold: 2,
      observedFailures: 0,
      successfulEvaluations: input.successfulEvaluations ?? (status === "promoted" ? 1 : 0),
      evidenceRefs: [],
      lastEvaluationAt: null,
      lastControlPlaneSequence: 1,
    },
    rollback: null,
    lastControlPlaneSequence: 1,
    version: 1,
    revision: 4,
    createdBy: { kind: "seat", actorId: "supervisor", seatId: "supervisor" },
    activatedBy: owner,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:03:00.000Z",
  } as unknown as HarnessPatch;
}

describe("Harness Patch base policy", () => {
  it("owns one deterministic immutable digest on the server", () => {
    const expected = `sha256:${createHash("sha256").update(SUPERVISED_BASE_POLICY).digest("hex")}`;
    assert.equal(SUPERVISED_BASE_POLICY_HASH, expected);
    assert.equal(SUPERVISED_BASE_POLICY_HASH.length, 71);
    assert.equal(Object.isFrozen(SUPERVISED_BASE_POLICY_LAWS), true);
    assert.match(SUPERVISED_BASE_POLICY, /cannot grant authority, expand permission/);
  });

  it("resolves only valid active overlays for the exact scope, broad to specific", () => {
    const profile = activePatch({
      id: "profile",
      scope: { kind: "profile", profilePresetId: "profile-1" as never },
    });
    const project = activePatch({
      id: "project",
      scope: { kind: "project", projectId: "project-1" as never },
      status: "promoted",
    });
    const task = activePatch({
      id: "task",
      scope: { kind: "task", taskId: "task-1" as never },
    });
    const wrongRoom = activePatch({
      id: "wrong-room",
      scope: { kind: "room", roomId: "room-2" as never },
    });
    const staleBase = {
      ...project,
      id: "stale-base" as never,
      basePolicyHash: `sha256:${"f".repeat(64)}` as HarnessPatch["basePolicyHash"],
    };
    const failedThreshold = {
      ...task,
      id: "failed-threshold" as never,
      canary: { ...task.canary!, observedFailures: task.canary!.failureThreshold },
    };

    const overlays = resolveEffectiveHarnessPatchOverlays({
      patches: [task, wrongRoom, failedThreshold, project, staleBase, profile],
      context: {
        profilePresetId: "profile-1" as never,
        projectId: "project-1" as never,
        roomId: "room-1" as never,
        taskId: "task-1" as never,
      },
    });

    assert.deepEqual(
      overlays.map((overlay) => overlay.patchId),
      ["profile", "project", "task"],
    );
    assert.deepEqual(
      overlays.map((overlay) => overlay.status),
      ["canary", "promoted", "canary"],
    );
    assert.equal(Object.isFrozen(overlays), true);
    assert.equal(
      overlays.every((overlay) => Object.isFrozen(overlay)),
      true,
    );
    assert.equal(
      overlays.every((overlay) => Object.isFrozen(overlay.scope)),
      true,
    );
  });
});
