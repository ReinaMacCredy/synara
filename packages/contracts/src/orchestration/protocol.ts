import { Option, Schema, SchemaIssue, Struct } from "effect";
import {
  AntigravityModelOptions,
  ClaudeModelOptions,
  CodexModelOptions,
  CursorModelOptions,
  DroidModelOptions,
  GrokModelOptions,
  OpenCodeModelOptions,
  PiModelOptions,
} from "../model";
import { ProviderMentionReference, ProviderSkillReference } from "../providerDiscovery";
import { AcceptedCrossModeHandoffV1, HandoffAttemptId, HandoffConversationMode } from "../handoff";
import { ProjectKind } from "../project";
import {
  TaskProcessCommand,
  TaskProcessDomainEvent,
  TaskProcessEventType,
  TaskProcessId,
} from "../taskProcess";
import {
  SupervisionAggregateId,
  SupervisionDomainEvent,
  SupervisionEventType,
} from "../supervision";
import {
  SupervisedAggregateKind,
  SupervisedCommand,
  SupervisedDomainEvent,
  SupervisedEventType,
  SupervisedRuntimeSnapshot,
  emptySupervisedRuntimeSnapshot,
} from "../supervised";
import {
  SupervisedFirstSendBootstrap,
  SupervisedGovernanceAggregateId,
  SupervisedGovernanceCommand,
  SupervisedGovernanceDomainEvent,
  SupervisedGovernanceEventType,
  SupervisedOrchestrationSnapshot,
  emptySupervisedOrchestrationSnapshot,
} from "../supervisedGovernance";
import {
  ApprovalRequestId,
  CheckpointRef,
  CommandId,
  EventId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  SpaceId,
  ProviderItemId,
  ThreadId,
  ThreadMarkerId,
  TrimmedNonEmptyString,
  TurnId,
} from "../baseSchemas";
import {
  ORCHESTRATION_WS_METHODS,
  ORCHESTRATION_WS_CHANNELS,
  ProviderKind,
  ProviderApprovalPolicy,
  ProviderSandboxMode,
  DEFAULT_PROVIDER_KIND,
  CodexModelSelection,
  ClaudeModelSelection,
  CursorModelSelection,
  AntigravityModelSelection,
  GrokModelSelection,
  DroidModelSelection,
  OpenCodeModelSelection,
  KiloModelSelection,
  PiModelSelection,
  ModelSelection,
  CodexProviderStartOptions,
  ClaudeProviderStartOptions,
  AntigravityProviderStartOptions,
  CursorProviderStartOptions,
  GrokProviderStartOptions,
  DroidProviderStartOptions,
  OpenCodeProviderStartOptions,
  KiloProviderStartOptions,
  PiProviderStartOptions,
  ProviderStartOptions,
  RuntimeMode,
  DEFAULT_RUNTIME_MODE,
  ProviderInteractionMode,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  SidechatSourceThreadId,
  ProviderRequestKind,
  AssistantDeliveryMode,
  TurnDispatchMode,
  DEFAULT_TURN_DISPATCH_MODE,
  MessageDispatchOrigin,
  ThreadCreationSource,
  ProviderReviewTarget,
  ProviderApprovalDecision,
  ProviderUserInputAnswer,
  ProviderUserInputAnswers,
  ThreadHandoffBootstrapStatus,
  ThreadEnvironmentMode,
  OrchestrationMessageSource,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_IMPORT_BYTES,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  MAX_PINNED_PROJECTS,
  CHAT_ATTACHMENT_ID_MAX_CHARS,
  CHAT_ASSISTANT_SELECTION_TEXT_MAX_CHARS,
  THREAD_NOTES_MAX_CHARS,
  PINNED_MESSAGES_MAX_COUNT,
  PINNED_MESSAGE_LABEL_MAX_CHARS,
  THREAD_MARKERS_MAX_COUNT,
  THREAD_MARKER_LABEL_MAX_CHARS,
  THREAD_MARKER_SELECTED_TEXT_MAX_CHARS,
  CorrelationId,
  ChatAttachmentId,
  ChatImageAttachment,
  ChatFileAttachment,
  ChatAssistantSelectionAttachment,
  UploadChatAssistantSelectionAttachment,
  ChatAttachment,
  ChatAttachmentList,
  UploadChatAttachment,
  UploadChatAttachmentList,
  TurnMessageContentCheck,
} from "./provider";
import {
  ProjectScriptIcon,
  ProjectScript,
  SPACE_NAME_MAX_LENGTH,
  SPACES_MAX_COUNT,
  RESERVED_VOID_SPACE_ID,
  SPACE_PROJECTS_ASSIGN_MAX_COUNT,
  SPACE_ICON_NAMES,
  SpaceIconName,
  SpaceName,
  OrchestrationSpace,
  OrchestrationSpaceShell,
  OrchestrationProject,
  OrchestrationProjectShell,
} from "./projectSpace";
import {
  OrchestrationMessageRole,
  ThreadOriginEnvelope,
  OrchestrationMessage,
  ThreadHandoff,
  OrchestrationProposedPlanId,
  OrchestrationProposedPlan,
  SourceProposedPlanReference,
  OrchestrationSessionStatus,
  OrchestrationSession,
  OrchestrationCheckpointFile,
  OrchestrationCheckpointStatus,
  OrchestrationCheckpointSummary,
  OrchestrationThreadActivityTone,
  OrchestrationThreadActivity,
  OrchestrationLatestTurnState,
  OrchestrationLatestTurn,
  OrchestrationThreadPullRequest,
  ThreadNotes,
  PinnedMessageLabel,
  PinnedMessage,
  ThreadPinnedMessages,
  ThreadMarkerStyle,
  ThreadMarkerColor,
  ThreadMarkerLabel,
  ThreadMarker,
  ThreadMarkers,
  ProjectionPendingInteractionKind,
  ProjectionPendingInteractionStatus,
  ProjectionPendingInteractionDecision,
  OrchestrationPendingInteraction,
  OrchestrationThread,
  OrchestrationThreadShell,
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamEvent,
  OrchestrationShellStreamItem,
} from "./threadTranscript";
import {
  SpaceCreateCommand,
  SpaceMetaUpdateCommand,
  SpaceReorderCommand,
  SpaceDeleteCommand,
  SpaceProjectsAssignCommand,
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadFirstSendBootstrap,
  ThreadHandoffImportedMessage,
  ThreadHandoffCreateCommand,
  ThreadForkCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadMetaUpdateCommand,
  ThreadPinnedMessageAddCommand,
  ThreadPinnedMessageRemoveCommand,
  ThreadPinnedMessageDoneSetCommand,
  ThreadPinnedMessageLabelSetCommand,
  ThreadMarkerAddCommand,
  ThreadMarkerRemoveCommand,
  ThreadMarkerDoneSetCommand,
  ThreadMarkerLabelSetCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ThreadTurnStartCommand,
  ClientThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadTaskStopCommand,
  ThreadTaskBackgroundCommand,
  ThreadDispatchQueuedTurnCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadConversationRollbackCommand,
  ThreadMessageEditAndResendCommand,
  ThreadSessionStopCommand,
  ThreadActivityAppendCommand,
  DispatchableClientOrchestrationCommand,
  ClientOrchestrationCommand,
  ThreadSessionSetCommand,
  ThreadMessagesImportCommand,
  ThreadMessageAssistantDeltaCommand,
  ThreadMessageAssistantCompleteCommand,
  ThreadProposedPlanUpsertCommand,
  ThreadTurnDiffCompleteCommand,
  ThreadRevertCompleteCommand,
  ThreadConversationRollbackCompleteCommand,
  InternalOrchestrationCommand,
  OrchestrationCommand,
  CoreOrchestrationEventType,
} from "./commands";
import {
  OrchestrationEventType,
  OrchestrationAggregateKind,
  OrchestrationActorKind,
  SpaceCreatedPayload,
  SpaceMetaUpdatedPayload,
  SpaceOrderUpdatedPayload,
  SpaceDeletedPayload,
  ProjectCreatedPayload,
  ProjectMetaUpdatedPayload,
  ProjectDeletedPayload,
  ThreadCreatedPayload,
  ThreadDeletedPayload,
  ThreadArchivedPayload,
  ThreadUnarchivedPayload,
  ThreadMetaUpdatedPayload,
  ThreadPinnedMessageAddedPayload,
  ThreadPinnedMessageRemovedPayload,
  ThreadPinnedMessageDoneSetPayload,
  ThreadPinnedMessageLabelSetPayload,
  ThreadMarkerAddedPayload,
  ThreadMarkerRemovedPayload,
  ThreadMarkerDoneSetPayload,
  ThreadMarkerLabelSetPayload,
  ThreadRuntimeModeSetPayload,
  ThreadInteractionModeSetPayload,
  ThreadMessageSentPayload,
  ThreadTurnStartRequestedPayload,
  ThreadTurnQueuedPayload,
  ThreadTurnInterruptRequestedPayload,
  ThreadTaskStopRequestedPayload,
  ThreadTaskBackgroundRequestedPayload,
  ThreadApprovalResponseRequestedPayload,
  ThreadUserInputResponseRequestedPayload,
  ThreadCheckpointRevertRequestedPayload,
  ThreadRevertedPayload,
  ThreadConversationRollbackRequestedPayload,
  ThreadConversationRolledBackPayload,
  ThreadMessageEditResendRequestedPayload,
  ThreadSessionStopRequestedPayload,
  ThreadSessionSetPayload,
  ThreadProposedPlanUpsertedPayload,
  ThreadTurnDiffCompletedPayload,
  ThreadActivityAppendedPayload,
  OrchestrationEventMetadata,
  EventBaseFields,
  OrchestrationEvent,
} from "./events";

export const OrchestrationThreadDetailSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  thread: OrchestrationThread,
});
export type OrchestrationThreadDetailSnapshot = typeof OrchestrationThreadDetailSnapshot.Type;

export const OrchestrationThreadStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationThreadDetailSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    event: OrchestrationEvent,
  }),
]);
export type OrchestrationThreadStreamItem = typeof OrchestrationThreadStreamItem.Type;

export const OrchestrationCommandReceiptStatus = Schema.Literals(["accepted", "rejected"]);
export type OrchestrationCommandReceiptStatus = typeof OrchestrationCommandReceiptStatus.Type;

export const TurnCountRange = Schema.Struct({
  fromTurnCount: NonNegativeInt,
  toTurnCount: NonNegativeInt,
}).check(
  Schema.makeFilter(
    (input) =>
      input.fromTurnCount <= input.toTurnCount ||
      new SchemaIssue.InvalidValue(Option.some(input.fromTurnCount), {
        message: "fromTurnCount must be less than or equal to toTurnCount",
      }),
    { identifier: "OrchestrationTurnDiffRange" },
  ),
);

export const ThreadTurnDiff = TurnCountRange.mapFields(
  Struct.assign({
    threadId: ThreadId,
    diff: Schema.String,
  }),
  { unsafePreserveChecks: true },
);

