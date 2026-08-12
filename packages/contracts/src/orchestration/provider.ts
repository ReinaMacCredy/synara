import { Option, Schema, SchemaIssue } from "effect";
import {
  CommandId,
  MessageId,
  NonNegativeInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "../baseSchemas";
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

export const ORCHESTRATION_WS_METHODS = {
  getSnapshot: "orchestration.getSnapshot",
  getShellSnapshot: "orchestration.getShellSnapshot",
  getThreadDetailSnapshot: "orchestration.getThreadDetailSnapshot",
  dispatchCommand: "orchestration.dispatchCommand",
  importThread: "orchestration.importThread",
  repairState: "orchestration.repairState",
  getTurnDiff: "orchestration.getTurnDiff",
  getFullThreadDiff: "orchestration.getFullThreadDiff",
  replayEvents: "orchestration.replayEvents",
  listProviderDeliveryBlockers: "orchestration.listProviderDeliveryBlockers",
  reconcileProviderDelivery: "orchestration.reconcileProviderDelivery",
  subscribeShell: "orchestration.subscribeShell",
  unsubscribeShell: "orchestration.unsubscribeShell",
  subscribeThread: "orchestration.subscribeThread",
  unsubscribeThread: "orchestration.unsubscribeThread",
  listTaskProcesses: "orchestration.listTaskProcesses",
  getTaskProcessSummary: "orchestration.getTaskProcessSummary",
  getTaskProcessGraph: "orchestration.getTaskProcessGraph",
  getSessionProgress: "orchestration.getSessionProgress",
  dispatchTaskProcessCommand: "orchestration.dispatchTaskProcessCommand",
  startHandoffPreparation: "orchestration.startHandoffPreparation",
  getHandoffPreparation: "orchestration.getHandoffPreparation",
  cancelHandoffPreparation: "orchestration.cancelHandoffPreparation",
  listHandoffGrants: "orchestration.listHandoffGrants",
  revokeHandoffGrant: "orchestration.revokeHandoffGrant",
  getSupervisedRuntime: "orchestration.getSupervisedRuntime",
  getSupervisedSettings: "orchestration.getSupervisedSettings",
  putSupervisedModelCapabilityProfile: "orchestration.putSupervisedModelCapabilityProfile",
  putSupervisedModelPreferences: "orchestration.putSupervisedModelPreferences",
  updateSupervisedToolPolicy: "orchestration.updateSupervisedToolPolicy",
  testSupervisedSubscription: "orchestration.testSupervisedSubscription",
  inspectSupervisedPlugin: "orchestration.inspectSupervisedPlugin",
  installSupervisedPlugin: "orchestration.installSupervisedPlugin",
  reconcileSupervisedRuntime: "orchestration.reconcileSupervisedRuntime",
} as const;

export const ORCHESTRATION_WS_CHANNELS = {
  domainEvent: "orchestration.domainEvent",
  shellEvent: "orchestration.shellEvent",
  threadEvent: "orchestration.threadEvent",
} as const;

export const ProviderKind = Schema.Literals([
  "codex",
  "claudeAgent",
  "cursor",
  "antigravity",
  "grok",
  "droid",
  "kilo",
  "opencode",
  "pi",
]);
export type ProviderKind = typeof ProviderKind.Type;
export const ProviderApprovalPolicy = Schema.Literals([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);
export type ProviderApprovalPolicy = typeof ProviderApprovalPolicy.Type;
export const ProviderSandboxMode = Schema.Literals([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);
export type ProviderSandboxMode = typeof ProviderSandboxMode.Type;
export const DEFAULT_PROVIDER_KIND: ProviderKind = "codex";

export const CodexModelSelection = Schema.Struct({
  provider: Schema.Literal("codex"),
  model: TrimmedNonEmptyString,
  options: Schema.optional(CodexModelOptions),
});
export type CodexModelSelection = typeof CodexModelSelection.Type;

export const ClaudeModelSelection = Schema.Struct({
  provider: Schema.Literal("claudeAgent"),
  model: TrimmedNonEmptyString,
  options: Schema.optional(ClaudeModelOptions),
  supportsAutoMode: Schema.optional(Schema.Boolean),
});
export type ClaudeModelSelection = typeof ClaudeModelSelection.Type;

export const CursorModelSelection = Schema.Struct({
  provider: Schema.Literal("cursor"),
  model: TrimmedNonEmptyString,
  options: Schema.optional(CursorModelOptions),
});
export type CursorModelSelection = typeof CursorModelSelection.Type;

export const AntigravityModelSelection = Schema.Struct({
  provider: Schema.Literal("antigravity"),
  model: TrimmedNonEmptyString,
  options: Schema.optional(AntigravityModelOptions),
});
export type AntigravityModelSelection = typeof AntigravityModelSelection.Type;

export const GrokModelSelection = Schema.Struct({
  provider: Schema.Literal("grok"),
  model: TrimmedNonEmptyString,
  options: Schema.optional(GrokModelOptions),
});
export type GrokModelSelection = typeof GrokModelSelection.Type;

export const DroidModelSelection = Schema.Struct({
  provider: Schema.Literal("droid"),
  model: TrimmedNonEmptyString,
  options: Schema.optional(DroidModelOptions),
});
export type DroidModelSelection = typeof DroidModelSelection.Type;

export const OpenCodeModelSelection = Schema.Struct({
  provider: Schema.Literal("opencode"),
  model: TrimmedNonEmptyString,
  options: Schema.optional(OpenCodeModelOptions),
});
export type OpenCodeModelSelection = typeof OpenCodeModelSelection.Type;

export const KiloModelSelection = Schema.Struct({
  provider: Schema.Literal("kilo"),
  model: TrimmedNonEmptyString,
  options: Schema.optional(OpenCodeModelOptions),
});
export type KiloModelSelection = typeof KiloModelSelection.Type;

export const PiModelSelection = Schema.Struct({
  provider: Schema.Literal("pi"),
  model: TrimmedNonEmptyString,
  options: Schema.optional(PiModelOptions),
});
export type PiModelSelection = typeof PiModelSelection.Type;

export const ModelSelection = Schema.Union([
  CodexModelSelection,
  ClaudeModelSelection,
  CursorModelSelection,
  AntigravityModelSelection,
  GrokModelSelection,
  DroidModelSelection,
  KiloModelSelection,
  OpenCodeModelSelection,
  PiModelSelection,
]);
export type ModelSelection = typeof ModelSelection.Type;

export const CodexProviderStartOptions = Schema.Struct({
  binaryPath: Schema.optional(TrimmedNonEmptyString),
  homePath: Schema.optional(TrimmedNonEmptyString),
});

export const ClaudeProviderStartOptions = Schema.Struct({
  binaryPath: Schema.optional(TrimmedNonEmptyString),
  permissionMode: Schema.optional(TrimmedNonEmptyString),
  maxThinkingTokens: Schema.optional(NonNegativeInt),
});

export const AntigravityProviderStartOptions = Schema.Struct({
  binaryPath: Schema.optional(TrimmedNonEmptyString),
});

export const CursorProviderStartOptions = Schema.Struct({
  binaryPath: Schema.optional(TrimmedNonEmptyString),
  apiEndpoint: Schema.optional(TrimmedNonEmptyString),
});

export const GrokProviderStartOptions = Schema.Struct({
  binaryPath: Schema.optional(TrimmedNonEmptyString),
});

export const DroidProviderStartOptions = Schema.Struct({
  binaryPath: Schema.optional(TrimmedNonEmptyString),
});

export const OpenCodeProviderStartOptions = Schema.Struct({
  binaryPath: Schema.optional(TrimmedNonEmptyString),
  serverUrl: Schema.optional(TrimmedNonEmptyString),
  experimentalWebSockets: Schema.optional(Schema.Boolean),
});

export const KiloProviderStartOptions = Schema.Struct({
  binaryPath: Schema.optional(TrimmedNonEmptyString),
  serverUrl: Schema.optional(TrimmedNonEmptyString),
});

export const PiProviderStartOptions = Schema.Struct({
  binaryPath: Schema.optional(TrimmedNonEmptyString),
  agentDir: Schema.optional(TrimmedNonEmptyString),
});

export const ProviderStartOptions = Schema.Struct({
  codex: Schema.optional(CodexProviderStartOptions),
  claudeAgent: Schema.optional(ClaudeProviderStartOptions),
  cursor: Schema.optional(CursorProviderStartOptions),
  antigravity: Schema.optional(AntigravityProviderStartOptions),
  grok: Schema.optional(GrokProviderStartOptions),
  droid: Schema.optional(DroidProviderStartOptions),
  kilo: Schema.optional(KiloProviderStartOptions),
  opencode: Schema.optional(OpenCodeProviderStartOptions),
  pi: Schema.optional(PiProviderStartOptions),
});
export type ProviderStartOptions = typeof ProviderStartOptions.Type;

export const RuntimeMode = Schema.Literals(["approval-required", "auto", "full-access"]);
export type RuntimeMode = typeof RuntimeMode.Type;
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";
export const ProviderInteractionMode = Schema.Literals(["default", "plan"]);
export type ProviderInteractionMode = typeof ProviderInteractionMode.Type;
export const DEFAULT_PROVIDER_INTERACTION_MODE: ProviderInteractionMode = "default";
export const SidechatSourceThreadId = Schema.optional(Schema.NullOr(ThreadId)).pipe(
  Schema.withDecodingDefault(() => null),
);
export const ProviderRequestKind = Schema.Literals([
  "command",
  "file-read",
  "file-change",
  "permissions",
  "mcp-tool",
]);
export type ProviderRequestKind = typeof ProviderRequestKind.Type;
export const AssistantDeliveryMode = Schema.Literals(["buffered", "streaming"]);
export type AssistantDeliveryMode = typeof AssistantDeliveryMode.Type;
// Queue is the default "send message" behavior; steer is an urgent redirect.
export const TurnDispatchMode = Schema.Literals(["queue", "steer"]);
export type TurnDispatchMode = typeof TurnDispatchMode.Type;
export const DEFAULT_TURN_DISPATCH_MODE: TurnDispatchMode = "queue";
// Marks who dispatched a user turn: a person typing, an automation run, or
// another agent through the Veylen agent gateway (MCP tools).
// Absent is treated as "user"; only server-dispatched turns carry the flag.
export const MessageDispatchOrigin = Schema.Literals(["user", "automation", "agent"]);
export type MessageDispatchOrigin = typeof MessageDispatchOrigin.Type;
export const ThreadCreationSource = Schema.Literals([
  "veylen_mcp",
  "external_mcp",
  "provider_native",
  "supervised_native",
]);
export type ThreadCreationSource = typeof ThreadCreationSource.Type;
export const ProviderReviewTarget = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("uncommittedChanges"),
  }),
  Schema.Struct({
    type: Schema.Literal("baseBranch"),
    branch: TrimmedNonEmptyString,
  }),
]);
export type ProviderReviewTarget = typeof ProviderReviewTarget.Type;
export const ProviderApprovalDecision = Schema.Literals([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
]);
export type ProviderApprovalDecision = typeof ProviderApprovalDecision.Type;
export const ProviderUserInputAnswer = Schema.NullOr(
  Schema.Union([Schema.String, Schema.Array(Schema.String)]),
);
export type ProviderUserInputAnswer = typeof ProviderUserInputAnswer.Type;
export const ProviderUserInputAnswers = Schema.Record(Schema.String, ProviderUserInputAnswer);
export type ProviderUserInputAnswers = typeof ProviderUserInputAnswers.Type;
export const ThreadHandoffBootstrapStatus = Schema.Literals(["pending", "completed"]);
export type ThreadHandoffBootstrapStatus = typeof ThreadHandoffBootstrapStatus.Type;
export const ThreadEnvironmentMode = Schema.Literals(["local", "worktree"]);
export type ThreadEnvironmentMode = typeof ThreadEnvironmentMode.Type;

