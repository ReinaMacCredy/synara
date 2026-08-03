import type {
  OrchestrationReadModel,
  OrchestratorCapability,
  ChildResultEnvelope,
  OrchestratorCommand,
  OrchestratorDomainEvent,
  OrchestratorRole,
  OrchestratorRoot,
  ThreadId,
} from "@synara/contracts";
import {
  ArbiterVerdict,
  ChildResultId,
  CompiledProposal,
  EventId,
  FinalDecisionPacket,
  OrchestratorLinkId,
} from "@synara/contracts";
import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";

import { OrchestrationCommandInvariantError } from "../Errors.ts";
import {
  activeOwnershipByChild,
  assertCapabilityCeiling,
  canAdvanceRun,
  canTransitionAssignment,
  capabilitiesForRole,
  isReachableThread,
  wouldCreateOwnershipCycle,
} from "./invariants.ts";
import type { OrchestratorAggregateState } from "./projector.ts";
import { ORCHESTRATOR_RESOURCE_POLICY_V1 } from "./resourcePolicy.ts";
import { ORCHESTRATOR_MONITOR_POLICY_V1 } from "./resourcePolicy.ts";
import {
  assignmentCompletionEvidenceIssue,
  assignmentReporterIsAuthorized,
  assignmentVerificationIssue,
} from "./assignmentEvidence.ts";
import { pathContains, writerClaimsConflict } from "./writerClaims.ts";

type UnsequencedOrchestratorEvent = Omit<OrchestratorDomainEvent, "sequence">;

const reject = (commandType: string, detail: string) =>
  Effect.fail(new OrchestrationCommandInvariantError({ commandType, detail }));

const latestAssignment = (state: OrchestratorAggregateState, assignmentId: string) =>
  state.assignments
    .filter((assignment) => assignment.assignmentId === assignmentId)
    .toSorted((left, right) => right.version - left.version)[0] ?? null;

const actorCapabilities = (
  state: OrchestratorAggregateState,
  command: OrchestratorCommand,
): ReadonlySet<OrchestratorCapability> => {
  if (command.actor.kind === "user") return capabilitiesForRole("root");
  if (command.actor.kind !== "thread") return new Set();
  if (command.actor.threadId === command.rootThreadId) return capabilitiesForRole("root");
  return new Set(activeOwnershipByChild(state, command.actor.threadId)?.capabilities ?? []);
};

const actorRole = (
  state: OrchestratorAggregateState,
  command: OrchestratorCommand,
): OrchestratorRole | null => {
  if (command.actor.kind === "user" || command.actor.kind === "server") return "root";
  if (command.actor.kind !== "thread") return null;
  if (command.actor.threadId === command.rootThreadId) return "root";
  return activeOwnershipByChild(state, command.actor.threadId)?.role ?? null;
};

const ARTIFACT_KINDS_BY_ROLE = {
  root: new Set([
    "brief",
    "proposal",
    "critique",
    "revision",
    "claim_ledger",
    "arbiter_verdict",
    "decision_packet",
    "evidence",
  ]),
  child_owner: new Set(["proposal", "critique", "revision", "evidence"]),
  participant: new Set(["proposal", "critique", "revision", "evidence"]),
  compiler: new Set(["claim_ledger"]),
  arbiter: new Set(["arbiter_verdict"]),
  verifier: new Set(["evidence"]),
} as const satisfies Readonly<Record<OrchestratorRole, ReadonlySet<string>>>;

const hasCapability = (
  state: OrchestratorAggregateState,
  command: OrchestratorCommand,
  capability: OrchestratorCapability,
) => actorCapabilities(state, command).has(capability);

const updatedRoot = (
  state: OrchestratorAggregateState,
  acceptedRevision: number,
  patch: Partial<OrchestratorRoot> = {},
): OrchestratorRoot => ({
  ...state.root!,
  ...patch,
  revision: acceptedRevision,
});

const event = (input: {
  readonly command: OrchestratorCommand;
  readonly acceptedRevision: number;
  readonly type: OrchestratorDomainEvent["type"];
  readonly root: OrchestratorRoot;
  readonly payload?: Partial<OrchestratorDomainEvent["payload"]>;
}): UnsequencedOrchestratorEvent => {
  const meaningfullyActive = new Set<OrchestratorDomainEvent["type"]>([
    "orchestrator.child.attached",
    "orchestrator.assignment.status-reported",
    "orchestrator.assignment.accepted",
    "orchestrator.assignment.reopened",
    "orchestrator.child-result.resolved",
    "orchestrator.message.enqueued",
  ]).has(input.type);
  const root = meaningfullyActive
    ? {
        ...input.root,
        lastMeaningfulActivityAt: input.command.createdAt,
        latestActivityRevision: input.acceptedRevision,
      }
    : input.root;
  return {
    eventId: EventId.makeUnsafe(crypto.randomUUID()),
    aggregateKind: "orchestrator",
    aggregateId: input.command.rootThreadId,
    type: input.type,
    payload: {
      rootThreadId: input.command.rootThreadId,
      projectId: input.command.projectId,
      actor: input.command.actor,
      protocolVersion: input.command.protocolVersion,
      acceptedRevision: input.acceptedRevision,
      root,
      ...input.payload,
    },
    occurredAt: input.command.createdAt,
    commandId: input.command.commandId,
    causationEventId: null,
    correlationId: input.command.commandId,
    metadata: {},
  };
};

