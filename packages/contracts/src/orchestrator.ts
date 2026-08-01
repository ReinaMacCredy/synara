import { Schema } from "effect";

import {
  CommandId,
  EventId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ProviderItemId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import {
  ActorIdentity,
  ProjectTaskId,
  TaskGraphMutationResult,
  TaskProcessId,
  TaskProcessSummaryProjection,
  TaskProgressEntryId,
  TaskProgressKind,
  TaskThreadBindingId,
  TaskThreadRole,
} from "./taskProcess";

const makeOrchestratorId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));
const ShortText = TrimmedNonEmptyString.check(Schema.isMaxLength(1_024));
const BoundedText = TrimmedNonEmptyString.check(Schema.isMaxLength(64_000));
const StringRefs = Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(256));
const PROTOCOL_VERSION = Schema.Literal(1);

export const AssignmentId = makeOrchestratorId("AssignmentId");
export type AssignmentId = typeof AssignmentId.Type;
export const OrchestratorLinkId = makeOrchestratorId("OrchestratorLinkId");
export type OrchestratorLinkId = typeof OrchestratorLinkId.Type;
export const OrchestratorMessageId = makeOrchestratorId("OrchestratorMessageId");
export type OrchestratorMessageId = typeof OrchestratorMessageId.Type;
export const OrchestratorRunId = makeOrchestratorId("OrchestratorRunId");
export type OrchestratorRunId = typeof OrchestratorRunId.Type;
export const ArtifactId = makeOrchestratorId("ArtifactId");
export type ArtifactId = typeof ArtifactId.Type;
export const MonitorId = makeOrchestratorId("MonitorId");
export type MonitorId = typeof MonitorId.Type;
export const WriterClaimId = makeOrchestratorId("WriterClaimId");
export type WriterClaimId = typeof WriterClaimId.Type;
export const ContextBundleId = makeOrchestratorId("ContextBundleId");
export type ContextBundleId = typeof ContextBundleId.Type;

export const OrchestratorProtocolVersion = PROTOCOL_VERSION;
export type OrchestratorProtocolVersion = typeof OrchestratorProtocolVersion.Type;

export const OrchestratorRole = Schema.Literals([
  "root",
  "child_owner",
  "participant",
  "compiler",
  "arbiter",
  "verifier",
]);
export type OrchestratorRole = typeof OrchestratorRole.Type;

export const OrchestratorCapability = Schema.Literals([
  "state.read",
  "subtree.read",
  "child.assign",
  "child.retire",
  "link.request",
  "link.manage",
  "message.send",
  "artifact.publish",
  "artifact.release",
  "run.manage",
  "monitor.manage",
  "assignment.report",
  "assignment.verify",
  "assignment.accept",
  "task.manage",
  "writer-claim.manage",
]);
export type OrchestratorCapability = typeof OrchestratorCapability.Type;
export const OrchestratorCapabilities = Schema.Array(OrchestratorCapability).check(
  Schema.isMaxLength(32),
);

export const OrchestratorRootState = Schema.Literals(["active", "archived"]);
export type OrchestratorRootState = typeof OrchestratorRootState.Type;

export const OrchestratorModelTarget = Schema.Struct({
  provider: TrimmedNonEmptyString,
  model: TrimmedNonEmptyString,
  runtimeMode: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  providerOptions: Schema.optional(
    Schema.Record(
      TrimmedNonEmptyString,
      Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
    ),
  ),
});
export type OrchestratorModelTarget = typeof OrchestratorModelTarget.Type;
export const OrchestratorRootBootstrap = Schema.Struct({
  protocolVersion: OrchestratorProtocolVersion,
  modelTarget: OrchestratorModelTarget,
  title: ShortText,
});
export type OrchestratorRootBootstrap = typeof OrchestratorRootBootstrap.Type;

export const OrchestratorDecisionReason = Schema.Struct({
  summary: ShortText,
  taskFit: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(32)),
  contextHealth: Schema.Literals(["healthy", "anchored", "saturated", "stale", "unknown"]),
  cacheEconomics: Schema.Literals(["reuse", "expiring", "expired", "unavailable", "unknown"]),
  selectedAt: IsoDateTime,
});
export type OrchestratorDecisionReason = typeof OrchestratorDecisionReason.Type;

export const ContextBundle = Schema.Struct({
  id: ContextBundleId,
  version: PositiveInt,
  assignmentId: Schema.NullOr(AssignmentId),
  originalBrief: BoundedText,
  immutableUserConstraints: Schema.Array(BoundedText).check(Schema.isMaxLength(128)),
  acceptedDecisions: Schema.Array(BoundedText).check(Schema.isMaxLength(256)),
  rejectedAlternatives: Schema.Array(BoundedText).check(Schema.isMaxLength(128)),
  ownershipClaims: StringRefs,
  dependencyRefs: StringRefs,
  sourceRefs: StringRefs,
  threadMessageRefs: Schema.Array(OrchestratorMessageId).check(Schema.isMaxLength(256)),
  artifactRefs: Schema.Array(ArtifactId).check(Schema.isMaxLength(256)),
  capabilityCeiling: OrchestratorCapabilities,
  createdBy: ActorIdentity,
  createdAt: IsoDateTime,
  contentHash: TrimmedNonEmptyString,
});
export type ContextBundle = typeof ContextBundle.Type;

