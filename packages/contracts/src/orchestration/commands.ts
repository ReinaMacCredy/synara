import { Schema } from "effect";
import {
  ApprovalRequestId,
  CheckpointRef,
  CommandId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  SpaceId,
  ThreadId,
  ThreadMarkerId,
  TrimmedNonEmptyString,
  TurnId,
} from "../baseSchemas";
import { AcceptedCrossModeHandoffV1, HandoffAttemptId, HandoffConversationMode } from "../handoff";
import { ProjectKind } from "../project";
import { ProviderMentionReference, ProviderSkillReference } from "../providerDiscovery";
import { SupervisedCommand } from "../supervised";
import { SupervisedFirstSendBootstrap, SupervisedGovernanceCommand } from "../supervisedGovernance";
import { TaskProcessCommand } from "../taskProcess";
import {
  ProjectScript,
  SPACES_MAX_COUNT,
  SPACE_PROJECTS_ASSIGN_MAX_COUNT,
  SpaceIconName,
  SpaceName,
} from "./projectSpace";
import {
  AssistantDeliveryMode,
  ChatAttachment,
  ChatAttachmentList,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_TURN_DISPATCH_MODE,
  MessageDispatchOrigin,
  ModelSelection,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  ProviderReviewTarget,
  ProviderStartOptions,
  ProviderUserInputAnswers,
  RuntimeMode,
  SidechatSourceThreadId,
  THREAD_MARKER_SELECTED_TEXT_MAX_CHARS,
  ThreadCreationSource,
  ThreadEnvironmentMode,
  TurnDispatchMode,
  TurnMessageContentCheck,
  UploadChatAttachmentList,
} from "./provider";
import {
  OrchestrationCheckpointFile,
  OrchestrationCheckpointStatus,
  OrchestrationProposedPlan,
  OrchestrationSession,
  OrchestrationSessionStatus,
  OrchestrationThreadActivity,
  OrchestrationThreadPullRequest,
  PinnedMessageLabel,
  SourceProposedPlanReference,
  ThreadHandoff,
  ThreadMarkerColor,
  ThreadMarkerLabel,
  ThreadMarkerStyle,
  ThreadMarkers,
  ThreadNotes,
  ThreadOriginEnvelope,
  ThreadPinnedMessages,
} from "./threadTranscript";

export const SpaceCreateCommand = Schema.Struct({
  type: Schema.Literal("space.create"),
  commandId: CommandId,
  spaceId: SpaceId,
  name: SpaceName,
  icon: SpaceIconName,
  createdAt: IsoDateTime,
});

export const SpaceMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("space.meta.update"),
  commandId: CommandId,
  spaceId: SpaceId,
  name: Schema.optional(SpaceName),
  icon: Schema.optional(SpaceIconName),
});

export const SpaceReorderCommand = Schema.Struct({
  type: Schema.Literal("space.reorder"),
  commandId: CommandId,
  spaceId: SpaceId,
  orderedSpaceIds: Schema.Array(SpaceId).check(Schema.isMaxLength(SPACES_MAX_COUNT)),
});

export const SpaceDeleteCommand = Schema.Struct({
  type: Schema.Literal("space.delete"),
  commandId: CommandId,
  spaceId: SpaceId,
});

/**
 * Bulk assignment into one target space, applied atomically in a single transaction.
 * Moving projects out to Void stays per-project via `project.meta.update` — the only
 * bulk surface in the app files projects *into* a space.
 */
export const SpaceProjectsAssignCommand = Schema.Struct({
  type: Schema.Literal("space.projects.assign"),
  commandId: CommandId,
  spaceId: SpaceId,
  projectIds: Schema.Array(ProjectId).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(SPACE_PROJECTS_ASSIGN_MAX_COUNT),
  ),
});

export const ProjectCreateCommand = Schema.Struct({
  type: Schema.Literal("project.create"),
  commandId: CommandId,
  projectId: ProjectId,
  kind: Schema.optional(ProjectKind).pipe(Schema.withDecodingDefault(() => "project")),
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  createWorkspaceRootIfMissing: Schema.optional(Schema.Boolean).pipe(
    Schema.withDecodingDefault(() => false),
  ),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  isPinned: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => false)),
  /**
   * Space the project is born into (usually the client's active space). Best-effort:
   * an unusable target (deleted space, non-ordinary kind) degrades to Void rather
   * than failing creation.
   */
  spaceId: Schema.optional(Schema.NullOr(SpaceId)),
  createdAt: IsoDateTime,
});

