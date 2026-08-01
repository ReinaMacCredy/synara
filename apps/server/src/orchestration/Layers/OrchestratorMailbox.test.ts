import {
  OrchestratorMessageId,
  ProjectId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  type OrchestratorMessageEnvelope,
} from "@synara/contracts";
import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";

import type { ProjectionOrchestratorRepositoryShape } from "../../persistence/Services/ProjectionOrchestrator.ts";
import { ProjectionOrchestratorRepository } from "../../persistence/Services/ProjectionOrchestrator.ts";
import type { OrchestrationCommandReceiptRepositoryShape } from "../../persistence/Services/OrchestrationCommandReceipts.ts";
import { OrchestrationCommandReceiptRepository } from "../../persistence/Services/OrchestrationCommandReceipts.ts";
import type { OrchestrationEventDeliveryRepositoryShape } from "../../persistence/Services/OrchestrationEventDeliveries.ts";
import { OrchestrationEventDeliveryRepository } from "../../persistence/Services/OrchestrationEventDeliveries.ts";
import type { OrchestrationEngineShape } from "../Services/OrchestrationEngine.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { makeOrchestratorMailbox } from "./OrchestratorMailbox.ts";

const ROOT = ThreadId.makeUnsafe("root-thread");
const TARGET = ThreadId.makeUnsafe("target-thread");
const PROJECT = ProjectId.makeUnsafe("project-1");
const NOW = "2026-08-01T01:00:00.000Z";

const queuedMessage = (overrides?: Partial<OrchestratorMessageEnvelope>) =>
  ({
    messageId: OrchestratorMessageId.makeUnsafe("message-1"),
    rootThreadId: ROOT,
    senderThreadId: ROOT,
    targetThreadId: TARGET,
    assignmentId: null,
    runId: null,
    correlationId: null,
    replyToMessageId: null,
    hopCount: 0,
    expiresAt: "2026-08-01T02:00:00.000Z",
    body: "Inspect the lifecycle independently.",
    artifactRefs: [],
    deliveryState: "queued",
    deliveryAttemptId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }) satisfies OrchestratorMessageEnvelope;