export const ContextBundleDraft = Schema.Struct({
  id: ContextBundleId,
  version: PositiveInt,
  originalBrief: BoundedText,
  acceptedDecisions: Schema.Array(BoundedText).check(Schema.isMaxLength(256)),
  rejectedAlternatives: Schema.Array(BoundedText).check(Schema.isMaxLength(128)),
  sourceRefs: StringRefs,
  threadMessageRefs: Schema.Array(OrchestratorMessageId).check(Schema.isMaxLength(256)),
  artifactRefs: Schema.Array(ArtifactId).check(Schema.isMaxLength(256)),
});
export type ContextBundleDraft = typeof ContextBundleDraft.Type;

export const OrchestratorChildContinuityInput = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("reuse"), threadId: ThreadId }),
  Schema.Struct({
    kind: Schema.Literal("rotate"),
    sourceThreadId: ThreadId,
    contextBundle: ContextBundleDraft,
  }),
  Schema.Struct({ kind: Schema.Literal("clean"), contextBundle: ContextBundleDraft }),
]);
export type OrchestratorChildContinuityInput = typeof OrchestratorChildContinuityInput.Type;

export const ChildContinuity = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("reuse"), threadId: ThreadId }),
  Schema.Struct({
    kind: Schema.Literal("rotate"),
    sourceThreadId: ThreadId,
    contextBundle: ContextBundle,
  }),
  Schema.Struct({ kind: Schema.Literal("clean"), contextBundle: ContextBundle }),
]);
export type ChildContinuity = typeof ChildContinuity.Type;

export const OrchestratorRoot = Schema.Struct({
  rootThreadId: ThreadId,
  projectId: ProjectId,
  protocolVersion: OrchestratorProtocolVersion,
  state: OrchestratorRootState,
  activeProcessId: Schema.NullOr(TaskProcessId),
  resourcePolicyVersion: PositiveInt,
  createdAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime),
  revision: NonNegativeInt,
});
export type OrchestratorRoot = typeof OrchestratorRoot.Type;

export const OrchestratorOwnershipEdge = Schema.Struct({
  rootThreadId: ThreadId,
  parentThreadId: ThreadId,
  childThreadId: ThreadId,
  role: OrchestratorRole,
  capabilities: OrchestratorCapabilities,
  contractVersion: PositiveInt,
  sourceThreadId: ThreadId,
  sourceTurnId: Schema.NullOr(TrimmedNonEmptyString),
  sourceOperationId: Schema.NullOr(TrimmedNonEmptyString),
  activeFrom: IsoDateTime,
  retiredAt: Schema.NullOr(IsoDateTime),
  decisionReason: OrchestratorDecisionReason,
});
export type OrchestratorOwnershipEdge = typeof OrchestratorOwnershipEdge.Type;

export const OrchestratorLinkDirection = Schema.Literals([
  "bidirectional",
  "source_to_target",
  "target_to_source",
]);
export type OrchestratorLinkDirection = typeof OrchestratorLinkDirection.Type;
export const OrchestratorLinkState = Schema.Literals([
  "requested",
  "granted",
  "rejected",
  "revoked",
  "expired",
]);
export type OrchestratorLinkState = typeof OrchestratorLinkState.Type;

