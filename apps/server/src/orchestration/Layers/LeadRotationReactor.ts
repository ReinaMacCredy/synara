import {
  CommandId,
  LeadRotationId,
  MessageId,
  SupervisionAggregateId,
  type LeadRotation,
  type OrchestrationEvent,
  type OrchestrationThread,
  type ProfileSnapshot,
  type ProjectId,
} from "@synara/contracts";
import { Cause, Effect, Layer, Option, Semaphore, Stream } from "effect";

import {
  ProjectionOrchestratorRepository,
  type ProjectionOrchestratorCore,
} from "../../persistence/Services/ProjectionOrchestrator.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  LeadRotationReactor,
  type LeadRotationReactorShape,
} from "../Services/LeadRotationReactor.ts";

const AGGREGATE_ID = SupervisionAggregateId.makeUnsafe("supervision");

const commandId = (rotation: LeadRotation, phase: string) =>
  CommandId.makeUnsafe(`server:lead-rotation:${rotation.id}:${phase}:${rotation.revision}`);

const runtimeModeForProfile = (profile: ProfileSnapshot) =>
  profile.runtime.sandboxMode === "danger-full-access"
    ? ("full-access" as const)
    : ("approval-required" as const);

const primitiveProviderOptions = (options: Readonly<Record<string, unknown>>) =>
  Object.fromEntries(
    Object.entries(options).filter(
      (entry): entry is [string, string | number | boolean] =>
        typeof entry[1] === "string" ||
        typeof entry[1] === "number" ||
        typeof entry[1] === "boolean",
    ),
  );

const boundedHandoff = (
  thread: OrchestrationThread,
  predecessorCore: ProjectionOrchestratorCore | null,
): string => {
  const messages = thread.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-8)
    .map((message) => `${message.role}: ${message.text.slice(0, 1_500)}`)
    .join("\n\n");
  const activeEdges =
    predecessorCore?.ownershipEdges.filter((edge) => edge.retiredAt === null) ?? [];
  const assignments = predecessorCore?.assignments ?? [];
  return [
    `Predecessor Lead: ${thread.id}`,
    `Project: ${thread.projectId}`,
    `Active TaskProcess: ${predecessorCore?.root.root.activeProcessId ?? "none"}`,
    `Peer ownership routes to rebind: ${activeEdges.map((edge) => `${edge.parentThreadId} -> ${edge.childThreadId}`).join(", ") || "none"}`,
    `Assignment/task bindings retained on predecessor and reported blocked for automatic rebind: ${assignments.map((assignment) => assignment.assignmentId).join(", ") || "none"}`,
    "Bounded recent handoff:",
    messages || "No bounded transcript messages were available.",
    "Existing Project work and Peer history remain durable. Re-evaluate current topology before dispatching new work.",
  ]
    .join("\n\n")
    .slice(0, 12_000);
};

