import { Schema } from "effect";
import {
  ApprovalRequestId,
  CheckpointRef,
  CommandId,
  EventId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  ProviderItemId,
  SpaceId,
  ThreadId,
  ThreadMarkerId,
  TrimmedNonEmptyString,
  TurnId,
} from "../baseSchemas";
import { ProjectKind } from "../project";
import { ProviderMentionReference, ProviderSkillReference } from "../providerDiscovery";
import { SupervisedAggregateKind, SupervisedDomainEvent, SupervisedEventType } from "../supervised";
import {
  SupervisedGovernanceAggregateId,
  SupervisedGovernanceDomainEvent,
  SupervisedGovernanceEventType,
} from "../supervisedGovernance";
import {
  SupervisionAggregateId,
  SupervisionDomainEvent,
  SupervisionEventType,
} from "../supervision";
import { TaskProcessDomainEvent, TaskProcessEventType, TaskProcessId } from "../taskProcess";
import { CoreOrchestrationEventType } from "./commands";
import { ProjectScript, SPACES_MAX_COUNT, SpaceIconName, SpaceName } from "./projectSpace";
import {
  AssistantDeliveryMode,
  ChatAttachment,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_TURN_DISPATCH_MODE,
  MessageDispatchOrigin,
  ModelSelection,
  OrchestrationMessageSource,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  ProviderReviewTarget,
  ProviderStartOptions,
  ProviderUserInputAnswers,
  RuntimeMode,
  SidechatSourceThreadId,
  ThreadCreationSource,
  ThreadEnvironmentMode,
  TurnDispatchMode,
} from "./provider";
import {
  OrchestrationCheckpointFile,
  OrchestrationCheckpointStatus,
  OrchestrationMessageRole,
  OrchestrationProposedPlan,
  OrchestrationSession,
  OrchestrationThreadActivity,
  OrchestrationThreadPullRequest,
  PinnedMessage,
  PinnedMessageLabel,
  SourceProposedPlanReference,
  ThreadHandoff,
  ThreadMarker,
  ThreadMarkerLabel,
  ThreadMarkers,
  ThreadNotes,
  ThreadOriginEnvelope,
  ThreadPinnedMessages,
} from "./threadTranscript";

export const OrchestrationEventType = Schema.Union([
  CoreOrchestrationEventType,
  TaskProcessEventType,
  SupervisionEventType,
  SupervisedGovernanceEventType,
  SupervisedEventType,
]);
export type OrchestrationEventType = typeof OrchestrationEventType.Type;

export const OrchestrationAggregateKind = Schema.Union([
  Schema.Literals([
    "space",
    "project",
    "thread",
    "task_process",
    "supervision",
    "supervised_governance",
  ]),
  SupervisedAggregateKind,
]);
export type OrchestrationAggregateKind = typeof OrchestrationAggregateKind.Type;
export const OrchestrationActorKind = Schema.Literals(["client", "server", "provider"]);

