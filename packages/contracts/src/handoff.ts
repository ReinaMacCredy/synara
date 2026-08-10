import { Schema } from "effect";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas";
const HandoffProviderKind = Schema.Literals([
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

const makeHandoffId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));
const ShortText = TrimmedNonEmptyString.check(Schema.isMaxLength(2_048));
const BoundedText = TrimmedNonEmptyString.check(Schema.isMaxLength(32_768));
const OptionalGuidance = TrimmedString.check(Schema.isMaxLength(4_096));
const SourceRef = TrimmedNonEmptyString.check(Schema.isMaxLength(1_024));
const PreparationProgressPercent = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }));
const HandoffModel = TrimmedNonEmptyString.check(Schema.isMaxLength(256));

export const HandoffId = makeHandoffId("HandoffId");
export type HandoffId = typeof HandoffId.Type;
export const HandoffAttemptId = makeHandoffId("HandoffAttemptId");
export type HandoffAttemptId = typeof HandoffAttemptId.Type;
export const HandoffGrantId = makeHandoffId("HandoffGrantId");
export type HandoffGrantId = typeof HandoffGrantId.Type;

export const HandoffConversationMode = Schema.Literals(["project", "supervised"]);
export type HandoffConversationMode = typeof HandoffConversationMode.Type;

export const HandoffRuntimeSelection = Schema.Struct({
  provider: HandoffProviderKind,
  model: HandoffModel,
  effort: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
});
export type HandoffRuntimeSelection = typeof HandoffRuntimeSelection.Type;

export const HandoffSourceReference = Schema.Struct({
  ref: SourceRef,
  kind: Schema.Literals(["message", "note", "artifact", "activity", "thread"]),
  label: ShortText,
});
export type HandoffSourceReference = typeof HandoffSourceReference.Type;

export const HandoffClaim = Schema.Struct({
  text: BoundedText,
  claimType: Schema.Literals(["fact", "inference", "recommendation"]),
  citations: Schema.Array(SourceRef).check(Schema.isMaxLength(64)),
});
export type HandoffClaim = typeof HandoffClaim.Type;

const HandoffClaims = Schema.Array(HandoffClaim).check(Schema.isMaxLength(128));

export const HandoffPacketProvenanceV1 = Schema.Struct({
  sourceThreadId: ThreadId,
  sourceMode: HandoffConversationMode,
  destinationMode: HandoffConversationMode,
  sourceCursor: NonNegativeInt,
  sourceDigest: TrimmedNonEmptyString,
  capsuleHash: TrimmedNonEmptyString,
  runtime: HandoffRuntimeSelection,
  settingsRevision: NonNegativeInt,
  coreInstructionVersion: Schema.Literal(1),
  coreInstructionHash: TrimmedNonEmptyString,
  ownerGuidanceHash: TrimmedNonEmptyString,
  handoffPromptHash: TrimmedNonEmptyString,
  attemptId: HandoffAttemptId,
  packetRevision: Schema.Literal(1),
});
export type HandoffPacketProvenanceV1 = typeof HandoffPacketProvenanceV1.Type;

export const HandoffPacketV1 = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  objective: HandoffClaim,
  ownerConstraints: HandoffClaims,
  currentState: HandoffClaims,
  progress: HandoffClaims,
  decisions: Schema.Struct({
    accepted: HandoffClaims,
    rejected: HandoffClaims,
    disputed: HandoffClaims,
    superseded: HandoffClaims,
  }),
  verification: HandoffClaims,
  failedAttempts: HandoffClaims,
  blockers: HandoffClaims,
  risks: HandoffClaims,
  dissent: HandoffClaims,
  openQuestions: HandoffClaims,
  nextActions: HandoffClaims,
  omissions: Schema.Array(BoundedText).check(Schema.isMaxLength(128)),
  citations: Schema.Array(HandoffSourceReference).check(Schema.isMaxLength(256)),
  provenance: HandoffPacketProvenanceV1,
});
export type HandoffPacketV1 = typeof HandoffPacketV1.Type;

export const HandoffCapsuleItemV1 = Schema.Struct({
  ref: SourceRef,
  role: Schema.Literals(["user", "assistant", "note", "activity"]),
  text: BoundedText,
  createdAt: IsoDateTime,
});
export type HandoffCapsuleItemV1 = typeof HandoffCapsuleItemV1.Type;

export const HandoffCapsuleV1 = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  sourceThreadId: ThreadId,
  sourceTitle: ShortText,
  sourceMode: HandoffConversationMode,
  sourceProvider: HandoffProviderKind,
  projectId: ProjectId,
  projectTitle: ShortText,
  workspaceRoot: TrimmedNonEmptyString,
  environment: Schema.Struct({
    mode: Schema.Literals(["local", "worktree"]),
    branch: Schema.NullOr(Schema.String),
    worktreePath: Schema.NullOr(Schema.String),
  }),
  sourceCursor: NonNegativeInt,
  sourceDigest: TrimmedNonEmptyString,
  items: Schema.Array(HandoffCapsuleItemV1).check(Schema.isMaxLength(32)),
  omissions: Schema.Array(BoundedText).check(Schema.isMaxLength(64)),
  sealedAt: IsoDateTime,
  capsuleHash: TrimmedNonEmptyString,
});
export type HandoffCapsuleV1 = typeof HandoffCapsuleV1.Type;