function makeHarness(
  initialMessages: ReadonlyArray<OrchestratorMessageEnvelope>,
  initialProviderDeliveryState: "succeeded" | "uncertain" | null = "succeeded",
) {
  let revision = 4;
  let sequence = 100;
  let messages = [...initialMessages];
  const order: string[] = [];
  const turnCommands: OrchestrationCommand[] = [];
  const commandResultSequences = new Map<string, number>();
  let providerDeliveryState = initialProviderDeliveryState;

  const repository = {
    getRoot: () =>
      Effect.succeed(
        Option.some({
          root: {
            rootThreadId: ROOT,
            projectId: PROJECT,
            protocolVersion: 1,
            state: "active",
            activeProcessId: null,
            resourcePolicyVersion: 1,
            revision,
            createdAt: NOW,
            archivedAt: null,
          },
          highWaterCursor: String(sequence),
        }),
      ),
    listRoots: () =>
      Effect.succeed([
        {
          root: {
            rootThreadId: ROOT,
            projectId: PROJECT,
            protocolVersion: 1 as const,
            state: "active" as const,
            activeProcessId: null,
            resourcePolicyVersion: 1,
            revision,
            createdAt: NOW,
            archivedAt: null,
          },
          highWaterCursor: String(sequence),
        },
      ]),
    listMessages: () => Effect.succeed(messages),
    listMailboxMessages: () =>
      Effect.succeed(
        messages.filter(
          (message) =>
            message.deliveryState === "queued" ||
            message.deliveryState === "processing" ||
            message.deliveryState === "delivered",
        ),
      ),
  } as unknown as ProjectionOrchestratorRepositoryShape;

  const readModel = {
    threads: [
      {
        id: TARGET,
        projectId: PROJECT,
        runtimeMode: "full-access",
        interactionMode: "default",
      },
    ],
  } as unknown as OrchestrationReadModel;

  const engine = {
    dispatch: (command: OrchestrationCommand) =>
      Effect.sync(() => {
        order.push(command.type);
        if (command.type === "orchestrator.message.delivery.mark") {
          const index = messages.findIndex((message) => message.messageId === command.messageId);
          const current = messages[index]!;
          messages[index] = {
            ...current,
            deliveryState: command.deliveryState,
            deliveryAttemptId: command.deliveryAttemptId,
            updatedAt: command.createdAt,
          };
          revision += 1;
        } else if (command.type === "orchestrator.message.response.mark") {
          const index = messages.findIndex((message) => message.messageId === command.messageId);
          messages[index] = {
            ...messages[index]!,
            deliveryState: "responded",
            updatedAt: command.createdAt,
          };
          revision += 1;
        } else if (command.type === "thread.turn.start") {
          turnCommands.push(command);
        }
        sequence += 1;
        commandResultSequences.set(command.commandId, sequence);
        return { sequence };
      }),
    getReadModel: () => Effect.succeed(readModel),
  } as unknown as OrchestrationEngineShape;

  const commandReceiptRepository = {
    getByCommandId: ({ commandId }: { readonly commandId: string }) => {
      const resultSequence = commandResultSequences.get(commandId);
      return Effect.succeed(
        resultSequence === undefined
          ? Option.none()
          : Option.some({
              commandId,
              aggregateKind: "thread" as const,
              aggregateId: TARGET,
              acceptedAt: NOW,
              resultSequence,
              status: "accepted" as const,
              error: null,
              fingerprintVersion: 1,
              commandFingerprint: "0".repeat(64),
            }),
      );
    },
  } as unknown as OrchestrationCommandReceiptRepositoryShape;

  const providerDeliveryRepository = {
    getDelivery: ({ eventSequence }: { readonly eventSequence: number }) =>
      Effect.succeed(
        commandResultSequences.size === 0 || providerDeliveryState === null
          ? Option.none()
          : Option.some({
              consumerName: "provider-command-reactor.v1",
              eventSequence,
              threadId: TARGET,
              state: providerDeliveryState,
              claimOwner: null,
              claimedAt: null,
              claimExpiresAt: null,
              attemptCount: 1,
              lastError:
                providerDeliveryState === "uncertain" ? "receipt write failed after send" : null,
              completedAt: providerDeliveryState === "succeeded" ? NOW : null,
              updatedAt: NOW,
            }),
      ),
  } as unknown as OrchestrationEventDeliveryRepositoryShape;

  const layer = Layer.mergeAll(
    Layer.succeed(ProjectionOrchestratorRepository, repository),
    Layer.succeed(OrchestrationEngineService, engine),
    Layer.succeed(OrchestrationCommandReceiptRepository, commandReceiptRepository),
    Layer.succeed(OrchestrationEventDeliveryRepository, providerDeliveryRepository),
  );

  return {
    layer,
    order,
    turnCommands,
    messages: () => messages,
    setProviderDeliveryState: (state: "succeeded" | "uncertain") => {
      providerDeliveryState = state;
    },
  };
}

