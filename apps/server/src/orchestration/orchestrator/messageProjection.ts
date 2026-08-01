import {
  CommandId,
  MessageId,
  ThreadTurnStartCommand,
  type OrchestrationThread,
  type OrchestratorMessageEnvelope,
  type ThreadOriginEnvelope,
} from "@synara/contracts";

export interface OrchestratorExchangeProjection {
  readonly messageId: string;
  readonly rootThreadId: string;
  readonly senderKind: "thread";
  readonly senderThreadId: string;
  readonly targetThreadId: string;
  readonly body: string;
  readonly artifactRefs: ReadonlyArray<string>;
  readonly correlationId: string | null;
  readonly replyToMessageId: string | null;
  readonly deliveryState: OrchestratorMessageEnvelope["deliveryState"];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OrchestratorMailboxDoorbellProjection {
  readonly rootThreadId: string;
  readonly targetThreadId: string;
  readonly messageId: string;
  readonly reasonCode: "message_delivery_failed" | "message_expired";
}

export const projectOrchestratorExchange = (
  message: OrchestratorMessageEnvelope,
): OrchestratorExchangeProjection => ({
  messageId: message.messageId,
  rootThreadId: message.rootThreadId,
  senderKind: "thread",
  senderThreadId: message.senderThreadId,
  targetThreadId: message.targetThreadId,
  body: message.body,
  artifactRefs: message.artifactRefs,
  correlationId: message.correlationId,
  replyToMessageId: message.replyToMessageId,
  deliveryState: message.deliveryState,
  createdAt: message.createdAt,
  updatedAt: message.updatedAt,
});

export const projectMailboxDoorbell = (
  message: OrchestratorMessageEnvelope,
): OrchestratorMailboxDoorbellProjection | null => {
  const reasonCode =
    message.deliveryState === "failed"
      ? "message_delivery_failed"
      : message.deliveryState === "expired"
        ? "message_expired"
        : null;
  return reasonCode === null
    ? null
    : {
        rootThreadId: message.rootThreadId,
        targetThreadId: message.targetThreadId,
        messageId: message.messageId,
        reasonCode,
      };
};

export const threadOriginEnvelope = (
  message: OrchestratorMessageEnvelope,
): ThreadOriginEnvelope => ({
  messageId: message.messageId,
  rootThreadId: message.rootThreadId,
  senderThreadId: message.senderThreadId,
  targetThreadId: message.targetThreadId,
  assignmentId: message.assignmentId,
  runId: message.runId,
  correlationId: message.correlationId,
  replyToMessageId: message.replyToMessageId,
  hopCount: message.hopCount,
  artifactRefs: message.artifactRefs,
});

export const projectMessageToThreadTurn = (input: {
  readonly message: OrchestratorMessageEnvelope;
  readonly targetThread: Pick<OrchestrationThread, "id" | "runtimeMode" | "interactionMode">;
}): typeof ThreadTurnStartCommand.Type => ({
  type: "thread.turn.start",
  commandId: CommandId.makeUnsafe(`server:orchestrator-message:${input.message.messageId}`),
  threadId: input.targetThread.id,
  message: {
    messageId: MessageId.makeUnsafe(input.message.messageId),
    role: "thread",
    text: input.message.body,
    attachments: [],
  },
  dispatchMode: "queue",
  dispatchOrigin: "orchestrator",
  threadOrigin: threadOriginEnvelope(input.message),
  runtimeMode: input.targetThread.runtimeMode,
  interactionMode: input.targetThread.interactionMode,
  createdAt: input.message.createdAt,
});
