import { Schema } from "effect";

import {
  CommandId,
  EventId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  SpaceId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";

const entityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));
const ShortText = TrimmedNonEmptyString.check(Schema.isMaxLength(512));

export const ProfilePresetId = entityId("ProfilePresetId");
export type ProfilePresetId = typeof ProfilePresetId.Type;
export const ProfileSnapshotId = entityId("ProfileSnapshotId");
export type ProfileSnapshotId = typeof ProfileSnapshotId.Type;
export const SupervisorSeatId = entityId("SupervisorSeatId");
export type SupervisorSeatId = typeof SupervisorSeatId.Type;
export const LeadSeatId = entityId("LeadSeatId");
export type LeadSeatId = typeof LeadSeatId.Type;
export const RootHolderSeatId = Schema.Union([LeadSeatId, SupervisorSeatId]);
export type RootHolderSeatId = typeof RootHolderSeatId.Type;
export const SupervisionMissionId = entityId("SupervisionMissionId");
export type SupervisionMissionId = typeof SupervisionMissionId.Type;
export const WorkflowDirectiveId = entityId("WorkflowDirectiveId");
export type WorkflowDirectiveId = typeof WorkflowDirectiveId.Type;
export const WorkflowConflictId = entityId("WorkflowConflictId");
export type WorkflowConflictId = typeof WorkflowConflictId.Type;
export const SupervisionAdviceId = entityId("SupervisionAdviceId");
export type SupervisionAdviceId = typeof SupervisionAdviceId.Type;
export const SupervisionObservationId = entityId("SupervisionObservationId");
export type SupervisionObservationId = typeof SupervisionObservationId.Type;
export const LeadRotationId = entityId("LeadRotationId");
export type LeadRotationId = typeof LeadRotationId.Type;
export const SupervisionAggregateId = entityId("SupervisionAggregateId");
export type SupervisionAggregateId = typeof SupervisionAggregateId.Type;

export const SupervisionDraftMode = Schema.Literals(["orchestrate", "supervise"]);
export type SupervisionDraftMode = typeof SupervisionDraftMode.Type;
export const DEFAULT_SUPERVISION_DRAFT_MODE: SupervisionDraftMode = "orchestrate";

export const RoomRole = Schema.Literals(["supervisor", "lead", "peer"]);
export type RoomRole = typeof RoomRole.Type;

export const ProfileProviderKind = Schema.Literals([
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
export type ProfileProviderKind = typeof ProfileProviderKind.Type;

export const ProfileSandboxMode = Schema.Literals([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);
export type ProfileSandboxMode = typeof ProfileSandboxMode.Type;
export const ProfileApprovalPolicy = Schema.Literals([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);
export type ProfileApprovalPolicy = typeof ProfileApprovalPolicy.Type;

export const ProfileRuntimeConfig = Schema.Struct({
  provider: ProfileProviderKind,
  model: TrimmedNonEmptyString,
  reasoningEffort: Schema.NullOr(TrimmedNonEmptyString),
  sandboxMode: ProfileSandboxMode,
  approvalPolicy: ProfileApprovalPolicy,
  developerInstructions: Schema.String,
  providerOptions: Schema.optional(Schema.Unknown),
});
export type ProfileRuntimeConfig = typeof ProfileRuntimeConfig.Type;

export const ProfilePreset = Schema.Struct({
  id: ProfilePresetId,
  name: TrimmedNonEmptyString,
  roleHints: Schema.Array(RoomRole),
  runtime: ProfileRuntimeConfig,
  isDefault: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime),
  clearedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  revision: Schema.Int,
});
export type ProfilePreset = typeof ProfilePreset.Type;

export const ProfileSnapshot = Schema.Struct({
  id: ProfileSnapshotId,
  sourcePresetId: Schema.NullOr(ProfilePresetId),
  sourcePresetName: TrimmedNonEmptyString,
  runtime: ProfileRuntimeConfig,
  contentHash: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});
export type ProfileSnapshot = typeof ProfileSnapshot.Type;

export const SupervisorSeatStatus = Schema.Literals(["active", "queued", "rotating", "archived"]);
export const SupervisorSeat = Schema.Struct({
  id: SupervisorSeatId,
  name: TrimmedNonEmptyString,
  concern: Schema.optional(ShortText),
  isPrimary: Schema.optional(Schema.Boolean),
  activeThreadId: ThreadId,
  predecessorThreadIds: Schema.Array(ThreadId),
  profileSnapshotId: ProfileSnapshotId,
  status: SupervisorSeatStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime),
  revision: Schema.Int,
});
export type SupervisorSeat = typeof SupervisorSeat.Type;

export const LeadSeatStatus = Schema.Literals(["active", "rotating", "vacant", "archived"]);
export const LeadSeat = Schema.Struct({
  id: LeadSeatId,
  projectId: ProjectId,
  activeThreadId: ThreadId,
  predecessorThreadIds: Schema.Array(ThreadId),
  profileSnapshotId: ProfileSnapshotId,
  status: LeadSeatStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime),
  revision: Schema.Int,
});
export type LeadSeat = typeof LeadSeat.Type;

export const PeerBinding = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  leadSeatId: RootHolderSeatId,
  rootThreadId: ThreadId,
  profileSnapshotId: ProfileSnapshotId,
  status: Schema.Literals(["active", "archived"]),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime),
  revision: Schema.Int,
});
export type PeerBinding = typeof PeerBinding.Type;