export const OrchestratorCommunicationLink = Schema.Struct({
  id: OrchestratorLinkId,
  rootThreadId: ThreadId,
  sourceThreadId: ThreadId,
  targetThreadId: ThreadId,
  direction: OrchestratorLinkDirection,
  taskId: Schema.NullOr(ProjectTaskId),
  runId: Schema.NullOr(OrchestratorRunId),
  capabilities: OrchestratorCapabilities,
  requestedBy: ActorIdentity,
  grantedBy: Schema.NullOr(ActorIdentity),
  reason: ShortText,
  state: OrchestratorLinkState,
  createdAt: IsoDateTime,
  expiresAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type OrchestratorCommunicationLink = typeof OrchestratorCommunicationLink.Type;

export const AssignmentState = Schema.Literals([
  "queued",
  "running",
  "waiting_on_thread",
  "waiting_on_user",
  "needs_permission",
  "blocked",
  "reported_complete",
  "verified",
  "accepted",
  "reopened",
  "failed",
  "cancelled",
]);
export type AssignmentState = typeof AssignmentState.Type;

export const AssignmentContract = Schema.Struct({
  assignmentId: AssignmentId,
  version: PositiveInt,
  taskId: ProjectTaskId,
  ownerThreadId: ThreadId,
  assigneeThreadId: ThreadId,
  goal: BoundedText,
  acceptanceCriteria: Schema.Array(BoundedText).check(Schema.isMaxLength(128)),
  immutableUserConstraints: Schema.Array(BoundedText).check(Schema.isMaxLength(128)),
  workingAssumptions: Schema.Array(BoundedText).check(Schema.isMaxLength(128)),
  contextBundleId: ContextBundleId,
  continuity: ChildContinuity,
  modelTarget: OrchestratorModelTarget,
  decisionReason: OrchestratorDecisionReason,
  pathOwnershipClaims: StringRefs,
  dependencyRefs: StringRefs,
  expectedApis: StringRefs,
  allowedCapabilities: OrchestratorCapabilities,
  evidenceRequirements: Schema.Array(BoundedText).check(Schema.isMaxLength(128)),
  verifierClass: Schema.Literals(["root", "existing_child", "fresh_child", "council"]),
  state: AssignmentState,
  supersedesVersion: Schema.NullOr(PositiveInt),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AssignmentContract = typeof AssignmentContract.Type;

export const AssignmentCompletionEvidence = Schema.Struct({
  assignmentId: AssignmentId,
  taskId: ProjectTaskId,
  summary: BoundedText,
  changedPaths: StringRefs,
  diffRef: Schema.NullOr(TrimmedNonEmptyString),
  checks: Schema.Array(
    Schema.Struct({
      command: BoundedText,
      result: Schema.Literals(["pass", "fail", "unavailable"]),
      observedAt: IsoDateTime,
    }),
  ).check(Schema.isMaxLength(128)),
  consumerEvidenceRefs: StringRefs,
  artifactRefs: Schema.Array(ArtifactId).check(Schema.isMaxLength(128)),
  risks: Schema.Array(BoundedText).check(Schema.isMaxLength(128)),
  deviations: Schema.Array(BoundedText).check(Schema.isMaxLength(128)),
  reportedAt: IsoDateTime,
});
export type AssignmentCompletionEvidence = typeof AssignmentCompletionEvidence.Type;

export const OrchestratorMessageDeliveryState = Schema.Literals([
  "queued",
  "delivered",
  "processing",
  "responded",
  "expired",
  "failed",
]);
export type OrchestratorMessageDeliveryState = typeof OrchestratorMessageDeliveryState.Type;

export const OrchestratorMessageEnvelope = Schema.Struct({
  messageId: OrchestratorMessageId,
  rootThreadId: ThreadId,
  senderThreadId: ThreadId,
  targetThreadId: ThreadId,
  assignmentId: Schema.NullOr(AssignmentId),
  runId: Schema.NullOr(OrchestratorRunId),
  correlationId: Schema.NullOr(OrchestratorMessageId),
  replyToMessageId: Schema.NullOr(OrchestratorMessageId),
  hopCount: NonNegativeInt.check(Schema.isLessThanOrEqualTo(32)),
  expiresAt: IsoDateTime,
  body: BoundedText,
  artifactRefs: Schema.Array(ArtifactId).check(Schema.isMaxLength(64)),
  deliveryState: OrchestratorMessageDeliveryState,
  deliveryAttemptId: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestratorMessageEnvelope = typeof OrchestratorMessageEnvelope.Type;

export const OrchestratorArtifactVisibility = Schema.Literals([
  "private",
  "sealed",
  "round_released",
  "root_released",
  "public",
]);
export const OrchestratorArtifact = Schema.Struct({
  id: ArtifactId,
  rootThreadId: ThreadId,
  runId: Schema.NullOr(OrchestratorRunId),
  round: Schema.NullOr(PositiveInt),
  kind: Schema.Literals([
    "brief",
    "proposal",
    "critique",
    "revision",
    "claim_ledger",
    "arbiter_verdict",
    "decision_packet",
    "evidence",
  ]),
  contentHash: TrimmedNonEmptyString,
  content: BoundedText,
  producerThreadId: ThreadId,
  visibility: OrchestratorArtifactVisibility,
  sourceRefs: StringRefs,
  supersedesArtifactId: Schema.NullOr(ArtifactId),
  schemaVersion: PositiveInt,
  createdAt: IsoDateTime,
});
export type OrchestratorArtifact = typeof OrchestratorArtifact.Type;

export const OrchestratorRunMode = Schema.Literals(["collaboration", "council"]);
export type OrchestratorRunMode = typeof OrchestratorRunMode.Type;
export const OrchestratorRunState = Schema.Literals([
  "draft",
  "active",
  "synthesizing",
  "decided",
  "brief_sealed",
  "proposals_sealed",
  "cross_review_sealed",
  "revisions_sealed",
  "compiled",
  "arbitrating",
  "disagreement_round",
  "converged",
  "disputed",
  "owner_review_required",
  "blocked",
  "cancelled",
  "packet_published",
]);
export type OrchestratorRunState = typeof OrchestratorRunState.Type;
export const OrchestratorRunDisposition = Schema.Literals([
  "auto_actionable",
  "owner_review_required",
  "blocked",
]);
export type OrchestratorRunDisposition = typeof OrchestratorRunDisposition.Type;

export const OrchestratorRunParticipant = Schema.Struct({
  threadId: ThreadId,
  role: OrchestratorRole,
  anonymousLabel: Schema.NullOr(TrimmedNonEmptyString),
  modelTarget: OrchestratorModelTarget,
  artifactIds: Schema.Array(ArtifactId),
});
export const OrchestratorRun = Schema.Struct({
  id: OrchestratorRunId,
  rootThreadId: ThreadId,
  mode: OrchestratorRunMode,
  state: OrchestratorRunState,
  disposition: Schema.NullOr(OrchestratorRunDisposition),
  briefHash: Schema.NullOr(TrimmedNonEmptyString),
  participants: Schema.Array(OrchestratorRunParticipant).check(Schema.isMaxLength(16)),
  decisionPacketArtifactId: Schema.NullOr(ArtifactId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestratorRun = typeof OrchestratorRun.Type;

export const AtomicClaimDecision = Schema.Literals([
  "adopt",
  "reject",
  "needs_evidence",
  "not_comparable",
]);
export const CompiledAtomicClaim = Schema.Struct({
  id: TrimmedNonEmptyString,
  claim: BoundedText,
  assumptions: Schema.Array(BoundedText),
  evidenceRefs: StringRefs,
  dependencies: StringRefs,
  lifecycleImplications: Schema.Array(BoundedText),
  failureModes: Schema.Array(BoundedText),
  unresolvedQuestions: Schema.Array(BoundedText),
  userConstraintCompatibility: Schema.Array(BoundedText),
  implementationConsequences: Schema.Array(BoundedText),
});
export const CompiledProposal = Schema.Struct({
  proposalLabel: TrimmedNonEmptyString,
  artifactHash: TrimmedNonEmptyString,
  claims: Schema.Array(CompiledAtomicClaim).check(Schema.isMaxLength(256)),
  winner: Schema.optional(Schema.Never),
  score: Schema.optional(Schema.Never),
  mergedProposal: Schema.optional(Schema.Never),
  recommendation: Schema.optional(Schema.Never),
});
export type CompiledProposal = typeof CompiledProposal.Type;

export const ArbiterVerdict = Schema.Struct({
  arbiterArtifactId: ArtifactId,
  decisions: Schema.Array(
    Schema.Struct({
      claimId: TrimmedNonEmptyString,
      decision: AtomicClaimDecision,
      evidenceSufficient: Schema.Boolean,
      reasons: Schema.Array(BoundedText),
    }),
  ).check(Schema.isMaxLength(256)),
  userConstraintConflicts: Schema.Array(BoundedText),
  criticalRisks: Schema.Array(BoundedText),
  preferredProposal: Schema.NullOr(TrimmedNonEmptyString),
  synthesisRequirements: Schema.Array(BoundedText),
  confidence: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)).check(
    Schema.isLessThanOrEqualTo(1),
  ),
  confidenceReasons: Schema.Array(BoundedText),
  unresolvedDisputes: Schema.Array(BoundedText),
  recommendedDisposition: OrchestratorRunDisposition,
});
export type ArbiterVerdict = typeof ArbiterVerdict.Type;

export const FinalDecisionPacket = Schema.Struct({
  packetId: ArtifactId,
  version: PositiveInt,
  runId: OrchestratorRunId,
  status: Schema.Literals(["converged", "disputed", "blocked"]),
  decision: BoundedText,
  goal: BoundedText,
  immutableUserConstraints: Schema.Array(BoundedText),
  adoptedClaims: StringRefs,
  rejectedAlternatives: Schema.Array(BoundedText),
  evidenceRefs: StringRefs,
  primaryVerdictArtifactId: ArtifactId,
  shadowVerdictArtifactId: ArtifactId,
  materialDissent: Schema.Array(BoundedText),
  unresolvedRisks: Schema.Array(BoundedText),
  implementationConsequences: Schema.Array(BoundedText),
  orderedFollowUps: Schema.Array(BoundedText),
  provenanceRefs: StringRefs,
  conciseView: BoundedText,
  fullAuditViewArtifactId: ArtifactId,
  createdAt: IsoDateTime,
});
export type FinalDecisionPacket = typeof FinalDecisionPacket.Type;

export const OrchestratorMonitorKind = Schema.Literals(["notify", "heartbeat", "schedule", "wait"]);
export const OrchestratorMonitor = Schema.Struct({
  id: MonitorId,
  rootThreadId: ThreadId,
  targetThreadId: Schema.NullOr(ThreadId),
  kind: OrchestratorMonitorKind,
  condition: BoundedText,
  cadenceMs: Schema.NullOr(PositiveInt),
  nextWakeAt: Schema.NullOr(IsoDateTime),
  maxRuns: PositiveInt,
  runCount: NonNegativeInt,
  expiresAt: IsoDateTime,
  ownerThreadId: ThreadId,
  state: Schema.Literals(["active", "fired", "cancelled", "expired"]),
});
export type OrchestratorMonitor = typeof OrchestratorMonitor.Type;

export const OrchestratorWriterClaim = Schema.Struct({
  id: WriterClaimId,
  rootThreadId: ThreadId,
  workspaceRoot: TrimmedNonEmptyString,
  normalizedPathPrefix: TrimmedNonEmptyString,
  assignmentId: AssignmentId,
  threadId: ThreadId,
  mode: Schema.Literals(["read", "write"]),
  acquiredAt: IsoDateTime,
  expiresAt: IsoDateTime,
  releasedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestratorWriterClaim = typeof OrchestratorWriterClaim.Type;

export const OrchestratorTelemetryValue = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("known"),
    value: Schema.Number,
    source: ShortText,
    at: IsoDateTime,
  }),
  Schema.Struct({ kind: Schema.Literal("unknown"), reason: ShortText, at: IsoDateTime }),
]);
export const OrchestratorProviderCapability = Schema.Struct({
  provider: TrimmedNonEmptyString,
  model: TrimmedNonEmptyString,
  orchestratorCapable: Schema.Boolean,
  authoritativeRoleInstruction: Schema.Boolean,
  authenticatedMcp: Schema.Boolean,
  independentSession: Schema.Boolean,
  contextWindow: OrchestratorTelemetryValue,
  inputTokens: OrchestratorTelemetryValue,
  outputTokens: OrchestratorTelemetryValue,
  cacheReadTokens: OrchestratorTelemetryValue,
  cacheWriteTokens: OrchestratorTelemetryValue,
  cacheTtlSeconds: OrchestratorTelemetryValue,
  estimatedCost: OrchestratorTelemetryValue,
  observedAt: IsoDateTime,
});
export type OrchestratorProviderCapability = typeof OrchestratorProviderCapability.Type;

export const OrchestratorCapacitySnapshot = Schema.Struct({
  policyVersion: PositiveInt,
  activeSessions: NonNegativeInt,
  sessionLimit: PositiveInt,
  activeTurns: NonNegativeInt,
  turnLimit: PositiveInt,
  activeWriters: NonNegativeInt,
  writerLimit: PositiveInt,
  mailboxDepth: NonNegativeInt,
  mailboxLimit: PositiveInt,
  activeMonitors: NonNegativeInt,
  monitorLimit: PositiveInt,
  estimatedSpend: OrchestratorTelemetryValue,
  observedAt: IsoDateTime,
});
export type OrchestratorCapacitySnapshot = typeof OrchestratorCapacitySnapshot.Type;

const OrchestratorCommandBase = {
  commandId: CommandId,
  rootThreadId: ThreadId,
  projectId: ProjectId,
  actor: ActorIdentity,
  protocolVersion: OrchestratorProtocolVersion,
  expectedRevision: NonNegativeInt,
  createdAt: IsoDateTime,
} as const;

export const OrchestratorRootCreateCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.root.create"),
  modelTarget: OrchestratorModelTarget,
  title: ShortText,
  activeProcessId: Schema.NullOr(TaskProcessId),
});
export const OrchestratorRootArchiveCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.root.archive"),
  reason: Schema.NullOr(ShortText),
});
export const OrchestratorRootRestoreCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.root.restore"),
});
export const OrchestratorRootActiveProcessSetCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.root.active-process.set"),
  activeProcessId: Schema.NullOr(TaskProcessId),
});
export const OrchestratorChildAttachCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.child.attach"),
  parentThreadId: ThreadId,
  childThreadId: ThreadId,
  role: OrchestratorRole,
  capabilities: OrchestratorCapabilities,
  continuity: ChildContinuity,
  modelTarget: OrchestratorModelTarget,
  decisionReason: OrchestratorDecisionReason,
});
export const OrchestratorChildRetireCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.child.retire"),
  childThreadId: ThreadId,
  reason: ShortText,
});
export const OrchestratorChildReparentCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.child.reparent"),
  childThreadId: ThreadId,
  parentThreadId: ThreadId,
});
export const OrchestratorLinkRequestCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.link.request"),
  linkId: OrchestratorLinkId,
  sourceThreadId: ThreadId,
  targetThreadId: ThreadId,
  direction: OrchestratorLinkDirection,
  taskId: Schema.NullOr(ProjectTaskId),
  runId: Schema.NullOr(OrchestratorRunId),
  capabilities: OrchestratorCapabilities,
  reason: ShortText,
  expiresAt: IsoDateTime,
});
export const OrchestratorLinkSetCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.link.set"),
  linkId: OrchestratorLinkId,
  state: Schema.Literals(["granted", "rejected", "revoked", "expired"]),
  reason: ShortText,
});
export const OrchestratorAssignmentCreateCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.assignment.create"),
  processId: TaskProcessId,
  expectedProcessRevision: NonNegativeInt,
  bindingId: TaskThreadBindingId,
  bindingRole: TaskThreadRole,
  contract: AssignmentContract,
});
export const OrchestratorAssignmentContractUpdateCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.assignment.contract.update"),
  contract: AssignmentContract,
});
export const OrchestratorAssignmentStatusReportCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.assignment.status.report"),
  processId: TaskProcessId,
  expectedProcessRevision: NonNegativeInt,
  progressId: TaskProgressEntryId,
  progressKind: TaskProgressKind,
  progressEvidenceRefs: Schema.Array(ArtifactId).check(Schema.isMaxLength(128)),
  assignmentId: AssignmentId,
  taskId: ProjectTaskId,
  state: AssignmentState,
  summary: BoundedText,
  evidence: Schema.NullOr(AssignmentCompletionEvidence),
});
export const OrchestratorAssignmentVerifyCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.assignment.verify"),
  assignmentId: AssignmentId,
  taskId: ProjectTaskId,
  evidenceArtifactIds: Schema.Array(ArtifactId),
});
export const OrchestratorAssignmentAcceptCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.assignment.accept"),
  assignmentId: AssignmentId,
  taskId: ProjectTaskId,
});
export const OrchestratorAssignmentReopenCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.assignment.reopen"),
  assignmentId: AssignmentId,
  taskId: ProjectTaskId,
  reason: BoundedText,
});
export const OrchestratorMessageEnqueueCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.message.enqueue"),
  message: OrchestratorMessageEnvelope,
});
export const OrchestratorMessageDeliveryMarkCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.message.delivery.mark"),
  messageId: OrchestratorMessageId,
  deliveryState: OrchestratorMessageDeliveryState,
  deliveryAttemptId: TrimmedNonEmptyString,
});
export const OrchestratorMessageResponseMarkCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.message.response.mark"),
  messageId: OrchestratorMessageId,
  responseMessageId: OrchestratorMessageId,
});
export const OrchestratorArtifactPublishCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.artifact.publish"),
  artifact: OrchestratorArtifact,
});
export const OrchestratorArtifactReleaseCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.artifact.release"),
  artifactId: ArtifactId,
  visibility: OrchestratorArtifactVisibility,
});
export const OrchestratorRunCreateCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.run.create"),
  run: OrchestratorRun,
});
export const OrchestratorRunAdvanceCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.run.advance"),
  runId: OrchestratorRunId,
  state: OrchestratorRunState,
  artifactIds: Schema.Array(ArtifactId),
});
export const OrchestratorRunDispositionSetCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.run.disposition.set"),
  runId: OrchestratorRunId,
  disposition: OrchestratorRunDisposition,
  reason: BoundedText,
});
export const OrchestratorMonitorRegisterCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.monitor.register"),
  monitor: OrchestratorMonitor,
});
export const OrchestratorMonitorCancelCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.monitor.cancel"),
  monitorId: MonitorId,
  reason: ShortText,
});
export const OrchestratorMonitorFireCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.monitor.fire"),
  monitorId: MonitorId,
  reasonCode: TrimmedNonEmptyString,
});
export const OrchestratorWriterClaimAcquireCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.writer-claim.acquire"),
  claim: OrchestratorWriterClaim,
});
export const OrchestratorWriterClaimReleaseCommand = Schema.Struct({
  ...OrchestratorCommandBase,
  type: Schema.Literal("orchestrator.writer-claim.release"),
  claimId: WriterClaimId,
  reason: ShortText,
});

