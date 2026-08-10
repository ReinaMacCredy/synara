import { Schema } from "effect";

import {
  CommandId,
  EventId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import {
  LeadSeatId,
  ProfilePresetId,
  ProfileSnapshot,
  RootHolderSeatId,
  SupervisorSeatId,
} from "./supervision";

const id = <Brand extends string>(brand: Brand) => TrimmedNonEmptyString.pipe(Schema.brand(brand));
const ShortText = TrimmedNonEmptyString.check(Schema.isMaxLength(512));
const BoundedText = Schema.String.check(Schema.isMaxLength(32_768));
const BoundedUnknownRecord = Schema.Record(
  Schema.String.check(Schema.isMaxLength(256)),
  Schema.Unknown,
).check(Schema.isMaxProperties(256));
const BoundedJsonRecord = Schema.Record(
  Schema.String.check(Schema.isMaxLength(256)),
  Schema.Json,
).check(Schema.isMaxProperties(256));
const Percent = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 100 }));
const Confidence = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }));
const Sha256 = Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/));

export const RoomId = id("RoomId");
export type RoomId = typeof RoomId.Type;
export const TaskId = id("TaskId");
export type TaskId = typeof TaskId.Type;
export const TaskNodeId = id("TaskNodeId");
export type TaskNodeId = typeof TaskNodeId.Type;
export const TaskNodeRevisionId = id("TaskNodeRevisionId");
export type TaskNodeRevisionId = typeof TaskNodeRevisionId.Type;
export const RunId = id("RunId");
export type RunId = typeof RunId.Type;
export const RunPolicyId = id("RunPolicyId");
export type RunPolicyId = typeof RunPolicyId.Type;
export const WorkClaimId = id("WorkClaimId");
export type WorkClaimId = typeof WorkClaimId.Type;
export const CapabilityLeaseId = id("CapabilityLeaseId");
export type CapabilityLeaseId = typeof CapabilityLeaseId.Type;
export const ContextWorkspaceId = id("ContextWorkspaceId");
export type ContextWorkspaceId = typeof ContextWorkspaceId.Type;
export const ContextRecordId = id("ContextRecordId");
export type ContextRecordId = typeof ContextRecordId.Type;
export const ContextViewId = id("ContextViewId");
export type ContextViewId = typeof ContextViewId.Type;
export const ContextCompactionReceiptId = id("ContextCompactionReceiptId");
export type ContextCompactionReceiptId = typeof ContextCompactionReceiptId.Type;
export const EvidenceId = id("EvidenceId");
export type EvidenceId = typeof EvidenceId.Type;
export const HarnessPatchId = id("HarnessPatchId");
export type HarnessPatchId = typeof HarnessPatchId.Type;
export const PeerSpecialtyId = id("PeerSpecialtyId");
export type PeerSpecialtyId = typeof PeerSpecialtyId.Type;
export const PeerSpecialtySnapshotId = id("PeerSpecialtySnapshotId");
export type PeerSpecialtySnapshotId = typeof PeerSpecialtySnapshotId.Type;
export const KernelSessionId = id("KernelSessionId");
export type KernelSessionId = typeof KernelSessionId.Type;
export const KernelExecutionId = id("KernelExecutionId");
export type KernelExecutionId = typeof KernelExecutionId.Type;
export const RlmEpisodeId = id("RlmEpisodeId");
export type RlmEpisodeId = typeof RlmEpisodeId.Type;
export const ModelSessionId = id("ModelSessionId");
export type ModelSessionId = typeof ModelSessionId.Type;
export const InterventionId = id("InterventionId");
export type InterventionId = typeof InterventionId.Type;
export const LeadNotificationId = id("LeadNotificationId");
export type LeadNotificationId = typeof LeadNotificationId.Type;
export const ReconciliationId = id("ReconciliationId");
export type ReconciliationId = typeof ReconciliationId.Type;
export const EventSchemaId = id("EventSchemaId");
export type EventSchemaId = typeof EventSchemaId.Type;
export const MetricSampleId = id("MetricSampleId");
export type MetricSampleId = typeof MetricSampleId.Type;
export const DerivedSignalId = id("DerivedSignalId");
export type DerivedSignalId = typeof DerivedSignalId.Type;
export const SubscriptionId = id("SubscriptionId");
export type SubscriptionId = typeof SubscriptionId.Type;
export const SubscriptionDeliveryId = id("SubscriptionDeliveryId");
export type SubscriptionDeliveryId = typeof SubscriptionDeliveryId.Type;
export const PluginId = id("PluginId");
export type PluginId = typeof PluginId.Type;
export const PluginGrantId = id("PluginGrantId");
export type PluginGrantId = typeof PluginGrantId.Type;
export const DeadLetterId = id("DeadLetterId");
export type DeadLetterId = typeof DeadLetterId.Type;

export const SupervisedActor = Schema.Struct({
  kind: Schema.Literals(["user", "seat", "daemon", "plugin", "kernel", "migration"]),
  actorId: TrimmedNonEmptyString,
  seatId: Schema.optional(Schema.Union([SupervisorSeatId, LeadSeatId, ThreadId])),
});
export type SupervisedActor = typeof SupervisedActor.Type;

export const AuthorityScope = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("global") }),
  Schema.Struct({ kind: Schema.Literal("project"), projectId: ProjectId }),
  Schema.Struct({ kind: Schema.Literal("room"), roomId: RoomId }),
  Schema.Struct({ kind: Schema.Literal("task"), taskId: TaskId }),
  Schema.Struct({ kind: Schema.Literal("task_node"), taskNodeId: TaskNodeId }),
  Schema.Struct({
    kind: Schema.Literal("seat"),
    // TODO(supervised-runtime): Remove the legacy Specialist scope alias on or after
    // 2027-08-09 once every pre-cutover authority receipt has expired or been upcast.
    role: Schema.Literals(["lead", "peer", "specialist"]),
    seatId: TrimmedNonEmptyString,
  }),
]);
export type AuthorityScope = typeof AuthorityScope.Type;

