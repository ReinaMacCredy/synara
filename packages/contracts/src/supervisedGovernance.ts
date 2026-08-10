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
import { RoomId, TaskNodeId } from "./supervised";
import {
  LeadRotation,
  LeadSeat,
  PeerBinding,
  ProfilePreset,
  ProfilePresetId,
  ProfileSnapshot,
  ProfileSnapshotId,
  SupervisionAdvice,
  SupervisionMission,
  SupervisionObservationCursor,
  SupervisionWake,
  SupervisorSeat,
  WorkflowConflict,
  WorkflowDirective,
  WorkflowDirectiveId,
} from "./supervision";

const entityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));
const ShortText = TrimmedNonEmptyString.check(Schema.isMaxLength(512));
const BoundedText = Schema.String.check(Schema.isMaxLength(32_768));
const Confidence = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }));
const CapabilityScore = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 10 }));
const NonNegativeFinite = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

export const SupervisedWorkspaceId = entityId("SupervisedWorkspaceId");
export type SupervisedWorkspaceId = typeof SupervisedWorkspaceId.Type;
export const AgentSeatId = entityId("AgentSeatId");
export type AgentSeatId = typeof AgentSeatId.Type;
export const AgentProfileId = entityId("AgentProfileId");
export type AgentProfileId = typeof AgentProfileId.Type;
export const EffectiveAuthorityReceiptId = entityId("EffectiveAuthorityReceiptId");
export type EffectiveAuthorityReceiptId = typeof EffectiveAuthorityReceiptId.Type;
export const RootAuthorityLeaseId = entityId("RootAuthorityLeaseId");
export type RootAuthorityLeaseId = typeof RootAuthorityLeaseId.Type;
export const HumanDirectiveId = entityId("HumanDirectiveId");
export type HumanDirectiveId = typeof HumanDirectiveId.Type;
export const StandingMandateId = entityId("StandingMandateId");
export type StandingMandateId = typeof StandingMandateId.Type;
export const DirectInterventionId = entityId("DirectInterventionId");
export type DirectInterventionId = typeof DirectInterventionId.Type;
export const SupervisorNotebookEntryId = entityId("SupervisorNotebookEntryId");
export type SupervisorNotebookEntryId = typeof SupervisorNotebookEntryId.Type;
export const SupervisorNotebookCursorId = entityId("SupervisorNotebookCursorId");
export type SupervisorNotebookCursorId = typeof SupervisorNotebookCursorId.Type;
export const SupervisorNotebookCompactionReceiptId = entityId(
  "SupervisorNotebookCompactionReceiptId",
);
export type SupervisorNotebookCompactionReceiptId =
  typeof SupervisorNotebookCompactionReceiptId.Type;
export const ModelCapabilityProfileId = entityId("ModelCapabilityProfileId");
export type ModelCapabilityProfileId = typeof ModelCapabilityProfileId.Type;
export const UserModelPreferenceProfileId = entityId("UserModelPreferenceProfileId");
export type UserModelPreferenceProfileId = typeof UserModelPreferenceProfileId.Type;
export const ModelSelectionReceiptId = entityId("ModelSelectionReceiptId");
export type ModelSelectionReceiptId = typeof ModelSelectionReceiptId.Type;
export const ModelTelemetryAggregateId = entityId("ModelTelemetryAggregateId");
export type ModelTelemetryAggregateId = typeof ModelTelemetryAggregateId.Type;
export const GovernedProviderSessionId = entityId("GovernedProviderSessionId");
export type GovernedProviderSessionId = typeof GovernedProviderSessionId.Type;
export const GovernanceHandoffId = entityId("GovernanceHandoffId");
export type GovernanceHandoffId = typeof GovernanceHandoffId.Type;
export const RoleAssumptionId = entityId("RoleAssumptionId");
export type RoleAssumptionId = typeof RoleAssumptionId.Type;
export const LeadReplacementId = entityId("LeadReplacementId");
export type LeadReplacementId = typeof LeadReplacementId.Type;

export const AgentRole = Schema.Literals(["supervisor", "lead", "peer"]);
export type AgentRole = typeof AgentRole.Type;
export const EffectiveAgentRole = Schema.Union([AgentRole, Schema.Literal("acting_root")]);
export type EffectiveAgentRole = typeof EffectiveAgentRole.Type;