const directOwnershipPair = (
  state: OrchestratorAggregateState,
  left: ThreadId,
  right: ThreadId,
): boolean =>
  state.ownershipEdges.some(
    (edge) =>
      edge.retiredAt === null &&
      ((edge.parentThreadId === left && edge.childThreadId === right) ||
        (edge.parentThreadId === right && edge.childThreadId === left)),
  );

const canSend = (
  state: OrchestratorAggregateState,
  source: ThreadId,
  target: ThreadId,
  at: string,
): boolean => {
  if (source === state.root?.rootThreadId && isReachableThread(state, target)) return true;
  if (target === state.root?.rootThreadId && isReachableThread(state, source)) return true;
  if (directOwnershipPair(state, source, target)) return true;
  return state.communicationLinks.some((link) => {
    if (link.state !== "granted" || (link.expiresAt !== null && link.expiresAt <= at)) return false;
    if (link.direction === "bidirectional") {
      return (
        (link.sourceThreadId === source && link.targetThreadId === target) ||
        (link.sourceThreadId === target && link.targetThreadId === source)
      );
    }
    if (link.direction === "source_to_target") {
      return link.sourceThreadId === source && link.targetThreadId === target;
    }
    return link.targetThreadId === source && link.sourceThreadId === target;
  });
};