export const OrchestratorUserCommand = Schema.Union([
  OrchestratorRootCreateCommand,
  OrchestratorRootArchiveCommand,
  OrchestratorRootRestoreCommand,
]);
export type OrchestratorUserCommand = typeof OrchestratorUserCommand.Type;
export const OrchestratorCommand = Schema.Union([
  OrchestratorUserCommand,
  OrchestratorRootActiveProcessSetCommand,
  OrchestratorChildAttachCommand,
  OrchestratorChildRetireCommand,
  OrchestratorChildReparentCommand,
  OrchestratorLinkRequestCommand,
  OrchestratorLinkSetCommand,
  OrchestratorAssignmentCreateCommand,
  OrchestratorAssignmentContractUpdateCommand,
  OrchestratorAssignmentStatusReportCommand,
  OrchestratorAssignmentVerifyCommand,
  OrchestratorAssignmentAcceptCommand,
  OrchestratorAssignmentReopenCommand,
  OrchestratorMessageEnqueueCommand,
  OrchestratorMessageDeliveryMarkCommand,
  OrchestratorMessageResponseMarkCommand,
  OrchestratorArtifactPublishCommand,
  OrchestratorArtifactReleaseCommand,
  OrchestratorRunCreateCommand,
  OrchestratorRunAdvanceCommand,
  OrchestratorRunDispositionSetCommand,
  OrchestratorMonitorRegisterCommand,
  OrchestratorMonitorCancelCommand,
  OrchestratorMonitorFireCommand,
  OrchestratorWriterClaimAcquireCommand,
  OrchestratorWriterClaimReleaseCommand,
]);
export type OrchestratorCommand = typeof OrchestratorCommand.Type;

