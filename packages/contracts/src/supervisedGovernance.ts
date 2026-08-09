import { Schema } from "effect";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import { RoomId, TaskNodeId } from "./supervised";

const entityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));
const ShortText = TrimmedNonEmptyString.check(Schema.isMaxLength(512));
const BoundedText = Schema.String.check(Schema.isMaxLength(32_768));
const Confidence = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }));
const CapabilityScore = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 10 }));

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
export const ModelCapabilityProfileId = entityId("ModelCapabilityProfileId");
export type ModelCapabilityProfileId = typeof ModelCapabilityProfileId.Type;
export const UserModelPreferenceProfileId = entityId("UserModelPreferenceProfileId");
export type UserModelPreferenceProfileId = typeof UserModelPreferenceProfileId.Type;
export const ModelSelectionReceiptId = entityId("ModelSelectionReceiptId");
export type ModelSelectionReceiptId = typeof ModelSelectionReceiptId.Type;
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
  scope: Schema.Array(CanonicalAuthorityScope).check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)),
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
  scope: Schema.Array(CanonicalAuthorityScope).check(Schema.isMinLength(1)).check(Schema.isMaxLength(128)),
  status: HumanDirectiveStatus,
  sourceMessageId: Schema.NullOr(TrimmedNonEmptyString),
  issuedAt: IsoDateTime,
  fulfilledAt: Schema.NullOr(IsoDateTime),
  revokedAt: Schema.NullOr(IsoDateTime),
  revision: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type HumanDirective = typeof HumanDirective.Type;

export const StandingMandateStatus = Schema.Literals(["active", "paused", "fulfilled", "revoked", "expired"]);
export const StandingMandate = Schema.Struct({
  id: StandingMandateId,
  workspaceId: SupervisedWorkspaceId,
  sourceDirectiveId: HumanDirectiveId,
  subjectSeatId: Schema.NullOr(AgentSeatId),
  concern: ShortText,
  scope: Schema.Array(CanonicalAuthorityScope).check(Schema.isMinLength(1)).check(Schema.isMaxLength(128)),
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
  scores: ModelCapabilityScores,
  provenance: Schema.Array(TrimmedNonEmptyString).check(Schema.isMinLength(1)).check(Schema.isMaxLength(32)),
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
  updatedAt: IsoDateTime,
});
export type UserModelPreferenceProfile = typeof UserModelPreferenceProfile.Type;

export const ModelSelectionReceipt = Schema.Struct({
  id: ModelSelectionReceiptId,
  workspaceId: SupervisedWorkspaceId,
  roomId: Schema.NullOr(RoomId),
  taskNodeId: Schema.NullOr(TaskNodeId),
  actorSeatId: AgentSeatId,
  selectedModelId: ModelCapabilityProfileId,
  candidateModelIds: Schema.Array(ModelCapabilityProfileId).check(Schema.isMinLength(1)).check(Schema.isMaxLength(128)),
  hardConstraints: Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(128)),
  explanation: BoundedText,
  rejectedReasons: Schema.Record(ModelCapabilityProfileId, BoundedText),
  capabilityProfileRevision: NonNegativeInt,
  preferenceProfileRevision: NonNegativeInt,
  runPolicyRevision: NonNegativeInt,
  overrideReason: Schema.NullOr(BoundedText),
  createdAt: IsoDateTime,
});
export type ModelSelectionReceipt = typeof ModelSelectionReceipt.Type;

export const SupervisedGovernanceSnapshot = Schema.Struct({
  revision: NonNegativeInt,
  workspaces: Schema.Array(SupervisedWorkspace),
  agentSeats: Schema.Array(AgentSeat),
  providerSessions: Schema.optional(Schema.Array(GovernedProviderSession)).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  authorityReceipts: Schema.Array(EffectiveAuthorityReceipt),
  rootLeases: Schema.Array(RootAuthorityLease),
  handoffs: Schema.optional(Schema.Array(GovernanceHandoff)).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  roleAssumptions: Schema.optional(Schema.Array(RoleAssumption)).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  leadReplacements: Schema.optional(Schema.Array(LeadReplacement)).pipe(
    Schema.withDecodingDefault(() => []),
  ),
  humanDirectives: Schema.Array(HumanDirective),
  standingMandates: Schema.Array(StandingMandate),
  directInterventions: Schema.Array(DirectIntervention),
  notebookEntries: Schema.Array(SupervisorNotebookEntry),
  modelCapabilityProfiles: Schema.Array(ModelCapabilityProfile),
  userModelPreferenceProfiles: Schema.Array(UserModelPreferenceProfile),
  modelSelectionReceipts: Schema.Array(ModelSelectionReceipt),
  updatedAt: IsoDateTime,
});
export type SupervisedGovernanceSnapshot = typeof SupervisedGovernanceSnapshot.Type;

export const emptySupervisedGovernanceSnapshot = (updatedAt: string): SupervisedGovernanceSnapshot => ({
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
  modelCapabilityProfiles: [],
  userModelPreferenceProfiles: [],
  modelSelectionReceipts: [],
  updatedAt,
});