export const ProjectMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("project.meta.update"),
  commandId: CommandId,
  projectId: ProjectId,
  kind: Schema.optional(ProjectKind),
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  createWorkspaceRootIfMissing: Schema.optional(Schema.Boolean).pipe(
    Schema.withDecodingDefault(() => false),
  ),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  isPinned: Schema.optional(Schema.Boolean),
  spaceId: Schema.optional(Schema.NullOr(SpaceId)),
});

export const ProjectDeleteCommand = Schema.Struct({
  type: Schema.Literal("project.delete"),
  commandId: CommandId,
  projectId: ProjectId,
});

export const ThreadCreateCommand = Schema.Struct({
  type: Schema.Literal("thread.create"),
  commandId: CommandId,
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  envMode: Schema.optional(ThreadEnvironmentMode).pipe(Schema.withDecodingDefault(() => "local")),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  workingDirectory: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreeBranch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreeRef: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  createBranchFlowCompleted: Schema.optional(Schema.Boolean).pipe(
    Schema.withDecodingDefault(() => false),
  ),
  isPinned: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => false)),
  parentThreadId: Schema.optional(Schema.NullOr(ThreadId)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  creationSource: Schema.optional(ThreadCreationSource),
  sourceThreadId: Schema.optional(ThreadId),
  sourceTurnId: Schema.optional(TurnId),
  gatewayOperationId: Schema.optional(TrimmedNonEmptyString),
  gatewayOperationIndex: Schema.optional(NonNegativeInt),
  subagentAgentId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  subagentNickname: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  subagentRole: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  lastKnownPr: Schema.optional(Schema.NullOr(OrchestrationThreadPullRequest)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  createdAt: IsoDateTime,
});

export const ThreadFirstSendBootstrap = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  envMode: Schema.optional(ThreadEnvironmentMode).pipe(Schema.withDecodingDefault(() => "local")),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  workingDirectory: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreeBranch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreeRef: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  createBranchFlowCompleted: Schema.optional(Schema.Boolean).pipe(
    Schema.withDecodingDefault(() => false),
  ),
  isPinned: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => false)),
  lastKnownPr: Schema.optional(Schema.NullOr(OrchestrationThreadPullRequest)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  createdAt: IsoDateTime,
});
export type ThreadFirstSendBootstrap = typeof ThreadFirstSendBootstrap.Type;

export const ThreadHandoffImportedMessage = Schema.Struct({
  messageId: MessageId,
  role: Schema.Literals(["user", "assistant"]),
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ThreadHandoffImportedMessage = typeof ThreadHandoffImportedMessage.Type;

export const ThreadHandoffCreateCommand = Schema.Struct({
  type: Schema.Literal("thread.handoff.create"),
  commandId: CommandId,
  threadId: ThreadId,
  sourceThreadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  envMode: Schema.optional(ThreadEnvironmentMode).pipe(Schema.withDecodingDefault(() => "local")),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  workingDirectory: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreeBranch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreeRef: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  createBranchFlowCompleted: Schema.optional(Schema.Boolean).pipe(
    Schema.withDecodingDefault(() => false),
  ),
  importedMessages: Schema.Array(ThreadHandoffImportedMessage),
  crossModeHandoff: Schema.optional(AcceptedCrossModeHandoffV1),
  handoffAttemptId: Schema.optional(HandoffAttemptId),
  handoffDestinationMode: Schema.optional(HandoffConversationMode),
  handoffSourceLinkOnly: Schema.optional(Schema.Boolean),
  createdAt: IsoDateTime,
});

export const ThreadForkCreateCommand = Schema.Struct({
  type: Schema.Literal("thread.fork.create"),
  commandId: CommandId,
  threadId: ThreadId,
  sourceThreadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  envMode: Schema.optional(ThreadEnvironmentMode).pipe(Schema.withDecodingDefault(() => "local")),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  workingDirectory: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreeBranch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  associatedWorktreeRef: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  createBranchFlowCompleted: Schema.optional(Schema.Boolean).pipe(
    Schema.withDecodingDefault(() => false),
  ),
  parentThreadId: Schema.optional(Schema.NullOr(ThreadId)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  subagentNickname: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  subagentRole: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  sidechatSourceThreadId: SidechatSourceThreadId,
  importedMessages: Schema.Array(ThreadHandoffImportedMessage),
  createdAt: IsoDateTime,
});

export const ThreadDeleteCommand = Schema.Struct({
  type: Schema.Literal("thread.delete"),
  commandId: CommandId,
  threadId: ThreadId,
});

export const ThreadArchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.archive"),
  commandId: CommandId,
  threadId: ThreadId,
});

export const ThreadUnarchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.unarchive"),
  commandId: CommandId,
  threadId: ThreadId,
});