export const OrchestrationMessageSource = Schema.Literals([
  "native",
  "handoff-import",
  "fork-import",
]);
export type OrchestrationMessageSource = typeof OrchestrationMessageSource.Type;

export const PROVIDER_SEND_TURN_MAX_INPUT_CHARS = 120_000;
export const PROVIDER_SEND_TURN_MAX_ATTACHMENTS = 8;
export const PROVIDER_SEND_TURN_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Raw local images may exceed the provider-safe payload limit when they can be
// normalized on-device before upload (for example Retina PNG screenshots).
export const PROVIDER_SEND_TURN_MAX_IMAGE_IMPORT_BYTES = 32 * 1024 * 1024;
export const PROVIDER_SEND_TURN_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_PINNED_PROJECTS = 3;
export const CHAT_ATTACHMENT_ID_MAX_CHARS = 128;
export const CHAT_ASSISTANT_SELECTION_TEXT_MAX_CHARS = 4_000;
export const THREAD_NOTES_MAX_CHARS = 16_384;
export const PINNED_MESSAGES_MAX_COUNT = 100;
export const PINNED_MESSAGE_LABEL_MAX_CHARS = 60;
export const THREAD_MARKERS_MAX_COUNT = 200;
export const THREAD_MARKER_LABEL_MAX_CHARS = 60;
export const THREAD_MARKER_SELECTED_TEXT_MAX_CHARS = 4_000;
// Correlation id is command id by design in this model.
export const CorrelationId = CommandId;
export type CorrelationId = typeof CorrelationId.Type;

