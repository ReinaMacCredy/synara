import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  LeadRotationId,
  MessageId,
  SupervisedGovernanceAggregateId,
  type LeadRotation,
  type ModelSelection,
  type OrchestrationEvent,
  type OrchestrationThread,
  type ProfileSnapshot,
  type RuntimeMode,
} from "@veylen/contracts";
import { Cause, Effect, Exit, Layer, Semaphore, Stream } from "effect";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  LeadRotationReactor,
  type LeadRotationReactorShape,
} from "../Services/LeadRotationReactor.ts";

const AGGREGATE_ID = SupervisedGovernanceAggregateId.makeUnsafe("supervised");
const RECOVERY_INTERVAL = "30 seconds";
const MAX_TRANSITIONS_PER_RECONCILIATION = 8;
const MAX_HANDOFF_MESSAGES = 32;

const commandId = (rotationId: LeadRotationId, suffix: string) =>
  CommandId.makeUnsafe(`server:lead-rotation:${rotationId}:${suffix}`);

const runtimeModeFor = (profile: ProfileSnapshot): RuntimeMode =>
  profile.runtime.sandboxMode === "danger-full-access" ? "full-access" : "approval-required";

const modelSelectionFor = (profile: ProfileSnapshot): ModelSelection =>
  ({
    provider: profile.runtime.provider,
    model: profile.runtime.model,
    options: profile.runtime.providerOptions ?? {},
  }) as ModelSelection;

const importedHandoffMessages = (source: OrchestrationThread, rotation: LeadRotation) => {
  const messages = source.messages.flatMap((message) =>
    (message.role === "user" || message.role === "assistant") &&
    message.createdAt <= rotation.createdAt
      ? [
          {
            messageId: message.id,
            role: message.role,
            text: message.text,
            ...(message.attachments === undefined ? {} : { attachments: message.attachments }),
            createdAt: message.createdAt,
            updatedAt: message.updatedAt,
          },
        ]
      : [],
  );
  return messages.slice(-MAX_HANDOFF_MESSAGES);
};

const bootstrapText = (rotation: LeadRotation, profile: ProfileSnapshot) =>
  [
    "<veylen_lead_replacement>",
    "You are being provisioned as the replacement Lead for an existing Room.",
    `lead_seat_id: ${rotation.leadSeatId}`,
    `predecessor_thread_id: ${rotation.predecessorThreadId}`,
    `replacement_thread_id: ${rotation.replacementThreadId}`,
    "Review the imported handoff context. Do not claim that Root has transferred until the durable Room topology says this thread is active.",
    "Apply this owner-resolved profile guidance while provisioning:",
    profile.runtime.developerInstructions,
    "</veylen_lead_replacement>",
  ].join("\n");

const providerFailure = (thread: OrchestrationThread): string | null => {
  const session = thread.session;
  if (!session || !["error", "interrupted", "stopped"].includes(session.status)) return null;
  return (
    session.lastError ??
    `Replacement provider session became ${session.status} before handoff acceptance.`
  );
};

const replacementReady = (thread: OrchestrationThread) =>
  thread.handoff?.bootstrapStatus === "completed" &&
  thread.session !== null &&
  ["idle", "ready", "running"].includes(thread.session.status);

const causeDetail = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause);
  return error instanceof Error ? error.message : String(error);
};