export const ThreadMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.meta.update"),
  commandId: CommandId,
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
  // Desired settled state; the decider stamps the authoritative settledAt timestamp.
  isSettled: Schema.optional(Schema.Boolean),
  parentThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  subagentAgentId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  subagentNickname: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  subagentRole: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  handoff: Schema.optional(Schema.NullOr(ThreadHandoff)),
  lastKnownPr: Schema.optional(Schema.NullOr(OrchestrationThreadPullRequest)),
  pinnedMessages: Schema.optional(ThreadPinnedMessages),
  threadMarkers: Schema.optional(ThreadMarkers),
  notes: Schema.optional(ThreadNotes),
});

export const ThreadPinnedMessageAddCommand = Schema.Struct({
  type: Schema.Literal("thread.pinned-message.add"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
});

export const ThreadPinnedMessageRemoveCommand = Schema.Struct({
  type: Schema.Literal("thread.pinned-message.remove"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
});

export const ThreadPinnedMessageDoneSetCommand = Schema.Struct({
  type: Schema.Literal("thread.pinned-message.done.set"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  done: Schema.Boolean,
});

export const ThreadPinnedMessageLabelSetCommand = Schema.Struct({
  type: Schema.Literal("thread.pinned-message.label.set"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  label: Schema.NullOr(PinnedMessageLabel),
});

export const ThreadMarkerAddCommand = Schema.Struct({
  type: Schema.Literal("thread.marker.add"),
  commandId: CommandId,
  threadId: ThreadId,
  markerId: ThreadMarkerId,
  messageId: MessageId,
  startOffset: NonNegativeInt,
  endOffset: NonNegativeInt,
  selectedText: TrimmedNonEmptyString.check(
    Schema.isMaxLength(THREAD_MARKER_SELECTED_TEXT_MAX_CHARS),
  ),
  style: ThreadMarkerStyle,
  color: ThreadMarkerColor,
});

export const ThreadMarkerRemoveCommand = Schema.Struct({
  type: Schema.Literal("thread.marker.remove"),
  commandId: CommandId,
  threadId: ThreadId,
  markerId: ThreadMarkerId,
});

export const ThreadMarkerDoneSetCommand = Schema.Struct({
  type: Schema.Literal("thread.marker.done.set"),
  commandId: CommandId,
  threadId: ThreadId,
  markerId: ThreadMarkerId,
  done: Schema.Boolean,
});

export const ThreadMarkerLabelSetCommand = Schema.Struct({
  type: Schema.Literal("thread.marker.label.set"),
  commandId: CommandId,
  threadId: ThreadId,
  markerId: ThreadMarkerId,
  label: Schema.NullOr(ThreadMarkerLabel),
});

export const ThreadRuntimeModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.runtime-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  createdAt: IsoDateTime,
});

export const ThreadInteractionModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.interaction-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode,
  createdAt: IsoDateTime,
});

export const ThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literals(["user", "thread"]),
    text: Schema.String.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
    attachments: ChatAttachmentList,
    skills: Schema.optional(Schema.Array(ProviderSkillReference)),
    mentions: Schema.optional(Schema.Array(ProviderMentionReference)),
  }).check(TurnMessageContentCheck),
  modelSelection: Schema.optional(ModelSelection),
  providerOptions: Schema.optional(ProviderStartOptions),
  reviewTarget: Schema.optional(ProviderReviewTarget),
  assistantDeliveryMode: Schema.optional(AssistantDeliveryMode),
  dispatchMode: Schema.optional(TurnDispatchMode).pipe(
    Schema.withDecodingDefault(() => DEFAULT_TURN_DISPATCH_MODE),
  ),
  // Set by the automation engine when it dispatches a turn. Clients cannot set it:
  // ClientThreadTurnStartCommand omits the field, so decoding strips any spoofed value.
  dispatchOrigin: Schema.optional(MessageDispatchOrigin),
  threadOrigin: Schema.optional(ThreadOriginEnvelope),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  threadBootstrap: Schema.optional(ThreadFirstSendBootstrap),
  supervisedBootstrap: Schema.optional(SupervisedFirstSendBootstrap),
  createdAt: IsoDateTime,
});

