import type { EventId, EvidenceId, HarnessPatch, SupervisedActor } from "@synara/contracts";

import {
  assertHarnessPatchUsesCurrentBasePolicy,
  isCurrentSupervisedBasePolicyHash,
  SUPERVISED_BASE_POLICY_HASH,
} from "./HarnessPatchPolicy.ts";

export interface HarnessPatchEvaluation {
  readonly passed: boolean;
  readonly basePolicyHash: HarnessPatch["basePolicyHash"];
  readonly evidenceRefs: ReadonlyArray<EvidenceId>;
  readonly regressions: ReadonlyArray<string>;
  readonly evaluatedBy: SupervisedActor;
  readonly evaluatedAt: string;
  readonly eventId: EventId;
  readonly controlPlaneSequence: number;
}

const transitions: Readonly<Record<HarnessPatch["status"], ReadonlySet<HarnessPatch["status"]>>> = {
  observed: new Set(["proposed", "rejected", "revoked"]),
  proposed: new Set(["proposed", "sandboxed", "rejected", "revoked"]),
  sandboxed: new Set(["sandboxed", "evaluated", "failed", "rejected", "revoked"]),
  evaluated: new Set(["awaiting_approval", "failed", "rejected", "revoked"]),
  awaiting_approval: new Set(["canary", "rejected", "revoked"]),
  canary: new Set(["canary", "promoted", "failed", "rolled_back", "revoked"]),
  promoted: new Set(["rolled_back", "revoked"]),
  rejected: new Set(),
  failed: new Set(["proposed", "revoked"]),
  rolled_back: new Set(["proposed", "revoked"]),
  revoked: new Set(),
};

const actorEquals = (left: SupervisedActor, right: SupervisedActor) =>
  JSON.stringify(left) === JSON.stringify(right);

const requireHuman = (actor: SupervisedActor, action: string) => {
  if (actor.kind !== "user") throw new Error(`Only the Human may ${action}.`);
};

const uniqueEvidenceRefs = (evidenceRefs: ReadonlyArray<EvidenceId>) => [...new Set(evidenceRefs)];
const observationEvidenceRefs = (patch: HarnessPatch) => patch.observationEvidenceRefs ?? [];
const patchRevision = (patch: HarnessPatch) => patch.revision ?? 0;
const patchControlPlaneSequence = (patch: HarnessPatch) => patch.lastControlPlaneSequence ?? 0;

function assertObservationEvidenceContinuity(current: HarnessPatch, next: HarnessPatch) {
  for (const evidenceRef of observationEvidenceRefs(current)) {
    if (!observationEvidenceRefs(next).includes(evidenceRef)) {
      throw new Error("Harness Patch observation evidence is append-only.");
    }
  }
}

function assertImmutablePatchIdentity(current: HarnessPatch, next: HarnessPatch) {
  if (
    current.id !== next.id ||
    current.patchType !== next.patchType ||
    JSON.stringify(current.scope) !== JSON.stringify(next.scope) ||
    !actorEquals(current.createdBy, next.createdBy) ||
    current.createdAt !== next.createdAt
  ) {
    throw new Error("Harness Patch identity, type, and scope are immutable.");
  }
  if (current.basePolicyHash !== next.basePolicyHash) {
    throw new Error("Harness Patch cannot mutate its immutable base policy hash.");
  }
}

function assertReceiptContinuity(current: HarnessPatch, next: HarnessPatch) {
  if (patchControlPlaneSequence(next) < patchControlPlaneSequence(current)) {
    throw new Error("Harness Patch control-plane cursor cannot move backwards.");
  }
  assertObservationEvidenceContinuity(current, next);
  for (const evidenceRef of current.evaluationEvidenceRefs) {
    if (!next.evaluationEvidenceRefs.includes(evidenceRef)) {
      throw new Error("Harness Patch evaluation evidence is append-only.");
    }
  }
  if (
    current.sandboxEvaluation &&
    JSON.stringify(current.sandboxEvaluation) !== JSON.stringify(next.sandboxEvaluation)
  ) {
    throw new Error("Harness Patch sandbox evaluation receipt is immutable.");
  }
  if (current.approval && JSON.stringify(current.approval) !== JSON.stringify(next.approval)) {
    throw new Error("Harness Patch approval receipt is immutable.");
  }
  if (current.rollback && JSON.stringify(current.rollback) !== JSON.stringify(next.rollback)) {
    throw new Error("Harness Patch rollback receipt is immutable.");
  }
  if (current.activatedBy && !actorEquals(current.activatedBy, next.activatedBy!)) {
    throw new Error("Harness Patch activation receipt is immutable.");
  }
  if (current.canary && !next.canary) {
    throw new Error("Harness Patch canary receipt is immutable.");
  }
  if (current.canary && next.canary) {
    if (
      current.canary.startedAt !== next.canary.startedAt ||
      current.canary.failureThreshold !== next.canary.failureThreshold ||
      next.canary.observedFailures < current.canary.observedFailures ||
      next.canary.successfulEvaluations < current.canary.successfulEvaluations ||
      next.canary.lastControlPlaneSequence < current.canary.lastControlPlaneSequence
    ) {
      throw new Error("Harness Patch canary receipt must advance monotonically.");
    }
    for (const evidenceRef of current.canary.evidenceRefs) {
      if (!next.canary.evidenceRefs.includes(evidenceRef)) {
        throw new Error("Harness Patch canary evidence is append-only.");
      }
    }
  }
}