export const ProviderSessionRuntimeStatus = Schema.Literals([
  "starting",
  "running",
  "stopped",
  "error",
]);
export type ProviderSessionRuntimeStatus = typeof ProviderSessionRuntimeStatus.Type;

export const ProjectionThreadTurnStatus = Schema.Literals([
  "running",
  "completed",
  "interrupted",
  "error",
]);
export type ProjectionThreadTurnStatus = typeof ProjectionThreadTurnStatus.Type;

export const ProjectionCheckpointRow = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type ProjectionCheckpointRow = typeof ProjectionCheckpointRow.Type;

export const DispatchResult = Schema.Struct({
  sequence: NonNegativeInt,
});
export type DispatchResult = typeof DispatchResult.Type;

export const OrchestrationGetSnapshotInput = Schema.Struct({});
export type OrchestrationGetSnapshotInput = typeof OrchestrationGetSnapshotInput.Type;
export const OrchestrationGetSnapshotResult = OrchestrationReadModel;
export type OrchestrationGetSnapshotResult = typeof OrchestrationGetSnapshotResult.Type;

export const OrchestrationGetShellSnapshotInput = Schema.Struct({});
export type OrchestrationGetShellSnapshotInput = typeof OrchestrationGetShellSnapshotInput.Type;
export const OrchestrationGetShellSnapshotResult = OrchestrationShellSnapshot;
export type OrchestrationGetShellSnapshotResult = typeof OrchestrationGetShellSnapshotResult.Type;