export const HandoffPreparationState = Schema.Literals([
  "preparing",
  "ready",
  "failed",
  "cancelled",
  "interrupted",
]);
export type HandoffPreparationState = typeof HandoffPreparationState.Type;

export const HandoffPreparationSnapshot = Schema.Struct({
  attemptId: HandoffAttemptId,
  handoffId: HandoffId,
  destinationDraftThreadId: ThreadId,
  state: HandoffPreparationState,
  phase: ShortText,
  progressPercent: PreparationProgressPercent,
  runtime: HandoffRuntimeSelection,
  settingsRevision: NonNegativeInt,
  capsule: HandoffCapsuleV1,
  handoffPrompt: OptionalGuidance,
  packet: Schema.NullOr(HandoffPacketV1),
  error: Schema.NullOr(BoundedText),
  startedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type HandoffPreparationSnapshot = typeof HandoffPreparationSnapshot.Type;

export const HandoffDraftV1 = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  handoffId: HandoffId,
  sourceThreadId: ThreadId,
  sourceTitle: ShortText,
  sourceMode: HandoffConversationMode,
  destinationMode: HandoffConversationMode,
  sourceProvider: HandoffProviderKind,
  sourceCursor: NonNegativeInt,
  sourceDigest: TrimmedNonEmptyString,
  capsule: HandoffCapsuleV1,
  handoffPrompt: OptionalGuidance,
  attemptId: Schema.NullOr(HandoffAttemptId),
  preparationState: HandoffPreparationState,
  preparationPhase: ShortText,
  preparationProgressPercent: Schema.optionalKey(PreparationProgressPercent),
  runtime: HandoffRuntimeSelection,
  settingsRevision: NonNegativeInt,
  packet: Schema.NullOr(HandoffPacketV1),
  error: Schema.NullOr(BoundedText),
  sourceLinkOnly: Schema.Boolean,
  stagedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type HandoffDraftV1 = typeof HandoffDraftV1.Type;

export const HandoffSourceReadGrant = Schema.Struct({
  grantId: HandoffGrantId,
  handoffId: HandoffId,
  sourceThreadId: ThreadId,
  destinationThreadId: ThreadId,
  projectId: ProjectId,
  allowedViews: Schema.Array(
    Schema.Literals([
      "status",
      "last_message",
      "tail_since_cursor",
      "transcript",
      "artifacts",
      "activity",
    ]),
  ).check(Schema.isMaxLength(8)),
  grantedThroughCursor: NonNegativeInt,
  status: Schema.Literals(["active", "suspended", "revoked"]),
  revision: PositiveInt,
  createdAt: IsoDateTime,
  lastAccessedAt: Schema.NullOr(IsoDateTime),
  revokedAt: Schema.NullOr(IsoDateTime),
});
export type HandoffSourceReadGrant = typeof HandoffSourceReadGrant.Type;

export const AcceptedCrossModeHandoffV1 = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  handoffId: HandoffId,
  sourceTitle: ShortText,
  sourceMode: HandoffConversationMode,
  destinationMode: HandoffConversationMode,
  sourceCursor: NonNegativeInt,
  sourceDigest: TrimmedNonEmptyString,
  capsule: HandoffCapsuleV1,
  handoffPrompt: OptionalGuidance,
  packet: Schema.NullOr(HandoffPacketV1),
  sourceLinkOnly: Schema.Boolean,
  grant: HandoffSourceReadGrant,
});
export type AcceptedCrossModeHandoffV1 = typeof AcceptedCrossModeHandoffV1.Type;

export const StartHandoffPreparationInput = Schema.Struct({
  sourceThreadId: ThreadId,
  destinationDraftThreadId: ThreadId,
  destinationMode: HandoffConversationMode,
  handoffPrompt: OptionalGuidance,
  runtime: Schema.optionalKey(HandoffRuntimeSelection),
  sealedCapsule: Schema.optionalKey(HandoffCapsuleV1),
});
export type StartHandoffPreparationInput = typeof StartHandoffPreparationInput.Type;

export const GetHandoffPreparationInput = Schema.Struct({
  attemptId: HandoffAttemptId,
});
export type GetHandoffPreparationInput = typeof GetHandoffPreparationInput.Type;

export const CancelHandoffPreparationInput = GetHandoffPreparationInput;
export type CancelHandoffPreparationInput = typeof CancelHandoffPreparationInput.Type;

export const ListHandoffGrantsInput = Schema.Struct({});
export type ListHandoffGrantsInput = typeof ListHandoffGrantsInput.Type;
export const ListHandoffGrantsResult = Schema.Struct({
  items: Schema.Array(HandoffSourceReadGrant),
});
export type ListHandoffGrantsResult = typeof ListHandoffGrantsResult.Type;

export const RevokeHandoffGrantInput = Schema.Struct({ grantId: HandoffGrantId });
export type RevokeHandoffGrantInput = typeof RevokeHandoffGrantInput.Type;
export const RevokeHandoffGrantResult = Schema.Struct({ revoked: Schema.Boolean });
export type RevokeHandoffGrantResult = typeof RevokeHandoffGrantResult.Type;