function assertLifecycleEvidence(patch: HarnessPatch) {
  assertHarnessPatchUsesCurrentBasePolicy(patch);
  if (patch.name.trim().length === 0 || patch.content.trim().length === 0) {
    throw new Error("A Harness Patch requires a name and reversible overlay content.");
  }
  if (
    (patch.status === "observed" || patch.status === "proposed") &&
    observationEvidenceRefs(patch).length === 0
  ) {
    throw new Error("A Harness Patch observation or proposal requires durable friction evidence.");
  }
  if (
    ["evaluated", "awaiting_approval", "canary", "promoted"].includes(patch.status) &&
    (!patch.sandboxEvaluation?.passed ||
      patch.sandboxEvaluation.basePolicyHash !== patch.basePolicyHash ||
      patch.sandboxEvaluation.evidenceRefs.length === 0 ||
      patch.sandboxEvaluation.regressions.length > 0)
  ) {
    throw new Error(
      "Harness Patch progression requires passing sandbox evidence against its base policy.",
    );
  }
  if (["canary", "promoted"].includes(patch.status)) {
    if (
      patch.approval?.approvedBy.kind !== "user" ||
      !patch.canary ||
      patch.activatedBy?.kind !== "user" ||
      patch.rollback
    ) {
      throw new Error(
        "Harness Patch canary requires explicit Human approval and durable canary state.",
      );
    }
  }
  if (
    patch.status === "canary" &&
    patch.canary &&
    patch.canary.observedFailures >= patch.canary.failureThreshold
  ) {
    throw new Error("A failed Harness Patch canary must roll back at its durable threshold.");
  }
  if (patch.status === "promoted" && (patch.canary?.successfulEvaluations ?? 0) < 1) {
    throw new Error("Harness Patch promotion requires at least one successful canary evaluation.");
  }
  if (patch.status === "rolled_back" && (!patch.rollback || !patch.canary)) {
    throw new Error("Harness Patch rollback requires a durable rollback receipt.");
  }
}

