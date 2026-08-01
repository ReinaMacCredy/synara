import {
  CommandId,
  OrchestratorMessageId,
  type OrchestratorMessageEnvelope,
  type ThreadId,
} from "@synara/contracts";
import { Cause, Duration, Effect, Layer, Option, Semaphore, Stream } from "effect";

import { OrchestrationCommandReceiptRepository } from "../../persistence/Services/OrchestrationCommandReceipts.ts";
import {
  OrchestrationEventDeliveryRepository,
  PROVIDER_COMMAND_REACTOR_CONSUMER,
} from "../../persistence/Services/OrchestrationEventDeliveries.ts";
import { ProjectionOrchestratorRepository } from "../../persistence/Services/ProjectionOrchestrator.ts";
import {
  OrchestratorMailbox,
  type OrchestratorMailboxReconcileResult,
  type OrchestratorMailboxShape,
} from "../Services/OrchestratorMailbox.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { projectMessageToThreadTurn } from "../orchestrator/messageProjection.ts";
import { ORCHESTRATOR_RESOURCE_POLICY_V1 } from "../orchestrator/resourcePolicy.ts";

export interface OrchestratorMailboxLiveOptions {
  readonly now?: () => string;
  readonly afterProcessingPersisted?: (
    message: OrchestratorMessageEnvelope,
  ) => Effect.Effect<void, unknown>;
  readonly reconcileIntervalMs?: number;
}

const emptyResult = (): OrchestratorMailboxReconcileResult => ({
  rootsVisited: 0,
  messagesDelivered: 0,
  messagesExpired: 0,
  messagesFailed: 0,
  responsesCorrelated: 0,
});

const addResult = (
  left: OrchestratorMailboxReconcileResult,
  right: OrchestratorMailboxReconcileResult,
): OrchestratorMailboxReconcileResult => ({
  rootsVisited: left.rootsVisited + right.rootsVisited,
  messagesDelivered: left.messagesDelivered + right.messagesDelivered,
  messagesExpired: left.messagesExpired + right.messagesExpired,
  messagesFailed: left.messagesFailed + right.messagesFailed,
  responsesCorrelated: left.responsesCorrelated + right.responsesCorrelated,
});