export const OrchestrationRepairStateInput = Schema.Struct({});
export type OrchestrationRepairStateInput = typeof OrchestrationRepairStateInput.Type;
export const OrchestrationRepairStateResult = OrchestrationReadModel;
export type OrchestrationRepairStateResult = typeof OrchestrationRepairStateResult.Type;

export const OrchestrationGetTurnDiffInput = TurnCountRange.mapFields(
  Struct.assign({
    threadId: ThreadId,
    ignoreWhitespace: Schema.optional(Schema.Boolean),
  }),
  { unsafePreserveChecks: true },
);
export type OrchestrationGetTurnDiffInput = typeof OrchestrationGetTurnDiffInput.Type;

export const OrchestrationGetTurnDiffResult = ThreadTurnDiff;
export type OrchestrationGetTurnDiffResult = typeof OrchestrationGetTurnDiffResult.Type;

export const OrchestrationGetFullThreadDiffInput = Schema.Struct({
  threadId: ThreadId,
  toTurnCount: NonNegativeInt,
  ignoreWhitespace: Schema.optional(Schema.Boolean),
});
export type OrchestrationGetFullThreadDiffInput = typeof OrchestrationGetFullThreadDiffInput.Type;

export const OrchestrationGetFullThreadDiffResult = ThreadTurnDiff;
export type OrchestrationGetFullThreadDiffResult = typeof OrchestrationGetFullThreadDiffResult.Type;

export const OrchestrationReplayEventsInput = Schema.Struct({
  fromSequenceExclusive: NonNegativeInt,
  threadId: Schema.optional(ThreadId),
});
export type OrchestrationReplayEventsInput = typeof OrchestrationReplayEventsInput.Type;

export const OrchestrationReplayEventsResult = Schema.Array(OrchestrationEvent);
export type OrchestrationReplayEventsResult = typeof OrchestrationReplayEventsResult.Type;

export const ProviderDeliveryReconciliationOutcome = Schema.Literals([
  "accepted",
  "safe_retry",
  "abandon",
]);
export type ProviderDeliveryReconciliationOutcome =
  typeof ProviderDeliveryReconciliationOutcome.Type;

export const ProviderDeliveryBlockingEvidence = Schema.Struct({
  consumerName: Schema.String,
  eventSequence: NonNegativeInt,
  eventId: EventId,
  eventType: Schema.String,
  occurredAt: IsoDateTime,
  threadId: ThreadId,
  state: Schema.Literals(["dead", "uncertain"]),
  attemptCount: NonNegativeInt,
  lastError: Schema.NullOr(Schema.String),
  updatedAt: IsoDateTime,
  lastReconciliationOutcome: Schema.NullOr(ProviderDeliveryReconciliationOutcome),
  lastReconciledAt: Schema.NullOr(IsoDateTime),
  lastReconciledBy: Schema.NullOr(Schema.String),
  lastReconciliationNote: Schema.NullOr(Schema.String),
});
export type ProviderDeliveryBlockingEvidence = typeof ProviderDeliveryBlockingEvidence.Type;

export const OrchestrationListProviderDeliveryBlockersInput = Schema.Struct({
  threadId: Schema.optional(ThreadId),
  limit: Schema.optional(PositiveInt),
});
export type OrchestrationListProviderDeliveryBlockersInput =
  typeof OrchestrationListProviderDeliveryBlockersInput.Type;

export const OrchestrationListProviderDeliveryBlockersResult = Schema.Array(
  ProviderDeliveryBlockingEvidence,
);
export type OrchestrationListProviderDeliveryBlockersResult =
  typeof OrchestrationListProviderDeliveryBlockersResult.Type;

export const OrchestrationReconcileProviderDeliveryInput = Schema.Struct({
  eventSequence: NonNegativeInt,
  threadId: ThreadId,
  expectedState: Schema.Literals(["dead", "uncertain"]),
  outcome: ProviderDeliveryReconciliationOutcome,
  note: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(2_000))),
});
export type OrchestrationReconcileProviderDeliveryInput =
  typeof OrchestrationReconcileProviderDeliveryInput.Type;

export const OrchestrationReconcileProviderDeliveryResult = Schema.Struct({
  eventSequence: NonNegativeInt,
  threadId: ThreadId,
  outcome: ProviderDeliveryReconciliationOutcome,
  state: Schema.Literals(["retry", "succeeded", "dead", "uncertain"]),
  reconciledAt: IsoDateTime,
});
export type OrchestrationReconcileProviderDeliveryResult =
  typeof OrchestrationReconcileProviderDeliveryResult.Type;