export const OrchestratorEventType = Schema.Literals([
  "orchestrator.root.created",
  "orchestrator.root.archived",
  "orchestrator.root.restored",
  "orchestrator.root.active-process-set",
  "orchestrator.child.attached",
  "orchestrator.child.retired",
  "orchestrator.child.reparented",
  "orchestrator.link.requested",
  "orchestrator.link.set",
  "orchestrator.assignment.created",
  "orchestrator.assignment.contract-updated",
  "orchestrator.assignment.status-reported",
  "orchestrator.assignment.verified",
  "orchestrator.assignment.accepted",
  "orchestrator.assignment.reopened",
  "orchestrator.message.enqueued",
  "orchestrator.message.delivery-marked",
  "orchestrator.message.response-marked",
  "orchestrator.artifact.published",
  "orchestrator.artifact.released",
  "orchestrator.run.created",
  "orchestrator.run.advanced",
  "orchestrator.run.disposition-set",
  "orchestrator.monitor.registered",
  "orchestrator.monitor.cancelled",
  "orchestrator.monitor.fired",
  "orchestrator.writer-claim.acquired",
  "orchestrator.writer-claim.released",
]);
export type OrchestratorEventType = typeof OrchestratorEventType.Type;

export const OrchestratorEventPayload = Schema.Struct({
  rootThreadId: ThreadId,
  projectId: ProjectId,
  actor: ActorIdentity,
  protocolVersion: OrchestratorProtocolVersion,
  acceptedRevision: NonNegativeInt,
  root: Schema.optional(OrchestratorRoot),
  ownershipEdge: Schema.optional(OrchestratorOwnershipEdge),
  link: Schema.optional(OrchestratorCommunicationLink),
  assignment: Schema.optional(AssignmentContract),
  evidence: Schema.optional(AssignmentCompletionEvidence),
  message: Schema.optional(OrchestratorMessageEnvelope),
  artifact: Schema.optional(OrchestratorArtifact),
  run: Schema.optional(OrchestratorRun),
  monitor: Schema.optional(OrchestratorMonitor),
  writerClaim: Schema.optional(OrchestratorWriterClaim),
  reason: Schema.optional(Schema.NullOr(BoundedText)),
});
export type OrchestratorEventPayload = typeof OrchestratorEventPayload.Type;