export const decideOrchestratorCommand = Effect.fn("decideOrchestratorCommand")(function* (input: {
  readonly command: OrchestratorCommand;
  readonly state: OrchestratorAggregateState;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  UnsequencedOrchestratorEvent | ReadonlyArray<UnsequencedOrchestratorEvent>,
  OrchestrationCommandInvariantError
> {
  const { command, state, readModel } = input;
  if (command.protocolVersion !== 1) {
    return yield* reject(
      command.type,
      `Unsupported Orchestrator protocol ${command.protocolVersion}.`,
    );
  }

  if (command.type === "orchestrator.root.create") {
    if (state.root !== null || command.expectedRevision !== 0) {
      return yield* reject(command.type, "Root already exists or expectedRevision is not zero.");
    }
    if (command.actor.kind !== "user") {
      return yield* reject(command.type, "Only the user may designate an Orchestrator Root.");
    }
    if (command.activeProcessId !== null) {
      return yield* reject(
        command.type,
        "A new Root starts without an active process; attach its Root-owned process after creation.",
      );
    }
    const project = readModel.projects.find(
      (candidate) => candidate.id === command.projectId && candidate.deletedAt === null,
    );
    const rootThread = readModel.threads.find(
      (candidate) => candidate.id === command.rootThreadId && candidate.deletedAt === null,
    );
    const isOrchestratorWorkspace = project?.kind === "project" || project?.kind === "chat";
    if (!isOrchestratorWorkspace || rootThread?.projectId !== command.projectId) {
      return yield* reject(
        command.type,
        "Root must be an active thread in an active workspace container.",
      );
    }
    if (rootThread.subagentAgentId !== null && rootThread.subagentAgentId !== undefined) {
      return yield* reject(
        command.type,
        "Provider-native subagents cannot become Orchestrator Roots.",
      );
    }
    const root: OrchestratorRoot = {
      rootThreadId: command.rootThreadId,
      projectId: command.projectId,
      protocolVersion: 1,
      state: "active",
      activeProcessId: command.activeProcessId,
      resourcePolicyVersion: 1,
      createdAt: command.createdAt,
      archivedAt: null,
      lastMeaningfulActivityAt: command.createdAt,
      pinnedAt: null,
      latestActivityRevision: 1,
      revision: 1,
    };
    return event({ command, acceptedRevision: 1, type: "orchestrator.root.created", root });
  }

  if (state.root === null) {
    return yield* reject(command.type, "Orchestrator Root does not exist.");
  }
  if (
    command.projectId !== state.root.projectId ||
    command.rootThreadId !== state.root.rootThreadId
  ) {
    return yield* reject(
      command.type,
      "Command does not match the Root project and thread identity.",
    );
  }
  if (command.expectedRevision !== state.revision) {
    return yield* reject(
      command.type,
      `Revision conflict: expected ${command.expectedRevision}, current ${state.revision}.`,
    );
  }
  if (command.type === "orchestrator.root.restore") {
    if (command.actor.kind !== "user") {
      return yield* reject(command.type, "Only the user may restore an Orchestrator Root.");
    }
    if (state.root.state !== "archived") {
      return yield* reject(command.type, "Only an archived Orchestrator Root can be restored.");
    }
    const acceptedRevision = state.revision + 1;
    return event({
      command,
      acceptedRevision,
      type: "orchestrator.root.restored",
      root: updatedRoot(state, acceptedRevision, {
        state: "active",
        archivedAt: null,
      }),
    });
  }
  if (state.root.state === "archived") {
    return yield* reject(command.type, "Archived Roots reject further mutation.");
  }

  const acceptedRevision = state.revision + 1;
  const root = updatedRoot(state, acceptedRevision);

  switch (command.type) {
    case "orchestrator.root.archive": {
      if (command.actor.kind !== "user") {
        return yield* reject(command.type, "Only the user may archive an Orchestrator Root.");
      }
      const archivedRoot = updatedRoot(state, acceptedRevision, {
        state: "archived",
        archivedAt: command.createdAt,
      });
      return event({
        command,
        acceptedRevision,
        type: "orchestrator.root.archived",
        root: archivedRoot,
        payload: { reason: command.reason },
      });
    }

    case "orchestrator.root.active-process.set": {
      if (
        command.actor.kind !== "user" &&
        (command.actor.kind !== "thread" || command.actor.threadId !== command.rootThreadId)
      ) {
        return yield* reject(
          command.type,
          "Only the user or Root thread may select the active process.",
        );
      }
      if (state.root.activeProcessId === command.activeProcessId) {
        return yield* reject(command.type, "Active process selection is unchanged.");
      }
      return event({
        command,
        acceptedRevision,
        type: "orchestrator.root.active-process-set",
        root: updatedRoot(state, acceptedRevision, { activeProcessId: command.activeProcessId }),
      });
    }

    case "orchestrator.child.attach": {
      if (!hasCapability(state, command, "child.assign")) {
        return yield* reject(command.type, "Actor lacks child.assign capability.");
      }
      if (!isReachableThread(state, command.parentThreadId)) {
        return yield* reject(command.type, "Parent thread is not reachable from this Root.");
      }
      const child = readModel.threads.find(
        (thread) => thread.id === command.childThreadId && thread.deletedAt === null,
      );
      if (child?.projectId !== command.projectId) {
        return yield* reject(command.type, "Child must be an active thread in the Root project.");
      }
      if (child.subagentAgentId !== null && child.subagentAgentId !== undefined) {
        return yield* reject(command.type, "Provider-native subagents are not graph participants.");
      }
      if (activeOwnershipByChild(state, command.childThreadId) !== null) {
        return yield* reject(command.type, "Child already has an active Orchestrator parent.");
      }
      if (
        wouldCreateOwnershipCycle({
          state,
          childThreadId: command.childThreadId,
          parentThreadId: command.parentThreadId,
        })
      ) {
        return yield* reject(command.type, "Ownership edge would create a cycle.");
      }
      const parentCapabilities =
        command.parentThreadId === command.rootThreadId
          ? capabilitiesForRole("root")
          : new Set(activeOwnershipByChild(state, command.parentThreadId)?.capabilities ?? []);
      const ceiling = yield* Effect.try({
        try: () =>
          assertCapabilityCeiling({
            commandType: command.type,
            role: command.role,
            capabilities: command.capabilities,
            parentCapabilities,
          }),
        catch: (cause) =>
          cause instanceof OrchestrationCommandInvariantError
            ? cause
            : new OrchestrationCommandInvariantError({
                commandType: command.type,
                detail: "Capability ceiling validation failed.",
              }),
      });
      void ceiling;
      const previousVersions = state.ownershipEdges
        .filter((edge) => edge.childThreadId === command.childThreadId)
        .map((edge) => edge.contractVersion);
      const contractVersion = Math.max(0, ...previousVersions) + 1;
      const ownershipEdge = {
        rootThreadId: command.rootThreadId,
        parentThreadId: command.parentThreadId,
        childThreadId: command.childThreadId,
        role: command.role,
        capabilities: command.capabilities,
        contractVersion,
        sourceThreadId:
          command.actor.kind === "thread" ? command.actor.threadId : command.rootThreadId,
        sourceTurnId: null,
        sourceOperationId: null,
        activeFrom: command.createdAt,
        retiredAt: null,
        decisionReason: command.decisionReason,
      } as const;
      return event({
        command,
        acceptedRevision,
        type: "orchestrator.child.attached",
        root,
        payload: { ownershipEdge },
      });
    }

    case "orchestrator.child.create":
      return yield* reject(
        command.type,
        "Child creation must be expanded by the orchestration engine transaction boundary.",
      );

    case "orchestrator.child.retire": {
      if (!hasCapability(state, command, "child.retire")) {
        return yield* reject(command.type, "Actor lacks child.retire capability.");
      }
      const existing = activeOwnershipByChild(state, command.childThreadId);
      if (existing === null)
        return yield* reject(command.type, "Child has no active ownership edge.");
      return event({
        command,
        acceptedRevision,
        type: "orchestrator.child.retired",
        root,
        payload: {
          ownershipEdge: { ...existing, retiredAt: command.createdAt },
          reason: command.reason,
        },
      });
    }

    case "orchestrator.child.reparent": {
      if (!hasCapability(state, command, "child.assign")) {
        return yield* reject(command.type, "Actor lacks child.assign capability.");
      }
      const existing = activeOwnershipByChild(state, command.childThreadId);
      if (existing === null || !isReachableThread(state, command.parentThreadId)) {
        return yield* reject(command.type, "Child or new parent is not active in this tree.");
      }
      if (
        wouldCreateOwnershipCycle({
          state,
          childThreadId: command.childThreadId,
          parentThreadId: command.parentThreadId,
        })
      ) {
        return yield* reject(command.type, "Reparenting would create an ownership cycle.");
      }
      return event({
        command,
        acceptedRevision,
        type: "orchestrator.child.reparented",
        root,
        payload: {
          ownershipEdge: {
            ...existing,
            parentThreadId: command.parentThreadId,
            contractVersion: existing.contractVersion + 1,
            activeFrom: command.createdAt,
            retiredAt: null,
          },
        },
      });
    }

    case "orchestrator.link.request": {
      if (!hasCapability(state, command, "link.request")) {
        return yield* reject(command.type, "Actor lacks link.request capability.");
      }
      if (
        !isReachableThread(state, command.sourceThreadId) ||
        !isReachableThread(state, command.targetThreadId) ||
        command.sourceThreadId === command.targetThreadId
      ) {
        return yield* reject(command.type, "Link endpoints must be distinct reachable threads.");
      }
      if (command.taskId === null && command.runId === null) {
        return yield* reject(command.type, "Cross-links require task or run scope.");
      }
      if (command.expiresAt <= command.createdAt) {
        return yield* reject(command.type, "Cross-link expiry must be in the future.");
      }
      if (state.communicationLinks.some((link) => link.id === command.linkId)) {
        return yield* reject(command.type, "Link identity already exists.");
      }
      return event({
        command,
        acceptedRevision,
        type: "orchestrator.link.requested",
        root,
        payload: {
          link: {
            id: command.linkId,
            rootThreadId: command.rootThreadId,
            sourceThreadId: command.sourceThreadId,
            targetThreadId: command.targetThreadId,
            direction: command.direction,
            taskId: command.taskId,
            runId: command.runId,
            capabilities: command.capabilities,
            requestedBy: command.actor,
            grantedBy: null,
            reason: command.reason,
            state: "requested",
            createdAt: command.createdAt,
            expiresAt: command.expiresAt,
            updatedAt: command.createdAt,
          },
        },
      });
    }

    case "orchestrator.link.set": {
      if (!hasCapability(state, command, "link.manage")) {
        return yield* reject(command.type, "Actor lacks link.manage capability.");
      }
      const link = state.communicationLinks.find((candidate) => candidate.id === command.linkId);
      if (!link) return yield* reject(command.type, "Link does not exist.");
      if (link.state !== "requested" && command.state === "granted") {
        return yield* reject(command.type, "Only a requested link may be granted.");
      }
      return event({
        command,
        acceptedRevision,
        type: "orchestrator.link.set",
        root,
        payload: {
          link: {
            ...link,
            state: command.state,
            reason: command.reason,
            grantedBy: command.state === "granted" ? command.actor : link.grantedBy,
            updatedAt: command.createdAt,
          },
        },
      });
    }

    case "orchestrator.assignment.create": {
      if (!hasCapability(state, command, "child.assign")) {
        return yield* reject(command.type, "Actor lacks child.assign capability.");
      }
      if (
        command.contract.version !== 1 ||
        command.contract.taskId === undefined ||
        latestAssignment(state, command.contract.assignmentId) !== null
      ) {
        return yield* reject(
          command.type,
          "Assignment identity/version is invalid or already exists.",
        );
      }
      if (
        !isReachableThread(state, command.contract.ownerThreadId) ||
        !isReachableThread(state, command.contract.assigneeThreadId)
      ) {
        return yield* reject(command.type, "Assignment threads must be reachable from the Root.");
      }
      if (
        command.actor.kind !== "thread" ||
        command.contract.ownerThreadId !== command.actor.threadId ||
        (command.contract.continuity.kind === "reuse" &&
          command.contract.continuity.threadId !== command.contract.assigneeThreadId)
      ) {
        return yield* reject(
          command.type,
          "Assignment owner and continuity must match the authenticated caller and assignee.",
        );
      }
      const assigneeCapabilities =
        command.contract.assigneeThreadId === command.rootThreadId
          ? capabilitiesForRole("root")
          : new Set(
              activeOwnershipByChild(state, command.contract.assigneeThreadId)?.capabilities ?? [],
            );
      if (
        command.contract.allowedCapabilities.some(
          (capability) => !assigneeCapabilities.has(capability),
        )
      ) {
        return yield* reject(
          command.type,
          "Assignment capabilities exceed the assignee's durable ownership grant.",
        );
      }
      return event({
        command,
        acceptedRevision,
        type: "orchestrator.assignment.created",
        root,
        payload: { assignment: command.contract },
      });
    }

    case "orchestrator.assignment.contract.update": {
      if (!hasCapability(state, command, "child.assign")) {
        return yield* reject(command.type, "Actor lacks child.assign capability.");
      }
      const current = latestAssignment(state, command.contract.assignmentId);
      if (
        current === null ||
        command.contract.version !== current.version + 1 ||
        command.contract.taskId !== current.taskId ||
        JSON.stringify(command.contract.immutableUserConstraints) !==
          JSON.stringify(current.immutableUserConstraints)
      ) {
        return yield* reject(
          command.type,
          "Assignment contract version or immutable fields are stale.",
        );
      }
      return event({
        command,
        acceptedRevision,
        type: "orchestrator.assignment.contract-updated",
        root,
        payload: { assignment: command.contract },
      });
    }

    case "orchestrator.child-result.resolve": {
      const result = state.childResults.find(
        (candidate) => candidate.resultId === command.resultId,
      );
      if (result === undefined) {
        return yield* reject(command.type, "Child result does not exist in this Root.");
      }
      const isRootActor =
        command.actor.kind === "user" ||
        (command.actor.kind === "thread" && command.actor.threadId === command.rootThreadId);
      if (!isRootActor || !hasCapability(state, command, "assignment.accept")) {
        return yield* reject(command.type, "Only the Root may resolve a child result.");
      }
      if (result.reviewState !== "pending" || result.revision !== command.expectedResultRevision) {
        return yield* reject(command.type, "Child result revision or review state is stale.");
      }
      const current = latestAssignment(state, result.assignmentId);
      if (current === null || current.taskId !== result.taskId) {
        return yield* reject(command.type, "Child result Assignment no longer exists.");
      }
      const nextState = command.decision === "accept" ? "accepted" : "reopened";
      if (!canTransitionAssignment(current.state, nextState)) {
        return yield* reject(
          command.type,
          `Illegal assignment transition ${current.state} -> ${nextState}.`,
        );
      }
      const childResult: ChildResultEnvelope = {
        ...result,
        revision: result.revision + 1,
        reviewState: command.decision === "accept" ? "accepted" : "changes_requested",
        reviewedAt: command.createdAt,
        reviewedByThreadId: command.rootThreadId,
        feedback: command.feedback,
      };
      return event({
        command,
        acceptedRevision,
        type: "orchestrator.child-result.resolved",
        root,
        payload: {
          assignment: { ...current, state: nextState, updatedAt: command.createdAt },
          childResult,
          ...(command.decision === "request_changes" && command.feedback !== null
            ? { reason: command.feedback }
            : {}),
        },
      });
    }

    case "orchestrator.assignment.status.report":
    case "orchestrator.assignment.verify":
    case "orchestrator.assignment.accept":
    case "orchestrator.assignment.reopen": {
      const assignmentId = command.assignmentId;
      const current = latestAssignment(state, assignmentId);
      if (current === null || current.taskId !== command.taskId) {
        return yield* reject(command.type, "Assignment/task identity does not exist.");
      }
      let nextState = current.state;
      let eventType: OrchestratorDomainEvent["type"];
      let evidence = undefined;
      let childResult: ChildResultEnvelope | undefined;
      let reason = undefined;
      if (command.type === "orchestrator.assignment.status.report") {
        if (!hasCapability(state, command, "assignment.report")) {
          return yield* reject(command.type, "Actor lacks assignment.report capability.");
        }
        if (
          !assignmentReporterIsAuthorized({
            assignment: current,
            actorThreadId: command.actor.kind === "thread" ? command.actor.threadId : null,
            rootThreadId: command.rootThreadId,
          })
        ) {
          return yield* reject(
            command.type,
            "Only the assignee, Root, or authorized user may report Assignment status.",
          );
        }
        nextState = command.state;
        evidence = command.evidence ?? undefined;
        if (command.state === "reported_complete") {
          const issue = assignmentCompletionEvidenceIssue({
            assignment: current,
            taskId: command.taskId,
            evidence: command.evidence,
            progressEvidenceRefs: command.progressEvidenceRefs,
            artifacts: state.artifacts,
          });
          if (issue !== null) return yield* reject(command.type, issue);
          if (command.evidence === null) {
            return yield* reject(command.type, "Completion evidence is required.");
          }
          const contentHash = `sha256:${createHash("sha256")
            .update(JSON.stringify(command.evidence))
            .digest("hex")}`;
          childResult = {
            resultId: ChildResultId.makeUnsafe(`child-result-${crypto.randomUUID()}`),
            rootThreadId: command.rootThreadId,
            childThreadId: current.assigneeThreadId,
            assignmentId: current.assignmentId,
            taskId: current.taskId,
            finalMessage: command.summary,
            artifactRefs: command.evidence.artifactRefs,
            diffSummary: {
              changedPaths: command.evidence.changedPaths,
              diffRef: command.evidence.diffRef,
              ...(command.evidence.diffSummary === undefined ? {} : command.evidence.diffSummary),
            },
            contentHash,
            revision: 1,
            reviewState: "pending",
            submittedAt: command.createdAt,
            reviewedAt: null,
            reviewedByThreadId: null,
            feedback: null,
            evidence: command.evidence,
          };
        } else if (command.evidence !== null) {
          return yield* reject(
            command.type,
            "Completion evidence is accepted only with reported_complete status.",
          );
        }
        eventType = "orchestrator.assignment.status-reported";
      } else if (command.type === "orchestrator.assignment.verify") {
        if (!hasCapability(state, command, "assignment.verify")) {
          return yield* reject(command.type, "Actor lacks assignment.verify capability.");
        }
        const latestEvidence =
          state.assignmentEvidence
            .filter((candidate) => candidate.assignmentId === current.assignmentId)
            .toSorted((left, right) => right.reportedAt.localeCompare(left.reportedAt))[0] ?? null;
        const issue = assignmentVerificationIssue({
          assignment: current,
          taskId: command.taskId,
          latestEvidence,
          evidenceArtifactIds: command.evidenceArtifactIds,
          artifacts: state.artifacts,
        });
        if (issue !== null) return yield* reject(command.type, issue);
        nextState = "verified";
        eventType = "orchestrator.assignment.verified";
      } else if (command.type === "orchestrator.assignment.accept") {
        if (!hasCapability(state, command, "assignment.accept")) {
          return yield* reject(command.type, "Actor lacks assignment.accept capability.");
        }
        nextState = "accepted";
        eventType = "orchestrator.assignment.accepted";
      } else {
        if (!hasCapability(state, command, "child.assign")) {
          return yield* reject(command.type, "Actor lacks authority to reopen assignments.");
        }
        nextState = "reopened";
        reason = command.reason;
        eventType = "orchestrator.assignment.reopened";
      }
      if (!canTransitionAssignment(current.state, nextState)) {
        return yield* reject(
          command.type,
          `Illegal assignment transition ${current.state} -> ${nextState}.`,
        );
      }
      return event({
        command,
        acceptedRevision,
        type: eventType,
        root,
        payload: {
          assignment: { ...current, state: nextState, updatedAt: command.createdAt },
          ...(evidence === undefined ? {} : { evidence }),
          ...(childResult === undefined ? {} : { childResult }),
          ...(reason === undefined ? {} : { reason }),
        },
      });
    }

    case "orchestrator.message.enqueue": {
      if (!hasCapability(state, command, "message.send")) {
        return yield* reject(command.type, "Actor lacks message.send capability.");
      }
      const message = command.message;
      const actorOwnsSender =
        command.actor.kind === "thread"
          ? command.actor.threadId === message.senderThreadId
          : command.actor.kind === "user"
            ? command.rootThreadId === message.senderThreadId
            : false;
      const reply =
        message.replyToMessageId === null
          ? null
          : (state.messages.find((candidate) => candidate.messageId === message.replyToMessageId) ??
            null);
      const expectedCorrelationId = reply?.correlationId ?? reply?.messageId ?? null;
      const correlationKey = message.correlationId ?? message.messageId;
      const messagesForCorrelation = state.messages.filter(
        (candidate) => (candidate.correlationId ?? candidate.messageId) === correlationKey,
      ).length;
      const mailboxDepth = state.messages.filter(
        (candidate) =>
          candidate.targetThreadId === message.targetThreadId &&
          candidate.deliveryState !== "responded" &&
          candidate.deliveryState !== "expired" &&
          candidate.deliveryState !== "failed",
      ).length;
      const validCorrelation =
        reply === null
          ? message.replyToMessageId === null &&
            message.correlationId === null &&
            message.hopCount === 0
          : reply.targetThreadId === message.senderThreadId &&
            message.correlationId === expectedCorrelationId &&
            message.hopCount === reply.hopCount + 1;
      if (
        message.rootThreadId !== command.rootThreadId ||
        !actorOwnsSender ||
        message.expiresAt <= command.createdAt ||
        message.deliveryState !== "queued" ||
        message.deliveryAttemptId !== null ||
        state.messages.some((existing) => existing.messageId === message.messageId) ||
        !isReachableThread(state, message.senderThreadId) ||
        !isReachableThread(state, message.targetThreadId) ||
        !validCorrelation ||
        Buffer.byteLength(message.body, "utf8") > ORCHESTRATOR_RESOURCE_POLICY_V1.maxMessageBytes ||
        mailboxDepth >= ORCHESTRATOR_RESOURCE_POLICY_V1.maxMailboxDepthPerThread ||
        messagesForCorrelation >= ORCHESTRATOR_RESOURCE_POLICY_V1.maxMessagesPerCorrelation ||
        message.hopCount > ORCHESTRATOR_RESOURCE_POLICY_V1.maxHopCount ||
        !canSend(state, message.senderThreadId, message.targetThreadId, command.createdAt)
      ) {
        return yield* reject(
          command.type,
          "Message identity, correlation, resource ceiling, expiry, state, or communication path is invalid.",
        );
      }
      return event({
        command,
        acceptedRevision,
        type: "orchestrator.message.enqueued",
        root,
        payload: { message },
      });
    }

    case "orchestrator.message.delivery.mark":
    case "orchestrator.message.response.mark": {
      if (command.actor.kind !== "server") {
        return yield* reject(command.type, "Only the server may settle mailbox delivery state.");
      }
      const message = state.messages.find((candidate) => candidate.messageId === command.messageId);
      if (!message) return yield* reject(command.type, "Mailbox message does not exist.");
      if (command.type === "orchestrator.message.delivery.mark") {
        const validTransition =
          (message.deliveryState === "queued" &&
            (command.deliveryState === "processing" ||
              command.deliveryState === "expired" ||
              command.deliveryState === "failed")) ||
          (message.deliveryState === "processing" &&
            (command.deliveryState === "delivered" || command.deliveryState === "failed")) ||
          (message.deliveryState === command.deliveryState &&
            message.deliveryAttemptId === command.deliveryAttemptId);
        if (!validTransition) {
          return yield* reject(
            command.type,
            `Illegal mailbox delivery transition ${message.deliveryState} -> ${command.deliveryState}.`,
          );
        }
      } else {
        const response = state.messages.find(
          (candidate) => candidate.messageId === command.responseMessageId,
        );
        if (
          message.deliveryState !== "delivered" ||
          response === undefined ||
          response.replyToMessageId !== message.messageId ||
          response.correlationId !== (message.correlationId ?? message.messageId)
        ) {
          return yield* reject(
            command.type,
            "Response receipt must reference a correlated reply to a delivered message.",
          );
        }
      }
      const deliveryState =
        command.type === "orchestrator.message.response.mark" ? "responded" : command.deliveryState;
      return event({
        command,
        acceptedRevision,
        type:
          command.type === "orchestrator.message.response.mark"
            ? "orchestrator.message.response-marked"
            : "orchestrator.message.delivery-marked",
        root,
        payload: {
          message: {
            ...message,
            deliveryState,
            deliveryAttemptId:
              command.type === "orchestrator.message.delivery.mark"
                ? command.deliveryAttemptId
                : message.deliveryAttemptId,
            updatedAt: command.createdAt,
          },
        },
      });
    }

    case "orchestrator.artifact.publish": {
      if (!hasCapability(state, command, "artifact.publish")) {
        return yield* reject(command.type, "Actor lacks artifact.publish capability.");
      }
      const role = actorRole(state, command);
      if (
        role === null ||
        !ARTIFACT_KINDS_BY_ROLE[role].has(command.artifact.kind) ||
        command.artifact.rootThreadId !== command.rootThreadId ||
        (command.actor.kind === "thread" &&
          command.artifact.producerThreadId !== command.actor.threadId) ||
        !isReachableThread(state, command.artifact.producerThreadId) ||
        state.artifacts.some((artifact) => artifact.id === command.artifact.id)
      ) {
        return yield* reject(
          command.type,
          "Artifact kind, identity, producer, or Root scope is invalid for the caller role.",
        );
      }
      const structuredSchema =
        command.artifact.kind === "claim_ledger"
          ? CompiledProposal
          : command.artifact.kind === "arbiter_verdict"
            ? ArbiterVerdict
            : command.artifact.kind === "decision_packet"
              ? FinalDecisionPacket
              : null;
      if (structuredSchema !== null) {
        const valid = yield* Effect.sync(() => {
          try {
            Schema.decodeUnknownSync(structuredSchema)(JSON.parse(command.artifact.content));
            return true;
          } catch {
            return false;
          }
        });
        if (!valid) {
          return yield* reject(
            command.type,
            `Artifact kind ${command.artifact.kind} requires its canonical structured schema.`,
          );
        }
      }
      return event({
        command,
        acceptedRevision,
        type: "orchestrator.artifact.published",
        root,
        payload: { artifact: command.artifact },
      });
    }

    case "orchestrator.artifact.release": {
      if (!hasCapability(state, command, "artifact.release")) {
        return yield* reject(command.type, "Actor lacks artifact.release capability.");
      }
      const artifact = state.artifacts.find((candidate) => candidate.id === command.artifactId);
      if (!artifact) return yield* reject(command.type, "Artifact does not exist.");
      const legal =
        artifact.visibility === command.visibility ||
        (artifact.visibility === "private" &&
          (command.visibility === "root_released" || command.visibility === "public")) ||
        (artifact.visibility === "sealed" && command.visibility === "round_released") ||
        (artifact.visibility === "round_released" &&
          (command.visibility === "root_released" || command.visibility === "public")) ||
        (artifact.visibility === "root_released" && command.visibility === "public");
      if (!legal) return yield* reject(command.type, "Artifact visibility transition is illegal.");
      return event({
        command,
        acceptedRevision,
        type: "orchestrator.artifact.released",
        root,
        payload: { artifact: { ...artifact, visibility: command.visibility } },
      });
    }

    case "orchestrator.run.create": {
      if (!hasCapability(state, command, "run.manage")) {
        return yield* reject(command.type, "Actor lacks run.manage capability.");
      }
      if (
        command.run.rootThreadId !== command.rootThreadId ||
        command.run.state !== "draft" ||
        state.runs.some((run) => run.id === command.run.id)
      ) {
        return yield* reject(
          command.type,
          "Run identity, initial state, or Root scope is invalid.",
        );
      }
      return event({
        command,
        acceptedRevision,
        type: "orchestrator.run.created",
        root,
        payload: { run: command.run },
      });
    }

    case "orchestrator.run.advance": {
      if (!hasCapability(state, command, "run.manage")) {
        return yield* reject(command.type, "Actor lacks run.manage capability.");
      }
      const run = state.runs.find((candidate) => candidate.id === command.runId);
      if (!run || !canAdvanceRun(run.state, command.state)) {
        return yield* reject(command.type, "Run does not exist or transition is illegal.");
      }
      const missingArtifact = command.artifactIds.find(
        (artifactId) => !state.artifacts.some((artifact) => artifact.id === artifactId),
      );
      if (missingArtifact !== undefined) {
        return yield* reject(
          command.type,
          `Run transition references missing artifact ${missingArtifact}.`,
        );
      }
      return event({
        command,
        acceptedRevision,
        type: "orchestrator.run.advanced",
        root,
        payload: { run: { ...run, state: command.state, updatedAt: command.createdAt } },
      });
    }

    case "orchestrator.run.disposition.set": {
      if (!hasCapability(state, command, "run.manage")) {
        return yield* reject(command.type, "Actor lacks run.manage capability.");
      }
      const run = state.runs.find((candidate) => candidate.id === command.runId);
      if (!run) return yield* reject(command.type, "Run does not exist.");
      return event({
        command,
        acceptedRevision,
        type: "orchestrator.run.disposition-set",
        root,
        payload: {
          run: { ...run, disposition: command.disposition, updatedAt: command.createdAt },
          reason: command.reason,
        },
      });
    }

    case "orchestrator.monitor.register": {
      const selfOwnedWait =
        command.actor.kind === "thread" &&
        command.monitor.kind === "wait" &&
        command.monitor.ownerThreadId === command.actor.threadId;
      if (!hasCapability(state, command, "monitor.manage") && !selfOwnedWait) {
        return yield* reject(command.type, "Actor lacks monitor.manage capability.");
      }
      if (
        command.monitor.rootThreadId !== command.rootThreadId ||
        command.monitor.state !== "active" ||
        command.monitor.runCount !== 0 ||
        command.monitor.expiresAt <= command.createdAt ||
        !isReachableThread(state, command.monitor.ownerThreadId) ||
        (command.monitor.targetThreadId !== null &&
          !isReachableThread(state, command.monitor.targetThreadId)) ||
        state.monitors.filter((monitor) => monitor.state === "active").length >=
          ORCHESTRATOR_RESOURCE_POLICY_V1.maxActiveMonitorsPerRoot ||
        state.monitors.some((monitor) => monitor.id === command.monitor.id)
      ) {
        return yield* reject(command.type, "Monitor identity, state, or Root scope is invalid.");
      }
      const repeating = command.monitor.kind === "schedule" || command.monitor.kind === "heartbeat";
      if (
        repeating !== (command.monitor.cadenceMs !== null) ||
        repeating !== (command.monitor.nextWakeAt !== null) ||
        (!repeating && command.monitor.maxRuns !== 1) ||
        command.monitor.maxRuns > ORCHESTRATOR_MONITOR_POLICY_V1.maxRunsPerMonitor ||
        (command.monitor.cadenceMs !== null &&
          (command.monitor.cadenceMs < ORCHESTRATOR_MONITOR_POLICY_V1.minCadenceMs ||
            command.monitor.cadenceMs > ORCHESTRATOR_MONITOR_POLICY_V1.maxCadenceMs)) ||
        (command.monitor.nextWakeAt !== null &&
          (command.monitor.nextWakeAt <= command.createdAt ||
            command.monitor.nextWakeAt > command.monitor.expiresAt))
      ) {
        return yield* reject(
          command.type,
          "Monitor cadence, wake, expiry, or run bound is invalid.",
        );
      }
      return event({
        command,
        acceptedRevision,
        type: "orchestrator.monitor.registered",
        root,
        payload: { monitor: command.monitor },
      });
    }

    case "orchestrator.monitor.cancel":
    case "orchestrator.monitor.fire": {
      const monitor = state.monitors.find((candidate) => candidate.id === command.monitorId);
      const selfOwnedWait =
        command.type === "orchestrator.monitor.cancel" &&
        command.actor.kind === "thread" &&
        monitor?.kind === "wait" &&
        monitor.ownerThreadId === command.actor.threadId;
      if (
        command.type === "orchestrator.monitor.cancel" &&
        command.actor.kind !== "server" &&
        !hasCapability(state, command, "monitor.manage") &&
        !selfOwnedWait
      ) {
        return yield* reject(command.type, "Actor lacks monitor.manage capability.");
      }
      if (command.type === "orchestrator.monitor.fire" && command.actor.kind !== "server") {
        return yield* reject(command.type, "Only the native monitor runtime may fire monitors.");
      }
      if (!monitor || monitor.state !== "active") {
        return yield* reject(command.type, "Monitor does not exist or is not active.");
      }
      const fired = command.type === "orchestrator.monitor.fire";
      const nextRunCount = fired ? monitor.runCount + 1 : monitor.runCount;
      if (fired && nextRunCount > monitor.maxRuns) {
        return yield* reject(command.type, "Monitor has exhausted its bounded run count.");
      }
      const expired = fired && command.createdAt >= monitor.expiresAt;
      const repeating = monitor.kind === "schedule" || monitor.kind === "heartbeat";
      if (
        fired &&
        repeating &&
        !expired &&
        (monitor.nextWakeAt === null || command.createdAt < monitor.nextWakeAt)
      ) {
        return yield* reject(command.type, "Repeating monitor is not due yet.");
      }
      const candidateNextWakeAt =
        fired && repeating && monitor.cadenceMs !== null
          ? new Date(
              Math.max(Date.parse(command.createdAt), Date.parse(monitor.nextWakeAt!)) +
                monitor.cadenceMs,
            ).toISOString()
          : null;
      const remainsActive =
        fired &&
        repeating &&
        !expired &&
        nextRunCount < monitor.maxRuns &&
        candidateNextWakeAt !== null &&
        candidateNextWakeAt <= monitor.expiresAt;
      return event({
        command,
        acceptedRevision,
        type: fired ? "orchestrator.monitor.fired" : "orchestrator.monitor.cancelled",
        root,
        payload: {
          monitor: {
            ...monitor,
            state: fired ? (expired ? "expired" : remainsActive ? "active" : "fired") : "cancelled",
            runCount: nextRunCount,
            nextWakeAt: remainsActive ? candidateNextWakeAt : null,
          },
          reason: fired ? command.reasonCode : command.reason,
        },
      });
    }

    case "orchestrator.writer-claim.acquire": {
      if (!hasCapability(state, command, "writer-claim.manage")) {
        return yield* reject(command.type, "Actor lacks writer-claim.manage capability.");
      }
      const claim = command.claim;
      const conflicts = state.writerClaims.some(
        (current) =>
          current.releasedAt === null &&
          current.expiresAt > command.createdAt &&
          writerClaimsConflict(current, claim),
      );
      const assignment = latestAssignment(state, claim.assignmentId);
      const project = readModel.projects.find((candidate) => candidate.id === command.projectId);
      const activeWriterCount = state.writerClaims.filter(
        (candidate) =>
          candidate.releasedAt === null &&
          candidate.expiresAt > command.createdAt &&
          candidate.mode === "write",
      ).length;
      if (
        claim.rootThreadId !== command.rootThreadId ||
        claim.releasedAt !== null ||
        claim.acquiredAt !== command.createdAt ||
        claim.expiresAt <= command.createdAt ||
        state.writerClaims.some((candidate) => candidate.id === claim.id) ||
        assignment === null ||
        assignment.assigneeThreadId !== claim.threadId ||
        !isReachableThread(state, claim.threadId) ||
        project?.workspaceRoot !== claim.workspaceRoot ||
        !pathContains(claim.workspaceRoot, claim.normalizedPathPrefix) ||
        (claim.mode === "write" &&
          activeWriterCount >= ORCHESTRATOR_RESOURCE_POLICY_V1.maxActiveWriters) ||
        conflicts
      ) {
        return yield* reject(
          command.type,
          "Writer claim scope is invalid or conflicts with an active claim.",
        );
      }
      return event({
        command,
        acceptedRevision,
        type: "orchestrator.writer-claim.acquired",
        root,
        payload: { writerClaim: claim },
      });
    }

    case "orchestrator.writer-claim.release": {
      if (!hasCapability(state, command, "writer-claim.manage")) {
        return yield* reject(command.type, "Actor lacks writer-claim.manage capability.");
      }
      const claim = state.writerClaims.find((candidate) => candidate.id === command.claimId);
      if (!claim || claim.releasedAt !== null) {
        return yield* reject(command.type, "Writer claim does not exist or is already released.");
      }
      return event({
        command,
        acceptedRevision,
        type: "orchestrator.writer-claim.released",
        root,
        payload: {
          writerClaim: { ...claim, releasedAt: command.createdAt },
          reason: command.reason,
        },
      });
    }
  }
});