export const ChatAttachmentId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CHAT_ATTACHMENT_ID_MAX_CHARS),
  Schema.isPattern(/^[a-z0-9_-]+$/i),
);
export type ChatAttachmentId = typeof ChatAttachmentId.Type;

export const ChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  id: ChatAttachmentId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
});
export type ChatImageAttachment = typeof ChatImageAttachment.Type;

export const ChatFileAttachment = Schema.Struct({
  type: Schema.Literal("file"),
  id: ChatAttachmentId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_FILE_BYTES)),
});
export type ChatFileAttachment = typeof ChatFileAttachment.Type;

export const ChatAssistantSelectionAttachment = Schema.Struct({
  type: Schema.Literal("assistant-selection"),
  id: ChatAttachmentId,
  assistantMessageId: MessageId,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(CHAT_ASSISTANT_SELECTION_TEXT_MAX_CHARS)),
});
export type ChatAssistantSelectionAttachment = typeof ChatAssistantSelectionAttachment.Type;

export const UploadChatAssistantSelectionAttachment = Schema.Struct({
  type: Schema.Literal("assistant-selection"),
  assistantMessageId: MessageId,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(CHAT_ASSISTANT_SELECTION_TEXT_MAX_CHARS)),
});
export type UploadChatAssistantSelectionAttachment =
  typeof UploadChatAssistantSelectionAttachment.Type;

export const ChatAttachment = Schema.Union([
  ChatImageAttachment,
  ChatFileAttachment,
  ChatAssistantSelectionAttachment,
]);
export type ChatAttachment = typeof ChatAttachment.Type;
export const ChatAttachmentList = Schema.Array(ChatAttachment).check(
  Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS),
);
export const UploadChatAttachment = Schema.Union([
  ChatImageAttachment,
  ChatFileAttachment,
  UploadChatAssistantSelectionAttachment,
]);
export type UploadChatAttachment = typeof UploadChatAttachment.Type;
export const UploadChatAttachmentList = Schema.Array(UploadChatAttachment).check(
  Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_ATTACHMENTS),
);
export const TurnMessageContentCheck = Schema.makeFilter(
  (input: { readonly text: string; readonly attachments: ReadonlyArray<unknown> }) =>
    input.text.trim().length > 0 ||
    input.attachments.length > 0 ||
    new SchemaIssue.InvalidValue(Option.some(input.text), {
      message: "Turn input must include text or attachments.",
    }),
  { identifier: "TurnMessageContent" },
);