export const OrchestratorDomainEvent = Schema.Struct({
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: Schema.Literal("orchestrator"),
  aggregateId: ThreadId,
  type: OrchestratorEventType,
  payload: OrchestratorEventPayload,
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: Schema.Struct({
    providerTurnId: Schema.optional(TrimmedNonEmptyString),
    providerItemId: Schema.optional(ProviderItemId),
    adapterKey: Schema.optional(TrimmedNonEmptyString),
    ingestedAt: Schema.optional(IsoDateTime),
  }),
});
export type OrchestratorDomainEvent = typeof OrchestratorDomainEvent.Type;

export const OrchestratorSnapshot = Schema.Struct({
  root: OrchestratorRoot,
  ownershipEdges: Schema.Array(OrchestratorOwnershipEdge),
  communicationLinks: Schema.Array(OrchestratorCommunicationLink),
  assignments: Schema.Array(AssignmentContract),
  runs: Schema.Array(OrchestratorRun),
  activeProcess: Schema.NullOr(TaskProcessSummaryProjection),
  providerCapabilities: Schema.Array(OrchestratorProviderCapability),
  capacity: OrchestratorCapacitySnapshot,
  highWaterCursor: TrimmedNonEmptyString,
});
export type OrchestratorSnapshot = typeof OrchestratorSnapshot.Type;