export const makeOrchestratorMailbox = (options?: OrchestratorMailboxLiveOptions) =>
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const repository = yield* ProjectionOrchestratorRepository;
    const commandReceipts = yield* OrchestrationCommandReceiptRepository;
    const providerDeliveries = yield* OrchestrationEventDeliveryRepository;
    const deliveryLock = yield* Semaphore.make(1);
    const now = options?.now ?? (() => new Date().toISOString());

    const markDelivery = Effect.fnUntraced(function* (input: {
      readonly rootThreadId: ThreadId;
      readonly messageId: string;
      readonly deliveryState: "processing" | "delivered" | "expired" | "failed";
      readonly deliveryAttemptId: string;
    }) {
      const root = yield* repository.getRoot(input.rootThreadId);
      if (Option.isNone(root)) return;
      yield* engine.dispatch({
        type: "orchestrator.message.delivery.mark",
        commandId: CommandId.makeUnsafe(
          `server:mailbox:${input.messageId}:${input.deliveryState}:${input.deliveryAttemptId}`,
        ),
        rootThreadId: input.rootThreadId,
        projectId: root.value.root.projectId,
        actor: { kind: "server", actorId: "orchestrator-mailbox" },
        protocolVersion: 1,
        expectedRevision: root.value.root.revision,
        createdAt: now(),
        messageId: OrchestratorMessageId.makeUnsafe(input.messageId),
        deliveryState: input.deliveryState,
        deliveryAttemptId: input.deliveryAttemptId,
      });
    });

    const markResponse = Effect.fnUntraced(function* (input: {
      readonly rootThreadId: ThreadId;
      readonly messageId: string;
      readonly responseMessageId: string;
    }) {
      const root = yield* repository.getRoot(input.rootThreadId);
      if (Option.isNone(root)) return;
      yield* engine.dispatch({
        type: "orchestrator.message.response.mark",
        commandId: CommandId.makeUnsafe(
          `server:mailbox:${input.messageId}:responded:${input.responseMessageId}`,
        ),
        rootThreadId: input.rootThreadId,
        projectId: root.value.root.projectId,
        actor: { kind: "server", actorId: "orchestrator-mailbox" },
        protocolVersion: 1,
        expectedRevision: root.value.root.revision,
        createdAt: now(),
        messageId: OrchestratorMessageId.makeUnsafe(input.messageId),
        responseMessageId: OrchestratorMessageId.makeUnsafe(input.responseMessageId),
      });
    });

    const reconcileProcessingMessage = Effect.fnUntraced(function* (input: {
      readonly message: OrchestratorMessageEnvelope;
    }): Effect.fn.Return<"pending" | "delivered" | "failed", unknown> {
      const commandId = CommandId.makeUnsafe(
        `server:orchestrator-message:${input.message.messageId}`,
      );
      const receipt = yield* commandReceipts.getByCommandId({ commandId });
      if (Option.isNone(receipt) || receipt.value.status === "rejected") {
        yield* markDelivery({
          rootThreadId: input.message.rootThreadId,
          messageId: input.message.messageId,
          deliveryState: "failed",
          deliveryAttemptId:
            input.message.deliveryAttemptId ??
            `mailbox:${input.message.messageId}:recovered-uncertain`,
        });
        return "failed";
      }
      const delivery = yield* providerDeliveries.getDelivery({
        consumerName: PROVIDER_COMMAND_REACTOR_CONSUMER,
        eventSequence: receipt.value.resultSequence,
      });
      if (
        Option.isNone(delivery) ||
        delivery.value.state === "inflight" ||
        delivery.value.state === "retry"
      ) {
        return "pending";
      }
      const deliveryState = delivery.value.state === "succeeded" ? "delivered" : "failed";
      yield* markDelivery({
        rootThreadId: input.message.rootThreadId,
        messageId: input.message.messageId,
        deliveryState,
        deliveryAttemptId:
          input.message.deliveryAttemptId ?? `mailbox:${input.message.messageId}:attempt:1`,
      });
      return deliveryState;
    });

    const reconcileRootUnlocked = Effect.fnUntraced(function* (rootThreadId: ThreadId) {
      let result: OrchestratorMailboxReconcileResult = {
        ...emptyResult(),
        rootsVisited: 1,
      };
      const root = yield* repository.getRoot(rootThreadId);
      if (Option.isNone(root) || root.value.root.state !== "active") return result;

      const mailboxLimit =
        ORCHESTRATOR_RESOURCE_POLICY_V1.maxMailboxDepthPerThread *
        ORCHESTRATOR_RESOURCE_POLICY_V1.maxActiveSessions;
      const initialMessages = yield* repository.listMailboxMessages({
        rootThreadId,
        limit: mailboxLimit,
      });
      for (const message of initialMessages) {
        if (message.deliveryState === "processing") {
          const state = yield* reconcileProcessingMessage({
            message,
          });
          if (state === "delivered") {
            result = { ...result, messagesDelivered: result.messagesDelivered + 1 };
          } else if (state === "failed") {
            result = { ...result, messagesFailed: result.messagesFailed + 1 };
          }
          continue;
        }
        if (message.deliveryState !== "queued") continue;

        const attemptId = `mailbox:${message.messageId}:attempt:1`;
        if (message.expiresAt <= now()) {
          yield* markDelivery({
            rootThreadId,
            messageId: message.messageId,
            deliveryState: "expired",
            deliveryAttemptId: attemptId,
          });
          result = { ...result, messagesExpired: result.messagesExpired + 1 };
          continue;
        }

        yield* markDelivery({
          rootThreadId,
          messageId: message.messageId,
          deliveryState: "processing",
          deliveryAttemptId: attemptId,
        });
        if (options?.afterProcessingPersisted !== undefined) {
          yield* options.afterProcessingPersisted(message);
        }

        const readModel = yield* engine.getReadModel();
        const targetThread = readModel.threads.find(
          (thread) => thread.id === message.targetThreadId,
        );
        if (targetThread === undefined || targetThread.projectId !== root.value.root.projectId) {
          yield* markDelivery({
            rootThreadId,
            messageId: message.messageId,
            deliveryState: "failed",
            deliveryAttemptId: attemptId,
          });
          result = { ...result, messagesFailed: result.messagesFailed + 1 };
          continue;
        }

        const dispatched = yield* Effect.exit(
          engine.dispatch(projectMessageToThreadTurn({ message, targetThread })),
        );
        if (dispatched._tag === "Failure") {
          yield* markDelivery({
            rootThreadId,
            messageId: message.messageId,
            deliveryState: "failed",
            deliveryAttemptId: attemptId,
          });
          result = { ...result, messagesFailed: result.messagesFailed + 1 };
          continue;
        }

        const projectedProcessingMessage = {
          ...message,
          deliveryState: "processing" as const,
          deliveryAttemptId: attemptId,
          updatedAt: now(),
        };
        const state = yield* reconcileProcessingMessage({
          message: projectedProcessingMessage,
        });
        if (state === "delivered") {
          result = { ...result, messagesDelivered: result.messagesDelivered + 1 };
        } else if (state === "failed") {
          result = { ...result, messagesFailed: result.messagesFailed + 1 };
        }
      }

      const messages = yield* repository.listMailboxMessages({
        rootThreadId,
        limit: mailboxLimit,
      });
      const correlatedSourceIds = new Set<string>();
      for (const response of messages) {
        if (response.replyToMessageId === null) continue;
        const source = messages.find(
          (candidate) => candidate.messageId === response.replyToMessageId,
        );
        if (source?.deliveryState !== "delivered" || correlatedSourceIds.has(source.messageId)) {
          continue;
        }
        yield* markResponse({
          rootThreadId,
          messageId: source.messageId,
          responseMessageId: response.messageId,
        });
        correlatedSourceIds.add(source.messageId);
        result = { ...result, responsesCorrelated: result.responsesCorrelated + 1 };
      }
      return result;
    });

    const reconcileRoot: OrchestratorMailboxShape["reconcileRoot"] = (rootThreadId) =>
      deliveryLock.withPermits(1)(reconcileRootUnlocked(rootThreadId));

    const reconcileAllUnlocked = Effect.gen(function* () {
      let result = emptyResult();
      for (const root of yield* repository.listRoots()) {
        result = addResult(result, yield* reconcileRootUnlocked(root.root.rootThreadId));
      }
      return result;
    });
    const reconcileAll: OrchestratorMailboxShape["reconcileAll"] =
      deliveryLock.withPermits(1)(reconcileAllUnlocked);

    const start: OrchestratorMailboxShape["start"] = Effect.gen(function* () {
      yield* reconcileAll.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("orchestrator mailbox startup reconciliation failed", {
            cause: Cause.pretty(cause),
          }),
        ),
      );
      yield* engine.streamDomainEvents.pipe(
        Stream.filter(
          (event) =>
            event.aggregateKind === "orchestrator" &&
            event.type === "orchestrator.message.enqueued",
        ),
        Stream.runForEach((event) =>
          reconcileRoot(event.aggregateId as ThreadId).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("orchestrator mailbox event reconciliation failed", {
                rootThreadId: event.aggregateId,
                eventSequence: event.sequence,
                cause: Cause.pretty(cause),
              }),
            ),
          ),
        ),
        Effect.forkScoped,
      );
      yield* Effect.sleep(
        Duration.millis(Math.max(100, options?.reconcileIntervalMs ?? 1_000)),
      ).pipe(
        Effect.andThen(
          reconcileAll.pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("orchestrator mailbox periodic reconciliation failed", {
                cause: Cause.pretty(cause),
              }),
            ),
          ),
        ),
        Effect.forever,
        Effect.forkScoped,
      );
    });

    return { start, reconcileRoot, reconcileAll } satisfies OrchestratorMailboxShape;
  });

export const OrchestratorMailboxLive = Layer.effect(OrchestratorMailbox, makeOrchestratorMailbox());