export const RoomStatus = Schema.Literals([
  "draft",
  "provisioning",
  "ready",
  "active",
  "paused",
  "draining",
  "degraded",
  "recovering",
  "completed",
  "archived",
  "failed",
]);
export const Room = Schema.Struct({
  id: RoomId,
  projectId: ProjectId,
  title: ShortText,
  leadSeatId: Schema.NullOr(RootHolderSeatId),
  status: RoomStatus,
  graphRevision: NonNegativeInt,
  revision: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Room = typeof Room.Type;

export const TaskLifecycle = Schema.Literals([
  "draft",
  "active",
  "paused",
  "review",
  "accepted",
  "failed",
  "cancelled",
]);
export const Task = Schema.Struct({
  id: TaskId,
  roomId: RoomId,
  title: ShortText,
  intent: BoundedText,
  acceptanceCriteria: Schema.Array(BoundedText).check(Schema.isMaxLength(128)),
  lifecycle: TaskLifecycle,
  activeGraphRevision: NonNegativeInt,
  revision: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Task = typeof Task.Type;

export const TaskNodeLifecycle = Schema.Literals([
  "planned",
  "ready",
  "claimed",
  "running",
  "waiting",
  "review",
  "accepted",
  "failed",
  "cancelled",
]);
export const TaskNode = Schema.Struct({
  id: TaskNodeId,
  taskId: TaskId,
  roomId: RoomId,
  parentNodeId: Schema.NullOr(TaskNodeId),
  title: ShortText,
  description: Schema.NullOr(BoundedText),
  lifecycle: TaskNodeLifecycle,
  activeRevisionId: TaskNodeRevisionId,
  graphRevision: NonNegativeInt,
  revision: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TaskNode = typeof TaskNode.Type;

export const TaskNodeRevision = Schema.Struct({
  id: TaskNodeRevisionId,
  taskNodeId: TaskNodeId,
  graphRevision: NonNegativeInt,
  scope: BoundedText,
  acceptanceCriteria: Schema.Array(BoundedText).check(Schema.isMaxLength(128)),
  dependencyNodeIds: Schema.Array(TaskNodeId).check(Schema.isMaxLength(256)),
  evidenceRefs: Schema.Array(EvidenceId).check(Schema.isMaxLength(256)),
  createdBy: SupervisedActor,
  createdAt: IsoDateTime,
});
export type TaskNodeRevision = typeof TaskNodeRevision.Type;

export const RunStatus = Schema.Literals([
  "queued",
  "admitted",
  "starting",
  "running",
  "waiting",
  "reviewing",
  "paused",
  "retrying",
  "interrupted",
  "recovering",
  "stalled",
  "succeeded",
  "failed",
  "cancelled",
]);
export const Run = Schema.Struct({
  id: RunId,
  roomId: RoomId,
  taskId: TaskId,
  taskNodeId: Schema.NullOr(TaskNodeId),
  taskNodeRevisionId: Schema.NullOr(TaskNodeRevisionId),
  ownerSeatId: TrimmedNonEmptyString,
  policyId: RunPolicyId,
  status: RunStatus,
  attempt: PositiveInt,
  daemonEpoch: PositiveInt,
  startedAt: Schema.NullOr(IsoDateTime),
  lastProgressAt: Schema.NullOr(IsoDateTime),
  finishedAt: Schema.NullOr(IsoDateTime),
  revision: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Run = typeof Run.Type;

export const ReplayBehavior = Schema.Literals(["disabled", "observe_only", "idempotent_actions"]);
export const RunPolicy = Schema.Struct({
  id: RunPolicyId,
  name: ShortText,
  maxWallTimeMs: PositiveInt,
  maxRecursiveCalls: NonNegativeInt,
  maxFanOut: PositiveInt,
  maxRetries: NonNegativeInt,
  maxKernelMemoryMiB: PositiveInt,
  maxKernelOutputBytes: PositiveInt,
  maxPluginHandlerMs: PositiveInt,
  maxPluginQueueDepth: PositiveInt,
  maxSubscriptions: PositiveInt,
  maxPlugins: PositiveInt,
  maxEventRatePerMinute: PositiveInt,
  maxAggregationWindowMs: PositiveInt,
  maxAggregationSamples: PositiveInt,
  maxCostUsd: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  replayBehavior: ReplayBehavior,
  allowedCapabilities: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(256)),
  allowedPluginActions: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(128)),
  circuitBreakerFailureCount: PositiveInt,
  circuitBreakerResetMs: PositiveInt,
  revision: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type RunPolicy = typeof RunPolicy.Type;

export const DEFAULT_SUPERVISED_RUN_POLICY = {
  maxWallTimeMs: 30 * 60 * 1_000,
  maxRecursiveCalls: 8,
  maxFanOut: 4,
  maxRetries: 2,
  maxKernelMemoryMiB: 256,
  maxKernelOutputBytes: 8 * 1024 * 1024,
  maxPluginHandlerMs: 30_000,
  maxPluginQueueDepth: 1_000,
  maxSubscriptions: 256,
  maxPlugins: 64,
  maxEventRatePerMinute: 10_000,
  maxAggregationWindowMs: 24 * 60 * 60 * 1_000,
  maxAggregationSamples: 100_000,
  replayBehavior: "observe_only" as const,
  circuitBreakerFailureCount: 5,
  circuitBreakerResetMs: 60_000,
};

export const WorkClaim = Schema.Struct({
  id: WorkClaimId,
  taskNodeId: TaskNodeId,
  taskNodeRevisionId: TaskNodeRevisionId,
  runId: RunId,
  ownerSeatId: TrimmedNonEmptyString,
  status: Schema.Literals(["active", "released", "expired", "revoked"]),
  acquiredAt: IsoDateTime,
  expiresAt: IsoDateTime,
  releasedAt: Schema.NullOr(IsoDateTime),
  revision: NonNegativeInt,
});
export type WorkClaim = typeof WorkClaim.Type;

export const CapabilityLease = Schema.Struct({
  id: CapabilityLeaseId,
  runId: RunId,
  holderSeatId: TrimmedNonEmptyString,
  capability: TrimmedNonEmptyString,
  scope: AuthorityScope,
  constraints: BoundedUnknownRecord,
  status: Schema.Literals(["active", "expired", "revoked"]),
  grantedBy: SupervisedActor,
  grantedAt: IsoDateTime,
  expiresAt: IsoDateTime,
  revision: NonNegativeInt,
});
export type CapabilityLease = typeof CapabilityLease.Type;

export const BlobReference = Schema.Struct({
  hash: Sha256,
  mediaType: TrimmedNonEmptyString,
  sizeBytes: NonNegativeInt,
  createdAt: IsoDateTime,
});
export type BlobReference = typeof BlobReference.Type;

export const ContextRecordKind = Schema.Literals([
  "intent",
  "decision",
  "evidence",
  "obligation",
  "summary",
  "checkpoint",
  "handoff",
  "conflict",
]);
export const ContextRecord = Schema.Struct({
  id: ContextRecordId,
  workspaceId: ContextWorkspaceId,
  kind: ContextRecordKind,
  scope: AuthorityScope,
  title: ShortText,
  inlineText: Schema.NullOr(BoundedText),
  blob: Schema.NullOr(BlobReference),
  sourceEventIds: Schema.Array(EventId).check(Schema.isMaxLength(512)),
  evidenceRefs: Schema.Array(EvidenceId).check(Schema.isMaxLength(256)),
  sourceRecordIds: Schema.optional(
    Schema.Array(ContextRecordId).check(Schema.isMaxLength(512)),
  ).pipe(Schema.withDecodingDefault(() => [])),
  provenance: Schema.optional(BoundedJsonRecord).pipe(Schema.withDecodingDefault(() => ({}))),
  protectionClass: Schema.optional(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(() => "workspace"),
  ),
  estimatedTokens: Schema.optional(NonNegativeInt).pipe(Schema.withDecodingDefault(() => 0)),
  status: Schema.Literals(["current", "superseded", "stale", "conflicted", "expired"]),
  contentRevision: PositiveInt,
  createdBy: SupervisedActor,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ContextRecord = typeof ContextRecord.Type;

export const ContextWorkspace = Schema.Struct({
  id: ContextWorkspaceId,
  projectId: ProjectId,
  roomId: Schema.NullOr(RoomId),
  revision: NonNegativeInt,
  highWaterSequence: NonNegativeInt,
  retention: Schema.Struct({
    maxAgeMs: PositiveInt,
    maxInlineBytes: PositiveInt,
    compactAfterRecords: PositiveInt,
  }),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ContextWorkspace = typeof ContextWorkspace.Type;

export const ContextView = Schema.Struct({
  id: ContextViewId,
  workspaceId: ContextWorkspaceId,
  workspaceRevision: NonNegativeInt,
  actorSeatId: TrimmedNonEmptyString,
  recordIds: Schema.Array(ContextRecordId).check(Schema.isMaxLength(512)),
  evidenceRefs: Schema.Array(EvidenceId).check(Schema.isMaxLength(512)),
  activeObligationRecordIds: Schema.Array(ContextRecordId).check(Schema.isMaxLength(256)),
  provider: TrimmedNonEmptyString,
  model: TrimmedNonEmptyString,
  estimatedTokens: NonNegativeInt,
  providerLimitTokens: Schema.NullOr(PositiveInt),
  confidence: Confidence,
  createdAt: IsoDateTime,
});
export type ContextView = typeof ContextView.Type;

export const ContextCompactionReceipt = Schema.Struct({
  id: ContextCompactionReceiptId,
  workspaceId: ContextWorkspaceId,
  summaryRecordId: ContextRecordId,
  sourceRecordIds: Schema.Array(ContextRecordId)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(512)),
  evidenceRefs: Schema.Array(EvidenceId).check(Schema.isMaxLength(512)),
  createdBy: SupervisedActor,
  createdAt: IsoDateTime,
});
export type ContextCompactionReceipt = typeof ContextCompactionReceipt.Type;

export const Evidence = Schema.Struct({
  id: EvidenceId,
  scope: AuthorityScope,
  kind: Schema.Literals(["artifact", "test", "observation", "decision", "provider_receipt"]),
  summary: BoundedText,
  blob: Schema.NullOr(BlobReference),
  sourceEventIds: Schema.Array(EventId).check(Schema.isMaxLength(512)),
  modelSessionId: Schema.optional(Schema.NullOr(ModelSessionId)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  createdBy: SupervisedActor,
  createdAt: IsoDateTime,
});
export type Evidence = typeof Evidence.Type;

export const RlmAdmissionMode = Schema.Literals(["direct", "recursive", "auto"]);
export const RlmAdmissionReceipt = Schema.Struct({
  episodeId: RlmEpisodeId,
  requestedMode: RlmAdmissionMode,
  selectedMode: Schema.Literals(["direct", "recursive"]),
  estimatedContextPercent: Percent,
  estimatedInputTokens: NonNegativeInt,
  independentEvidenceBranches: NonNegativeInt,
  reasons: Schema.Array(ShortText).check(Schema.isMaxLength(32)),
  admittedByPolicyId: RunPolicyId,
  createdAt: IsoDateTime,
});
export type RlmAdmissionReceipt = typeof RlmAdmissionReceipt.Type;

export const RlmEpisode = Schema.Struct({
  id: RlmEpisodeId,
  runId: RunId,
  admission: RlmAdmissionReceipt,
  status: Schema.Literals([
    "requested",
    "admitted",
    "branching",
    "branches_running",
    "synthesizing",
    "completed",
    "partially_completed",
    "stalled",
    "failed",
    "cancelled",
    // TODO(supervised-runtime): Remove legacy aliases after 2026-11-09 when all
    // retained event journals have been upcast by a versioned replay migration.
    "planned",
    "running",
  ]),
  rootModelSessionId: Schema.optional(Schema.NullOr(ModelSessionId)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  branchModelSessionIds: Schema.optional(
    Schema.Array(ModelSessionId).check(Schema.isMaxLength(64)),
  ).pipe(Schema.withDecodingDefault(() => [])),
  branchCount: NonNegativeInt,
  completedBranchCount: NonNegativeInt,
  staleBranchCount: NonNegativeInt,
  coveragePercent: Percent,
  contradictionCount: NonNegativeInt,
  evidenceRefs: Schema.Array(EvidenceId).check(Schema.isMaxLength(512)),
  failureSummaries: Schema.Array(ShortText).check(Schema.isMaxLength(64)),
  revision: Schema.optional(NonNegativeInt).pipe(Schema.withDecodingDefault(() => 0)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type RlmEpisode = typeof RlmEpisode.Type;

export const ModelSessionRole = Schema.Literals([
  "lead",
  "peer",
  // TODO(supervised-runtime): Remove the legacy Specialist model-session role on or after
  // 2027-08-09 once every pre-cutover transcript has been upcast.
  "specialist",
  "rlm_root",
  "rlm_branch",
]);
export const ModelSessionStatus = Schema.Literals([
  "queued",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
]);
const TranscriptItemBase = {
  id: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
} as const;
export const ModelTranscriptItem = Schema.Union([
  Schema.Struct({
    ...TranscriptItemBase,
    type: Schema.Literal("message"),
    role: Schema.Literals(["user", "assistant"]),
    content: BoundedText,
    reasoningSummary: Schema.NullOr(BoundedText),
  }),
  Schema.Struct({
    ...TranscriptItemBase,
    type: Schema.Literal("tool_call"),
    callId: TrimmedNonEmptyString,
    toolName: TrimmedNonEmptyString,
    inputSummary: BoundedText,
    status: Schema.Literals(["pending", "running", "completed", "failed"]),
    finishedAt: Schema.NullOr(IsoDateTime),
  }),
  Schema.Struct({
    ...TranscriptItemBase,
    type: Schema.Literal("tool_result"),
    callId: TrimmedNonEmptyString,
    outputSummary: Schema.NullOr(BoundedText),
    errorSummary: Schema.NullOr(BoundedText),
  }),
  Schema.Struct({
    ...TranscriptItemBase,
    type: Schema.Literal("evidence"),
    evidenceId: EvidenceId,
    summary: BoundedText,
  }),
  Schema.Struct({
    ...TranscriptItemBase,
    type: Schema.Literal("kernel_cell"),
    language: Schema.Literals(["javascript", "python"]),
    code: BoundedText,
    output: Schema.NullOr(BoundedText),
    status: Schema.Literals(["running", "completed", "failed", "denied"]),
  }),
  Schema.Struct({
    ...TranscriptItemBase,
    type: Schema.Literal("context_receipt"),
    label: ShortText,
    contextRecordIds: Schema.Array(ContextRecordId).check(Schema.isMaxLength(256)),
  }),
  Schema.Struct({
    ...TranscriptItemBase,
    type: Schema.Literal("handoff"),
    destination: ShortText,
    summary: BoundedText,
  }),
]);
export type ModelTranscriptItem = typeof ModelTranscriptItem.Type;

export const ModelSessionTrace = Schema.Struct({
  id: ModelSessionId,
  roomId: RoomId,
  runId: RunId,
  taskId: TaskId,
  taskNodeId: Schema.NullOr(TaskNodeId),
  actorSeatId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  authorityReceiptId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  effectiveRole: Schema.optional(
    Schema.NullOr(Schema.Literals(["supervisor", "lead", "peer", "acting_root"])),
  ).pipe(Schema.withDecodingDefault(() => null)),
  rootLeaseIds: Schema.optional(
    Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(64)),
  ).pipe(Schema.withDecodingDefault(() => [])),
  rlmEpisodeId: Schema.NullOr(RlmEpisodeId),
  parentSessionId: Schema.NullOr(ModelSessionId),
  peerSpecialtyId: Schema.optional(Schema.NullOr(PeerSpecialtyId)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  // TODO(supervised-runtime): Remove the legacy payload key on or after 2027-08-09
  // once all model-session event payloads have passed the Peer upcaster.
  specialistId: Schema.optional(Schema.NullOr(PeerSpecialtyId)),
  threadId: Schema.optional(Schema.NullOr(ThreadId)).pipe(Schema.withDecodingDefault(() => null)),
  role: ModelSessionRole,
  title: ShortText,
  provider: TrimmedNonEmptyString,
  model: TrimmedNonEmptyString,
  reasoningEffort: Schema.NullOr(TrimmedNonEmptyString),
  providerSessionId: Schema.NullOr(TrimmedNonEmptyString),
  providerCallId: Schema.NullOr(TrimmedNonEmptyString),
  contextViewRefs: Schema.Array(ContextRecordId).check(Schema.isMaxLength(256)),
  contextView: Schema.optional(Schema.NullOr(ContextView)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  promptHash: Schema.optional(Schema.NullOr(Sha256)).pipe(Schema.withDecodingDefault(() => null)),
  inputSummary: BoundedText,
  items: Schema.Array(ModelTranscriptItem).check(Schema.isMaxLength(10_000)),
  usage: Schema.Struct({
    inputTokens: NonNegativeInt,
    outputTokens: NonNegativeInt,
    contextTokens: NonNegativeInt,
    providerLimitTokens: Schema.NullOr(PositiveInt),
    contextUsagePercent: Schema.NullOr(Percent),
  }),
  usageProvenance: Schema.optional(
    Schema.Struct({
      inputOutputTokens: Schema.Literals(["unavailable", "provider_observed"]),
      contextWindow: Schema.Literals(["unavailable", "provider_observed"]),
    }),
  ).pipe(
    Schema.withDecodingDefault(() => ({
      inputOutputTokens: "unavailable" as const,
      contextWindow: "unavailable" as const,
    })),
  ),
  status: ModelSessionStatus,
  retryCount: NonNegativeInt,
  durationMs: Schema.NullOr(NonNegativeInt),
  costUsd: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  synthesisDestination: Schema.NullOr(ShortText),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  revision: NonNegativeInt,
});
export type ModelSessionTrace = typeof ModelSessionTrace.Type;

export const HarnessPatchScope = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("profile"), profilePresetId: ProfilePresetId }),
  Schema.Struct({ kind: Schema.Literal("project"), projectId: ProjectId }),
  Schema.Struct({ kind: Schema.Literal("room"), roomId: RoomId }),
  Schema.Struct({ kind: Schema.Literal("task"), taskId: TaskId }),
]);
export const HarnessPatchSandboxEvaluation = Schema.Struct({
  passed: Schema.Boolean,
  basePolicyHash: Sha256,
  evidenceRefs: Schema.Array(EvidenceId)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(128)),
  regressions: Schema.Array(BoundedText).check(Schema.isMaxLength(128)),
  evaluatedBy: SupervisedActor,
  evaluatedAt: IsoDateTime,
  eventId: EventId,
  controlPlaneSequence: NonNegativeInt,
});
export const HarnessPatchApproval = Schema.Struct({
  approvedBy: SupervisedActor,
  approvedAt: IsoDateTime,
});
export const HarnessPatchCanary = Schema.Struct({
  startedAt: IsoDateTime,
  failureThreshold: PositiveInt,
  observedFailures: NonNegativeInt,
  successfulEvaluations: NonNegativeInt,
  evidenceRefs: Schema.Array(EvidenceId).check(Schema.isMaxLength(256)),
  lastEvaluationAt: Schema.NullOr(IsoDateTime),
  lastControlPlaneSequence: NonNegativeInt,
});
export const HarnessPatchRollback = Schema.Struct({
  reason: BoundedText,
  evidenceRefs: Schema.Array(EvidenceId)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(128)),
  rolledBackBy: SupervisedActor,
  rolledBackAt: IsoDateTime,
});
export const HarnessPatch = Schema.Struct({
  id: HarnessPatchId,
  name: ShortText,
  patchType: Schema.Literals(["instruction", "routing", "evaluation", "tool_guidance"]),
  scope: HarnessPatchScope,
  content: BoundedText,
  basePolicyHash: Sha256,
  status: Schema.Literals([
    "observed",
    "proposed",
    "sandboxed",
    "evaluated",
    "awaiting_approval",
    "canary",
    "promoted",
    "rejected",
    "failed",
    "rolled_back",
    "revoked",
  ]),
  observationEvidenceRefs: Schema.optional(
    Schema.Array(EvidenceId).check(Schema.isMaxLength(128)),
  ).pipe(Schema.withDecodingDefault(() => [])),
  evaluationEvidenceRefs: Schema.Array(EvidenceId).check(Schema.isMaxLength(128)),
  sandboxEvaluation: Schema.optional(Schema.NullOr(HarnessPatchSandboxEvaluation)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  approval: Schema.optional(Schema.NullOr(HarnessPatchApproval)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  canary: Schema.optional(Schema.NullOr(HarnessPatchCanary)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  rollback: Schema.optional(Schema.NullOr(HarnessPatchRollback)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  lastControlPlaneSequence: Schema.optional(NonNegativeInt).pipe(
    Schema.withDecodingDefault(() => 0),
  ),
  version: PositiveInt,
  revision: Schema.optional(NonNegativeInt).pipe(Schema.withDecodingDefault(() => 0)),
  createdBy: SupervisedActor,
  activatedBy: Schema.NullOr(SupervisedActor),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type HarnessPatch = typeof HarnessPatch.Type;

export const PeerSpecialty = Schema.Struct({
  id: PeerSpecialtyId,
  profilePresetId: ProfilePresetId,
  concern: TrimmedNonEmptyString,
  status: Schema.Literals(["idle", "retained", "active", "expired", "revoked"]),
  allowedScopes: Schema.Array(AuthorityScope).check(Schema.isMaxLength(64)),
  latestSnapshotId: Schema.NullOr(PeerSpecialtySnapshotId),
  expiresAt: IsoDateTime,
  revision: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type PeerSpecialty = typeof PeerSpecialty.Type;
export const PeerSpecialtySnapshot = Schema.Struct({
  id: PeerSpecialtySnapshotId,
  peerSpecialtyId: PeerSpecialtyId,
  profileContentHash: Sha256,
  contextRefs: Schema.Array(ContextRecordId).check(Schema.isMaxLength(256)),
  evidenceRefs: Schema.Array(EvidenceId).check(Schema.isMaxLength(256)),
  sanitized: Schema.Boolean,
  compatibleSchemaVersions: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(64)),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
export type PeerSpecialtySnapshot = typeof PeerSpecialtySnapshot.Type;
export const LegacySpecialistSnapshot = Schema.Struct({
  id: PeerSpecialtySnapshotId,
  specialistId: PeerSpecialtyId,
  profileContentHash: Sha256,
  contextRefs: Schema.Array(ContextRecordId).check(Schema.isMaxLength(256)),
  evidenceRefs: Schema.Array(EvidenceId).check(Schema.isMaxLength(256)),
  sanitized: Schema.Boolean,
  compatibleSchemaVersions: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(64)),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
// TODO(supervised-runtime): Remove LegacySpecialistSnapshot on or after 2027-08-09
// once every pre-cutover journal has been replayed through the Peer upcaster.
export type LegacySpecialistSnapshot = typeof LegacySpecialistSnapshot.Type;

export const KernelLanguage = Schema.Literals(["javascript", "python"]);
export const KernelSession = Schema.Struct({
  id: KernelSessionId,
  runId: RunId,
  language: KernelLanguage,
  status: Schema.Literals(["starting", "ready", "busy", "stopped", "failed"]),
  isolationBackend: TrimmedNonEmptyString,
  capabilityLeaseIds: Schema.Array(CapabilityLeaseId).check(Schema.isMaxLength(64)),
  workingDirectory: TrimmedNonEmptyString,
  processId: Schema.NullOr(PositiveInt),
  startedAt: IsoDateTime,
  lastUsedAt: IsoDateTime,
  stoppedAt: Schema.NullOr(IsoDateTime),
});
export type KernelSession = typeof KernelSession.Type;
export const KernelExecution = Schema.Struct({
  id: KernelExecutionId,
  kernelSessionId: KernelSessionId,
  codeHash: Sha256,
  status: Schema.Literals(["queued", "running", "succeeded", "failed", "timed_out", "denied"]),
  startedAt: Schema.NullOr(IsoDateTime),
  finishedAt: Schema.NullOr(IsoDateTime),
  output: Schema.NullOr(BlobReference),
  errorSummary: Schema.NullOr(BoundedText),
  requestedCapabilities: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(64)),
});
export type KernelExecution = typeof KernelExecution.Type;

export const Intervention = Schema.Struct({
  id: InterventionId,
  roomId: RoomId,
  requestedBy: SupervisedActor,
  // TODO(supervised-runtime): Rename the persisted compatibility key after 2027-08-09
  // once every migration-096 intervention row and journal payload has been upcast.
  specialistThreadId: ThreadId,
  reason: BoundedText,
  material: Schema.optional(Schema.Boolean).pipe(Schema.withDecodingDefault(() => false)),
  evidenceRefs: Schema.Array(EvidenceId).check(Schema.isMaxLength(256)),
  status: Schema.Literals(["open", "reconciled", "rejected"]),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  revision: NonNegativeInt,
});
export type Intervention = typeof Intervention.Type;

export const LeadNotification = Schema.Struct({
  id: LeadNotificationId,
  interventionId: InterventionId,
  roomId: RoomId,
  leadSeatId: Schema.NullOr(RootHolderSeatId),
  status: Schema.Literals(["queued", "delivered", "acknowledged"]),
  createdAt: IsoDateTime,
  deliveredAt: Schema.NullOr(IsoDateTime),
  acknowledgedAt: Schema.NullOr(IsoDateTime),
});
export type LeadNotification = typeof LeadNotification.Type;

export const Reconciliation = Schema.Struct({
  id: ReconciliationId,
  interventionId: InterventionId,
  roomId: RoomId,
  leadSeatId: RootHolderSeatId,
  status: Schema.Literals(["open", "accepted", "revised", "rejected"]),
  taskNodeRevisionId: Schema.NullOr(TaskNodeRevisionId),
  reason: Schema.NullOr(BoundedText),
  createdAt: IsoDateTime,
  resolvedAt: Schema.NullOr(IsoDateTime),
  revision: NonNegativeInt,
});
export type Reconciliation = typeof Reconciliation.Type;

export const EventSchemaCompatibility = Schema.Literals(["backward", "forward", "breaking"]);
export const EventSchema = Schema.Struct({
  id: EventSchemaId,
  eventType: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  compatibility: EventSchemaCompatibility,
  jsonSchema: BoundedJsonRecord,
  fieldClassifications: Schema.Record(
    Schema.String.check(Schema.isMaxLength(256)),
    Schema.Literals(["public", "internal", "protected", "secret"]),
  ).check(Schema.isMaxProperties(512)),
  status: Schema.Literals(["active", "deprecated", "revoked"]),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type EventSchema = typeof EventSchema.Type;

export const ControlPlaneEvent = Schema.Struct({
  sequence: NonNegativeInt,
  eventId: EventId,
  schemaId: EventSchemaId,
  schemaVersion: TrimmedNonEmptyString,
  type: TrimmedNonEmptyString,
  scope: AuthorityScope,
  subjectId: TrimmedNonEmptyString,
  eventTime: IsoDateTime,
  recordedAt: IsoDateTime,
  revision: Schema.NullOr(NonNegativeInt),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  payload: BoundedUnknownRecord,
  provenance: Schema.Struct({
    actor: SupervisedActor,
    source: TrimmedNonEmptyString,
    confidence: Confidence,
  }),
});
export type ControlPlaneEvent = typeof ControlPlaneEvent.Type;

export const MetricQuality = Schema.Literals(["exact", "estimated", "projected"]);
export const MetricSample = Schema.Struct({
  id: MetricSampleId,
  metric: TrimmedNonEmptyString,
  scope: AuthorityScope,
  subjectId: TrimmedNonEmptyString,
  value: Schema.Finite,
  unit: TrimmedNonEmptyString,
  eventTime: IsoDateTime,
  computedAt: IsoDateTime,
  sourceEventIds: Schema.Array(EventId)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(10_000)),
  aggregationReceiptHash: Sha256,
  quality: MetricQuality,
  confidence: Confidence,
  source: TrimmedNonEmptyString,
  revision: Schema.NullOr(NonNegativeInt),
});
export type MetricSample = typeof MetricSample.Type;

export const ThresholdOperator = Schema.Literals(["gt", "gte", "lt", "lte", "eq", "neq"]);
export const ThresholdSpec = Schema.Struct({ operator: ThresholdOperator, value: Schema.Finite });
export type ThresholdSpec = typeof ThresholdSpec.Type;
export const HysteresisSpec = Schema.Struct({
  trigger: ThresholdSpec,
  reset: ThresholdSpec,
});
export type HysteresisSpec = typeof HysteresisSpec.Type;
export const WindowSpec = Schema.Struct({
  kind: Schema.Literals(["latest", "tumbling", "sliding", "session"]),
  durationMs: PositiveInt,
  allowedLatenessMs: NonNegativeInt,
  maxSamples: PositiveInt,
});
export type WindowSpec = typeof WindowSpec.Type;

// Built-in signals use stable PascalCase names, while governed plugins may
// introduce additional versioned signal kinds without changing core contracts.
export const DerivedSignalKind = TrimmedNonEmptyString;
export const DerivedSignal = Schema.Struct({
  id: DerivedSignalId,
  kind: DerivedSignalKind,
  subscriptionId: SubscriptionId,
  scope: AuthorityScope,
  subjectId: TrimmedNonEmptyString,
  state: Schema.Literals(["triggered", "acknowledged", "reset", "expired"]),
  measuredValue: Schema.Finite,
  threshold: ThresholdSpec,
  sourceEventIds: Schema.Array(EventId)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(10_000)),
  metricSampleIds: Schema.Array(MetricSampleId).check(Schema.isMaxLength(10_000)),
  aggregationReceiptHash: Sha256,
  context: BoundedUnknownRecord,
  triggeredAt: IsoDateTime,
  resetAt: Schema.NullOr(IsoDateTime),
  revision: NonNegativeInt,
});
export type DerivedSignal = typeof DerivedSignal.Type;

export const SubscriptionSelector = Schema.Struct({
  sourceKind: Schema.Literals(["event", "metric"]),
  names: Schema.Array(TrimmedNonEmptyString)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(64)),
});
export const SubscriptionFilter = Schema.Struct({
  field: TrimmedNonEmptyString,
  operator: Schema.Literals(["eq", "neq", "in", "not_in", "exists", "contains"]),
  value: Schema.Unknown,
});
export const SubscriptionAggregation = Schema.Struct({
  function: Schema.Literals(["latest", "count", "sum", "avg", "min", "max", "rate"]),
  field: Schema.NullOr(TrimmedNonEmptyString),
  groupBy: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(16)),
});
export const SubscriptionDeliveryTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("lead_seat"), leadSeatId: LeadSeatId }),
  Schema.Struct({ kind: Schema.Literal("concern"), concern: TrimmedNonEmptyString }),
  Schema.Struct({ kind: Schema.Literal("inbox"), inbox: TrimmedNonEmptyString }),
  Schema.Struct({ kind: Schema.Literal("notification"), channel: TrimmedNonEmptyString }),
  Schema.Struct({
    kind: Schema.Literal("plugin"),
    pluginId: PluginId,
    handler: TrimmedNonEmptyString,
  }),
]);
export const SubscriptionDefinition = Schema.Struct({
  id: SubscriptionId,
  schemaVersion: TrimmedNonEmptyString,
  name: ShortText,
  owner: SupervisedActor,
  concern: TrimmedNonEmptyString,
  ownerLeadSeatId: Schema.NullOr(LeadSeatId),
  selector: SubscriptionSelector,
  scope: Schema.Array(AuthorityScope).check(Schema.isMinLength(1)).check(Schema.isMaxLength(64)),
  where: Schema.Array(SubscriptionFilter).check(Schema.isMaxLength(64)),
  aggregation: SubscriptionAggregation,
  window: WindowSpec,
  condition: ThresholdSpec,
  hysteresis: HysteresisSpec,
  debounceMs: NonNegativeInt,
  cooldownMs: NonNegativeInt,
  destination: SubscriptionDeliveryTarget,
  allowedActionRequests: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(64)),
  cursor: Schema.Struct({
    lastSequence: NonNegativeInt,
    lastEventTime: Schema.NullOr(IsoDateTime),
    lastDeliveryKey: Schema.NullOr(TrimmedNonEmptyString),
  }),
  replayPolicy: ReplayBehavior,
  state: Schema.Literals(["enabled", "paused", "revoked"]),
  rateLimitPerMinute: PositiveInt,
  maxQueueDepth: PositiveInt,
  failurePolicy: Schema.Struct({
    maxAttempts: PositiveInt,
    backoffMs: PositiveInt,
    deadLetterAfterAttempts: PositiveInt,
    critical: Schema.Boolean,
  }),
  armed: Schema.Boolean,
  createdBy: SupervisedActor,
  updatedBy: SupervisedActor,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  revision: NonNegativeInt,
});
export type SubscriptionDefinition = typeof SubscriptionDefinition.Type;

export const SubscriptionEvaluationWindowSample = Schema.Struct({
  eventId: EventId,
  sequence: NonNegativeInt,
  eventTime: IsoDateTime,
  value: Schema.Finite,
  event: ControlPlaneEvent,
});
export type SubscriptionEvaluationWindowSample = typeof SubscriptionEvaluationWindowSample.Type;
export const SubscriptionEvaluationGroupState = Schema.Struct({
  samples: Schema.Array(SubscriptionEvaluationWindowSample).check(Schema.isMaxLength(10_000)),
  armed: Schema.Boolean,
  nextEligibleAt: Schema.NullOr(IsoDateTime),
  pendingSince: Schema.NullOr(IsoDateTime),
  activeSignal: Schema.NullOr(DerivedSignal),
});
export type SubscriptionEvaluationGroupState = typeof SubscriptionEvaluationGroupState.Type;
export const SubscriptionEvaluationState = Schema.Struct({
  groups: Schema.Record(
    Schema.String.check(Schema.isMaxLength(2_048)),
    SubscriptionEvaluationGroupState,
  ).check(Schema.isMaxProperties(10_000)),
});
export type SubscriptionEvaluationState = typeof SubscriptionEvaluationState.Type;

export const SubscriptionDelivery = Schema.Struct({
  id: SubscriptionDeliveryId,
  subscriptionId: SubscriptionId,
  signalId: DerivedSignalId,
  dedupeKey: TrimmedNonEmptyString,
  status: Schema.Literals(["queued", "delivering", "delivered", "failed", "dead_lettered"]),
  attemptCount: NonNegativeInt,
  availableAt: IsoDateTime,
  deliveredAt: Schema.NullOr(IsoDateTime),
  lastError: Schema.NullOr(BoundedText),
  payloadHash: Sha256,
  replay: Schema.Boolean,
  replayBehavior: Schema.optional(ReplayBehavior).pipe(
    Schema.withDecodingDefault(() => "observe_only" as const),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type SubscriptionDelivery = typeof SubscriptionDelivery.Type;
export const DeliveryCursor = Schema.Struct({
  subscriptionId: SubscriptionId,
  lastSequence: NonNegativeInt,
  lastEventTime: Schema.NullOr(IsoDateTime),
  watermark: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type DeliveryCursor = typeof DeliveryCursor.Type;
export const DeadLetter = Schema.Struct({
  id: DeadLetterId,
  subscriptionId: SubscriptionId,
  deliveryId: SubscriptionDeliveryId,
  pluginId: Schema.NullOr(PluginId),
  reason: BoundedText,
  payloadHash: Sha256,
  attemptCount: PositiveInt,
  status: Schema.Literals(["open", "redriving", "resolved", "discarded"]),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  resolvedAt: Schema.NullOr(IsoDateTime),
});
export type DeadLetter = typeof DeadLetter.Type;

export const PluginCapability = Schema.Literals([
  "event.read",
  "metric.emit",
  "signal.propose",
  "command.request",
  "network.connect",
  "filesystem.read",
  "filesystem.write",
  "tool.invoke",
]);
export const PluginManifest = Schema.Struct({
  pluginId: PluginId,
  name: ShortText,
  version: TrimmedNonEmptyString,
  manifestVersion: Schema.Literal("1"),
  description: BoundedText,
  handler: Schema.NullOr(
    Schema.Struct({
      runtime: KernelLanguage,
      entry: TrimmedNonEmptyString,
      protocolVersion: Schema.Literal("1"),
    }),
  ),
  eventSchemas: Schema.Array(EventSchema).check(Schema.isMaxLength(128)),
  subscriptions: Schema.Array(SubscriptionDefinition).check(Schema.isMaxLength(256)),
  requestedCapabilities: Schema.Array(PluginCapability).check(Schema.isMaxLength(64)),
  requestedPayloadFields: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(512)),
  resourceLimits: Schema.Struct({
    maxRuntimeMs: PositiveInt,
    maxMemoryMiB: PositiveInt,
    maxOutputBytes: PositiveInt,
    maxConcurrentHandlers: PositiveInt,
    maxQueueDepth: PositiveInt,
  }),
  provenance: Schema.Struct({
    source: TrimmedNonEmptyString,
    contentHash: Sha256,
    signature: Schema.NullOr(TrimmedNonEmptyString),
  }),
});
export type PluginManifest = typeof PluginManifest.Type;
export const PluginCapabilityGrant = Schema.Struct({
  id: PluginGrantId,
  pluginId: PluginId,
  capabilities: Schema.Array(PluginCapability).check(Schema.isMaxLength(64)),
  payloadFields: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(512)),
  scopes: Schema.Array(AuthorityScope).check(Schema.isMaxLength(128)),
  allowedActionRequests: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(64)),
  status: Schema.Literals(["active", "paused", "revoked"]),
  grantedBy: SupervisedActor,
  grantedAt: IsoDateTime,
  revokedAt: Schema.NullOr(IsoDateTime),
  revision: NonNegativeInt,
});
export type PluginCapabilityGrant = typeof PluginCapabilityGrant.Type;
export const PluginInstallation = Schema.Struct({
  pluginId: PluginId,
  manifest: PluginManifest,
  grant: PluginCapabilityGrant,
  status: Schema.Literals(["installed", "enabled", "disabled", "unhealthy", "revoked"]),
  installedAt: IsoDateTime,
  updatedAt: IsoDateTime,
  revision: NonNegativeInt,
});
export type PluginInstallation = typeof PluginInstallation.Type;

export const PluginHealth = Schema.Struct({
  pluginId: PluginId,
  consecutiveFailures: NonNegativeInt,
  circuitState: Schema.Literals(["closed", "open", "half_open"]),
  circuitOpenedUntil: Schema.NullOr(IsoDateTime),
  queueDepth: NonNegativeInt,
  lagMs: NonNegativeInt,
  lastSuccessAt: Schema.NullOr(IsoDateTime),
  lastFailureAt: Schema.NullOr(IsoDateTime),
  lastError: Schema.NullOr(BoundedText),
  updatedAt: IsoDateTime,
});
export type PluginHealth = typeof PluginHealth.Type;

export const SupervisedRuntimeAuditEntry = Schema.Struct({
  sequence: NonNegativeInt,
  action: TrimmedNonEmptyString,
  actor: SupervisedActor,
  targetKind: TrimmedNonEmptyString,
  targetId: TrimmedNonEmptyString,
  outcome: TrimmedNonEmptyString,
  detail: BoundedUnknownRecord,
  occurredAt: IsoDateTime,
});
export type SupervisedRuntimeAuditEntry = typeof SupervisedRuntimeAuditEntry.Type;

export const InspectSupervisedPluginInput = Schema.Struct({
  directory: TrimmedNonEmptyString,
});
export type InspectSupervisedPluginInput = typeof InspectSupervisedPluginInput.Type;

export const SupervisedPluginInspection = Schema.Struct({
  directory: TrimmedNonEmptyString,
  manifest: PluginManifest,
  requestedActionRequests: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(256)),
  protectedPayloadFields: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(512)),
  warnings: Schema.Array(ShortText).check(Schema.isMaxLength(64)),
});
export type SupervisedPluginInspection = typeof SupervisedPluginInspection.Type;

export const InstallSupervisedPluginInput = Schema.Struct({
  directory: TrimmedNonEmptyString,
  enableAfterInstall: Schema.Boolean,
  capabilities: Schema.Array(PluginCapability).check(Schema.isMaxLength(64)),
  payloadFields: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(512)),
  scopes: Schema.Array(AuthorityScope).check(Schema.isMinLength(1)).check(Schema.isMaxLength(128)),
  allowedActionRequests: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(64)),
});
export type InstallSupervisedPluginInput = typeof InstallSupervisedPluginInput.Type;

export const InstallSupervisedPluginResult = Schema.Struct({
  installation: PluginInstallation,
  sequence: NonNegativeInt,
  operation: Schema.Literals(["installed", "upgraded"]),
});
export type InstallSupervisedPluginResult = typeof InstallSupervisedPluginResult.Type;

export const ReconcileSupervisedRuntimeInput = Schema.Struct({
  restart: Schema.optional(Schema.Boolean),
});
export type ReconcileSupervisedRuntimeInput = typeof ReconcileSupervisedRuntimeInput.Type;

export const ReviewLoopSignalContext = Schema.Struct({
  taskId: TaskId,
  taskNodeId: Schema.NullOr(TaskNodeId),
  graphRevision: NonNegativeInt,
  reviewCount: PositiveInt,
  reviewerSeatIds: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(128)),
  rejectionReasons: Schema.Array(BoundedText).check(Schema.isMaxLength(128)),
  repeatedProblems: Schema.Array(BoundedText).check(Schema.isMaxLength(128)),
  elapsedMs: NonNegativeInt,
  costUsd: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  evidenceRefs: Schema.Array(EvidenceId).check(Schema.isMaxLength(256)),
});
export type ReviewLoopSignalContext = typeof ReviewLoopSignalContext.Type;
export const ContextPressureSignalContext = Schema.Struct({
  leadSeatId: RootHolderSeatId,
  roomId: RoomId,
  providerSessionId: TrimmedNonEmptyString,
  provider: TrimmedNonEmptyString,
  model: TrimmedNonEmptyString,
  usedTokensEstimate: NonNegativeInt,
  providerLimitTokens: PositiveInt,
  reservedTokens: NonNegativeInt,
  usagePercent: Percent,
  trendPercentPerMinute: Schema.Finite,
  activeObligations: Schema.Array(BoundedText).check(Schema.isMaxLength(128)),
  ownedTaskNodeIds: Schema.Array(TaskNodeId).check(Schema.isMaxLength(256)),
  unsummarizedEvidenceRefs: Schema.Array(EvidenceId).check(Schema.isMaxLength(256)),
  compactionState: Schema.Literals(["idle", "recommended", "requested", "running", "completed"]),
  measurementSource: TrimmedNonEmptyString,
  quality: MetricQuality,
  confidence: Confidence,
  measuredAt: IsoDateTime,
});
export type ContextPressureSignalContext = typeof ContextPressureSignalContext.Type;

const CommandBase = {
  commandId: CommandId,
  actor: SupervisedActor,
  authorityReceiptId: Schema.optional(TrimmedNonEmptyString),
  aggregateId: TrimmedNonEmptyString,
  expectedRevision: NonNegativeInt,
  idempotencyKey: TrimmedNonEmptyString,
  runPolicyId: Schema.optional(RunPolicyId),
  createdAt: IsoDateTime,
} as const;

export const SupervisedTaskGraphNode = Schema.Struct({
  taskNode: TaskNode,
  taskNodeRevision: TaskNodeRevision,
});
export type SupervisedTaskGraphNode = typeof SupervisedTaskGraphNode.Type;

export const SupervisedCommand = Schema.Union([
  Schema.Struct({ ...CommandBase, type: Schema.Literal("supervised.room.create"), room: Room }),
  Schema.Struct({ ...CommandBase, type: Schema.Literal("supervised.room.update"), room: Room }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.role.assume"),
    roomId: RoomId,
    supervisorSeatId: SupervisorSeatId,
    supervisorThreadId: ThreadId,
    previousRootSeatId: RootHolderSeatId,
    previousRootThreadId: ThreadId,
    reason: BoundedText,
  }),
  Schema.Struct({ ...CommandBase, type: Schema.Literal("supervised.task.create"), task: Task }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.lead.create"),
    supervisorSeatId: SupervisorSeatId,
    leadSeatId: LeadSeatId,
    threadId: ThreadId,
    workingDirectory: TrimmedNonEmptyString,
    room: Room,
    profilePresetId: ProfilePresetId,
    profileSnapshot: Schema.optional(ProfileSnapshot),
    initialPrompt: Schema.optional(BoundedText),
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.task-graph.create"),
    task: Task,
    nodes: Schema.Array(SupervisedTaskGraphNode)
      .check(Schema.isMinLength(1))
      .check(Schema.isMaxLength(256)),
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.task-node.commit"),
    taskNode: TaskNode,
    taskNodeRevision: TaskNodeRevision,
  }),
  Schema.Struct({ ...CommandBase, type: Schema.Literal("supervised.run.request"), run: Run }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.task.delegate"),
    roomId: RoomId,
    projectId: ProjectId,
    leadSeatId: RootHolderSeatId,
    leadThreadId: ThreadId,
    peerThreadId: ThreadId,
    workRequest: BoundedText,
    run: Run,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.run.start"),
    runId: RunId,
    claim: WorkClaim,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.run.submit"),
    runId: RunId,
    claimId: WorkClaimId,
    evidence: Evidence,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.review.accept"),
    runId: RunId,
    evidenceId: EvidenceId,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.run.transition"),
    runId: RunId,
    status: RunStatus,
    reason: Schema.NullOr(BoundedText),
    daemonEpoch: Schema.optional(PositiveInt),
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.run-policy.upsert"),
    runPolicy: RunPolicy,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.claim.acquire"),
    claim: WorkClaim,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literals([
      "supervised.claim.release",
      "supervised.claim.revoke",
      "supervised.claim.expire",
    ]),
    claimId: WorkClaimId,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.lease.grant"),
    lease: CapabilityLease,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literals(["supervised.lease.revoke", "supervised.lease.expire"]),
    leaseId: CapabilityLeaseId,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.context.workspace-upsert"),
    workspace: ContextWorkspace,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.context.append"),
    record: ContextRecord,
    compactionReceipt: Schema.optional(ContextCompactionReceipt),
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.evidence.publish"),
    evidence: Evidence,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.rlm.upsert"),
    episode: RlmEpisode,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.model-session.upsert"),
    modelSession: ModelSessionTrace,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.patch.upsert"),
    patch: HarnessPatch,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.peer.create"),
    roomId: RoomId,
    projectId: ProjectId,
    leadSeatId: RootHolderSeatId,
    leadThreadId: ThreadId,
    threadId: ThreadId,
    title: ShortText,
    workingDirectory: TrimmedNonEmptyString,
    profilePresetId: ProfilePresetId,
    profileSnapshot: Schema.optional(ProfileSnapshot),
    peerSpecialty: PeerSpecialty,
    initialPrompt: Schema.optional(BoundedText),
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.work.assign"),
    roomId: RoomId,
    projectId: ProjectId,
    leadSeatId: RootHolderSeatId,
    leadThreadId: ThreadId,
    peerThreadId: ThreadId,
    intervention: Intervention,
    leadNotification: LeadNotification,
    reconciliation: Reconciliation,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.work.complete"),
    roomId: RoomId,
    interventionId: InterventionId,
    evidence: Evidence,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.peer.upsert"),
    peerSpecialty: PeerSpecialty,
    snapshot: Schema.optional(PeerSpecialtySnapshot),
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.kernel.session-upsert"),
    session: KernelSession,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.kernel.execution-upsert"),
    execution: KernelExecution,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.subscription.upsert"),
    subscription: SubscriptionDefinition,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literals([
      "supervised.subscription.pause",
      "supervised.subscription.enable",
      "supervised.subscription.revoke",
    ]),
    subscriptionId: SubscriptionId,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.plugin.install"),
    installation: PluginInstallation,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.plugin.upgrade"),
    installation: PluginInstallation,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literals([
      "supervised.plugin.enable",
      "supervised.plugin.disable",
      "supervised.plugin.revoke",
      "supervised.plugin.mark-unhealthy",
    ]),
    pluginId: PluginId,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.plugin.reset-circuit"),
    pluginId: PluginId,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.signal.acknowledge"),
    signalId: DerivedSignalId,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.delivery.redrive"),
    deadLetterId: DeadLetterId,
    replayBehavior: ReplayBehavior,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.intervention.propose"),
    intervention: Intervention,
    leadNotification: LeadNotification,
    reconciliation: Reconciliation,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.intervention.reconcile"),
    reconciliation: Reconciliation,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.compaction.request"),
    leadSeatId: RootHolderSeatId,
    roomId: RoomId,
    reason: BoundedText,
  }),
  Schema.Struct({
    ...CommandBase,
    type: Schema.Literal("supervised.handoff.request"),
    fromSeatId: TrimmedNonEmptyString,
    roomId: RoomId,
    reason: BoundedText,
  }),
]);
export type SupervisedCommand = typeof SupervisedCommand.Type;

export const SupervisedEventType = Schema.Literals([
  "supervised.room-created",
  "supervised.room-updated",
  "supervised.task-created",
  "supervised.task-node-committed",
  "supervised.run-requested",
  "supervised.run-transitioned",
  "supervised.run-policy-upserted",
  "supervised.claim-acquired",
  "supervised.claim-state-changed",
  "supervised.lease-granted",
  "supervised.lease-state-changed",
  "supervised.context-workspace-upserted",
  "supervised.context-appended",
  "supervised.evidence-published",
  "supervised.rlm-upserted",
  "supervised.model-session-upserted",
  "supervised.patch-upserted",
  "supervised.peer-upserted",
  // TODO(supervised-runtime): Remove the legacy event name on or after 2027-08-09 once
  // every pre-cutover journal has been replayed through the v1 Peer upcaster.
  "supervised.specialist-upserted",
  "supervised.kernel-session-upserted",
  "supervised.kernel-execution-upserted",
  "supervised.subscription-upserted",
  "supervised.subscription-state-changed",
  "supervised.plugin-installed",
  "supervised.plugin-upgraded",
  "supervised.plugin-state-changed",
  "supervised.plugin-circuit-reset",
  "supervised.metric-recorded",
  "supervised.signal-derived",
  "supervised.signal-acknowledged",
  "supervised.signal-reset",
  "supervised.delivery-enqueued",
  "supervised.delivery-updated",
  "supervised.dead-lettered",
  "supervised.intervention-proposed",
  "supervised.intervention-reconciled",
  "supervised.compaction-requested",
  "supervised.handoff-requested",
]);
export type SupervisedEventType = typeof SupervisedEventType.Type;
export const SupervisedAggregateKind = Schema.Literals([
  "supervised_room",
  "supervised_task",
  "supervised_run",
  "work_claim",
  "capability_lease",
  "run_policy",
  "context_workspace",
  "evidence",
  "rlm_episode",
  "model_session",
  "harness_patch",
  "peer",
  // TODO(supervised-runtime): Remove the legacy aggregate kind on or after 2027-08-09
  // once every pre-cutover journal has been replayed through the Peer upcaster.
  "specialist",
  "kernel_session",
  "intervention",
  "subscription",
  "plugin",
  "signal",
]);
export type SupervisedAggregateKind = typeof SupervisedAggregateKind.Type;
export const SupervisedEventPayload = Schema.Struct({
  acceptedRevision: NonNegativeInt,
  actor: SupervisedActor,
  room: Schema.optional(Room),
  task: Schema.optional(Task),
  taskNode: Schema.optional(TaskNode),
  taskNodeRevision: Schema.optional(TaskNodeRevision),
  run: Schema.optional(Run),
  runPolicy: Schema.optional(RunPolicy),
  workClaim: Schema.optional(WorkClaim),
  capabilityLease: Schema.optional(CapabilityLease),
  contextWorkspace: Schema.optional(ContextWorkspace),
  contextRecord: Schema.optional(ContextRecord),
  contextCompactionReceipt: Schema.optional(ContextCompactionReceipt),
  evidence: Schema.optional(Evidence),
  rlmEpisode: Schema.optional(RlmEpisode),
  modelSession: Schema.optional(ModelSessionTrace),
  patch: Schema.optional(HarnessPatch),
  peerSpecialty: Schema.optional(PeerSpecialty),
  peerSpecialtySnapshot: Schema.optional(PeerSpecialtySnapshot),
  // TODO(supervised-runtime): Remove these legacy payload keys on or after 2027-08-09
  // once every pre-cutover journal has been replayed through the Peer upcaster.
  specialist: Schema.optional(PeerSpecialty),
  specialistSnapshot: Schema.optional(LegacySpecialistSnapshot),
  kernelSession: Schema.optional(KernelSession),
  kernelExecution: Schema.optional(KernelExecution),
  intervention: Schema.optional(Intervention),
  leadNotification: Schema.optional(LeadNotification),
  reconciliation: Schema.optional(Reconciliation),
  subscription: Schema.optional(SubscriptionDefinition),
  plugin: Schema.optional(PluginInstallation),
  pluginHealth: Schema.optional(PluginHealth),
  metricSample: Schema.optional(MetricSample),
  signal: Schema.optional(DerivedSignal),
  delivery: Schema.optional(SubscriptionDelivery),
  deadLetter: Schema.optional(DeadLetter),
  metadata: Schema.optional(BoundedUnknownRecord),
});
export type SupervisedEventPayload = typeof SupervisedEventPayload.Type;
export const SupervisedDomainEvent = Schema.Struct({
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: SupervisedAggregateKind,
  aggregateId: TrimmedNonEmptyString,
  type: SupervisedEventType,
  payload: SupervisedEventPayload,
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: Schema.Struct({
    schemaVersion: TrimmedNonEmptyString,
    daemonEpoch: Schema.optional(PositiveInt),
    ingestedAt: Schema.optional(IsoDateTime),
  }),
});
export type SupervisedDomainEvent = typeof SupervisedDomainEvent.Type;

export const SupervisedRuntimeHealth = Schema.Struct({
  daemonEpoch: PositiveInt,
  status: Schema.Literals(["starting", "healthy", "degraded", "recovering", "stopped"]),
  journalLag: NonNegativeInt,
  deliveryQueueDepth: NonNegativeInt,
  deadLetterCount: NonNegativeInt,
  unhealthyPluginCount: NonNegativeInt,
  lastRecoveryAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type SupervisedRuntimeHealth = typeof SupervisedRuntimeHealth.Type;
export const SupervisedRuntimeSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  rooms: Schema.Array(Room),
  tasks: Schema.Array(Task),
  taskNodes: Schema.Array(TaskNode),
  taskNodeRevisions: Schema.Array(TaskNodeRevision).pipe(Schema.withDecodingDefault(() => [])),
  runs: Schema.Array(Run),
  runPolicies: Schema.Array(RunPolicy),
  workClaims: Schema.Array(WorkClaim).pipe(Schema.withDecodingDefault(() => [])),
  capabilityLeases: Schema.Array(CapabilityLease).pipe(Schema.withDecodingDefault(() => [])),
  contextWorkspaces: Schema.Array(ContextWorkspace),
  contextRecords: Schema.Array(ContextRecord).pipe(Schema.withDecodingDefault(() => [])),
  contextCompactionReceipts: Schema.Array(ContextCompactionReceipt).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  evidence: Schema.Array(Evidence).pipe(Schema.withDecodingDefault(() => [])),
  rlmEpisodes: Schema.Array(RlmEpisode).pipe(Schema.withDecodingDefault(() => [])),
  modelSessions: Schema.Array(ModelSessionTrace).pipe(Schema.withDecodingDefault(() => [])),
  harnessPatches: Schema.Array(HarnessPatch).pipe(Schema.withDecodingDefault(() => [])),
  peerSpecialties: Schema.Array(PeerSpecialty).pipe(Schema.withDecodingDefault(() => [])),
  peerSpecialtySnapshots: Schema.Array(PeerSpecialtySnapshot).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  kernelSessions: Schema.Array(KernelSession).pipe(Schema.withDecodingDefault(() => [])),
  kernelExecutions: Schema.Array(KernelExecution).pipe(Schema.withDecodingDefault(() => [])),
  interventions: Schema.Array(Intervention).pipe(Schema.withDecodingDefault(() => [])),
  leadNotifications: Schema.Array(LeadNotification).pipe(Schema.withDecodingDefault(() => [])),
  reconciliations: Schema.Array(Reconciliation).pipe(Schema.withDecodingDefault(() => [])),
  subscriptions: Schema.Array(SubscriptionDefinition),
  plugins: Schema.Array(PluginInstallation),
  pluginHealth: Schema.Array(PluginHealth).pipe(Schema.withDecodingDefault(() => [])),
  schemas: Schema.Array(EventSchema),
  signals: Schema.Array(DerivedSignal),
  deliveries: Schema.Array(SubscriptionDelivery),
  deadLetters: Schema.Array(DeadLetter),
  audit: Schema.Array(SupervisedRuntimeAuditEntry).pipe(Schema.withDecodingDefault(() => [])),
  health: SupervisedRuntimeHealth,
  updatedAt: IsoDateTime,
});
export type SupervisedRuntimeSnapshot = typeof SupervisedRuntimeSnapshot.Type;

export const emptySupervisedRuntimeSnapshot = (at: string): SupervisedRuntimeSnapshot => ({
  snapshotSequence: 0,
  rooms: [],
  tasks: [],
  taskNodes: [],
  taskNodeRevisions: [],
  runs: [],
  runPolicies: [],
  workClaims: [],
  capabilityLeases: [],
  contextWorkspaces: [],
  contextRecords: [],
  contextCompactionReceipts: [],
  evidence: [],
  rlmEpisodes: [],
  modelSessions: [],
  harnessPatches: [],
  peerSpecialties: [],
  peerSpecialtySnapshots: [],
  kernelSessions: [],
  kernelExecutions: [],
  interventions: [],
  leadNotifications: [],
  reconciliations: [],
  subscriptions: [],
  plugins: [],
  pluginHealth: [],
  schemas: [],
  signals: [],
  deliveries: [],
  deadLetters: [],
  audit: [],
  health: {
    daemonEpoch: 1,
    status: "stopped",
    journalLag: 0,
    deliveryQueueDepth: 0,
    deadLetterCount: 0,
    unhealthyPluginCount: 0,
    lastRecoveryAt: null,
    updatedAt: at,
  },
  updatedAt: at,
});

export const GetSupervisedRuntimeInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  roomId: Schema.optional(RoomId),
  includeDisabled: Schema.optional(Schema.Boolean),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(500))),
});
export type GetSupervisedRuntimeInput = typeof GetSupervisedRuntimeInput.Type;
export const DispatchSupervisedCommandInput = Schema.Struct({ command: SupervisedCommand });
export type DispatchSupervisedCommandInput = typeof DispatchSupervisedCommandInput.Type;
export const DispatchSupervisedCommandResult = Schema.Struct({
  sequence: NonNegativeInt,
  aggregateRevision: NonNegativeInt,
  eventIds: Schema.Array(EventId).check(Schema.isMinLength(1)).check(Schema.isMaxLength(16)),
});
export type DispatchSupervisedCommandResult = typeof DispatchSupervisedCommandResult.Type;
export const TestSubscriptionInput = Schema.Struct({
  subscription: SubscriptionDefinition,
  syntheticEvent: ControlPlaneEvent,
});
export type TestSubscriptionInput = typeof TestSubscriptionInput.Type;
export const TestSubscriptionResult = Schema.Struct({
  matched: Schema.Boolean,
  wouldTrigger: Schema.Boolean,
  reasons: Schema.Array(ShortText).check(Schema.isMaxLength(64)),
  hypotheticalSignal: Schema.NullOr(DerivedSignal),
  productionActionExecuted: Schema.Literal(false),
});
export type TestSubscriptionResult = typeof TestSubscriptionResult.Type;