export const ListOrchestratorRootsInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  includeArchived: Schema.optional(Schema.Boolean),
  cursor: Schema.optional(TrimmedNonEmptyString),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(100))),
});
export type ListOrchestratorRootsInput = typeof ListOrchestratorRootsInput.Type;
export const ListOrchestratorRootsResult = Schema.Struct({
  items: Schema.Array(OrchestratorRoot).check(Schema.isMaxLength(100)),
  nextCursor: Schema.NullOr(TrimmedNonEmptyString),
  highWaterCursor: TrimmedNonEmptyString,
});
export type ListOrchestratorRootsResult = typeof ListOrchestratorRootsResult.Type;
export const GetOrchestratorSnapshotInput = Schema.Struct({ rootThreadId: ThreadId });
export type GetOrchestratorSnapshotInput = typeof GetOrchestratorSnapshotInput.Type;
export const GetOrchestratorSnapshotResult = Schema.Struct({
  snapshot: OrchestratorSnapshot,
  projectionBehind: Schema.Boolean,
});
export type GetOrchestratorSnapshotResult = typeof GetOrchestratorSnapshotResult.Type;

const PagedRootReadInput = Schema.Struct({
  rootThreadId: ThreadId,
  cursor: Schema.optional(TrimmedNonEmptyString),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(100))),
});
export const ListOrchestratorExchangesInput = PagedRootReadInput;
export type ListOrchestratorExchangesInput = typeof ListOrchestratorExchangesInput.Type;
export const ListOrchestratorExchangesResult = Schema.Struct({
  items: Schema.Array(OrchestratorMessageEnvelope).check(Schema.isMaxLength(100)),
  nextCursor: Schema.NullOr(TrimmedNonEmptyString),
});
export type ListOrchestratorExchangesResult = typeof ListOrchestratorExchangesResult.Type;
export const ListOrchestratorArtifactsInput = PagedRootReadInput;
export type ListOrchestratorArtifactsInput = typeof ListOrchestratorArtifactsInput.Type;
export const ListOrchestratorArtifactsResult = Schema.Struct({
  items: Schema.Array(OrchestratorArtifact).check(Schema.isMaxLength(100)),
  nextCursor: Schema.NullOr(TrimmedNonEmptyString),
});
export type ListOrchestratorArtifactsResult = typeof ListOrchestratorArtifactsResult.Type;
export const ReadOrchestratorArtifactInput = Schema.Struct({
  rootThreadId: ThreadId,
  artifactId: ArtifactId,
});
export type ReadOrchestratorArtifactInput = typeof ReadOrchestratorArtifactInput.Type;
export const ListOrchestratorAuditEventsInput = PagedRootReadInput;
export type ListOrchestratorAuditEventsInput = typeof ListOrchestratorAuditEventsInput.Type;
export const ListOrchestratorAuditEventsResult = Schema.Struct({
  items: Schema.Array(OrchestratorDomainEvent).check(Schema.isMaxLength(100)),
  nextCursor: Schema.NullOr(TrimmedNonEmptyString),
});
export type ListOrchestratorAuditEventsResult = typeof ListOrchestratorAuditEventsResult.Type;