export const SpaceCreatedPayload = Schema.Struct({
  spaceId: SpaceId,
  name: SpaceName,
  icon: SpaceIconName,
  sortOrder: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const SpaceMetaUpdatedPayload = Schema.Struct({
  spaceId: SpaceId,
  name: Schema.optional(SpaceName),
  icon: Schema.optional(SpaceIconName),
  updatedAt: IsoDateTime,
});

export const SpaceOrderUpdatedPayload = Schema.Struct({
  spaceId: SpaceId,
  orderedSpaceIds: Schema.Array(SpaceId).check(Schema.isMaxLength(SPACES_MAX_COUNT)),
  updatedAt: IsoDateTime,
});

export const SpaceDeletedPayload = Schema.Struct({
  spaceId: SpaceId,
  deletedAt: IsoDateTime,
});

export const ProjectCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  kind: Schema.optional(ProjectKind).pipe(Schema.withDecodingDefault(() => "project")),
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  defaultModelSelection: Schema.NullOr(ModelSelection),
  scripts: Schema.Array(ProjectScript),
  isPinned: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => false)),
  spaceId: Schema.optional(Schema.NullOr(SpaceId)).pipe(Schema.withDecodingDefault(() => null)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectMetaUpdatedPayload = Schema.Struct({
  projectId: ProjectId,
  kind: Schema.optional(ProjectKind),
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  isPinned: Schema.optional(Schema.Boolean),
  spaceId: Schema.optional(Schema.NullOr(SpaceId)),
  updatedAt: IsoDateTime,
});

export const ProjectDeletedPayload = Schema.Struct({
  projectId: ProjectId,
  deletedAt: IsoDateTime,
});

export const ThreadCreatedPayload = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  envMode: Schema.optional(ThreadEnvironmentMode).pipe(Schema.withDecodingDefault(() => "local")),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  workingDirectory: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  associatedWorktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  associatedWorktreeBranch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  associatedWorktreeRef: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  createBranchFlowCompleted: Schema.optional(Schema.Boolean).pipe(
    Schema.withDecodingDefault(() => false),
  ),
  isPinned: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => false)),
  parentThreadId: Schema.optional(Schema.NullOr(ThreadId)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  creationSource: Schema.optional(Schema.NullOr(ThreadCreationSource)),
  sourceThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  sourceTurnId: Schema.optional(Schema.NullOr(TurnId)),
  gatewayOperationId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  gatewayOperationIndex: Schema.optional(Schema.NullOr(NonNegativeInt)),
  subagentAgentId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  subagentNickname: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  subagentRole: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  forkSourceThreadId: Schema.optional(Schema.NullOr(ThreadId)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  sidechatSourceThreadId: SidechatSourceThreadId,
  lastKnownPr: Schema.optional(Schema.NullOr(OrchestrationThreadPullRequest)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  handoff: Schema.NullOr(ThreadHandoff).pipe(Schema.withDecodingDefault(() => null)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadDeletedPayload = Schema.Struct({
  threadId: ThreadId,
  deletedAt: IsoDateTime,
});

export const ThreadArchivedPayload = Schema.Struct({
  threadId: ThreadId,
  // Required for new events, optional for legacy events
  archivedAt: Schema.optional(IsoDateTime),
  updatedAt: Schema.optional(IsoDateTime),
});

export const ThreadUnarchivedPayload = Schema.Struct({
  threadId: ThreadId,
  // Legacy field - kept for backward compatibility with old events
  unarchivedAt: Schema.optional(IsoDateTime),
  // Required for new events
  updatedAt: Schema.optional(IsoDateTime),
});

export const ThreadMetaUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  envMode: Schema.optional(ThreadEnvironmentMode),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  workingDirectory: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreeBranch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreeRef: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  createBranchFlowCompleted: Schema.optional(Schema.Boolean),
  isPinned: Schema.optional(Schema.Boolean),
  settledAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  parentThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  subagentAgentId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  subagentNickname: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  subagentRole: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  handoff: Schema.optional(Schema.NullOr(ThreadHandoff)),
  lastKnownPr: Schema.optional(Schema.NullOr(OrchestrationThreadPullRequest)),
  pinnedMessages: Schema.optional(ThreadPinnedMessages),
  threadMarkers: Schema.optional(ThreadMarkers),
  notes: Schema.optional(ThreadNotes),
  updatedAt: IsoDateTime,
});

export const ThreadPinnedMessageAddedPayload = Schema.Struct({
  threadId: ThreadId,
  pin: PinnedMessage,
  updatedAt: IsoDateTime,
});

export const ThreadPinnedMessageRemovedPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  updatedAt: IsoDateTime,
});

export const ThreadPinnedMessageDoneSetPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  done: Schema.Boolean,
  updatedAt: IsoDateTime,
});

export const ThreadPinnedMessageLabelSetPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  label: Schema.NullOr(PinnedMessageLabel),
  updatedAt: IsoDateTime,
});

export const ThreadMarkerAddedPayload = Schema.Struct({
  threadId: ThreadId,
  marker: ThreadMarker,
  updatedAt: IsoDateTime,
});

export const ThreadMarkerRemovedPayload = Schema.Struct({
  threadId: ThreadId,
  markerId: ThreadMarkerId,
  updatedAt: IsoDateTime,
});

export const ThreadMarkerDoneSetPayload = Schema.Struct({
  threadId: ThreadId,
  markerId: ThreadMarkerId,
  done: Schema.Boolean,
  updatedAt: IsoDateTime,
});

export const ThreadMarkerLabelSetPayload = Schema.Struct({
  threadId: ThreadId,
  markerId: ThreadMarkerId,
  label: Schema.NullOr(ThreadMarkerLabel),
  updatedAt: IsoDateTime,
});

export const ThreadRuntimeModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  updatedAt: IsoDateTime,
});

export const ThreadInteractionModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  updatedAt: IsoDateTime,
});

export const ThreadMessageSentPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  skills: Schema.optional(Schema.Array(ProviderSkillReference)),
  mentions: Schema.optional(Schema.Array(ProviderMentionReference)),
  dispatchMode: Schema.optional(TurnDispatchMode),
  dispatchOrigin: Schema.optional(MessageDispatchOrigin),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  source: OrchestrationMessageSource.pipe(Schema.withDecodingDefault(() => "native")),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadTurnStartRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  modelSelection: Schema.optional(ModelSelection),
  providerOptions: Schema.optional(ProviderStartOptions),
  reviewTarget: Schema.optional(ProviderReviewTarget),
  assistantDeliveryMode: Schema.optional(AssistantDeliveryMode),
  dispatchMode: TurnDispatchMode.pipe(Schema.withDecodingDefault(() => DEFAULT_TURN_DISPATCH_MODE)),
  dispatchOrigin: Schema.optional(MessageDispatchOrigin),
  threadOrigin: Schema.optional(ThreadOriginEnvelope),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

export const ThreadTurnQueuedPayload = ThreadTurnStartRequestedPayload;

export const ThreadTurnInterruptRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

export const ThreadTaskStopRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  taskId: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

export const ThreadTaskBackgroundRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  toolUseId: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

export const ThreadApprovalResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  lifecycleGeneration: Schema.optional(TrimmedNonEmptyString),
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

