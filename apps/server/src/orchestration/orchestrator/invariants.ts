import type {
  AssignmentState,
  OrchestratorCapability,
  OrchestratorRole,
  OrchestratorRunState,
  ThreadId,
} from "@synara/contracts";

import { OrchestrationCommandInvariantError } from "../Errors.ts";
import type { OrchestratorAggregateState } from "./projector.ts";

const ROLE_CAPABILITIES: Readonly<Record<OrchestratorRole, ReadonlySet<OrchestratorCapability>>> = {
  root: new Set([
    "state.read",
    "subtree.read",
    "child.assign",
    "child.retire",
    "link.request",
    "link.manage",
    "message.send",
    "artifact.publish",
    "artifact.release",
    "run.manage",
    "monitor.manage",
    "assignment.report",
    "assignment.verify",
    "assignment.accept",
    "task.manage",
    "writer-claim.manage",
  ]),
  child_owner: new Set([
    "state.read",
    "subtree.read",
    "child.assign",
    "child.retire",
    "link.request",
    "message.send",
    "artifact.publish",
    "assignment.report",
  ]),
  participant: new Set([
    "state.read",
    "link.request",
    "message.send",
    "artifact.publish",
    "assignment.report",
  ]),
  compiler: new Set(["state.read", "artifact.publish", "assignment.report"]),
  arbiter: new Set(["state.read", "artifact.publish", "assignment.report"]),
  verifier: new Set(["state.read", "artifact.publish", "assignment.report", "assignment.verify"]),
};

export const capabilitiesForRole = (role: OrchestratorRole): ReadonlySet<OrchestratorCapability> =>
  ROLE_CAPABILITIES[role];

export const activeOwnershipByChild = (
  state: OrchestratorAggregateState,
  childThreadId: ThreadId,
) =>
  state.ownershipEdges
    .filter((edge) => edge.childThreadId === childThreadId && edge.retiredAt === null)
    .toSorted((left, right) => right.contractVersion - left.contractVersion)[0] ?? null;

export const isReachableThread = (state: OrchestratorAggregateState, threadId: ThreadId): boolean =>
  state.root?.rootThreadId === threadId || activeOwnershipByChild(state, threadId) !== null;

export const wouldCreateOwnershipCycle = (input: {
  readonly state: OrchestratorAggregateState;
  readonly childThreadId: ThreadId;
  readonly parentThreadId: ThreadId;
}): boolean => {
  if (input.childThreadId === input.parentThreadId) return true;
  let cursor: ThreadId | null = input.parentThreadId;
  const visited = new Set<string>();
  while (cursor !== null && !visited.has(cursor)) {
    if (cursor === input.childThreadId) return true;
    visited.add(cursor);
    cursor = activeOwnershipByChild(input.state, cursor)?.parentThreadId ?? null;
  }
  return false;
};

export const assertCapabilityCeiling = (input: {
  readonly commandType: string;
  readonly role: OrchestratorRole;
  readonly capabilities: ReadonlyArray<OrchestratorCapability>;
  readonly parentCapabilities?: ReadonlySet<OrchestratorCapability>;
}): void => {
  const roleCeiling = capabilitiesForRole(input.role);
  const invalid = input.capabilities.find(
    (capability) =>
      !roleCeiling.has(capability) || input.parentCapabilities?.has(capability) === false,
  );
  if (invalid !== undefined) {
    throw new OrchestrationCommandInvariantError({
      commandType: input.commandType,
      detail: `Capability '${invalid}' exceeds the role or parent authority ceiling.`,
    });
  }
};

const RUN_TRANSITIONS: Readonly<Record<OrchestratorRunState, ReadonlySet<OrchestratorRunState>>> = {
  draft: new Set(["active", "brief_sealed", "cancelled", "blocked"]),
  active: new Set(["synthesizing", "decided", "cancelled", "blocked"]),
  synthesizing: new Set(["decided", "blocked", "cancelled"]),
  decided: new Set(["packet_published", "blocked"]),
  brief_sealed: new Set(["proposals_sealed", "blocked", "cancelled"]),
  proposals_sealed: new Set(["cross_review_sealed", "blocked", "cancelled"]),
  cross_review_sealed: new Set(["revisions_sealed", "blocked", "cancelled"]),
  revisions_sealed: new Set(["compiled", "blocked", "cancelled"]),
  compiled: new Set(["arbitrating", "blocked", "cancelled"]),
  arbitrating: new Set(["disagreement_round", "converged", "disputed", "blocked"]),
  disagreement_round: new Set(["arbitrating", "converged", "disputed", "blocked"]),
  converged: new Set(["packet_published"]),
  disputed: new Set(["owner_review_required", "packet_published"]),
  owner_review_required: new Set(["packet_published", "blocked"]),
  blocked: new Set(["active", "arbitrating", "cancelled"]),
  cancelled: new Set(),
  packet_published: new Set(),
};

export const canAdvanceRun = (from: OrchestratorRunState, to: OrchestratorRunState): boolean =>
  from === to || RUN_TRANSITIONS[from].has(to);

const ASSIGNMENT_TRANSITIONS: Readonly<Record<AssignmentState, ReadonlySet<AssignmentState>>> = {
  queued: new Set(["running", "cancelled", "failed"]),
  running: new Set([
    "waiting_on_thread",
    "waiting_on_user",
    "needs_permission",
    "blocked",
    "reported_complete",
    "failed",
    "cancelled",
  ]),
  waiting_on_thread: new Set(["running", "blocked", "failed", "cancelled"]),
  waiting_on_user: new Set(["running", "blocked", "failed", "cancelled"]),
  needs_permission: new Set(["running", "blocked", "failed", "cancelled"]),
  blocked: new Set(["running", "failed", "cancelled"]),
  reported_complete: new Set(["verified", "reopened", "failed"]),
  verified: new Set(["accepted", "reopened", "failed"]),
  accepted: new Set(["reopened"]),
  reopened: new Set(["running", "cancelled", "failed"]),
  failed: new Set(["reopened", "cancelled"]),
  cancelled: new Set(["reopened"]),
};

export const canTransitionAssignment = (from: AssignmentState, to: AssignmentState): boolean =>
  from === to || ASSIGNMENT_TRANSITIONS[from].has(to);
