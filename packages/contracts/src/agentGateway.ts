/**
 * Public contracts for the Veylen agent-control gateway.
 *
 * New gateway tools decode these schemas before doing any work. Keeping the
 * limits here ensures the MCP surface, server implementation, and tests share
 * the same definition of an exact creation/wait plan.
 */
import { Schema } from "effect";

import { ProjectId, ThreadId, TurnId } from "./baseSchemas";
import { ModelSelection, ProviderKind } from "./orchestration";
import { ProviderModelDescriptor } from "./providerDiscovery";
import { ServerProviderAuthStatus } from "./server";

export const VEYLEN_GATEWAY_MAX_THREADS_PER_OPERATION = 20;
export const VEYLEN_GATEWAY_MAX_REQUEST_ID_LENGTH = 256;
export const VEYLEN_GATEWAY_MAX_WAIT_MS = 60_000;

export const VeylenGatewayErrorCode = Schema.Literals([
  "caller_session_inactive",
  "caller_turn_inactive",
  "capability_denied",
  "provider_unavailable",
  "model_unavailable",
  "model_option_unavailable",
  "idempotency_conflict",
  "creation_plan_locked",
  "creation_limit_exceeded",
  "thread_not_found",
  "wait_timed_out",
  "operation_failed",
]);
export type VeylenGatewayErrorCode = typeof VeylenGatewayErrorCode.Type;

export const VeylenGatewayError = Schema.Struct({
  code: VeylenGatewayErrorCode,
  message: Schema.String,
  details: Schema.optional(Schema.Unknown),
});
export type VeylenGatewayError = typeof VeylenGatewayError.Type;

export const VeylenGatewayErrorResult = Schema.Struct({
  error: VeylenGatewayError,
});
export type VeylenGatewayErrorResult = typeof VeylenGatewayErrorResult.Type;

export const VeylenContextResult = Schema.Struct({
  harness: Schema.Struct({
    name: Schema.Literal("Veylen"),
    policyVersion: Schema.String,
  }),
  caller: Schema.Struct({
    threadId: ThreadId,
    turnId: Schema.NullOr(TurnId),
    provider: ProviderKind,
    projectId: ProjectId,
  }),
  capabilities: Schema.Struct({
    threadRead: Schema.Boolean,
    threadCreate: Schema.Boolean,
    threadWait: Schema.Boolean,
    automations: Schema.Boolean,
  }),
});
export type VeylenContextResult = typeof VeylenContextResult.Type;

export const VeylenCreateThreadSpec = Schema.Struct({
  prompt: Schema.String.check(Schema.isNonEmpty()),
  title: Schema.optional(Schema.String.check(Schema.isNonEmpty())),
  target: ModelSelection,
  projectId: Schema.optional(ProjectId),
  environment: Schema.optional(Schema.Literals(["local", "worktree"])),
  baseRef: Schema.optional(Schema.String.check(Schema.isNonEmpty())),
  // Legacy inputs remain decodable for replay/backward compatibility, but the
  // MCP catalog no longer advertises branch-backed worktree creation.
  baseBranch: Schema.optional(Schema.String.check(Schema.isNonEmpty())),
  branchName: Schema.optional(Schema.String.check(Schema.isNonEmpty())),
  runtimeMode: Schema.optional(Schema.Literals(["approval-required", "full-access"])),
});
export type VeylenCreateThreadSpec = typeof VeylenCreateThreadSpec.Type;

const VeylenGatewayRequestId = Schema.String.check(Schema.isNonEmpty()).check(
  Schema.isMaxLength(VEYLEN_GATEWAY_MAX_REQUEST_ID_LENGTH),
);

export const VeylenCreateThreadsInput = Schema.Struct({
  requestId: VeylenGatewayRequestId,
  threads: Schema.Array(VeylenCreateThreadSpec)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(VEYLEN_GATEWAY_MAX_THREADS_PER_OPERATION)),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type VeylenCreateThreadsInput = typeof VeylenCreateThreadsInput.Type;

export const VeylenProviderCatalog = Schema.Struct({
  provider: ProviderKind,
  defaultModel: Schema.NullOr(Schema.String),
  models: Schema.Array(ProviderModelDescriptor),
  enabled: Schema.Boolean,
  available: Schema.Boolean,
  authStatus: Schema.optional(ServerProviderAuthStatus),
  source: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
});
export type VeylenProviderCatalog = typeof VeylenProviderCatalog.Type;

export const VeylenGatewayTargetOptionValue = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
]);
export type VeylenGatewayTargetOptionValue = typeof VeylenGatewayTargetOptionValue.Type;