export const SupervisedWorkspaceLifecycle = Schema.Literals([
  "creating",
  "ready",
  "active",
  "suspended",
  "degraded",
  "recovering",
  "archiving",
  "archived",
  "failed",
]);
export const SupervisedWorkspace = Schema.Struct({
  id: SupervisedWorkspaceId,
  ownerNamespace: TrimmedNonEmptyString,
  title: ShortText,
  lifecycleState: SupervisedWorkspaceLifecycle,
  revision: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type SupervisedWorkspace = typeof SupervisedWorkspace.Type;

export const AgentSeatLifecycle = Schema.Literals([
  "requested",
  "provisioning",
  "bootstrapping",
  "ready",
  "active",
  "draining",
  "retained",
  "retired",
  "failed",
  "lost",
  "recovering",
]);
export const AgentWorkState = Schema.Literals([
  "idle",
  "assigned",
  "running",
  "blocked",
  "waiting_review",
  "handing_off",
]);
export const AgentSeat = Schema.Struct({
  id: AgentSeatId,
  workspaceId: SupervisedWorkspaceId,
  roomIds: Schema.Array(RoomId).check(Schema.isMaxLength(256)),
  identityRole: AgentRole,
  effectiveRole: EffectiveAgentRole,
  profileId: AgentProfileId,
  concern: Schema.optional(ShortText),
  providerSessionId: Schema.NullOr(GovernedProviderSessionId),
  lifecycleState: AgentSeatLifecycle,
  workState: AgentWorkState,
  authorityReceiptId: EffectiveAuthorityReceiptId,
  threadId: Schema.optional(Schema.NullOr(ThreadId)).pipe(Schema.withDecodingDefault(() => null)),
  projectId: Schema.optional(Schema.NullOr(ProjectId)).pipe(Schema.withDecodingDefault(() => null)),
  profileSnapshotId: Schema.optional(Schema.NullOr(ProfileSnapshotId)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  predecessorThreadIds: Schema.optional(Schema.Array(ThreadId)).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  displayName: Schema.optional(Schema.NullOr(ShortText)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  createdAt: IsoDateTime,
  retainedAt: Schema.NullOr(IsoDateTime),
  retiredAt: Schema.NullOr(IsoDateTime),
  revision: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type AgentSeat = typeof AgentSeat.Type;

export const GovernedProviderSessionLifecycle = Schema.Literals([
  "creating",
  "active",
  "retained",
  "resuming",
  "closing",
  "closed",
  "interrupted",
  "lost",
  "recovering",
  "failed",
]);
export const GovernedProviderSession = Schema.Struct({
  id: GovernedProviderSessionId,
  workspaceId: SupervisedWorkspaceId,
  seatId: AgentSeatId,
  provider: TrimmedNonEmptyString,
  nativeSessionId: Schema.NullOr(TrimmedNonEmptyString),
  lifecycleState: GovernedProviderSessionLifecycle,
  createdAt: IsoDateTime,
  retainedAt: Schema.NullOr(IsoDateTime),
  closedAt: Schema.NullOr(IsoDateTime),
  revision: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type GovernedProviderSession = typeof GovernedProviderSession.Type;

export const CanonicalAuthorityScope = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("workspace"), workspaceId: SupervisedWorkspaceId }),
  Schema.Struct({ kind: Schema.Literal("project"), projectId: ProjectId }),
  Schema.Struct({ kind: Schema.Literal("room"), roomId: RoomId }),
  Schema.Struct({ kind: Schema.Literal("task_node"), taskNodeId: TaskNodeId }),
  Schema.Struct({ kind: Schema.Literal("seat"), seatId: AgentSeatId }),
]);
export type CanonicalAuthorityScope = typeof CanonicalAuthorityScope.Type;

export const EffectiveAuthorityReceipt = Schema.Struct({
  id: EffectiveAuthorityReceiptId,
  actorSeatId: AgentSeatId,
  identityRole: AgentRole,
  effectiveRole: EffectiveAgentRole,
  workspaceScopes: Schema.Array(SupervisedWorkspaceId).check(Schema.isMaxLength(64)),
  roomScopes: Schema.Array(RoomId).check(Schema.isMaxLength(256)),
  taskNodeScopes: Schema.Array(TaskNodeId).check(Schema.isMaxLength(512)),
  allowedCommands: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(256)),
  allowedTools: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(256)),
  rootLeaseIds: Schema.Array(RootAuthorityLeaseId).check(Schema.isMaxLength(64)),
  mandateIds: Schema.Array(StandingMandateId).check(Schema.isMaxLength(128)),
  runPolicyRevision: NonNegativeInt,
  issuedAt: IsoDateTime,
  expiresAt: Schema.NullOr(IsoDateTime),
  revokedAt: Schema.NullOr(IsoDateTime),
});
export type EffectiveAuthorityReceipt = typeof EffectiveAuthorityReceipt.Type;

export const RootAuthorityLeaseStatus = Schema.Literals([
  "requested",
  "active",
  "transferring",
  "releasing",
  "released",
  "expired",
  "revoked",
]);
export const RootAuthorityLease = Schema.Struct({
  id: RootAuthorityLeaseId,
  workspaceId: SupervisedWorkspaceId,
  roomId: RoomId,
  holderSeatId: AgentSeatId,
  status: RootAuthorityLeaseStatus,
  acquiredUnderReceiptId: EffectiveAuthorityReceiptId,
  predecessorLeaseId: Schema.NullOr(RootAuthorityLeaseId),
  acquiredAt: IsoDateTime,
  releasedAt: Schema.NullOr(IsoDateTime),
  expiresAt: Schema.NullOr(IsoDateTime),
  revision: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type RootAuthorityLease = typeof RootAuthorityLease.Type;

export const GovernanceHandoffLifecycle = Schema.Literals([
  "draft",
  "prepared",
  "delivered",
  "acknowledged",
  "accepted",
  "ownership_transferred",
  "reconciled",
  "rejected",
  "expired",
  "cancelled",
  "failed",
]);
export const GovernanceHandoff = Schema.Struct({
  id: GovernanceHandoffId,
  workspaceId: SupervisedWorkspaceId,
  roomId: RoomId,
  fromSeatId: AgentSeatId,
  toSeatId: AgentSeatId,
  lifecycleState: GovernanceHandoffLifecycle,
  scope: Schema.Array(CanonicalAuthorityScope)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(256)),
  summary: Schema.NullOr(BoundedText),
  evidenceRefs: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(512)),
  preparedAt: Schema.NullOr(IsoDateTime),
  acceptedAt: Schema.NullOr(IsoDateTime),
  transferredAt: Schema.NullOr(IsoDateTime),
  reconciledAt: Schema.NullOr(IsoDateTime),
  revision: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type GovernanceHandoff = typeof GovernanceHandoff.Type;

export const RoleAssumptionLifecycle = Schema.Literals([
  "requested",
  "authority_validated",
  "destination_ready",
  "previous_root_notified",
  "lease_transferred",
  "topology_reconciled",
  "active",
  "release_requested",
  "successor_ready",
  "handoff_accepted",
  "released",
  "failed",
]);
export const RoleAssumption = Schema.Struct({
  id: RoleAssumptionId,
  workspaceId: SupervisedWorkspaceId,
  roomId: RoomId,
  actorSeatId: AgentSeatId,
  previousRootSeatId: AgentSeatId,
  handoffId: GovernanceHandoffId,
  previousLeaseId: RootAuthorityLeaseId,
  nextLeaseId: RootAuthorityLeaseId,
  operation: Schema.Literals(["assume", "release"]),
  lifecycleState: RoleAssumptionLifecycle,
  requestedUnderReceiptId: EffectiveAuthorityReceiptId,
  failureReason: Schema.NullOr(BoundedText),
  createdAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  revision: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type RoleAssumption = typeof RoleAssumption.Type;

export const LeadReplacementLifecycle = Schema.Literals([
  "requested",
  "provisioning_replacement",
  "replacement_ready",
  "handoff_prepared",
  "handoff_accepted",
  "lease_transferred",
  "topology_reconciled",
  "draining_previous",
  "completed",
  "failed",
]);
export const LeadReplacement = Schema.Struct({
  id: LeadReplacementId,
  workspaceId: SupervisedWorkspaceId,
  roomId: RoomId,
  previousLeadSeatId: AgentSeatId,
  replacementLeadSeatId: AgentSeatId,
  handoffId: GovernanceHandoffId,
  previousLeaseId: RootAuthorityLeaseId,
  replacementLeaseId: RootAuthorityLeaseId,
  lifecycleState: LeadReplacementLifecycle,
  retirePreviousLineage: Schema.Boolean,
  failureReason: Schema.NullOr(BoundedText),
  createdAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  revision: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type LeadReplacement = typeof LeadReplacement.Type;

export const HumanDirectiveStatus = Schema.Literals(["active", "fulfilled", "revoked", "expired"]);
export const HumanDirective = Schema.Struct({
  id: HumanDirectiveId,
  workspaceId: SupervisedWorkspaceId,
  roomId: Schema.NullOr(RoomId),
  text: BoundedText,
  scope: Schema.Array(CanonicalAuthorityScope)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(128)),
  status: HumanDirectiveStatus,
  sourceMessageId: Schema.NullOr(TrimmedNonEmptyString),
  issuedAt: IsoDateTime,
  fulfilledAt: Schema.NullOr(IsoDateTime),
  revokedAt: Schema.NullOr(IsoDateTime),
  revision: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type HumanDirective = typeof HumanDirective.Type;

export const StandingMandateStatus = Schema.Literals([
  "active",
  "paused",
  "fulfilled",
  "revoked",
  "expired",
]);
export const StandingMandate = Schema.Struct({
  id: StandingMandateId,
  workspaceId: SupervisedWorkspaceId,
  sourceDirectiveId: HumanDirectiveId,
  subjectSeatId: Schema.NullOr(AgentSeatId),
  concern: ShortText,
  scope: Schema.Array(CanonicalAuthorityScope)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(128)),
  allowedCommands: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(256)),
  status: StandingMandateStatus,
  grantedAt: IsoDateTime,
  expiresAt: Schema.NullOr(IsoDateTime),
  revokedAt: Schema.NullOr(IsoDateTime),
  revision: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type StandingMandate = typeof StandingMandate.Type;

export const DirectInterventionLifecycle = Schema.Literals([
  "opened",
  "delivered",
  "acknowledged",
  "executing",
  "completed",
  "lead_notified",
  "reconciled",
  "not_required",
  "closed",
  "failed",
]);
export const DirectIntervention = Schema.Struct({
  id: DirectInterventionId,
  workspaceId: SupervisedWorkspaceId,
  roomId: RoomId,
  supervisorSeatId: AgentSeatId,
  targetPeerSeatId: AgentSeatId,
  rootHolderSeatId: AgentSeatId,
  taskNodeId: Schema.NullOr(TaskNodeId),
  workRequest: BoundedText,
  material: Schema.Boolean,
  lifecycleState: DirectInterventionLifecycle,
  evidenceRefs: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(256)),
  openedUnderReceiptId: EffectiveAuthorityReceiptId,
  openedAt: IsoDateTime,
  leadNotifiedAt: Schema.NullOr(IsoDateTime),
  reconciledAt: Schema.NullOr(IsoDateTime),
  closedAt: Schema.NullOr(IsoDateTime),
  revision: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type DirectIntervention = typeof DirectIntervention.Type;

export const SupervisorNotebookEntryKind = Schema.Literals([
  "observation",
  "decision",
  "lesson",
  "hypothesis",
  "warning",
]);
export const SupervisorNotebookEntry = Schema.Struct({
  id: SupervisorNotebookEntryId,
  workspaceId: SupervisedWorkspaceId,
  roomId: Schema.NullOr(RoomId),
  taskNodeId: Schema.NullOr(TaskNodeId),
  concern: ShortText,
  authorSeatId: AgentSeatId,
  kind: SupervisorNotebookEntryKind,
  content: BoundedText,
  evidenceRefs: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(512)),
  confidence: Confidence,
  supersedesEntryId: Schema.NullOr(SupervisorNotebookEntryId),
  protectionClass: TrimmedNonEmptyString,
  redactedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
});
export type SupervisorNotebookEntry = typeof SupervisorNotebookEntry.Type;

export const SupervisorNotebookCursor = Schema.Struct({
  id: SupervisorNotebookCursorId,
  workspaceId: SupervisedWorkspaceId,
  seatId: AgentSeatId,
  lastCreatedAt: Schema.NullOr(IsoDateTime),
  lastEntryId: Schema.NullOr(SupervisorNotebookEntryId),
  updatedAt: IsoDateTime,
});
export type SupervisorNotebookCursor = typeof SupervisorNotebookCursor.Type;

export const SupervisorNotebookCompactionReceipt = Schema.Struct({
  id: SupervisorNotebookCompactionReceiptId,
  workspaceId: SupervisedWorkspaceId,
  summaryEntryId: SupervisorNotebookEntryId,
  sourceEntryIds: Schema.Array(SupervisorNotebookEntryId)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(512)),
  evidenceRefs: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(512)),
  createdBySeatId: AgentSeatId,
  createdAt: IsoDateTime,
});
export type SupervisorNotebookCompactionReceipt = typeof SupervisorNotebookCompactionReceipt.Type;

export const SupervisorNotebookView = Schema.Struct({
  workspaceId: SupervisedWorkspaceId,
  viewerSeatId: AgentSeatId,
  entries: Schema.Array(SupervisorNotebookEntry).check(Schema.isMaxLength(512)),
  compactionReceipts: Schema.Array(SupervisorNotebookCompactionReceipt).check(
    Schema.isMaxLength(512),
  ),
  nextCursor: SupervisorNotebookCursor,
  createdAt: IsoDateTime,
});
export type SupervisorNotebookView = typeof SupervisorNotebookView.Type;

export const ModelCapabilityDimension = Schema.Literals([
  "coding",
  "architecture",
  "debugging",
  "review",
  "uiUx",
  "visualUnderstanding",
  "longContext",
  "structuredOutput",
  "agenticEndurance",
  "multilingual",
]);
export type ModelCapabilityDimension = typeof ModelCapabilityDimension.Type;

export const ModelCapabilityScores = Schema.Struct({
  coding: CapabilityScore,
  architecture: CapabilityScore,
  debugging: CapabilityScore,
  review: CapabilityScore,
  uiUx: CapabilityScore,
  visualUnderstanding: CapabilityScore,
  longContext: CapabilityScore,
  structuredOutput: CapabilityScore,
  agenticEndurance: CapabilityScore,
  multilingual: CapabilityScore,
});
export const ModelCapabilityProfile = Schema.Struct({
  id: ModelCapabilityProfileId,
  provider: TrimmedNonEmptyString,
  model: TrimmedNonEmptyString,
  version: TrimmedNonEmptyString,
  available: Schema.Boolean,
  contextCapacity: PositiveInt,
  supportsVision: Schema.Boolean,
  supportsTools: Schema.Boolean,
  supportsReasoning: Schema.Boolean,
  latencyScore: CapabilityScore,
  costScore: CapabilityScore,
  inputCostUsdPerMillionTokens: Schema.optional(Schema.NullOr(NonNegativeFinite)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  outputCostUsdPerMillionTokens: Schema.optional(Schema.NullOr(NonNegativeFinite)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  failureRate: Schema.optional(Confidence).pipe(Schema.withDecodingDefault(() => 0)),
  retryRate: Schema.optional(Confidence).pipe(Schema.withDecodingDefault(() => 0)),
  scores: ModelCapabilityScores,
  provenance: Schema.Array(TrimmedNonEmptyString)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(32)),
  confidence: Confidence,
  revision: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type ModelCapabilityProfile = typeof ModelCapabilityProfile.Type;

export const RelativeModelPreference = Schema.Struct({
  preferredModelId: ModelCapabilityProfileId,
  overModelId: ModelCapabilityProfileId,
  category: TrimmedNonEmptyString,
  reason: Schema.NullOr(BoundedText),
});
export const UserModelPreferenceProfile = Schema.Struct({
  id: UserModelPreferenceProfileId,
  userId: TrimmedNonEmptyString,
  revision: NonNegativeInt,
  ratings: Schema.Record(ModelCapabilityProfileId, CapabilityScore),
  relativePreferences: Schema.Array(RelativeModelPreference).check(Schema.isMaxLength(256)),
  preferredFor: Schema.Record(TrimmedNonEmptyString, Schema.Array(ModelCapabilityProfileId)),
  avoidFor: Schema.Record(TrimmedNonEmptyString, Schema.Array(ModelCapabilityProfileId)),
  priorities: Schema.Struct({
    quality: CapabilityScore,
    speed: CapabilityScore,
    cost: CapabilityScore,
    contextCapacity: CapabilityScore,
  }),
  defaultModels: Schema.Struct({
    supervisor: Schema.optional(ModelCapabilityProfileId),
    lead: Schema.optional(ModelCapabilityProfileId),
    peer: Schema.optional(ModelCapabilityProfileId),
    reviewer: Schema.optional(ModelCapabilityProfileId),
    rlmBranch: Schema.optional(ModelCapabilityProfileId),
  }),
  fallbackChains: Schema.Record(TrimmedNonEmptyString, Schema.Array(ModelCapabilityProfileId)),
  ownerNotes: Schema.optional(BoundedText),
  updatedAt: IsoDateTime,
});
export type UserModelPreferenceProfile = typeof UserModelPreferenceProfile.Type;

export const ModelTelemetryAggregate = Schema.Struct({
  id: ModelTelemetryAggregateId,
  modelProfileId: ModelCapabilityProfileId,
  category: TrimmedNonEmptyString,
  sampleCount: NonNegativeInt,
  successCount: NonNegativeInt,
  failureCount: NonNegativeInt,
  retryCount: NonNegativeInt,
  totalLatencyMs: NonNegativeFinite,
  totalCostUsd: NonNegativeFinite,
  confidence: Confidence,
  revision: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type ModelTelemetryAggregate = typeof ModelTelemetryAggregate.Type;

export const ModelSelectionRankingEntry = Schema.Struct({
  modelId: ModelCapabilityProfileId,
  rank: PositiveInt,
  totalScore: Schema.Finite,
  objectiveScore: Schema.Finite,
  qualityScore: Schema.Finite,
  speedScore: Schema.Finite,
  costScore: Schema.Finite,
  contextScore: Schema.Finite,
  preferenceScore: Schema.Finite,
  telemetryScore: Schema.Finite,
  estimatedCostUsd: Schema.NullOr(NonNegativeFinite),
  capabilityMatches: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(128)),
  preferenceEffects: Schema.Array(BoundedText).check(Schema.isMaxLength(128)),
  telemetryApplied: Schema.Boolean,
});
export type ModelSelectionRankingEntry = typeof ModelSelectionRankingEntry.Type;

export const ModelSelectionReceipt = Schema.Struct({
  id: ModelSelectionReceiptId,
  workspaceId: SupervisedWorkspaceId,
  roomId: Schema.NullOr(RoomId),
  taskNodeId: Schema.NullOr(TaskNodeId),
  actorSeatId: AgentSeatId,
  selectedModelId: ModelCapabilityProfileId,
  candidateModelIds: Schema.Array(ModelCapabilityProfileId)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(128)),
  hardConstraints: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(128)),
  explanation: BoundedText,
  rejectedReasons: Schema.Record(ModelCapabilityProfileId, BoundedText),
  capabilityProfileRevision: NonNegativeInt,
  preferenceProfileRevision: NonNegativeInt,
  runPolicyRevision: NonNegativeInt,
  routingRevision: Schema.optional(NonNegativeInt).pipe(Schema.withDecodingDefault(() => 0)),
  rankedCandidates: Schema.optional(
    Schema.Array(ModelSelectionRankingEntry).check(Schema.isMaxLength(128)),
  ).pipe(Schema.withDecodingDefault(() => [])),
  fallbackFromReceiptId: Schema.optional(Schema.NullOr(ModelSelectionReceiptId)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  fallbackReason: Schema.optional(Schema.NullOr(BoundedText)).pipe(
    Schema.withDecodingDefault(() => null),
  ),
  overrideReason: Schema.NullOr(BoundedText),
  createdAt: IsoDateTime,
});
export type ModelSelectionReceipt = typeof ModelSelectionReceipt.Type;

/**
 * Canonical read slice for the profile, mission, and workflow configuration that
 * predates the Supervisor-first governance tables. `agentSeats` is a composed
 * read-only view; AgentSeat rows remain the sole durable actor records.
 */
export const SupervisedOrchestrationSnapshot = Schema.Struct({
  revision: NonNegativeInt,
  agentSeats: Schema.Array(AgentSeat).pipe(Schema.withDecodingDefault(() => [])),
  profiles: Schema.Array(ProfilePreset),
  profileSnapshots: Schema.Array(ProfileSnapshot),
  missions: Schema.Array(SupervisionMission),
  workflowDirectives: Schema.Array(WorkflowDirective),
  workflowConflicts: Schema.Array(WorkflowConflict),
  advice: Schema.Array(SupervisionAdvice),
  observationCursors: Schema.Array(SupervisionObservationCursor),
  wakeQueue: Schema.Array(SupervisionWake),
  rotations: Schema.Array(LeadRotation),
  updatedAt: IsoDateTime,
});
export type SupervisedOrchestrationSnapshot = typeof SupervisedOrchestrationSnapshot.Type;

export const SupervisedGovernanceAggregateId = entityId("SupervisedGovernanceAggregateId");
export type SupervisedGovernanceAggregateId = typeof SupervisedGovernanceAggregateId.Type;

export const SupervisedGovernanceActor = Schema.Struct({
  kind: Schema.Literals(["user", "thread", "server", "event", "scheduled"]),
  actorId: TrimmedNonEmptyString,
  threadId: Schema.optional(ThreadId),
});
export type SupervisedGovernanceActor = typeof SupervisedGovernanceActor.Type;

const supervisedGovernanceCommandBase = {
  commandId: CommandId,
  aggregateId: SupervisedGovernanceAggregateId,
  actor: SupervisedGovernanceActor,
  expectedRevision: Schema.Int,
  createdAt: IsoDateTime,
};

export const SupervisedGovernanceCommand = Schema.Union([
  Schema.Struct({
    ...supervisedGovernanceCommandBase,
    type: Schema.Literal("supervised.profile.create"),
    profile: ProfilePreset,
  }),
  Schema.Struct({
    ...supervisedGovernanceCommandBase,
    type: Schema.Literal("supervised.profile.update"),
    profile: ProfilePreset,
  }),
  Schema.Struct({
    ...supervisedGovernanceCommandBase,
    type: Schema.Literals([
      "supervised.profile.archive",
      "supervised.profile.restore",
      "supervised.profile.clear",
    ]),
    profileId: ProfilePresetId,
  }),
  Schema.Struct({
    ...supervisedGovernanceCommandBase,
    type: Schema.Literal("supervised.supervisor.create"),
    supervisor: SupervisorSeat,
    profilePresetId: ProfilePresetId,
    profileSnapshot: Schema.optional(ProfileSnapshot),
    initialMission: Schema.optional(SupervisionMission),
  }),
  Schema.Struct({
    ...supervisedGovernanceCommandBase,
    type: Schema.Literal("supervised.supervisor.update"),
    supervisor: SupervisorSeat,
  }),
  Schema.Struct({
    ...supervisedGovernanceCommandBase,
    type: Schema.Literals(["supervised.supervisor.archive", "supervised.supervisor.restore"]),
    supervisorSeatId: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    ...supervisedGovernanceCommandBase,
    type: Schema.Literal("supervised.lead.enroll"),
    lead: LeadSeat,
    profilePresetId: ProfilePresetId,
    profileSnapshot: Schema.optional(ProfileSnapshot),
  }),
  Schema.Struct({
    ...supervisedGovernanceCommandBase,
    type: Schema.Literal("supervised.peer.bind"),
    peer: PeerBinding,
    profilePresetId: ProfilePresetId,
    profileSnapshot: Schema.optional(ProfileSnapshot),
  }),
  Schema.Struct({
    ...supervisedGovernanceCommandBase,
    type: Schema.Literals([
      "supervised.mission.create",
      "supervised.mission.update",
      "supervised.mission.complete",
      "supervised.mission.cancel",
    ]),
    mission: SupervisionMission,
  }),
  Schema.Struct({
    ...supervisedGovernanceCommandBase,
    type: Schema.Literal("supervised.workflow.apply"),
    directive: WorkflowDirective,
  }),
  Schema.Struct({
    ...supervisedGovernanceCommandBase,
    type: Schema.Literal("supervised.workflow.resolve"),
    conflictId: TrimmedNonEmptyString,
    resolvedDirectiveId: WorkflowDirectiveId,
  }),
  Schema.Struct({
    ...supervisedGovernanceCommandBase,
    type: Schema.Literal("supervised.workflow.revoke"),
    directiveId: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    ...supervisedGovernanceCommandBase,
    type: Schema.Literal("supervised.advice.send"),
    advice: SupervisionAdvice,
  }),
  Schema.Struct({
    ...supervisedGovernanceCommandBase,
    type: Schema.Literal("supervised.observation.advance"),
    cursor: SupervisionObservationCursor,
  }),
  Schema.Struct({
    ...supervisedGovernanceCommandBase,
    type: Schema.Literal("supervised.wake.enqueue"),
    wake: SupervisionWake,
  }),
  Schema.Struct({
    ...supervisedGovernanceCommandBase,
    type: Schema.Literal("supervised.wake.update"),
    wake: SupervisionWake,
  }),
  Schema.Struct({
    ...supervisedGovernanceCommandBase,
    type: Schema.Literal("supervised.lead.replace"),
    rotation: LeadRotation,
    profilePresetId: ProfilePresetId,
    replacementProfileSnapshot: Schema.optional(ProfileSnapshot),
  }),
  Schema.Struct({
    ...supervisedGovernanceCommandBase,
    type: Schema.Literal("supervised.lead.rotation.advance"),
    rotation: LeadRotation,
  }),
]);
export type SupervisedGovernanceCommand = typeof SupervisedGovernanceCommand.Type;

export const SupervisedFirstSendBootstrap = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("lead"),
    profilePresetId: ProfilePresetId,
    profileSnapshot: Schema.optional(ProfileSnapshot),
    lead: LeadSeat,
  }),
  Schema.Struct({
    kind: Schema.Literal("supervisor"),
    profilePresetId: ProfilePresetId,
    profileSnapshot: Schema.optional(ProfileSnapshot),
    supervisor: SupervisorSeat,
    initialMission: SupervisionMission,
  }),
]);
export type SupervisedFirstSendBootstrap = typeof SupervisedFirstSendBootstrap.Type;

export const SupervisedGovernanceEventType = Schema.Literals([
  "supervised.profile-created",
  "supervised.profile-updated",
  "supervised.profile-archived",
  "supervised.profile-restored",
  "supervised.profile-cleared",
  "supervised.supervisor-created",
  "supervised.supervisor-updated",
  "supervised.supervisor-archived",
  "supervised.supervisor-restored",
  "supervised.lead-enrolled",
  "supervised.peer-bound",
  "supervised.mission-created",
  "supervised.mission-updated",
  "supervised.mission-completed",
  "supervised.mission-cancelled",
  "supervised.workflow-applied",
  "supervised.workflow-conflicted",
  "supervised.workflow-resolved",
  "supervised.workflow-reverted",
  "supervised.advice-sent",
  "supervised.observation-advanced",
  "supervised.wake-enqueued",
  "supervised.wake-updated",
  "supervised.lead-replacement-requested",
  "supervised.lead-rotation-advanced",
  "supervised.lead-replaced",
  "supervised.lead-replacement-failed",
]);
export type SupervisedGovernanceEventType = typeof SupervisedGovernanceEventType.Type;

export const SupervisedGovernanceEventPayload = Schema.Struct({
  acceptedRevision: Schema.Int,
  profile: Schema.optional(ProfilePreset),
  profileSnapshot: Schema.optional(ProfileSnapshot),
  supervisor: Schema.optional(SupervisorSeat),
  lead: Schema.optional(LeadSeat),
  peers: Schema.optional(Schema.Array(PeerBinding)),
  peer: Schema.optional(PeerBinding),
  mission: Schema.optional(SupervisionMission),
  workflowDirective: Schema.optional(WorkflowDirective),
  workflowConflict: Schema.optional(WorkflowConflict),
  advice: Schema.optional(SupervisionAdvice),
  observationCursor: Schema.optional(SupervisionObservationCursor),
  wake: Schema.optional(SupervisionWake),
  rotation: Schema.optional(LeadRotation),
});

export const SupervisedGovernanceDomainEvent = Schema.Struct({
  sequence: Schema.Int,
  eventId: EventId,
  aggregateKind: Schema.Literal("supervised_governance"),
  aggregateId: SupervisedGovernanceAggregateId,
  type: SupervisedGovernanceEventType,
  payload: SupervisedGovernanceEventPayload,
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
});
export type SupervisedGovernanceDomainEvent = typeof SupervisedGovernanceDomainEvent.Type;

export const emptySupervisedOrchestrationSnapshot = (
  updatedAt: string,
): SupervisedOrchestrationSnapshot => ({
  revision: 0,
  agentSeats: [],
  profiles: [],
  profileSnapshots: [],
  missions: [],
  workflowDirectives: [],
  workflowConflicts: [],
  advice: [],
  observationCursors: [],
  wakeQueue: [],
  rotations: [],
  updatedAt,
});

export const SupervisedGovernanceSnapshot = Schema.Struct({
  revision: NonNegativeInt,
  workspaces: Schema.Array(SupervisedWorkspace),
  agentSeats: Schema.Array(AgentSeat),
  providerSessions: Schema.Array(GovernedProviderSession).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  authorityReceipts: Schema.Array(EffectiveAuthorityReceipt),
  rootLeases: Schema.Array(RootAuthorityLease),
  handoffs: Schema.Array(GovernanceHandoff).pipe(Schema.withDecodingDefault(() => [])),
  roleAssumptions: Schema.Array(RoleAssumption).pipe(Schema.withDecodingDefault(() => [])),
  leadReplacements: Schema.Array(LeadReplacement).pipe(Schema.withDecodingDefault(() => [])),
  humanDirectives: Schema.Array(HumanDirective),
  standingMandates: Schema.Array(StandingMandate),
  directInterventions: Schema.Array(DirectIntervention),
  notebookEntries: Schema.Array(SupervisorNotebookEntry),
  notebookCursors: Schema.Array(SupervisorNotebookCursor).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  notebookCompactionReceipts: Schema.Array(SupervisorNotebookCompactionReceipt).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  modelCapabilityProfiles: Schema.Array(ModelCapabilityProfile),
  userModelPreferenceProfiles: Schema.Array(UserModelPreferenceProfile),
  modelTelemetryAggregates: Schema.Array(ModelTelemetryAggregate).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  modelSelectionReceipts: Schema.Array(ModelSelectionReceipt),
  orchestration: SupervisedOrchestrationSnapshot.pipe(
    Schema.withDecodingDefault(() =>
      emptySupervisedOrchestrationSnapshot(new Date(0).toISOString()),
    ),
  ),
  updatedAt: IsoDateTime,
});
export type SupervisedGovernanceSnapshot = typeof SupervisedGovernanceSnapshot.Type;

export const emptySupervisedGovernanceSnapshot = (
  updatedAt: string,
): SupervisedGovernanceSnapshot => ({
  revision: 0,
  workspaces: [],
  agentSeats: [],
  providerSessions: [],
  authorityReceipts: [],
  rootLeases: [],
  handoffs: [],
  roleAssumptions: [],
  leadReplacements: [],
  humanDirectives: [],
  standingMandates: [],
  directInterventions: [],
  notebookEntries: [],
  notebookCursors: [],
  notebookCompactionReceipts: [],
  modelCapabilityProfiles: [],
  userModelPreferenceProfiles: [],
  modelTelemetryAggregates: [],
  modelSelectionReceipts: [],
  orchestration: emptySupervisedOrchestrationSnapshot(updatedAt),
  updatedAt,
});