export function validateHarnessPatchUpdate(
  current: HarnessPatch | null,
  next: HarnessPatch,
  actor: SupervisedActor,
): void {
  if (!current) {
    if (next.status !== "observed" && next.status !== "proposed") {
      throw new Error("A new Harness Patch must begin as observed or proposed.");
    }
    if (!actorEquals(next.createdBy, actor)) {
      throw new Error("Harness Patch creator must match the proposing actor.");
    }
    if (actor.kind !== "user" && actor.kind !== "seat") {
      throw new Error("Only a Human or Agent Seat may observe or propose a Harness Patch.");
    }
    if (patchRevision(next) !== 0 || next.version !== 1) {
      throw new Error("A new Harness Patch must start at version 1 and revision 0.");
    }
    if (
      next.evaluationEvidenceRefs.length > 0 ||
      next.sandboxEvaluation ||
      next.approval ||
      next.canary ||
      next.rollback ||
      next.activatedBy
    ) {
      throw new Error(
        "A new Harness Patch cannot contain evaluation, approval, canary, or rollback state.",
      );
    }
    assertLifecycleEvidence(next);
    return;
  }

  assertImmutablePatchIdentity(current, next);
  assertHarnessPatchUsesCurrentBasePolicy(next);
  if (patchRevision(next) !== patchRevision(current) + 1) {
    throw new Error("Harness Patch revision must advance exactly once.");
  }
  const contentChanged = current.content !== next.content || current.name !== next.name;
  const reopensTerminalAttempt =
    next.status === "proposed" && (current.status === "failed" || current.status === "rolled_back");
  const startsNewVersion = contentChanged || reopensTerminalAttempt;
  if (startsNewVersion) {
    if (
      next.status !== "proposed" ||
      next.version !== current.version + 1 ||
      !["observed", "proposed", "failed", "rolled_back"].includes(current.status)
    ) {
      throw new Error("Harness Patch revisions require a new proposed content version.");
    }
    assertObservationEvidenceContinuity(current, next);
    if (patchControlPlaneSequence(next) < patchControlPlaneSequence(current)) {
      throw new Error("Harness Patch control-plane cursor cannot move backwards.");
    }
    if (
      next.evaluationEvidenceRefs.length > 0 ||
      next.sandboxEvaluation ||
      next.approval ||
      next.canary ||
      next.rollback ||
      next.activatedBy
    ) {
      throw new Error("A new Harness Patch version must reset prior lifecycle receipts.");
    }
  } else if (next.version !== current.version) {
    throw new Error("Harness Patch lifecycle transitions cannot change the content version.");
  } else {
    assertReceiptContinuity(current, next);
  }
  if (!transitions[current.status].has(next.status)) {
    throw new Error(`Illegal Harness Patch transition: ${current.status} -> ${next.status}.`);
  }

  switch (next.status) {
    case "observed":
    case "proposed":
      if (actor.kind !== "user" && actor.kind !== "seat") {
        throw new Error("Only a Human or Agent Seat may propose a Harness Patch.");
      }
      break;
    case "sandboxed":
    case "evaluated":
    case "awaiting_approval":
    case "failed":
      if (actor.kind !== "daemon") {
        throw new Error(`Only the daemon may transition a Harness Patch to ${next.status}.`);
      }
      break;
    case "canary":
    case "promoted":
    case "rejected":
    case "revoked":
      if (next.status === "canary" && current.status === "canary") {
        if (actor.kind !== "daemon") {
          throw new Error("Only the daemon may record a Harness Patch canary evaluation.");
        }
      } else {
        requireHuman(actor, `transition a Harness Patch to ${next.status}`);
      }
      break;
    case "rolled_back":
      if (actor.kind === "daemon") {
        if (
          current.status !== "canary" ||
          !next.canary ||
          next.canary.observedFailures < next.canary.failureThreshold
        ) {
          throw new Error("Daemon rollback requires a failed canary threshold.");
        }
      } else {
        requireHuman(actor, "roll back a Harness Patch");
      }
      break;
  }
  assertLifecycleEvidence(next);
}