export const VeylenGatewayTargetOptionRule = Schema.Struct({
  key: Schema.String,
  valueType: Schema.Literals(["string", "number", "boolean"]),
  allowedValues: Schema.Array(VeylenGatewayTargetOptionValue),
  allowedValuesSource: Schema.Literals(["provider-contract", "model-discovery"]),
});
export type VeylenGatewayTargetOptionRule = typeof VeylenGatewayTargetOptionRule.Type;

export const VeylenGatewayTargetConstruction = Schema.Struct({
  modelValueSource: Schema.Literal("providers[].models[].slug"),
  primaryOptionKey: Schema.String,
  alternativeOptionKeys: Schema.Array(Schema.String),
  optionSelectionRule: Schema.String,
  providerOptions: Schema.Array(VeylenGatewayTargetOptionRule),
  optionsByModel: Schema.Record(Schema.String, Schema.Array(VeylenGatewayTargetOptionRule)),
  exampleTarget: Schema.NullOr(ModelSelection),
});
export type VeylenGatewayTargetConstruction = typeof VeylenGatewayTargetConstruction.Type;

export const VeylenCapabilitiesResult = Schema.Struct({
  targetConstruction: Schema.Record(Schema.String, VeylenGatewayTargetConstruction),
  providers: Schema.Array(VeylenProviderCatalog),
  limits: Schema.Struct({
    maxThreadsPerOperation: Schema.Int,
    maxWaitMs: Schema.Int,
    oneCreationPlanPerActiveTurn: Schema.Boolean,
  }),
});
export type VeylenCapabilitiesResult = typeof VeylenCapabilitiesResult.Type;

export const VeylenCreatedThreadResult = Schema.Struct({
  index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  threadId: ThreadId,
  projectId: ProjectId,
  title: Schema.String,
  target: ModelSelection,
  provider: ProviderKind,
  model: Schema.String,
  runtimeMode: Schema.Literals(["approval-required", "full-access"]),
  environment: Schema.Literals(["local", "worktree"]),
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  status: Schema.Literal("task_dispatched"),
});
export type VeylenCreatedThreadResult = typeof VeylenCreatedThreadResult.Type;

export const VeylenCreateThreadsResult = Schema.Struct({
  operationId: Schema.String,
  requestId: VeylenGatewayRequestId,
  requestedCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  createdCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  threadIds: Schema.Array(ThreadId),
  threads: Schema.Array(VeylenCreatedThreadResult),
});
export type VeylenCreateThreadsResult = typeof VeylenCreateThreadsResult.Type;

export const VeylenWaitForThreadsInput = Schema.Struct({
  threadIds: Schema.Array(ThreadId)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(VEYLEN_GATEWAY_MAX_THREADS_PER_OPERATION)),
  runIds: Schema.optional(
    Schema.Array(Schema.NullOr(TurnId)).check(
      Schema.isMaxLength(VEYLEN_GATEWAY_MAX_THREADS_PER_OPERATION),
    ),
  ),
  timeoutMs: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).check(
      Schema.isLessThanOrEqualTo(VEYLEN_GATEWAY_MAX_WAIT_MS),
    ),
  ),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type VeylenWaitForThreadsInput = typeof VeylenWaitForThreadsInput.Type;

export const VeylenWaitedThreadResult = Schema.Struct({
  threadId: ThreadId,
  runId: Schema.NullOr(TurnId),
  state: Schema.Literals(["idle", "pending", "running", "completed", "error", "interrupted"]),
  terminal: Schema.Boolean,
  timedOut: Schema.Boolean,
  summary: Schema.NullOr(Schema.String),
  summaryTruncated: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
  readThread: Schema.Struct({
    tool: Schema.Literal("veylen_read_thread"),
    arguments: Schema.Struct({ threadId: ThreadId }),
  }),
});
export type VeylenWaitedThreadResult = typeof VeylenWaitedThreadResult.Type;

export const VeylenWaitForThreadsResult = Schema.Struct({
  callerThreadId: ThreadId,
  runIds: Schema.Array(Schema.NullOr(TurnId)),
  allTerminal: Schema.Boolean,
  timedOut: Schema.Boolean,
  threads: Schema.Array(VeylenWaitedThreadResult),
});
export type VeylenWaitForThreadsResult = typeof VeylenWaitForThreadsResult.Type;