export const MissionScope = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("all_projects") }),
  Schema.Struct({ kind: Schema.Literal("space"), spaceId: SpaceId }),
  Schema.Struct({ kind: Schema.Literal("project"), projectId: ProjectId }),
  Schema.Struct({ kind: Schema.Literal("lead"), leadSeatId: LeadSeatId }),
]);
export type MissionScope = typeof MissionScope.Type;
export const MissionScopeList = Schema.Array(MissionScope).check(Schema.isMinLength(1));
export type MissionScopeList = typeof MissionScopeList.Type;

export const MissionGrant = Schema.Literals([
  "lead.observe",
  "lead.advise",
  "lead.pause",
  "lead.resume",
  "workflow.apply",
  "workflow.revoke",
  "lead.replace",
  "lead.close",
]);
export type MissionGrant = typeof MissionGrant.Type;

export const MissionEndCondition = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("manual") }),
  Schema.Struct({ kind: Schema.Literal("timestamp"), endsAt: IsoDateTime }),
  Schema.Struct({ kind: Schema.Literal("domain_event"), eventType: TrimmedNonEmptyString }),
]);
export type MissionEndCondition = typeof MissionEndCondition.Type;

export const SupervisionMission = Schema.Struct({
  id: SupervisionMissionId,
  supervisorSeatId: SupervisorSeatId,
  brief: TrimmedNonEmptyString,
  focus: TrimmedNonEmptyString,
  scope: MissionScopeList,
  grants: Schema.Array(MissionGrant),
  endCondition: MissionEndCondition,
  status: Schema.Literals(["active", "paused", "completed", "expired", "cancelled"]),
  sourceMessageId: Schema.NullOr(MessageId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  revision: Schema.Int,
});
export type SupervisionMission = typeof SupervisionMission.Type;

export const WorkflowDirective = Schema.Struct({
  id: WorkflowDirectiveId,
  supervisorSeatId: SupervisorSeatId,
  leadSeatId: LeadSeatId,
  missionId: SupervisionMissionId,
  slot: TrimmedNonEmptyString,
  instruction: TrimmedNonEmptyString,
  status: Schema.Literals(["active", "superseded", "reverted", "conflicted"]),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  revision: Schema.Int,
});
export type WorkflowDirective = typeof WorkflowDirective.Type;

export const WorkflowConflict = Schema.Struct({
  id: WorkflowConflictId,
  leadSeatId: LeadSeatId,
  slot: TrimmedNonEmptyString,
  directiveIds: Schema.Array(WorkflowDirectiveId),
  status: Schema.Literals(["open", "resolved"]),
  resolvedDirectiveId: Schema.NullOr(WorkflowDirectiveId),
  createdAt: IsoDateTime,
  resolvedAt: Schema.NullOr(IsoDateTime),
});
export type WorkflowConflict = typeof WorkflowConflict.Type;

export const SupervisionAdvice = Schema.Struct({
  id: SupervisionAdviceId,
  supervisorSeatId: SupervisorSeatId,
  leadSeatId: LeadSeatId,
  missionId: SupervisionMissionId,
  text: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});
export type SupervisionAdvice = typeof SupervisionAdvice.Type;

export const SupervisionObservationCursor = Schema.Struct({
  id: SupervisionObservationId,
  missionId: SupervisionMissionId,
  leadSeatId: LeadSeatId,
  lastSequence: Schema.Int,
  updatedAt: IsoDateTime,
});
export type SupervisionObservationCursor = typeof SupervisionObservationCursor.Type;

export const SupervisionWakePointer = Schema.Struct({
  sequence: Schema.Int,
  eventType: TrimmedNonEmptyString,
  aggregateKind: TrimmedNonEmptyString,
  aggregateId: TrimmedNonEmptyString,
});
export type SupervisionWakePointer = typeof SupervisionWakePointer.Type;

export const SupervisionWake = Schema.Struct({
  id: SupervisionObservationId,
  missionId: SupervisionMissionId,
  supervisorSeatId: SupervisorSeatId,
  leadSeatId: LeadSeatId,
  episodeKind: TrimmedNonEmptyString,
  pointers: Schema.Array(SupervisionWakePointer),
  status: Schema.Literals(["queued", "dispatching", "delivered", "failed"]),
  attemptCount: Schema.Int,
  error: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type SupervisionWake = typeof SupervisionWake.Type;

export const LeadRotation = Schema.Struct({
  id: LeadRotationId,
  leadSeatId: LeadSeatId,
  missionId: Schema.NullOr(SupervisionMissionId),
  predecessorThreadId: ThreadId,
  replacementThreadId: ThreadId,
  replacementProfileSnapshotId: ProfileSnapshotId,
  state: Schema.Literals([
    "requested",
    "frozen",
    "replacement_created",
    "validated",
    "switched",
    "completed",
    "failed",
  ]),
  error: Schema.NullOr(Schema.String),
  handoffSummary: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  revision: Schema.Int,
});
export type LeadRotation = typeof LeadRotation.Type;

// TODO(veylen): Remove this legacy supervision schema envelope on or after 2027-08-09
// once every supported database has replayed migration 108. New runtime traffic uses
// the canonical schemas in supervisedGovernance.ts.
export const SupervisionSnapshot = Schema.Struct({
  snapshotSequence: Schema.Int,
  profiles: Schema.Array(ProfilePreset),
  profileSnapshots: Schema.Array(ProfileSnapshot),
  supervisors: Schema.Array(SupervisorSeat),
  leads: Schema.Array(LeadSeat),
  peers: Schema.optional(Schema.Array(PeerBinding)).pipe(Schema.withDecodingDefault(() => [])),
  missions: Schema.Array(SupervisionMission),
  workflowDirectives: Schema.Array(WorkflowDirective),
  workflowConflicts: Schema.Array(WorkflowConflict),
  advice: Schema.Array(SupervisionAdvice),
  observationCursors: Schema.Array(SupervisionObservationCursor),
  wakeQueue: Schema.Array(SupervisionWake),
  rotations: Schema.Array(LeadRotation),
  updatedAt: IsoDateTime,
});
export type SupervisionSnapshot = typeof SupervisionSnapshot.Type;

export const emptySupervisionSnapshot = (updatedAt: string): SupervisionSnapshot => ({
  snapshotSequence: 0,
  profiles: [],
  profileSnapshots: [],
  supervisors: [],
  leads: [],
  peers: [],
  missions: [],
  workflowDirectives: [],
  workflowConflicts: [],
  advice: [],
  observationCursors: [],
  wakeQueue: [],
  rotations: [],
  updatedAt,
});

export const SupervisionActor = Schema.Struct({
  kind: Schema.Literals(["user", "thread", "server", "event", "scheduled"]),
  actorId: TrimmedNonEmptyString,
  threadId: Schema.optional(ThreadId),
});
export type SupervisionActor = typeof SupervisionActor.Type;

const commandBase = {
  commandId: CommandId,
  aggregateId: SupervisionAggregateId,
  actor: SupervisionActor,
  expectedRevision: Schema.Int,
  createdAt: IsoDateTime,
};

export const SupervisionCommand = Schema.Union([
  Schema.Struct({
    ...commandBase,
    type: Schema.Literal("supervision.profile.create"),
    profile: ProfilePreset,
  }),
  Schema.Struct({
    ...commandBase,
    type: Schema.Literal("supervision.profile.update"),
    profile: ProfilePreset,
  }),
  Schema.Struct({
    ...commandBase,
    type: Schema.Literals([
      "supervision.profile.archive",
      "supervision.profile.restore",
      "supervision.profile.clear",
    ]),
    profileId: ProfilePresetId,
  }),
  Schema.Struct({
    ...commandBase,
    type: Schema.Literal("supervision.supervisor.create"),
    supervisor: SupervisorSeat,
    profilePresetId: ProfilePresetId,
    profileSnapshot: Schema.optional(ProfileSnapshot),
    initialMission: Schema.optional(SupervisionMission),
  }),
  Schema.Struct({
    ...commandBase,
    type: Schema.Literal("supervision.supervisor.update"),
    supervisor: SupervisorSeat,
  }),
  Schema.Struct({
    ...commandBase,
    type: Schema.Literals(["supervision.supervisor.archive", "supervision.supervisor.restore"]),
    supervisorSeatId: SupervisorSeatId,
  }),
  Schema.Struct({
    ...commandBase,
    type: Schema.Literal("supervision.lead.enroll"),
    lead: LeadSeat,
    profilePresetId: ProfilePresetId,
    profileSnapshot: Schema.optional(ProfileSnapshot),
  }),
  Schema.Struct({
    ...commandBase,
    type: Schema.Literal("supervision.peer.bind"),
    peer: PeerBinding,
    profilePresetId: ProfilePresetId,
    profileSnapshot: Schema.optional(ProfileSnapshot),
  }),
  Schema.Struct({
    ...commandBase,
    type: Schema.Literals([
      "supervision.mission.create",
      "supervision.mission.update",
      "supervision.mission.complete",
      "supervision.mission.cancel",
    ]),
    mission: SupervisionMission,
  }),
  Schema.Struct({
    ...commandBase,
    type: Schema.Literal("supervision.workflow.apply"),
    directive: WorkflowDirective,
  }),
  Schema.Struct({
    ...commandBase,
    type: Schema.Literal("supervision.workflow.resolve"),
    conflictId: WorkflowConflictId,
    resolvedDirectiveId: WorkflowDirectiveId,
  }),
  Schema.Struct({
    ...commandBase,
    type: Schema.Literal("supervision.workflow.revoke"),
    directiveId: WorkflowDirectiveId,
  }),
  Schema.Struct({
    ...commandBase,
    type: Schema.Literal("supervision.advice.send"),
    advice: SupervisionAdvice,
  }),
  Schema.Struct({
    ...commandBase,
    type: Schema.Literal("supervision.observation.advance"),
    cursor: SupervisionObservationCursor,
  }),
  Schema.Struct({
    ...commandBase,
    type: Schema.Literal("supervision.wake.enqueue"),
    wake: SupervisionWake,
  }),
  Schema.Struct({
    ...commandBase,
    type: Schema.Literal("supervision.wake.update"),
    wake: SupervisionWake,
  }),
  Schema.Struct({
    ...commandBase,
    type: Schema.Literal("supervision.lead.replace"),
    rotation: LeadRotation,
    profilePresetId: ProfilePresetId,
    replacementProfileSnapshot: Schema.optional(ProfileSnapshot),
  }),
  Schema.Struct({
    ...commandBase,
    type: Schema.Literal("supervision.lead.rotation.advance"),
    rotation: LeadRotation,
  }),
]);
export type SupervisionCommand = typeof SupervisionCommand.Type;

export const SupervisionFirstSendBootstrap = Schema.Union([
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
export type SupervisionFirstSendBootstrap = typeof SupervisionFirstSendBootstrap.Type;

export const SupervisionPeerBootstrap = Schema.Struct({
  profilePresetId: ProfilePresetId,
  profileSnapshot: Schema.optional(ProfileSnapshot),
  peer: PeerBinding,
});
export type SupervisionPeerBootstrap = typeof SupervisionPeerBootstrap.Type;

export const SupervisionEventType = Schema.Literals([
  "supervision.profile-created",
  "supervision.profile-updated",
  "supervision.profile-archived",
  "supervision.profile-restored",
  "supervision.profile-cleared",
  "supervision.supervisor-created",
  "supervision.supervisor-updated",
  "supervision.supervisor-archived",
  "supervision.supervisor-restored",
  "supervision.lead-enrolled",
  "supervision.peer-bound",
  "supervision.mission-created",
  "supervision.mission-updated",
  "supervision.mission-completed",
  "supervision.mission-cancelled",
  "supervision.workflow-applied",
  "supervision.workflow-conflicted",
  "supervision.workflow-resolved",
  "supervision.workflow-reverted",
  "supervision.advice-sent",
  "supervision.observation-advanced",
  "supervision.wake-enqueued",
  "supervision.wake-updated",
  "supervision.lead-replacement-requested",
  "supervision.lead-rotation-advanced",
  "supervision.lead-replaced",
  "supervision.lead-replacement-failed",
]);
export type SupervisionEventType = typeof SupervisionEventType.Type;

export const SupervisionEventPayload = Schema.Struct({
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

export const SupervisionDomainEvent = Schema.Struct({
  sequence: Schema.Int,
  eventId: EventId,
  aggregateKind: Schema.Literal("supervision"),
  aggregateId: SupervisionAggregateId,
  type: SupervisionEventType,
  payload: SupervisionEventPayload,
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
});
export type SupervisionDomainEvent = typeof SupervisionDomainEvent.Type;

export const ProviderSupervisedSessionContext = Schema.Struct({
  role: RoomRole,
  supervisorSeatId: Schema.optional(SupervisorSeatId),
  leadSeatId: Schema.optional(LeadSeatId),
  profileSnapshot: ProfileSnapshot,
  missionIds: Schema.Array(SupervisionMissionId),
  agentSeatId: Schema.optional(TrimmedNonEmptyString),
  workspaceId: Schema.optional(TrimmedNonEmptyString),
  roomIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  effectiveRole: Schema.optional(Schema.Union([RoomRole, Schema.Literal("acting_root")])),
  authorityReceiptId: Schema.optional(TrimmedNonEmptyString),
  allowedTools: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  allowedCommands: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  rootLeaseIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  mandateIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  runPolicyRevision: Schema.optional(NonNegativeInt),
});
export type ProviderSupervisedSessionContext = typeof ProviderSupervisedSessionContext.Type;
