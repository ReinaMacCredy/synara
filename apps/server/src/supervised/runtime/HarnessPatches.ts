import type { HarnessPatch, SupervisedActor } from "@synara/contracts";

export interface HarnessPatchEvaluation {
  readonly passed: boolean;
  readonly basePolicyHash: HarnessPatch["basePolicyHash"];
  readonly evidenceRefs: HarnessPatch["evaluationEvidenceRefs"];
  readonly regressions: ReadonlyArray<string>;
}

export function activateHarnessPatch(
  patch: HarnessPatch,
  evaluation: HarnessPatchEvaluation,
  actor: SupervisedActor,
  at: string,
): HarnessPatch {
  if (patch.status !== "draft" && patch.status !== "evaluating" && patch.status !== "rejected") {
    throw new Error(`Harness Patch '${patch.id}' cannot activate from '${patch.status}'.`);
  }
  if (patch.basePolicyHash !== evaluation.basePolicyHash) {
    throw new Error("Harness Patch evaluation does not match the immutable base policy hash.");
  }
  if (!evaluation.passed || evaluation.regressions.length > 0 || evaluation.evidenceRefs.length === 0) {
    throw new Error("Harness Patch activation requires passing regression evidence.");
  }
  return {
    ...patch,
    status: "active",
    evaluationEvidenceRefs: [...evaluation.evidenceRefs],
    activatedBy: actor,
    updatedAt: at,
  };
}

export function mayPromoteHarnessPatch(input: {
  readonly patch: HarnessPatch;
  readonly targetProjectId: string;
  readonly actor: SupervisedActor;
  readonly explicitHumanApproval: boolean;
  readonly evaluationScopeCreated: boolean;
}): boolean {
  if (
    input.patch.scope.kind === "project" &&
    input.patch.scope.projectId === input.targetProjectId
  ) {
    return true;
  }
  return (
    input.actor.kind === "user" && input.explicitHumanApproval && input.evaluationScopeCreated
  );
}

export function revertHarnessPatch(patch: HarnessPatch, at: string): HarnessPatch {
  if (patch.status !== "active") {
    throw new Error(`Only an active Harness Patch can be reverted.`);
  }
  return { ...patch, status: "reverted", updatedAt: at };
}