export const makeLeadRotationReactor = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const lock = yield* Semaphore.make(1);

  const load = Effect.fnUntraced(function* (rotationId: LeadRotationId) {
    const readModel = yield* engine.getReadModel();
    return {
      readModel,
      rotation:
        readModel.supervisedOrchestration.rotations.find(
          (candidate) => candidate.id === rotationId,
        ) ?? null,
    };
  });

  const advance = Effect.fnUntraced(function* (
    rotation: LeadRotation,
    state: LeadRotation["state"],
    at: string,
    error: string | null,
  ) {
    yield* engine.dispatch({
      type: "supervised.lead.rotation.advance",
      commandId: commandId(rotation.id, `advance:${state}:${rotation.revision}`),
      aggregateId: AGGREGATE_ID,
      actor: { kind: "server", actorId: "lead-rotation-reactor" },
      expectedRevision: rotation.revision,
      createdAt: at,
      rotation: { ...rotation, state, error, updatedAt: at },
    });
  });

  const ensureFailureVisible = Effect.fnUntraced(function* (
    rotation: LeadRotation,
    source: OrchestrationThread,
  ) {
    if (rotation.state !== "failed" || rotation.error === null) return;
    const activityId = EventId.makeUnsafe(
      `lead-rotation:${rotation.id}:failure:${rotation.revision}`,
    );
    if (source.activities.some((activity) => activity.id === activityId)) return;
    yield* engine.dispatch({
      type: "thread.activity.append",
      commandId: commandId(rotation.id, `failure-visible:${rotation.revision}`),
      threadId: source.id,
      activity: {
        id: activityId,
        tone: "error",
        kind: "supervised.lead-replacement.failed",
        summary: "Lead replacement failed; the existing Root remains active.",
        payload: {
          rotationId: rotation.id,
          replacementThreadId: rotation.replacementThreadId,
          detail: rotation.error,
        },
        turnId: null,
        createdAt: rotation.updatedAt,
      },
      createdAt: rotation.updatedAt,
    });
  });

  const fail = Effect.fnUntraced(function* (rotation: LeadRotation, detail: string, at: string) {
    if (rotation.state === "failed" || rotation.state === "completed") return;
    yield* advance(rotation, "failed", at, detail);
    const current = yield* load(rotation.id);
    const source = current.readModel.threads.find(
      (thread) => thread.id === rotation.predecessorThreadId && thread.deletedAt === null,
    );
    if (current.rotation && source) {
      yield* ensureFailureVisible(current.rotation, source);
    }
  });

  const createReplacement = Effect.fnUntraced(function* (
    rotation: LeadRotation,
    source: OrchestrationThread,
    profile: ProfileSnapshot,
  ) {
    const outcome = yield* Effect.exit(
      engine.dispatch({
        type: "thread.handoff.create",
        commandId: commandId(rotation.id, `handoff:${rotation.revision}`),
        threadId: rotation.replacementThreadId,
        sourceThreadId: rotation.predecessorThreadId,
        projectId: source.projectId,
        title: `${source.title} replacement`,
        modelSelection: modelSelectionFor(profile),
        runtimeMode: runtimeModeFor(profile),
        interactionMode: source.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
        envMode: source.envMode,
        branch: source.branch,
        worktreePath: source.worktreePath,
        workingDirectory: source.workingDirectory,
        associatedWorktreePath: source.associatedWorktreePath,
        associatedWorktreeBranch: source.associatedWorktreeBranch,
        associatedWorktreeRef: source.associatedWorktreeRef,
        createBranchFlowCompleted: source.createBranchFlowCompleted,
        importedMessages: importedHandoffMessages(source, rotation),
        createdAt: rotation.createdAt,
      }),
    );
    return Exit.isFailure(outcome) ? causeDetail(outcome.cause) : null;
  });

  const startReplacement = Effect.fnUntraced(function* (
    rotation: LeadRotation,
    thread: OrchestrationThread,
    profile: ProfileSnapshot,
  ) {
    const messageId = MessageId.makeUnsafe(
      `lead-rotation:${rotation.id}:bootstrap:${rotation.revision}`,
    );
    if (thread.messages.some((message) => message.id === messageId)) return null;
    const outcome = yield* Effect.exit(
      engine.dispatch({
        type: "thread.turn.start",
        commandId: commandId(rotation.id, `bootstrap:${rotation.revision}`),
        threadId: rotation.replacementThreadId,
        message: {
          messageId,
          role: "user",
          text: bootstrapText(rotation, profile),
          attachments: [],
        },
        dispatchMode: "queue",
        dispatchOrigin: "automation",
        runtimeMode: runtimeModeFor(profile),
        interactionMode: thread.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: rotation.updatedAt,
      }),
    );
    return Exit.isFailure(outcome) ? causeDetail(outcome.cause) : null;
  });

  const reconcileRotationUnlocked = Effect.fnUntraced(function* (rotationId: LeadRotationId) {
    for (let transition = 0; transition < MAX_TRANSITIONS_PER_RECONCILIATION; transition += 1) {
      const { readModel, rotation } = yield* load(rotationId);
      if (!rotation || rotation.state === "completed") return;

      const source = readModel.threads.find(
        (thread) => thread.id === rotation.predecessorThreadId && thread.deletedAt === null,
      );
      const replacement = readModel.threads.find(
        (thread) => thread.id === rotation.replacementThreadId && thread.deletedAt === null,
      );
      const profile = readModel.supervisedOrchestration.profileSnapshots.find(
        (candidate) => candidate.id === rotation.replacementProfileSnapshotId,
      );

      if (!source) {
        yield* fail(rotation, "The predecessor Lead thread is unavailable.", rotation.updatedAt);
        return;
      }
      if (!profile) {
        yield* fail(
          rotation,
          "The replacement Lead profile snapshot is unavailable.",
          rotation.updatedAt,
        );
        return;
      }

      if (rotation.state === "requested") {
        yield* advance(rotation, "frozen", rotation.updatedAt, null);
        continue;
      }

      if (rotation.state === "failed") {
        yield* ensureFailureVisible(rotation, source);
        if (replacement && providerFailure(replacement) !== null) return;
        if (replacement && replacementReady(replacement)) {
          yield* advance(rotation, "validated", replacement.session!.updatedAt, null);
          continue;
        }
        yield* advance(
          rotation,
          replacement ? "replacement_created" : "frozen",
          replacement?.session?.updatedAt ?? rotation.updatedAt,
          rotation.error,
        );
        continue;
      }

      if (rotation.state === "frozen") {
        if (replacement) {
          if (replacement.handoff?.sourceThreadId !== rotation.predecessorThreadId) {
            yield* fail(
              rotation,
              "The replacement thread id is already bound to a different lineage.",
              rotation.updatedAt,
            );
            return;
          }
        } else {
          const creationFailure = yield* createReplacement(rotation, source, profile);
          if (creationFailure !== null) {
            yield* fail(rotation, creationFailure, rotation.updatedAt);
            return;
          }
        }
        const current = (yield* load(rotationId)).rotation;
        if (!current || current.state !== "frozen") continue;
        yield* advance(current, "replacement_created", current.updatedAt, current.error);
        continue;
      }

      if (!replacement) {
        yield* fail(
          rotation,
          "The replacement Lead thread disappeared before validation.",
          rotation.updatedAt,
        );
        return;
      }
      if (replacement.handoff?.sourceThreadId !== rotation.predecessorThreadId) {
        yield* fail(
          rotation,
          "The replacement Lead thread does not carry the requested predecessor handoff.",
          rotation.updatedAt,
        );
        return;
      }

      if (rotation.state === "replacement_created") {
        const sessionFailure = providerFailure(replacement);
        if (sessionFailure !== null) {
          yield* fail(rotation, sessionFailure, replacement.session!.updatedAt);
          return;
        }
        if (replacementReady(replacement)) {
          yield* advance(rotation, "validated", replacement.session!.updatedAt, null);
          continue;
        }
        const bootstrapFailure = yield* startReplacement(rotation, replacement, profile);
        if (bootstrapFailure !== null) {
          yield* fail(rotation, bootstrapFailure, rotation.updatedAt);
        }
        return;
      }

      if (rotation.state === "validated") {
        yield* advance(rotation, "switched", rotation.updatedAt, null);
        continue;
      }
      if (rotation.state === "switched") {
        yield* advance(rotation, "completed", rotation.updatedAt, null);
        continue;
      }
    }
  });

  const reconcileRotation: LeadRotationReactorShape["reconcileRotation"] = (rotationId) =>
    lock.withPermits(1)(reconcileRotationUnlocked(rotationId));

  const reconcilePendingUnlocked = Effect.gen(function* () {
    const readModel = yield* engine.getReadModel();
    for (const rotation of readModel.supervisedOrchestration.rotations) {
      if (rotation.state !== "completed") {
        if (rotation.state === "failed") {
          const source = readModel.threads.find(
            (thread) => thread.id === rotation.predecessorThreadId && thread.deletedAt === null,
          );
          if (source) yield* ensureFailureVisible(rotation, source);
          const replacement = readModel.threads.find(
            (thread) => thread.id === rotation.replacementThreadId && thread.deletedAt === null,
          );
          if (replacement && providerFailure(replacement) !== null) continue;
        }
        yield* reconcileRotationUnlocked(rotation.id);
      }
    }
  });
  const reconcilePending: LeadRotationReactorShape["reconcilePending"] =
    lock.withPermits(1)(reconcilePendingUnlocked);

  const reconcileEvent: LeadRotationReactorShape["reconcileEvent"] = (event) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const payloadRotation = (event.payload as { rotation?: { id?: unknown } }).rotation;
        if (typeof payloadRotation?.id === "string") {
          if (event.type === "supervised.lead-replacement-failed") {
            const { readModel, rotation } = yield* load(
              LeadRotationId.makeUnsafe(payloadRotation.id),
            );
            const source = rotation
              ? readModel.threads.find(
                  (thread) =>
                    thread.id === rotation.predecessorThreadId && thread.deletedAt === null,
                )
              : undefined;
            if (rotation && source) yield* ensureFailureVisible(rotation, source);
            return;
          }
          yield* reconcileRotationUnlocked(LeadRotationId.makeUnsafe(payloadRotation.id));
          return;
        }
        if (event.aggregateKind !== "thread") return;
        const readModel = yield* engine.getReadModel();
        const rotations = readModel.supervisedOrchestration.rotations.filter(
          (rotation) =>
            rotation.state !== "completed" &&
            (rotation.predecessorThreadId === event.aggregateId ||
              rotation.replacementThreadId === event.aggregateId) &&
            (rotation.state !== "failed" ||
              (rotation.replacementThreadId === event.aggregateId &&
                (event.type === "thread.session-set" || event.type === "thread.meta-updated"))),
        );
        for (const rotation of rotations) {
          yield* reconcileRotationUnlocked(rotation.id);
        }
      }),
    );

  const start: LeadRotationReactorShape["start"] = Effect.gen(function* () {
    const events = yield* engine.subscribeDomainEvents;
    yield* events.pipe(
      Stream.runForEach((event: OrchestrationEvent) =>
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
    yield* reconcilePending.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Lead rotation startup reconciliation failed", {
          cause: Cause.pretty(cause),
        }),
      ),
    );
    yield* Effect.sleep(RECOVERY_INTERVAL).pipe(
      Effect.andThen(reconcilePending),
      Effect.catchCause((cause) =>
        Effect.logWarning("Lead rotation periodic reconciliation failed", {
          cause: Cause.pretty(cause),
        }),
      ),
      Effect.forever,
      Effect.forkScoped,
    );
  });

  return {
    start,
    reconcileEvent,
    reconcileRotation,
    reconcilePending,
  } satisfies LeadRotationReactorShape;
});

export const LeadRotationReactorLive = Layer.effect(LeadRotationReactor, makeLeadRotationReactor);