export const OrchestrationSubscribeShellInput = Schema.Struct({});
export type OrchestrationSubscribeShellInput = typeof OrchestrationSubscribeShellInput.Type;

export const OrchestrationUnsubscribeShellInput = Schema.Struct({});
export type OrchestrationUnsubscribeShellInput = typeof OrchestrationUnsubscribeShellInput.Type;

export const OrchestrationSubscribeThreadInput = Schema.Struct({
  threadId: ThreadId,
  // Cursor of the last event the client already applied. When present and the
  // gap fits the server's replay limit, the stream replays only the gap and
  // skips the full-history snapshot. Optional so older clients keep the
  // snapshot-first behavior unchanged.
  afterSequence: Schema.optional(NonNegativeInt),
});
export type OrchestrationSubscribeThreadInput = typeof OrchestrationSubscribeThreadInput.Type;

export const OrchestrationGetThreadDetailSnapshotInput = Schema.Struct({
  threadId: ThreadId,
});
export type OrchestrationGetThreadDetailSnapshotInput =
  typeof OrchestrationGetThreadDetailSnapshotInput.Type;

export const OrchestrationGetThreadDetailSnapshotResult = Schema.NullOr(
  OrchestrationThreadDetailSnapshot,
);
export type OrchestrationGetThreadDetailSnapshotResult =
  typeof OrchestrationGetThreadDetailSnapshotResult.Type;

export const OrchestrationImportThreadInput = Schema.Struct({
  threadId: ThreadId,
  externalId: TrimmedNonEmptyString,
});
export type OrchestrationImportThreadInput = typeof OrchestrationImportThreadInput.Type;

export const OrchestrationImportThreadResult = Schema.Struct({
  threadId: ThreadId,
});
export type OrchestrationImportThreadResult = typeof OrchestrationImportThreadResult.Type;

export const OrchestrationUnsubscribeThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type OrchestrationUnsubscribeThreadInput = typeof OrchestrationUnsubscribeThreadInput.Type;

export const OrchestrationRpcSchemas = {
  getSnapshot: {
    input: OrchestrationGetSnapshotInput,
    output: OrchestrationGetSnapshotResult,
  },
  getShellSnapshot: {
    input: OrchestrationGetShellSnapshotInput,
    output: OrchestrationGetShellSnapshotResult,
  },
  getThreadDetailSnapshot: {
    input: OrchestrationGetThreadDetailSnapshotInput,
    output: OrchestrationGetThreadDetailSnapshotResult,
  },
  repairState: {
    input: OrchestrationRepairStateInput,
    output: OrchestrationRepairStateResult,
  },
  dispatchCommand: {
    input: ClientOrchestrationCommand,
    output: DispatchResult,
  },
  importThread: {
    input: OrchestrationImportThreadInput,
    output: OrchestrationImportThreadResult,
  },
  getTurnDiff: {
    input: OrchestrationGetTurnDiffInput,
    output: OrchestrationGetTurnDiffResult,
  },
  getFullThreadDiff: {
    input: OrchestrationGetFullThreadDiffInput,
    output: OrchestrationGetFullThreadDiffResult,
  },
  replayEvents: {
    input: OrchestrationReplayEventsInput,
    output: OrchestrationReplayEventsResult,
  },
  listProviderDeliveryBlockers: {
    input: OrchestrationListProviderDeliveryBlockersInput,
    output: OrchestrationListProviderDeliveryBlockersResult,
  },
  reconcileProviderDelivery: {
    input: OrchestrationReconcileProviderDeliveryInput,
    output: OrchestrationReconcileProviderDeliveryResult,
  },
  subscribeShell: {
    input: OrchestrationSubscribeShellInput,
    output: Schema.Void,
  },
  unsubscribeShell: {
    input: OrchestrationUnsubscribeShellInput,
    output: Schema.Void,
  },
  subscribeThread: {
    input: OrchestrationSubscribeThreadInput,
    output: Schema.Void,
  },
  unsubscribeThread: {
    input: OrchestrationUnsubscribeThreadInput,
    output: Schema.Void,
  },
} as const;
