import { describe, expect, it } from "vitest";
import {
  OrchestratorMessageId,
  ThreadId,
  type OrchestratorMessageEnvelope,
} from "@synara/contracts";

import {
  projectMailboxDoorbell,
  projectMessageToThreadTurn,
  projectOrchestratorExchange,
} from "./messageProjection.ts";

const message = (state: OrchestratorMessageEnvelope["deliveryState"] = "queued") =>
  ({
    messageId: OrchestratorMessageId.makeUnsafe("message-1"),
    rootThreadId: ThreadId.makeUnsafe("root"),
    senderThreadId: ThreadId.makeUnsafe("child-a"),
    targetThreadId: ThreadId.makeUnsafe("child-b"),
    assignmentId: null,
    runId: null,
    correlationId: null,
    replyToMessageId: null,
    hopCount: 0,
    expiresAt: "2026-08-01T02:00:00.000Z",
    body: "Challenge the lifecycle assumptions.",
    artifactRefs: [],
    deliveryState: state,
    deliveryAttemptId: null,
    createdAt: "2026-08-01T01:00:00.000Z",
    updatedAt: "2026-08-01T01:00:00.000Z",
  }) satisfies OrchestratorMessageEnvelope;

describe("orchestrator message projection", () => {
  it("projects a thread sender and a stable internal turn without a user role", () => {
    const envelope = message();
    const exchange = projectOrchestratorExchange(envelope);
    const command = projectMessageToThreadTurn({
      message: envelope,
      targetThread: {
        id: ThreadId.makeUnsafe("child-b"),
        runtimeMode: "full-access",
        interactionMode: "default",
      },
    });

    expect(exchange.senderKind).toBe("thread");
    expect(exchange.senderThreadId).toBe("child-a");
    expect(command.commandId).toBe("server:orchestrator-message:message-1");
    expect(command.message.role).toBe("thread");
    expect(command.dispatchOrigin).toBe("orchestrator");
    expect(command.threadOrigin?.senderThreadId).toBe("child-a");
    expect(command).not.toHaveProperty("modelSelection");
  });

  it("derives Root doorbells only from durable terminal delivery facts", () => {
    expect(projectMailboxDoorbell(message("queued"))).toBeNull();
    expect(projectMailboxDoorbell(message("failed"))?.reasonCode).toBe("message_delivery_failed");
    expect(projectMailboxDoorbell(message("expired"))?.reasonCode).toBe("message_expired");
  });
});