export function createHarnessPatchProposal(input: {
  readonly id: HarnessPatch["id"];
  readonly name: HarnessPatch["name"];
  readonly patchType: HarnessPatch["patchType"];
  readonly scope: HarnessPatch["scope"];
  readonly content: HarnessPatch["content"];
  readonly observationEvidenceRefs: ReadonlyArray<EvidenceId>;
  readonly createdBy: SupervisedActor;
  readonly createdAt: string;
}): HarnessPatch {
  if (input.name.trim().length === 0 || input.content.trim().length === 0) {
    throw new Error("A Harness Patch proposal requires a name and reversible overlay content.");
  }
  const patch: HarnessPatch = {
    id: input.id,
    name: input.name,
    patchType: input.patchType,
    scope: input.scope,
    content: input.content,
    basePolicyHash: SUPERVISED_BASE_POLICY_HASH,
    status: "proposed",
    observationEvidenceRefs: uniqueEvidenceRefs(input.observationEvidenceRefs),
    evaluationEvidenceRefs: [],
    sandboxEvaluation: null,
    approval: null,
    canary: null,
    rollback: null,
    lastControlPlaneSequence: 0,
    version: 1,
    revision: 0,
    createdBy: input.createdBy,
    activatedBy: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
  validateHarnessPatchUpdate(null, patch, input.createdBy);
  return patch;
}

export function reviseHarnessPatchProposal(
  patch: HarnessPatch,
  actor: SupervisedActor,
  input: {
    readonly name?: HarnessPatch["name"];
    readonly content?: HarnessPatch["content"];
    readonly observationEvidenceRefs?: ReadonlyArray<EvidenceId>;
    readonly updatedAt: string;
  },
): HarnessPatch {
  const next: HarnessPatch = {
    ...patch,
    name: input.name ?? patch.name,
    content: input.content ?? patch.content,
    status: "proposed",
    observationEvidenceRefs: uniqueEvidenceRefs([
      ...observationEvidenceRefs(patch),
      ...(input.observationEvidenceRefs ?? []),
    ]),
    evaluationEvidenceRefs: [],
    sandboxEvaluation: null,
    approval: null,
    canary: null,
    rollback: null,
    version: patch.version + 1,
    revision: patchRevision(patch) + 1,
    activatedBy: null,
    updatedAt: input.updatedAt,
  };
  validateHarnessPatchUpdate(patch, next, actor);
  return next;
}

export function applyHarnessPatchSandboxEvaluation(
  patch: HarnessPatch,
  evaluation: HarnessPatchEvaluation,
): HarnessPatch {
  if (patch.status !== "sandboxed") {
    throw new Error(`Harness Patch '${patch.id}' cannot be evaluated from '${patch.status}'.`);
  }
  if (patch.basePolicyHash !== evaluation.basePolicyHash) {
    throw new Error("Harness Patch evaluation does not match the immutable base policy hash.");
  }
  if (!isCurrentSupervisedBasePolicyHash(evaluation.basePolicyHash)) {
    throw new Error(
      "Harness Patch evaluation must use the server-owned current base policy digest.",
    );
  }
  if (evaluation.controlPlaneSequence <= patchControlPlaneSequence(patch)) {
    throw new Error("Harness Patch sandbox evaluation must advance the control-plane cursor.");
  }
  if (evaluation.evidenceRefs.length === 0) {
    throw new Error("Harness Patch evaluation requires durable evidence.");
  }
  const passed = evaluation.passed && evaluation.regressions.length === 0;
  const next: HarnessPatch = {
    ...patch,
    status: passed ? "evaluated" : "failed",
    evaluationEvidenceRefs: [...evaluation.evidenceRefs],
    sandboxEvaluation: {
      passed,
      basePolicyHash: evaluation.basePolicyHash,
      evidenceRefs: [...evaluation.evidenceRefs],
      regressions: [...evaluation.regressions],
      evaluatedBy: evaluation.evaluatedBy,
      evaluatedAt: evaluation.evaluatedAt,
      eventId: evaluation.eventId,
      controlPlaneSequence: evaluation.controlPlaneSequence,
    },
    lastControlPlaneSequence: evaluation.controlPlaneSequence,
    updatedAt: evaluation.evaluatedAt,
    revision: patchRevision(patch) + 1,
  };
  validateHarnessPatchUpdate(patch, next, evaluation.evaluatedBy);
  return next;
}

export function awaitHarnessPatchApproval(
  patch: HarnessPatch,
  actor: SupervisedActor,
  at: string,
): HarnessPatch {
  const next = {
    ...patch,
    status: "awaiting_approval" as const,
    updatedAt: at,
    revision: patchRevision(patch) + 1,
  };
  validateHarnessPatchUpdate(patch, next, actor);
  return next;
}

export function startHarnessPatchCanary(
  patch: HarnessPatch,
  actor: SupervisedActor,
  at: string,
  failureThreshold: number,
): HarnessPatch {
  requireHuman(actor, "approve a Harness Patch canary");
  if (!Number.isInteger(failureThreshold) || failureThreshold < 1) {
    throw new Error("Harness Patch canary failure threshold must be a positive integer.");
  }
  const next: HarnessPatch = {
    ...patch,
    status: "canary",
    approval: { approvedBy: actor, approvedAt: at },
    canary: {
      startedAt: at,
      failureThreshold,
      observedFailures: 0,
      successfulEvaluations: 0,
      evidenceRefs: [],
      lastEvaluationAt: null,
      lastControlPlaneSequence: Math.max(
        patchControlPlaneSequence(patch),
        patch.sandboxEvaluation?.controlPlaneSequence ?? 0,
      ),
    },
    rollback: null,
    activatedBy: actor,
    updatedAt: at,
    revision: patchRevision(patch) + 1,
  };
  validateHarnessPatchUpdate(patch, next, actor);
  return next;
}

export function recordHarnessPatchCanaryEvaluation(
  patch: HarnessPatch,
  evaluation: HarnessPatchEvaluation,
): HarnessPatch {
  if (patch.status !== "canary" || !patch.canary) {
    throw new Error(`Harness Patch '${patch.id}' is not in canary.`);
  }
  if (patch.basePolicyHash !== evaluation.basePolicyHash) {
    throw new Error(
      "Harness Patch canary evaluation does not match the immutable base policy hash.",
    );
  }
  if (!isCurrentSupervisedBasePolicyHash(evaluation.basePolicyHash)) {
    throw new Error(
      "Harness Patch canary evaluation must use the server-owned current base policy digest.",
    );
  }
  if (
    evaluation.controlPlaneSequence <=
    Math.max(patchControlPlaneSequence(patch), patch.canary.lastControlPlaneSequence)
  ) {
    return patch;
  }
  if (evaluation.evidenceRefs.length === 0) {
    throw new Error("Harness Patch canary evaluation requires durable evidence.");
  }
  const failed = !evaluation.passed || evaluation.regressions.length > 0;
  const observedFailures = patch.canary.observedFailures + (failed ? 1 : 0);
  const canary = {
    ...patch.canary,
    observedFailures,
    successfulEvaluations: patch.canary.successfulEvaluations + (failed ? 0 : 1),
    evidenceRefs: [...new Set([...patch.canary.evidenceRefs, ...evaluation.evidenceRefs])].slice(
      -256,
    ),
    lastEvaluationAt: evaluation.evaluatedAt,
    lastControlPlaneSequence: evaluation.controlPlaneSequence,
  };
  const shouldRollback = observedFailures >= canary.failureThreshold;
  const next: HarnessPatch = {
    ...patch,
    status: shouldRollback ? "rolled_back" : "canary",
    canary,
    rollback: shouldRollback
      ? {
          reason: "Canary failure threshold reached.",
          evidenceRefs: [...evaluation.evidenceRefs],
          rolledBackBy: evaluation.evaluatedBy,
          rolledBackAt: evaluation.evaluatedAt,
        }
      : null,
    lastControlPlaneSequence: evaluation.controlPlaneSequence,
    updatedAt: evaluation.evaluatedAt,
    revision: patchRevision(patch) + 1,
  };
  validateHarnessPatchUpdate(patch, next, evaluation.evaluatedBy);
  return next;
}

export function advanceHarnessPatchControlPlaneCursor(
  patch: HarnessPatch,
  actor: SupervisedActor,
  sequence: number,
  at: string,
): HarnessPatch {
  if (sequence <= patchControlPlaneSequence(patch)) return patch;
  const next = {
    ...patch,
    lastControlPlaneSequence: sequence,
    updatedAt: at,
    revision: patchRevision(patch) + 1,
  };
  validateHarnessPatchUpdate(patch, next, actor);
  return next;
}

export function promoteHarnessPatch(
  patch: HarnessPatch,
  actor: SupervisedActor,
  at: string,
): HarnessPatch {
  const next = {
    ...patch,
    status: "promoted" as const,
    updatedAt: at,
    revision: patchRevision(patch) + 1,
  };
  validateHarnessPatchUpdate(patch, next, actor);
  return next;
}

export function mayPromoteHarnessPatch(input: {
  readonly patch: HarnessPatch;
  readonly targetProjectId: string;
  readonly actor: SupervisedActor;
  readonly explicitHumanApproval: boolean;
  readonly evaluationScopeCreated: boolean;
}): boolean {
  if (
    input.actor.kind !== "user" ||
    !input.explicitHumanApproval ||
    input.patch.status !== "canary" ||
    !isCurrentSupervisedBasePolicyHash(input.patch.basePolicyHash) ||
    input.patch.sandboxEvaluation?.passed !== true ||
    input.patch.sandboxEvaluation.regressions.length > 0 ||
    input.patch.approval?.approvedBy.kind !== "user" ||
    input.patch.activatedBy?.kind !== "user" ||
    !input.patch.canary ||
    input.patch.canary.successfulEvaluations < 1 ||
    input.patch.canary.observedFailures >= input.patch.canary.failureThreshold
  ) {
    return false;
  }
  const remainsInEvaluatedProject =
    input.patch.scope.kind === "project" && input.patch.scope.projectId === input.targetProjectId;
  return remainsInEvaluatedProject || input.evaluationScopeCreated;
}

export function revertHarnessPatch(
  patch: HarnessPatch,
  actor: SupervisedActor,
  at: string,
  evidenceRefs: ReadonlyArray<EvidenceId>,
  reason = "Human-requested rollback.",
): HarnessPatch {
  if (patch.status !== "promoted" && patch.status !== "canary") {
    throw new Error("Only a promoted or canary Harness Patch can be rolled back.");
  }
  if (evidenceRefs.length === 0)
    throw new Error("Harness Patch rollback requires durable evidence.");
  if (reason.trim().length === 0) {
    throw new Error("Harness Patch rollback requires a durable reason.");
  }
  const next: HarnessPatch = {
    ...patch,
    status: "rolled_back",
    rollback: {
      reason,
      evidenceRefs: uniqueEvidenceRefs(evidenceRefs),
      rolledBackBy: actor,
      rolledBackAt: at,
    },
    updatedAt: at,
    revision: patchRevision(patch) + 1,
  };
  validateHarnessPatchUpdate(patch, next, actor);
  return next;
}
