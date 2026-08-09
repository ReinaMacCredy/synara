import { Schema } from "effect";

import { IsoDateTime, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas";
import {
  EffectiveAgentRole,
  SupervisedWorkspaceId,
  SupervisedGovernanceSnapshot,
  UserModelPreferenceProfile,
} from "./supervisedGovernance";
import {
  SupervisedIntentToolId,
  SupervisedInternalCommandId,
  SupervisedToolInvocationReceipt,
} from "./supervisedTools";
import { RoomId, SupervisedRuntimeSnapshot, TaskNodeId } from "./supervised";

const BoundedText = Schema.String.check(Schema.isMaxLength(32_768));

export const SupervisedToolPolicyState = Schema.Literals(["enabled", "disabled", "revoked"]);
export type SupervisedToolPolicyState = typeof SupervisedToolPolicyState.Type;

export const SupervisedSystemToolHealth = Schema.Literals([
  "healthy",
  "disabled",
  "revoked",
  "adapter_unavailable",
]);
export type SupervisedSystemToolHealth = typeof SupervisedSystemToolHealth.Type;

export const SupervisedToolPolicy = Schema.Struct({
  toolId: SupervisedIntentToolId,
  state: SupervisedToolPolicyState,
  revision: NonNegativeInt,
  reason: Schema.NullOr(BoundedText),
  updatedAt: IsoDateTime,
  revokedAt: Schema.NullOr(IsoDateTime),
});
export type SupervisedToolPolicy = typeof SupervisedToolPolicy.Type;

export const SupervisedSystemTool = Schema.Struct({
  id: SupervisedIntentToolId,
  providerToolNames: Schema.Array(TrimmedNonEmptyString),
  displayName: TrimmedNonEmptyString,
  description: Schema.String,
  schemaVersion: TrimmedNonEmptyString,
  source: TrimmedNonEmptyString,
  readOnly: Schema.Boolean,
  allowedRoles: Schema.Array(EffectiveAgentRole),
  internalCommands: Schema.Array(SupervisedInternalCommandId),
  providerSupport: Schema.Struct({
    codex: Schema.Literals(["native", "unsupported"]),
    claude: Schema.Literals(["native", "unsupported"]),
  }),
  allowedScopes: Schema.Struct({
    workspaceIds: Schema.Array(SupervisedWorkspaceId),
    roomIds: Schema.Array(RoomId),
    taskNodeIds: Schema.Array(TaskNodeId),
  }),
  policy: SupervisedToolPolicy,
  health: SupervisedSystemToolHealth,
  lastInvocation: Schema.NullOr(SupervisedToolInvocationReceipt),
  successCount: NonNegativeInt,
  failureCount: NonNegativeInt,
});
export type SupervisedSystemTool = typeof SupervisedSystemTool.Type;

export const GetSupervisedSettingsInput = Schema.Struct({});
export type GetSupervisedSettingsInput = typeof GetSupervisedSettingsInput.Type;

export const SupervisedSettingsSnapshot = Schema.Struct({
  governance: SupervisedGovernanceSnapshot,
  runtime: SupervisedRuntimeSnapshot,
  tools: Schema.Array(SupervisedSystemTool),
  updatedAt: IsoDateTime,
});
export type SupervisedSettingsSnapshot = typeof SupervisedSettingsSnapshot.Type;

export const PutSupervisedModelPreferencesInput = Schema.Struct({
  profile: UserModelPreferenceProfile,
  expectedRevision: Schema.NullOr(NonNegativeInt),
});
export type PutSupervisedModelPreferencesInput =
  typeof PutSupervisedModelPreferencesInput.Type;

export const PutSupervisedModelPreferencesResult = Schema.Struct({
  profile: UserModelPreferenceProfile,
  routingRevision: NonNegativeInt,
});
export type PutSupervisedModelPreferencesResult =
  typeof PutSupervisedModelPreferencesResult.Type;

export const UpdateSupervisedToolPolicyInput = Schema.Struct({
  toolId: SupervisedIntentToolId,
  state: SupervisedToolPolicyState,
  reason: Schema.NullOr(BoundedText),
  expectedRevision: NonNegativeInt,
});
export type UpdateSupervisedToolPolicyInput = typeof UpdateSupervisedToolPolicyInput.Type;

export const UpdateSupervisedToolPolicyResult = Schema.Struct({
  policy: SupervisedToolPolicy,
});
export type UpdateSupervisedToolPolicyResult = typeof UpdateSupervisedToolPolicyResult.Type;