export const ClientThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
    attachments: UploadChatAttachmentList,
    skills: Schema.optional(Schema.Array(ProviderSkillReference)),
    mentions: Schema.optional(Schema.Array(ProviderMentionReference)),
  }).check(TurnMessageContentCheck),
  modelSelection: Schema.optional(ModelSelection),
  providerOptions: Schema.optional(ProviderStartOptions),
  reviewTarget: Schema.optional(ProviderReviewTarget),
  assistantDeliveryMode: Schema.optional(AssistantDeliveryMode),
  dispatchMode: Schema.optional(TurnDispatchMode).pipe(
    Schema.withDecodingDefault(() => DEFAULT_TURN_DISPATCH_MODE),
  ),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  threadBootstrap: Schema.optional(ThreadFirstSendBootstrap),
  supervisedBootstrap: Schema.optional(SupervisedFirstSendBootstrap),
  createdAt: IsoDateTime,
});

export const ThreadTurnInterruptCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.interrupt"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

export const ThreadTaskStopCommand = Schema.Struct({
  type: Schema.Literal("thread.task.stop"),
  commandId: CommandId,
  threadId: ThreadId,
  taskId: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

export const ThreadTaskBackgroundCommand = Schema.Struct({
  type: Schema.Literal("thread.task.background"),
  commandId: CommandId,
  threadId: ThreadId,
  toolUseId: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

export const ThreadDispatchQueuedTurnCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.dispatch-queued"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  modelSelection: Schema.optional(ModelSelection),
  providerOptions: Schema.optional(ProviderStartOptions),
  reviewTarget: Schema.optional(ProviderReviewTarget),
  assistantDeliveryMode: Schema.optional(AssistantDeliveryMode),
  dispatchMode: Schema.optional(TurnDispatchMode).pipe(
    Schema.withDecodingDefault(() => DEFAULT_TURN_DISPATCH_MODE),
  ),
  dispatchOrigin: Schema.optional(MessageDispatchOrigin),
  threadOrigin: Schema.optional(ThreadOriginEnvelope),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(() => DEFAULT_PROVIDER_INTERACTION_MODE),
  ),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

export const ThreadApprovalRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.approval.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  lifecycleGeneration: Schema.optional(TrimmedNonEmptyString),
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

export const ThreadUserInputRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.user-input.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  lifecycleGeneration: Schema.optional(TrimmedNonEmptyString),
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

export const ThreadCheckpointRevertCommand = Schema.Struct({
  type: Schema.Literal("thread.checkpoint.revert"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  scope: Schema.optional(Schema.Literals(["thread", "files"])),
  createdAt: IsoDateTime,
});

export const ThreadConversationRollbackCommand = Schema.Struct({
  type: Schema.Literal("thread.conversation.rollback"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  numTurns: NonNegativeInt,
  createdAt: IsoDateTime,
});

export const ThreadMessageEditAndResendCommand = Schema.Struct({
  type: Schema.Literal("thread.message.edit-and-resend"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
  modelSelection: Schema.optional(ModelSelection),
  providerOptions: Schema.optional(ProviderStartOptions),
  assistantDeliveryMode: Schema.optional(AssistantDeliveryMode),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  createdAt: IsoDateTime,
});

export const ThreadSessionStopCommand = Schema.Struct({
  type: Schema.Literal("thread.session.stop"),
  commandId: CommandId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

export const ThreadActivityAppendCommand = Schema.Struct({
  type: Schema.Literal("thread.activity.append"),
  commandId: CommandId,
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
  createdAt: IsoDateTime,
});

export const DispatchableClientOrchestrationCommand = Schema.Union([
  SpaceCreateCommand,
  SpaceMetaUpdateCommand,
  SpaceReorderCommand,
  SpaceDeleteCommand,
  SpaceProjectsAssignCommand,
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
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
  ThreadTurnInterruptCommand,
  ThreadTaskStopCommand,
  ThreadTaskBackgroundCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadMessageEditAndResendCommand,
  ThreadActivityAppendCommand,
  ThreadSessionStopCommand,
  SupervisedGovernanceCommand,
]);
export type DispatchableClientOrchestrationCommand =
  typeof DispatchableClientOrchestrationCommand.Type;

export const ClientOrchestrationCommand = Schema.Union([
  SpaceCreateCommand,
  SpaceMetaUpdateCommand,
  SpaceReorderCommand,
  SpaceDeleteCommand,
  SpaceProjectsAssignCommand,
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
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
  ClientThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadTaskStopCommand,
  ThreadTaskBackgroundCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadMessageEditAndResendCommand,
  ThreadActivityAppendCommand,
  ThreadSessionStopCommand,
  TaskProcessCommand,
  SupervisedGovernanceCommand,
  SupervisedCommand,
]);
export type ClientOrchestrationCommand = typeof ClientOrchestrationCommand.Type;

export const ThreadSessionSetCommand = Schema.Struct({
  type: Schema.Literal("thread.session.set"),
  commandId: CommandId,
  threadId: ThreadId,
  session: OrchestrationSession,
  expectedSessionStatus: Schema.optional(OrchestrationSessionStatus),
  expectedSessionUpdatedAt: Schema.optional(IsoDateTime),
  createdAt: IsoDateTime,
});

export const ThreadMessagesImportCommand = Schema.Struct({
  type: Schema.Literal("thread.messages.import"),
  commandId: CommandId,
  threadId: ThreadId,
  messages: Schema.Array(ThreadHandoffImportedMessage),
  createdAt: IsoDateTime,
});

export const ThreadMessageAssistantDeltaCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.delta"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  delta: Schema.String,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

export const ThreadMessageAssistantCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

export const ThreadProposedPlanUpsertCommand = Schema.Struct({
  type: Schema.Literal("thread.proposed-plan.upsert"),
  commandId: CommandId,
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
  createdAt: IsoDateTime,
});

export const ThreadTurnDiffCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.diff.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: TurnId,
  completedAt: IsoDateTime,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.optional(MessageId),
  checkpointTurnCount: NonNegativeInt,
  preserveLatestTurn: Schema.optional(Schema.Boolean),
  checkpointRevertTurnCount: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
});

export const ThreadRevertCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.revert.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

export const ThreadConversationRollbackCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.conversation.rollback.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  numTurns: NonNegativeInt,
  removedTurnIds: Schema.optional(Schema.Array(TurnId)),
  skipAttachmentPrune: Schema.optional(Schema.Boolean),
  createdAt: IsoDateTime,
});

export const InternalOrchestrationCommand = Schema.Union([
  ThreadSessionSetCommand,
  ThreadMessagesImportCommand,
  ThreadMessageAssistantDeltaCommand,
  ThreadMessageAssistantCompleteCommand,
  ThreadProposedPlanUpsertCommand,
  ThreadTurnDiffCompleteCommand,
  ThreadActivityAppendCommand,
  ThreadRevertCompleteCommand,
  ThreadConversationRollbackCommand,
  ThreadConversationRollbackCompleteCommand,
  ThreadDispatchQueuedTurnCommand,
]);
export type InternalOrchestrationCommand = typeof InternalOrchestrationCommand.Type;

export const OrchestrationCommand = Schema.Union([
  DispatchableClientOrchestrationCommand,
  InternalOrchestrationCommand,
  TaskProcessCommand,
  SupervisedGovernanceCommand,
  SupervisedCommand,
]);
export type OrchestrationCommand = typeof OrchestrationCommand.Type;

export const CoreOrchestrationEventType = Schema.Literals([
  "space.created",
  "space.meta-updated",
  "space.order-updated",
  "space.deleted",
  "project.created",
  "project.meta-updated",
  "project.deleted",
  "thread.created",
  "thread.deleted",
  // Legacy desktop installs can still contain these rows in orchestration_events.
  "thread.archived",
  "thread.unarchived",
  "thread.meta-updated",
  "thread.pinned-message-added",
  "thread.pinned-message-removed",
  "thread.pinned-message-done-set",
  "thread.pinned-message-label-set",
  "thread.marker-added",
  "thread.marker-removed",
  "thread.marker-done-set",
  "thread.marker-label-set",
  "thread.runtime-mode-set",
  "thread.interaction-mode-set",
  "thread.message-sent",
  "thread.turn-queued",
  "thread.turn-start-requested",
  "thread.turn-interrupt-requested",
  "thread.task-stop-requested",
  "thread.task-background-requested",
  "thread.approval-response-requested",
  "thread.user-input-response-requested",
  "thread.checkpoint-revert-requested",
  "thread.reverted",
  "thread.conversation-rollback-requested",
  "thread.conversation-rolled-back",
  "thread.message-edit-resend-requested",
  "thread.session-stop-requested",
  "thread.session-set",
  "thread.proposed-plan-upserted",
  "thread.turn-diff-completed",
  "thread.activity-appended",
]);