export const CreateOrchestratorRootInput = Schema.Struct({
  command: OrchestratorRootCreateCommand,
});
export type CreateOrchestratorRootInput = typeof CreateOrchestratorRootInput.Type;
export const ArchiveOrchestratorRootInput = Schema.Struct({
  command: OrchestratorRootArchiveCommand,
});
export type ArchiveOrchestratorRootInput = typeof ArchiveOrchestratorRootInput.Type;
export const RestoreOrchestratorRootInput = Schema.Struct({
  command: OrchestratorRootRestoreCommand,
});
export type RestoreOrchestratorRootInput = typeof RestoreOrchestratorRootInput.Type;
export const DetachOrchestratorChildInput = Schema.Struct({
  rootThreadId: ThreadId,
  childThreadId: ThreadId,
  expectedRevision: NonNegativeInt,
  reason: ShortText,
});
export type DetachOrchestratorChildInput = typeof DetachOrchestratorChildInput.Type;
export const UpgradeOrchestratorRootInput = Schema.Struct({
  sourceRootThreadId: ThreadId,
  newRootThreadId: ThreadId,
  targetProtocolVersion: PositiveInt,
  contextBundle: ContextBundle,
});
export type UpgradeOrchestratorRootInput = typeof UpgradeOrchestratorRootInput.Type;
export const OrchestratorCommandResult = Schema.Struct({
  sequence: NonNegativeInt,
  revision: NonNegativeInt,
  taskMutation: Schema.optional(TaskGraphMutationResult),
});
export type OrchestratorCommandResult = typeof OrchestratorCommandResult.Type;

export const OrchestratorToolName = Schema.Literals([
  "synara_task_process_create",
  "synara_task_process_get",
  "synara_task_create",
  "synara_task_update",
  "synara_task_set_dependencies",
  "synara_task_transition",
  "synara_orchestrator_get_state",
  "synara_orchestrator_assign_task",
  "synara_orchestrator_send_message",
  "synara_orchestrator_request_link",
  "synara_orchestrator_set_link",
  "synara_orchestrator_publish_artifact",
  "synara_orchestrator_update_run",
  "synara_orchestrator_read_child",
  "synara_orchestrator_report_status",
  "synara_orchestrator_request_change",
  "synara_orchestrator_wait",
  "synara_orchestrator_retire_child",
]);
export type OrchestratorToolName = typeof OrchestratorToolName.Type;

export const OrchestratorAssignTaskInput = Schema.Struct({
  expectedRevision: NonNegativeInt,
  expectedProcessRevision: NonNegativeInt,
  processId: TaskProcessId,
  taskId: ProjectTaskId,
  assignmentId: AssignmentId,
  bindingId: TaskThreadBindingId,
  bindingRole: TaskThreadRole,
  continuity: OrchestratorChildContinuityInput,
  modelTarget: OrchestratorModelTarget,
  decisionReason: OrchestratorDecisionReason,
  contractVersion: PositiveInt,
  goal: BoundedText,
  acceptanceCriteria: Schema.Array(BoundedText).check(Schema.isMaxLength(128)),
  immutableUserConstraints: Schema.Array(BoundedText).check(Schema.isMaxLength(128)),
  workingAssumptions: Schema.Array(BoundedText).check(Schema.isMaxLength(128)),
  contextBundleId: ContextBundleId,
  pathOwnershipClaims: StringRefs,
  dependencyRefs: StringRefs,
  expectedApis: StringRefs,
  allowedCapabilities: OrchestratorCapabilities,
  evidenceRequirements: Schema.Array(BoundedText).check(Schema.isMaxLength(128)),
  verifierClass: Schema.Literals(["root", "existing_child", "fresh_child", "council"]),
  assignmentState: AssignmentState,
  supersedesVersion: Schema.NullOr(PositiveInt),
  startInitialTurn: Schema.Boolean,
});
export const OrchestratorReadChildInput = Schema.Struct({
  childThreadId: ThreadId,
  view: Schema.Literals([
    "status",
    "last_message",
    "tail_since_cursor",
    "full_transcript",
    "artifacts",
    "activity",
    "tool_calls",
    "pending_interactions",
  ]),
  cursor: Schema.optional(TrimmedNonEmptyString),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(200))),
});
export const OrchestratorReportStatusInput = Schema.Struct({
  expectedRevision: NonNegativeInt,
  expectedProcessRevision: NonNegativeInt,
  progressId: TaskProgressEntryId,
  progressKind: TaskProgressKind,
  progressEvidenceRefs: Schema.Array(ArtifactId).check(Schema.isMaxLength(128)),
  taskId: ProjectTaskId,
  assignmentId: AssignmentId,
  state: AssignmentState,
  summary: BoundedText,
  evidence: Schema.NullOr(AssignmentCompletionEvidence),
});
export const OrchestratorChangeRequestKind = Schema.Literals([
  "contract",
  "scope",
  "api",
  "dependency",
  "ownership",
  "workspace",
  "model",
  "participant",
  "deferral",
  "clarification",
  "reframing",
]);
export const OrchestratorRequestChangeInput = Schema.Struct({
  expectedRevision: NonNegativeInt,
  messageId: OrchestratorMessageId,
  taskId: ProjectTaskId,
  assignmentId: AssignmentId,
  kind: OrchestratorChangeRequestKind,
  request: BoundedText,
  reason: BoundedText,
  expiresAt: IsoDateTime,
});
export const OrchestratorWaitInput = Schema.Struct({
  expectedRevision: NonNegativeInt,
  monitorId: MonitorId,
  targetThreadId: Schema.NullOr(ThreadId),
  condition: BoundedText,
  timeoutMs: PositiveInt.check(Schema.isLessThanOrEqualTo(3_600_000)),
});