export const makeLeadRotationReactor = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const orchestratorRepository = yield* ProjectionOrchestratorRepository;
  const lock = yield* Semaphore.make(1);

  const rebindPeerOwnershipRoutes = Effect.fnUntraced(function* (
    rotation: LeadRotation,
    projectId: ProjectId,
  ) {
    const predecessorCoreOption = yield* orchestratorRepository.getCore(
      rotation.predecessorThreadId,
    );
    if (Option.isNone(predecessorCoreOption)) return;
    const activeEdges = predecessorCoreOption.value.ownershipEdges.filter(
      (edge) => edge.retiredAt === null,
    );
    const pending = [...activeEdges];
    const reachableParents = new Set<string>([rotation.predecessorThreadId]);
    const readModel = yield* engine.getReadModel();

    while (pending.length > 0) {
      const nextIndex = pending.findIndex((edge) => reachableParents.has(edge.parentThreadId));
      if (nextIndex < 0) {
        return yield* new Error(
          "Peer ownership routes could not be re-bound because the predecessor graph is disconnected.",
        );
      }
      const [edge] = pending.splice(nextIndex, 1);
      const child = readModel.threads.find(
        (thread) => thread.id === edge!.childThreadId && thread.deletedAt === null,
      );
      if (!child) {
        return yield* new Error(`Peer thread '${edge!.childThreadId}' is unavailable.`);
      }
      const replacementCoreOption = yield* orchestratorRepository.getCore(
        rotation.replacementThreadId,
      );
      if (Option.isNone(replacementCoreOption)) {
        return yield* new Error("Replacement Lead Root is unavailable for Peer route rebind.");
      }
      const replacementCore = replacementCoreOption.value;
      const parentThreadId =
        edge!.parentThreadId === rotation.predecessorThreadId
          ? rotation.replacementThreadId
          : edge!.parentThreadId;
      yield* engine.dispatch({
        type: "orchestrator.child.attach",
        commandId: commandId(rotation, `rebind-${edge!.childThreadId}`),
        rootThreadId: rotation.replacementThreadId,
        projectId,
        actor: { kind: "server", actorId: "lead-rotation-reactor" },
        protocolVersion: replacementCore.root.root.protocolVersion,
        expectedRevision: replacementCore.root.root.revision,
        createdAt: new Date().toISOString(),
        parentThreadId,
        childThreadId: edge!.childThreadId,
        role: edge!.role,
        capabilities: edge!.capabilities,
        continuity: { kind: "reuse", threadId: edge!.childThreadId },
        modelTarget: {
          provider: child.modelSelection.provider,
          model: child.modelSelection.model,
          runtimeMode: child.runtimeMode,
          workspaceRoot: child.workingDirectory ?? "",
          providerOptions: primitiveProviderOptions(child.modelSelection.options),
        },
        decisionReason: {
          ...edge!.decisionReason,
          summary:
            `Re-bound during Lead rotation ${rotation.id}: ${edge!.decisionReason.summary}`.slice(
              0,
              500,
            ),
          selectedAt: new Date().toISOString(),
        },
      });
      reachableParents.add(edge!.childThreadId);
    }
  });

  const advance = Effect.fnUntraced(function* (
    rotation: LeadRotation,
    state: LeadRotation["state"],
    patch: Partial<LeadRotation> = {},
  ) {
    const at = new Date().toISOString();
    yield* engine.dispatch({
      type: "supervision.lead.rotation.advance",
      commandId: commandId(rotation, state),
      aggregateId: AGGREGATE_ID,
      actor: { kind: "server", actorId: "lead-rotation-reactor" },
      expectedRevision: rotation.revision,
      createdAt: at,
      rotation: { ...rotation, ...patch, state, updatedAt: at },
    });
  });

  const fail = Effect.fnUntraced(function* (rotation: LeadRotation, error: unknown) {
    if (rotation.state !== "switched") {
      const readModel = yield* engine.getReadModel();
      const replacementThread = readModel.threads.find(
        (thread) => thread.id === rotation.replacementThreadId && thread.deletedAt === null,
      );
      const predecessorThread = readModel.threads.find(
        (thread) => thread.id === rotation.predecessorThreadId && thread.deletedAt === null,
      );
      const projectId = replacementThread?.projectId ?? predecessorThread?.projectId;
      const replacementRoot = yield* orchestratorRepository.getRoot(rotation.replacementThreadId);
      if (
        projectId !== undefined &&
        Option.isSome(replacementRoot) &&
        replacementRoot.value.root.state === "active"
      ) {
        yield* engine
          .dispatch({
            type: "orchestrator.root.archive",
            commandId: commandId(rotation, "cleanup-replacement-root"),
            rootThreadId: rotation.replacementThreadId,
            projectId,
            actor: { kind: "server", actorId: "lead-rotation-reactor" },
            protocolVersion: replacementRoot.value.root.protocolVersion,
            expectedRevision: replacementRoot.value.root.revision,
            createdAt: new Date().toISOString(),
            reason: `Lead rotation ${rotation.id} failed before pointer switch`,
          })
          .pipe(Effect.catch(() => Effect.void));
      }
      if (replacementThread && replacementThread.archivedAt === null) {
        yield* engine
          .dispatch({
            type: "thread.archive",
            commandId: commandId(rotation, "cleanup-replacement-thread"),
            threadId: rotation.replacementThreadId,
          })
          .pipe(Effect.catch(() => Effect.void));
      }
    }
    yield* advance(rotation, "failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  const reconcileRotationUnlocked = Effect.fnUntraced(function* (rotationId: LeadRotationId) {
    for (let step = 0; step < 8; step += 1) {
      const readModel = yield* engine.getReadModel();
      const rotation = readModel.supervision.rotations.find(
        (candidate) => candidate.id === rotationId,
      );
      if (!rotation || rotation.state === "completed" || rotation.state === "failed") return;
      const lead = readModel.supervision.leads.find(
        (candidate) => candidate.id === rotation.leadSeatId,
      );
      const predecessor = readModel.threads.find(
        (thread) => thread.id === rotation.predecessorThreadId && thread.deletedAt === null,
      );
      const profile = readModel.supervision.profileSnapshots.find(
        (candidate) => candidate.id === rotation.replacementProfileSnapshotId,
      );
      if (!lead || !predecessor || !profile) {
        yield* fail(
          rotation,
          "Lead, predecessor thread, or replacement profile snapshot is missing.",
        );
        return;
      }

      if (rotation.state === "requested") {
        const predecessorCore = yield* orchestratorRepository.getCore(rotation.predecessorThreadId);
        yield* advance(rotation, "frozen", {
          handoffSummary: boundedHandoff(predecessor, Option.getOrNull(predecessorCore)),
        });
        continue;
      }

      if (rotation.state === "frozen") {
        const project = readModel.projects.find(
          (candidate) => candidate.id === lead.projectId && candidate.deletedAt === null,
        );
        if (!project) {
          yield* fail(rotation, "Lead Project is unavailable.");
          return;
        }
        const replacementExists = readModel.threads.some(
          (thread) => thread.id === rotation.replacementThreadId && thread.deletedAt === null,
        );
        if (!replacementExists) {
          const createExit = yield* Effect.exit(
            engine.dispatch({
              type: "thread.create",
              commandId: commandId(rotation, "create-thread"),
              threadId: rotation.replacementThreadId,
              projectId: lead.projectId,
              title: `${predecessor.title} replacement`,
              modelSelection: {
                provider: profile.runtime.provider as "codex",
                model: profile.runtime.model,
                options: profile.runtime.providerOptions ?? {},
              },
              runtimeMode: runtimeModeForProfile(profile),
              interactionMode: "default",
              envMode: predecessor.envMode,
              branch: predecessor.branch,
              worktreePath: predecessor.worktreePath,
              workingDirectory: predecessor.workingDirectory ?? project.workspaceRoot,
              associatedWorktreePath: predecessor.associatedWorktreePath ?? null,
              associatedWorktreeBranch: predecessor.associatedWorktreeBranch ?? null,
              associatedWorktreeRef: predecessor.associatedWorktreeRef ?? null,
              parentThreadId: null,
              creationSource: "orchestrator_native",
              sourceThreadId: predecessor.id,
              subagentAgentId: null,
              subagentNickname: null,
              subagentRole: null,
              lastKnownPr: predecessor.lastKnownPr ?? null,
              createdAt: new Date().toISOString(),
            }),
          );
          if (createExit._tag === "Failure") {
            yield* fail(rotation, Cause.pretty(createExit.cause));
            return;
          }
        }
        const turnExit = yield* Effect.exit(
          engine.dispatch({
            type: "thread.turn.start",
            commandId: commandId(rotation, "start-replacement"),
            threadId: rotation.replacementThreadId,
            message: {
              messageId: MessageId.makeUnsafe(`lead-rotation:${rotation.id}:handoff`),
              role: "user",
              text:
                `<synara_lead_rotation_handoff>\n${rotation.handoffSummary ?? boundedHandoff(predecessor, null)}\n` +
                "You are the replacement Lead. Validate the bounded handoff, inspect durable Project state, and preserve ownership truth.\n</synara_lead_rotation_handoff>",
              attachments: [],
            },
            dispatchMode: "send",
            dispatchOrigin: "automation",
            runtimeMode: runtimeModeForProfile(profile),
            interactionMode: "default",
            orchestratorRoot: {
              protocolVersion: 1,
              modelTarget: {
                provider: profile.runtime.provider,
                model: profile.runtime.model,
                runtimeMode: runtimeModeForProfile(profile),
                workspaceRoot: predecessor.workingDirectory ?? project.workspaceRoot,
              },
              title: `${predecessor.title} replacement`,
            },
            createdAt: new Date().toISOString(),
          }),
        );
        if (turnExit._tag === "Failure") {
          yield* fail(rotation, Cause.pretty(turnExit.cause));
          return;
        }
        yield* advance(rotation, "replacement_created");
        return;
      }

      if (rotation.state === "replacement_created") {
        const replacement = readModel.threads.find(
          (thread) => thread.id === rotation.replacementThreadId && thread.deletedAt === null,
        );
        if (!replacement?.session || replacement.session.status === "starting") return;
        if (replacement.session.status === "error" || replacement.session.status === "stopped") {
          yield* fail(
            rotation,
            replacement.session.lastError ?? "Replacement provider failed before validation.",
          );
          return;
        }
        yield* advance(rotation, "validated");
        continue;
      }

      if (rotation.state === "validated") {
        const rebindExit = yield* Effect.exit(rebindPeerOwnershipRoutes(rotation, lead.projectId));
        if (rebindExit._tag === "Failure") {
          yield* fail(rotation, Cause.pretty(rebindExit.cause));
          return;
        }
        yield* advance(rotation, "switched");
        continue;
      }

      if (rotation.state === "switched") {
        const oldRoot = yield* orchestratorRepository.getRoot(rotation.predecessorThreadId);
        if (Option.isSome(oldRoot) && oldRoot.value.root.state === "active") {
          const archiveExit = yield* Effect.exit(
            engine.dispatch({
              type: "orchestrator.root.archive",
              commandId: commandId(rotation, "archive-predecessor"),
              rootThreadId: rotation.predecessorThreadId,
              projectId: lead.projectId,
              actor: { kind: "server", actorId: "lead-rotation-reactor" },
              protocolVersion: oldRoot.value.root.protocolVersion,
              expectedRevision: oldRoot.value.root.revision,
              createdAt: new Date().toISOString(),
              reason: `Replaced by Lead rotation ${rotation.id}`,
            }),
          );
          if (archiveExit._tag === "Failure") {
            yield* Effect.logWarning("Lead pointer switched but predecessor archival will retry", {
              rotationId: rotation.id,
              cause: Cause.pretty(archiveExit.cause),
            });
            return;
          }
        }
        yield* advance(rotation, "completed");
      }
    }
  });

  const reconcileRotation: LeadRotationReactorShape["reconcileRotation"] = (rotationId) =>
    lock.withPermits(1)(reconcileRotationUnlocked(rotationId));

  const reconcileAllUnlocked = Effect.gen(function* () {
    const readModel = yield* engine.getReadModel();
    for (const rotation of readModel.supervision.rotations) {
      if (rotation.state !== "completed" && rotation.state !== "failed") {
        yield* reconcileRotationUnlocked(rotation.id);
      }
    }
  });
  const reconcileAll: LeadRotationReactorShape["reconcileAll"] =
    lock.withPermits(1)(reconcileAllUnlocked);

  const reconcileEvent: LeadRotationReactorShape["reconcileEvent"] = (event: OrchestrationEvent) =>
    event.type.startsWith("supervision.lead-") || event.type === "thread.session-set"
      ? reconcileAll
      : Effect.void;

  const start: LeadRotationReactorShape["start"] = Effect.gen(function* () {
    yield* reconcileAll.pipe(Effect.catch(() => Effect.void));
    yield* engine.streamDomainEvents.pipe(
      Stream.runForEach((event) =>
        reconcileEvent(event).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Lead rotation reconciliation failed", {
              eventSequence: event.sequence,
              eventType: event.type,
              cause: Cause.pretty(cause),
            }),
          ),
        ),
      ),
      Effect.forkScoped,
    );
  });

  return {
    start,
    reconcileRotation,
    reconcileEvent,
    reconcileAll,
  } satisfies LeadRotationReactorShape;
});

export const LeadRotationReactorLive = Layer.effect(LeadRotationReactor, makeLeadRotationReactor);