describe("OrchestratorMailbox", () => {
  it("persists processing before publishing one stable thread-origin turn", async () => {
    const harness = makeHarness([queuedMessage()]);
    const result = await Effect.runPromise(
      makeOrchestratorMailbox({ now: () => NOW }).pipe(
        Effect.flatMap((mailbox) => mailbox.reconcileRoot(ROOT)),
        Effect.provide(harness.layer),
      ),
    );

    expect(harness.order).toEqual([
      "orchestrator.message.delivery.mark",
      "thread.turn.start",
      "orchestrator.message.delivery.mark",
    ]);
    expect(harness.turnCommands).toHaveLength(1);
    expect(harness.turnCommands[0]).toMatchObject({
      type: "thread.turn.start",
      commandId: "server:orchestrator-message:message-1",
      dispatchMode: "queue",
      dispatchOrigin: "orchestrator",
      message: { role: "thread" },
    });
    expect(harness.messages()[0]?.deliveryState).toBe("delivered");
    expect(result.messagesDelivered).toBe(1);
  });

  it("never replays a semantic turn after crashing at either delivery receipt boundary", async () => {
    const harness = makeHarness([queuedMessage()]);
    await expect(
      Effect.runPromise(
        makeOrchestratorMailbox({
          now: () => NOW,
          afterProcessingPersisted: () => Effect.fail(new Error("simulated crash")),
        }).pipe(
          Effect.flatMap((mailbox) => mailbox.reconcileRoot(ROOT)),
          Effect.provide(harness.layer),
        ),
      ),
    ).rejects.toThrow("simulated crash");
    expect(harness.turnCommands).toHaveLength(0);
    expect(harness.messages()[0]?.deliveryState).toBe("processing");

    await Effect.runPromise(
      makeOrchestratorMailbox({ now: () => NOW }).pipe(
        Effect.flatMap((mailbox) => mailbox.reconcileRoot(ROOT)),
        Effect.provide(harness.layer),
      ),
    );
    expect(harness.turnCommands).toHaveLength(0);
    expect(harness.messages()[0]?.deliveryState).toBe("failed");
  });

  it("surfaces an uncertain provider receipt as failure without replaying the accepted turn", async () => {
    const harness = makeHarness([queuedMessage()], "uncertain");
    const result = await Effect.runPromise(
      makeOrchestratorMailbox({ now: () => NOW }).pipe(
        Effect.flatMap((mailbox) => mailbox.reconcileRoot(ROOT)),
        Effect.provide(harness.layer),
      ),
    );

    expect(harness.turnCommands).toHaveLength(1);
    expect(harness.messages()[0]?.deliveryState).toBe("failed");
    expect(result.messagesFailed).toBe(1);
    await Effect.runPromise(
      makeOrchestratorMailbox({ now: () => NOW }).pipe(
        Effect.flatMap((mailbox) => mailbox.reconcileRoot(ROOT)),
        Effect.provide(harness.layer),
      ),
    );
    expect(harness.turnCommands).toHaveLength(1);
  });

  it("reconciles a delayed provider receipt by command identity after reconnect", async () => {
    const harness = makeHarness([queuedMessage()], null);
    await Effect.runPromise(
      makeOrchestratorMailbox({ now: () => NOW }).pipe(
        Effect.flatMap((mailbox) => mailbox.reconcileRoot(ROOT)),
        Effect.provide(harness.layer),
      ),
    );
    expect(harness.turnCommands).toHaveLength(1);
    expect(harness.messages()[0]?.deliveryState).toBe("processing");

    harness.setProviderDeliveryState("succeeded");
    await Effect.runPromise(
      makeOrchestratorMailbox({ now: () => NOW }).pipe(
        Effect.flatMap((mailbox) => mailbox.reconcileRoot(ROOT)),
        Effect.provide(harness.layer),
      ),
    );
    expect(harness.turnCommands).toHaveLength(1);
    expect(harness.messages()[0]?.deliveryState).toBe("delivered");
  });

  it("expires queued messages without publishing a provider turn", async () => {
    const harness = makeHarness([queuedMessage({ expiresAt: "2026-08-01T00:59:59.000Z" })]);
    await Effect.runPromise(
      makeOrchestratorMailbox({ now: () => NOW }).pipe(
        Effect.flatMap((mailbox) => mailbox.reconcileRoot(ROOT)),
        Effect.provide(harness.layer),
      ),
    );

    expect(harness.turnCommands).toHaveLength(0);
    expect(harness.messages()[0]?.deliveryState).toBe("expired");
  });

  it("correlates a delivered multi-hop reply without dispatching either message again", async () => {
    const source = queuedMessage({
      deliveryState: "delivered",
      deliveryAttemptId: "attempt-source",
    });
    const response = queuedMessage({
      messageId: OrchestratorMessageId.makeUnsafe("message-2"),
      senderThreadId: TARGET,
      targetThreadId: ROOT,
      correlationId: OrchestratorMessageId.makeUnsafe("message-1"),
      replyToMessageId: OrchestratorMessageId.makeUnsafe("message-1"),
      hopCount: 1,
      deliveryState: "delivered",
      deliveryAttemptId: "attempt-response",
    });
    const harness = makeHarness([source, response]);
    const result = await Effect.runPromise(
      makeOrchestratorMailbox({ now: () => NOW }).pipe(
        Effect.flatMap((mailbox) => mailbox.reconcileRoot(ROOT)),
        Effect.provide(harness.layer),
      ),
    );

    expect(harness.turnCommands).toHaveLength(0);
    expect(harness.messages()[0]?.deliveryState).toBe("responded");
    expect(result.responsesCorrelated).toBe(1);
  });
});
