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

export const OrchestrationMessageRole = Schema.Literals(["user", "assistant", "system", "thread"]);
export type OrchestrationMessageRole = typeof OrchestrationMessageRole.Type;

export const ThreadOriginEnvelope = Schema.Struct({
  messageId: TrimmedNonEmptyString,
  rootThreadId: ThreadId,
  senderThreadId: ThreadId,
  targetThreadId: ThreadId,
  assignmentId: Schema.NullOr(TrimmedNonEmptyString),
  runId: Schema.NullOr(TrimmedNonEmptyString),
  correlationId: Schema.NullOr(TrimmedNonEmptyString),
  replyToMessageId: Schema.NullOr(TrimmedNonEmptyString),
  hopCount: NonNegativeInt,
  artifactRefs: Schema.Array(TrimmedNonEmptyString),
});
export type ThreadOriginEnvelope = typeof ThreadOriginEnvelope.Type;

export const OrchestrationMessage = Schema.Struct({
  id: MessageId,
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
export type OrchestrationMessage = typeof OrchestrationMessage.Type;

export const ThreadHandoff = Schema.Struct({
  sourceThreadId: ThreadId,
  sourceProvider: ProviderKind,
  importedAt: IsoDateTime,
  bootstrapStatus: ThreadHandoffBootstrapStatus,
  crossMode: Schema.optional(Schema.NullOr(AcceptedCrossModeHandoffV1)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
});
export type ThreadHandoff = typeof ThreadHandoff.Type;

export const OrchestrationProposedPlanId = TrimmedNonEmptyString;
export type OrchestrationProposedPlanId = typeof OrchestrationProposedPlanId.Type;

export const OrchestrationProposedPlan = Schema.Struct({
  id: OrchestrationProposedPlanId,
  turnId: Schema.NullOr(TurnId),
  planMarkdown: TrimmedNonEmptyString,
  implementedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
  implementationThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(() => null)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProposedPlan = typeof OrchestrationProposedPlan.Type;

export const SourceProposedPlanReference = Schema.Struct({
  threadId: ThreadId,
  planId: OrchestrationProposedPlanId,
});

export const OrchestrationSessionStatus = Schema.Literals([
  "idle",
  "starting",
  "running",
  "ready",
  "interrupted",
  "stopped",
  "error",
]);
export type OrchestrationSessionStatus = typeof OrchestrationSessionStatus.Type;

export const OrchestrationSession = Schema.Struct({
  threadId: ThreadId,
  status: OrchestrationSessionStatus,
  providerName: Schema.NullOr(TrimmedNonEmptyString),
  providerSessionId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(() => DEFAULT_RUNTIME_MODE)),
  activeTurnId: Schema.NullOr(TurnId),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});
export type OrchestrationSession = typeof OrchestrationSession.Type;

export const OrchestrationCheckpointFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
});
export type OrchestrationCheckpointFile = typeof OrchestrationCheckpointFile.Type;

export const OrchestrationCheckpointStatus = Schema.Literals(["ready", "missing", "error"]);
export type OrchestrationCheckpointStatus = typeof OrchestrationCheckpointStatus.Type;

export const OrchestrationCheckpointSummary = Schema.Struct({
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type OrchestrationCheckpointSummary = typeof OrchestrationCheckpointSummary.Type;

export const OrchestrationThreadActivityTone = Schema.Literals([
  "info",
  "tool",
  "approval",
  "error",
]);
export type OrchestrationThreadActivityTone = typeof OrchestrationThreadActivityTone.Type;

export const OrchestrationThreadActivity = Schema.Struct({
  id: EventId,
  tone: OrchestrationThreadActivityTone,
  kind: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  payload: Schema.Json,
  turnId: Schema.NullOr(TurnId),
  sequence: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
});
export type OrchestrationThreadActivity = typeof OrchestrationThreadActivity.Type;

export const OrchestrationLatestTurnState = Schema.Literals([
  "running",
  "interrupted",
  "completed",
  "error",
]);
export type OrchestrationLatestTurnState = typeof OrchestrationLatestTurnState.Type;

export const OrchestrationLatestTurn = Schema.Struct({
  turnId: TurnId,
  state: OrchestrationLatestTurnState,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
});
export type OrchestrationLatestTurn = typeof OrchestrationLatestTurn.Type;

export const OrchestrationThreadPullRequest = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: Schema.String,
  baseBranch: TrimmedNonEmptyString,
  headBranch: TrimmedNonEmptyString,
  state: Schema.Literals(["open", "closed", "merged"]),
  // Optional so `last_known_pr_json` rows persisted before these fields existed still
  // decode. Literals stay inline: importing git.ts here would create an import cycle.
  isDraft: Schema.optional(Schema.Boolean),
  mergeability: Schema.optional(Schema.Literals(["mergeable", "conflicting", "unknown"])),
  additions: Schema.optional(Schema.NullOr(NonNegativeInt)),
  deletions: Schema.optional(Schema.NullOr(NonNegativeInt)),
  changedFiles: Schema.optional(Schema.NullOr(NonNegativeInt)),
});
export type OrchestrationThreadPullRequest = typeof OrchestrationThreadPullRequest.Type;

/**
 * A message the user pinned to the chat's sidebar checklist. `label` is an
 * optional user override; when null the UI derives a label from the message
 * text. `done` tracks the checklist "addressed" state. Decoding defaults keep
 * older/partial persisted entries decodable as the shape evolves.
 */
export const ThreadNotes = Schema.String.check(Schema.isMaxLength(THREAD_NOTES_MAX_CHARS));
export type ThreadNotes = typeof ThreadNotes.Type;
export const PinnedMessageLabel = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PINNED_MESSAGE_LABEL_MAX_CHARS),
);
export type PinnedMessageLabel = typeof PinnedMessageLabel.Type;
export const PinnedMessage = Schema.Struct({
  messageId: MessageId,
  label: Schema.optional(Schema.NullOr(PinnedMessageLabel)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  done: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => false)),
  pinnedAt: IsoDateTime,
});
export type PinnedMessage = typeof PinnedMessage.Type;
export const ThreadPinnedMessages = Schema.Array(PinnedMessage).check(
  Schema.isMaxLength(PINNED_MESSAGES_MAX_COUNT),
);
export type ThreadPinnedMessages = typeof ThreadPinnedMessages.Type;
export const ThreadMarkerStyle = Schema.Literals(["highlight", "underline"]);
export type ThreadMarkerStyle = typeof ThreadMarkerStyle.Type;
export const ThreadMarkerColor = Schema.Literals(["yellow", "blue", "green", "pink"]);
export type ThreadMarkerColor = typeof ThreadMarkerColor.Type;
export const ThreadMarkerLabel = TrimmedNonEmptyString.check(
  Schema.isMaxLength(THREAD_MARKER_LABEL_MAX_CHARS),
);
export type ThreadMarkerLabel = typeof ThreadMarkerLabel.Type;
export const ThreadMarker = Schema.Struct({
  id: ThreadMarkerId,
  messageId: MessageId,
  startOffset: NonNegativeInt,
  endOffset: NonNegativeInt,
  selectedText: TrimmedNonEmptyString.check(
    Schema.isMaxLength(THREAD_MARKER_SELECTED_TEXT_MAX_CHARS),
  ),
  style: ThreadMarkerStyle,
  color: ThreadMarkerColor,
  label: Schema.optional(Schema.NullOr(ThreadMarkerLabel)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  done: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => false)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ThreadMarker = typeof ThreadMarker.Type;
export const ThreadMarkers = Schema.Array(ThreadMarker).check(
  Schema.isMaxLength(THREAD_MARKERS_MAX_COUNT),
);
export type ThreadMarkers = typeof ThreadMarkers.Type;

export const ProjectionPendingInteractionKind = Schema.Literals(["approval", "userInput"]);
export type ProjectionPendingInteractionKind = typeof ProjectionPendingInteractionKind.Type;

export const ProjectionPendingInteractionStatus = Schema.Literals([
  "pending",
  "responding",
  "confirmed",
  "retryable",
  "uncertain",
]);
export type ProjectionPendingInteractionStatus = typeof ProjectionPendingInteractionStatus.Type;

export const ProjectionPendingInteractionDecision = Schema.NullOr(ProviderApprovalDecision);
export type ProjectionPendingInteractionDecision = typeof ProjectionPendingInteractionDecision.Type;

/** Unresolved provider interaction settlement exposed to thread-detail consumers. */
export const OrchestrationPendingInteraction = Schema.Struct({
  interactionKind: ProjectionPendingInteractionKind,
  requestId: ApprovalRequestId,
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  lifecycleGeneration: Schema.NullOr(TrimmedNonEmptyString),
  status: ProjectionPendingInteractionStatus,
  decision: ProjectionPendingInteractionDecision,
  responseCommandId: Schema.NullOr(CommandId),
  responseRequestedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  resolvedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationPendingInteraction = typeof OrchestrationPendingInteraction.Type;

export const OrchestrationThread = Schema.Struct({
  id: ThreadId,
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
  creationSource: Schema.optional(Schema.NullOr(ThreadCreationSource)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  sourceThreadId: Schema.optional(Schema.NullOr(ThreadId)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  sourceTurnId: Schema.optional(Schema.NullOr(TurnId)).pipe(Schema.withDecodingDefault(() => null)),
  gatewayOperationId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  gatewayOperationIndex: Schema.optional(Schema.NullOr(NonNegativeInt)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
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
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  latestUserMessageAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  hasPendingApprovals: Schema.optional(Schema.Boolean),
  hasPendingUserInput: Schema.optional(Schema.Boolean),
  hasActionableProposedPlan: Schema.optional(Schema.Boolean),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.optional(Schema.NullOr(IsoDateTime)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  settledAt: Schema.optional(Schema.NullOr(IsoDateTime)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  deletedAt: Schema.NullOr(IsoDateTime),
  handoff: Schema.NullOr(ThreadHandoff).pipe(Schema.withDecodingDefault(() => null)),
  pinnedMessages: Schema.optional(ThreadPinnedMessages),
  threadMarkers: Schema.optional(ThreadMarkers),
  notes: Schema.optional(ThreadNotes),
  messages: Schema.Array(OrchestrationMessage),
  proposedPlans: Schema.Array(OrchestrationProposedPlan).pipe(Schema.withDecodingDefault(() => [])),
  activities: Schema.Array(OrchestrationThreadActivity),
  pendingInteractions: Schema.optional(Schema.Array(OrchestrationPendingInteraction)),
  checkpoints: Schema.Array(OrchestrationCheckpointSummary),
  session: Schema.NullOr(OrchestrationSession),
});
export type OrchestrationThread = typeof OrchestrationThread.Type;

export const OrchestrationThreadShell = Schema.Struct({
  id: ThreadId,
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
  creationSource: Schema.optional(Schema.NullOr(ThreadCreationSource)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  sourceThreadId: Schema.optional(Schema.NullOr(ThreadId)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  sourceTurnId: Schema.optional(Schema.NullOr(TurnId)).pipe(Schema.withDecodingDefault(() => null)),
  gatewayOperationId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  gatewayOperationIndex: Schema.optional(Schema.NullOr(NonNegativeInt)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
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
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  latestUserMessageAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  hasPendingApprovals: Schema.optional(Schema.Boolean),
  hasPendingUserInput: Schema.optional(Schema.Boolean),
  hasActionableProposedPlan: Schema.optional(Schema.Boolean),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.optional(Schema.NullOr(IsoDateTime)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  settledAt: Schema.optional(Schema.NullOr(IsoDateTime)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  handoff: Schema.NullOr(ThreadHandoff).pipe(Schema.withDecodingDefault(() => null)),
  session: Schema.NullOr(OrchestrationSession),
});
export type OrchestrationThreadShell = typeof OrchestrationThreadShell.Type;

export const OrchestrationReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  spaces: Schema.Array(OrchestrationSpace),
  projects: Schema.Array(OrchestrationProject),
  threads: Schema.Array(OrchestrationThread),
  supervisedOrchestration: SupervisedOrchestrationSnapshot.pipe(
    Schema.withDecodingDefault(() =>
      emptySupervisedOrchestrationSnapshot(new Date(0).toISOString()),
    ),
  ),
  supervised: SupervisedRuntimeSnapshot.pipe(
    Schema.withDecodingDefault(() => emptySupervisedRuntimeSnapshot(new Date(0).toISOString())),
  ),
  updatedAt: IsoDateTime,
});
export type OrchestrationReadModel = typeof OrchestrationReadModel.Type;

export const OrchestrationShellSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  spaces: Schema.Array(OrchestrationSpaceShell),
  projects: Schema.Array(OrchestrationProjectShell),
  threads: Schema.Array(OrchestrationThreadShell),
  supervisedOrchestration: SupervisedOrchestrationSnapshot.pipe(
    Schema.withDecodingDefault(() =>
      emptySupervisedOrchestrationSnapshot(new Date(0).toISOString()),
    ),
  ),
  updatedAt: IsoDateTime,
});
export type OrchestrationShellSnapshot = typeof OrchestrationShellSnapshot.Type;

export const OrchestrationShellStreamEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("space-upserted"),
    sequence: NonNegativeInt,
    space: OrchestrationSpaceShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("space-removed"),
    sequence: NonNegativeInt,
    spaceId: SpaceId,
    updatedAt: IsoDateTime,
  }),
  Schema.Struct({
    kind: Schema.Literal("space-order-updated"),
    sequence: NonNegativeInt,
    orderedSpaceIds: Schema.Array(SpaceId),
  }),
  Schema.Struct({
    kind: Schema.Literal("project-upserted"),
    sequence: NonNegativeInt,
    project: OrchestrationProjectShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("project-removed"),
    sequence: NonNegativeInt,
    projectId: ProjectId,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-upserted"),
    sequence: NonNegativeInt,
    thread: OrchestrationThreadShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-removed"),
    sequence: NonNegativeInt,
    threadId: ThreadId,
  }),
  Schema.Struct({
    kind: Schema.Literal("supervised-orchestration-updated"),
    sequence: NonNegativeInt,
    supervisedOrchestration: SupervisedOrchestrationSnapshot,
  }),
]);
export type OrchestrationShellStreamEvent = typeof OrchestrationShellStreamEvent.Type;

export const OrchestrationShellStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationShellSnapshot,
  }),
  OrchestrationShellStreamEvent,
]);
export type OrchestrationShellStreamItem = typeof OrchestrationShellStreamItem.Type;