export const ThreadUserInputResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  lifecycleGeneration: Schema.optional(TrimmedNonEmptyString),
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

export const ThreadCheckpointRevertRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  scope: Schema.optional(Schema.Literals(["thread", "files"])).pipe(
    Schema.withDecodingDefault(() => "thread"),
  ),
  createdAt: IsoDateTime,
});

export const ThreadRevertedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
});

export const ThreadConversationRollbackRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  numTurns: NonNegativeInt,
  createdAt: IsoDateTime,
});

export const ThreadConversationRolledBackPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  numTurns: NonNegativeInt,
  removedTurnIds: Schema.optional(Schema.Array(TurnId)),
  skipAttachmentPrune: Schema.optional(Schema.Boolean),
});

export const ThreadMessageEditResendRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
  rollbackTurnCount: Schema.optional(NonNegativeInt),
  removedTurnIds: Schema.optional(Schema.Array(TurnId)),
  modelSelection: Schema.optional(ModelSelection),
  providerOptions: Schema.optional(ProviderStartOptions),
  assistantDeliveryMode: Schema.optional(AssistantDeliveryMode),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  createdAt: IsoDateTime,
});

export const ThreadSessionStopRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

export const ThreadSessionSetPayload = Schema.Struct({
  threadId: ThreadId,
  session: OrchestrationSession,
});

export const ThreadProposedPlanUpsertedPayload = Schema.Struct({
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
});

export const ThreadTurnDiffCompletedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
  preserveLatestTurn: Schema.optional(Schema.Boolean),
});

export const ThreadActivityAppendedPayload = Schema.Struct({
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
});

export const OrchestrationEventMetadata = Schema.Struct({
  providerTurnId: Schema.optional(TrimmedNonEmptyString),
  providerItemId: Schema.optional(ProviderItemId),
  adapterKey: Schema.optional(TrimmedNonEmptyString),
  requestId: Schema.optional(ApprovalRequestId),
  ingestedAt: Schema.optional(IsoDateTime),
});
export type OrchestrationEventMetadata = typeof OrchestrationEventMetadata.Type;

export const EventBaseFields = {
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: OrchestrationAggregateKind,
  aggregateId: Schema.Union([
    SpaceId,
    ProjectId,
    ThreadId,
    TaskProcessId,
    SupervisionAggregateId,
    SupervisedGovernanceAggregateId,
  ]),
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: OrchestrationEventMetadata,
} as const;

export const OrchestrationEvent = Schema.Union([
  TaskProcessDomainEvent,
  SupervisionDomainEvent,
  SupervisedGovernanceDomainEvent,
  SupervisedDomainEvent,
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("space.created"),
    payload: SpaceCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("space.meta-updated"),
    payload: SpaceMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("space.order-updated"),
    payload: SpaceOrderUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("space.deleted"),
    payload: SpaceDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.created"),
    payload: ProjectCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.meta-updated"),
    payload: ProjectMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.deleted"),
    payload: ProjectDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.created"),
    payload: ThreadCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.deleted"),
    payload: ThreadDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.archived"),
    payload: ThreadArchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.unarchived"),
    payload: ThreadUnarchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.meta-updated"),
    payload: ThreadMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.pinned-message-added"),
    payload: ThreadPinnedMessageAddedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.pinned-message-removed"),
    payload: ThreadPinnedMessageRemovedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.pinned-message-done-set"),
    payload: ThreadPinnedMessageDoneSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.pinned-message-label-set"),
    payload: ThreadPinnedMessageLabelSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.marker-added"),
    payload: ThreadMarkerAddedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.marker-removed"),
    payload: ThreadMarkerRemovedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.marker-done-set"),
    payload: ThreadMarkerDoneSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.marker-label-set"),
    payload: ThreadMarkerLabelSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.runtime-mode-set"),
    payload: ThreadRuntimeModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.interaction-mode-set"),
    payload: ThreadInteractionModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.message-sent"),
    payload: ThreadMessageSentPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-queued"),
    payload: ThreadTurnQueuedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-start-requested"),
    payload: ThreadTurnStartRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-interrupt-requested"),
    payload: ThreadTurnInterruptRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.task-stop-requested"),
    payload: ThreadTaskStopRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.task-background-requested"),
    payload: ThreadTaskBackgroundRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.approval-response-requested"),
    payload: ThreadApprovalResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.user-input-response-requested"),
    payload: ThreadUserInputResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.checkpoint-revert-requested"),
    payload: ThreadCheckpointRevertRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.reverted"),
    payload: ThreadRevertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.conversation-rollback-requested"),
    payload: ThreadConversationRollbackRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.conversation-rolled-back"),
    payload: ThreadConversationRolledBackPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.message-edit-resend-requested"),
    payload: ThreadMessageEditResendRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-stop-requested"),
    payload: ThreadSessionStopRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-set"),
    payload: ThreadSessionSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.proposed-plan-upserted"),
    payload: ThreadProposedPlanUpsertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-diff-completed"),
    payload: ThreadTurnDiffCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.activity-appended"),
    payload: ThreadActivityAppendedPayload,
  }),
]);
export type OrchestrationEvent = typeof OrchestrationEvent.Type;
