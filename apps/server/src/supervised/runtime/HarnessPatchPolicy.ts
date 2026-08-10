import { createHash } from "node:crypto";

import type { HarnessPatch, ProfilePresetId, ProjectId, RoomId, TaskId } from "@synara/contracts";

export const SUPERVISED_BASE_POLICY_LAWS = Object.freeze([
  "Communication routing and canonical authority are independent.",
  "A visible tool never grants authority by itself. Every mutation must remain inside the EffectiveAuthorityReceipt and RunPolicy.",
  "Provider text and tool output do not directly mutate durable domain state; typed commands and committed events do.",
  "Communication may bypass Root, but canonical ownership must never become ambiguous.",
  "Harness Patch overlays are additive and reversible. They cannot grant authority, expand permission, mutate canonical ownership, or weaken RunPolicy.",
  "Do not expose or persist hidden chain-of-thought. Publish concise decisions, evidence, receipts, and uncertainty instead.",
] as const);

export const SUPERVISED_BASE_POLICY = SUPERVISED_BASE_POLICY_LAWS.join(" ");

export const SUPERVISED_BASE_POLICY_HASH = `sha256:${createHash("sha256")
  .update(SUPERVISED_BASE_POLICY)
  .digest("hex")}` as HarnessPatch["basePolicyHash"];

export interface HarnessPatchScopeContext {
  readonly profilePresetId?: ProfilePresetId | null;
  readonly projectId?: ProjectId | null;
  readonly roomId?: RoomId | null;
  readonly taskId?: TaskId | null;
}

export interface EffectiveHarnessPatchOverlay {
  readonly patchId: HarnessPatch["id"];
  readonly name: HarnessPatch["name"];
  readonly patchType: HarnessPatch["patchType"];
  readonly scope: HarnessPatch["scope"];
  readonly content: HarnessPatch["content"];
  readonly basePolicyHash: HarnessPatch["basePolicyHash"];
  readonly status: "canary" | "promoted";
  readonly version: number;
  readonly revision: number;
  readonly activatedBy: NonNullable<HarnessPatch["activatedBy"]>;
  readonly activatedAt: string;
}

export function isCurrentSupervisedBasePolicyHash(hash: HarnessPatch["basePolicyHash"]): boolean {
  return hash === SUPERVISED_BASE_POLICY_HASH;
}

export function assertHarnessPatchUsesCurrentBasePolicy(patch: HarnessPatch): void {
  if (!isCurrentSupervisedBasePolicyHash(patch.basePolicyHash)) {
    throw new Error(
      "Harness Patch must target the server-owned current supervised base policy digest.",
    );
  }
}

export function harnessPatchScopeMatches(
  scope: HarnessPatch["scope"],
  context: HarnessPatchScopeContext,
): boolean {
  switch (scope.kind) {
    case "profile":
      return context.profilePresetId === scope.profilePresetId;
    case "project":
      return context.projectId === scope.projectId;
    case "room":
      return context.roomId === scope.roomId;
    case "task":
      return context.taskId === scope.taskId;
  }
}

const scopeOrder: Readonly<Record<HarnessPatch["scope"]["kind"], number>> = {
  profile: 0,
  project: 1,
  room: 2,
  task: 3,
};

function isEffectivePatch(patch: HarnessPatch): patch is HarnessPatch & {
  readonly status: "canary" | "promoted";
  readonly activatedBy: NonNullable<HarnessPatch["activatedBy"]>;
  readonly canary: NonNullable<HarnessPatch["canary"]>;
} {
  if (
    (patch.status !== "canary" && patch.status !== "promoted") ||
    !isCurrentSupervisedBasePolicyHash(patch.basePolicyHash) ||
    patch.sandboxEvaluation?.passed !== true ||
    patch.sandboxEvaluation.basePolicyHash !== SUPERVISED_BASE_POLICY_HASH ||
    patch.sandboxEvaluation.evidenceRefs.length === 0 ||
    patch.sandboxEvaluation.regressions.length > 0 ||
    patch.approval?.approvedBy.kind !== "user" ||
    patch.activatedBy?.kind !== "user" ||
    !patch.canary ||
    patch.rollback
  ) {
    return false;
  }
  if (patch.canary.observedFailures >= patch.canary.failureThreshold) return false;
  return patch.status !== "promoted" || patch.canary.successfulEvaluations > 0;
}

export function resolveEffectiveHarnessPatchOverlays(input: {
  readonly patches: ReadonlyArray<HarnessPatch>;
  readonly context: HarnessPatchScopeContext;
}): ReadonlyArray<EffectiveHarnessPatchOverlay> {
  const overlays = input.patches
    .filter(
      (
        patch,
      ): patch is HarnessPatch & {
        readonly status: "canary" | "promoted";
        readonly activatedBy: NonNullable<HarnessPatch["activatedBy"]>;
        readonly canary: NonNullable<HarnessPatch["canary"]>;
      } => isEffectivePatch(patch) && harnessPatchScopeMatches(patch.scope, input.context),
    )
    .sort(
      (left, right) =>
        scopeOrder[left.scope.kind] - scopeOrder[right.scope.kind] ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    )
    .map((patch) =>
      Object.freeze({
        patchId: patch.id,
        name: patch.name,
        patchType: patch.patchType,
        scope: Object.freeze({ ...patch.scope }),
        content: patch.content,
        basePolicyHash: patch.basePolicyHash,
        status: patch.status,
        version: patch.version,
        revision: patch.revision ?? 0,
        activatedBy: Object.freeze({ ...patch.activatedBy }),
        activatedAt: patch.canary.startedAt,
      }),
    );
  return Object.freeze(overlays);
}
