import type {
  AgentRole,
  AgentSeat,
  EffectiveAgentRole,
  EffectiveAuthorityReceipt,
  SupervisedIntentToolId,
  SupervisedInternalCommandId,
} from "@synara/contracts";

export interface SupervisedIntentToolDescriptor {
  readonly id: SupervisedIntentToolId;
  readonly schemaVersion: "1.0.0";
  readonly roles: ReadonlyArray<EffectiveAgentRole>;
  readonly readOnly: boolean;
  readonly internalCommands: ReadonlyArray<SupervisedInternalCommandId>;
}

const descriptor = (
  id: SupervisedIntentToolId,
  roles: ReadonlyArray<EffectiveAgentRole>,
  readOnly: boolean,
  internalCommands: ReadonlyArray<SupervisedInternalCommandId> = [],
): SupervisedIntentToolDescriptor => ({
  id,
  schemaVersion: "1.0.0",
  roles,
  readOnly,
  internalCommands,
});

const observerRoles: ReadonlyArray<EffectiveAgentRole> = [
  "supervisor",
  "lead",
  "peer",
  "acting_root",
];
const coordinatorRoles: ReadonlyArray<EffectiveAgentRole> = [
  "supervisor",
  "lead",
  "acting_root",
];
const rootRoles: ReadonlyArray<EffectiveAgentRole> = ["lead", "acting_root"];

export const supervisedIntentToolRegistry: ReadonlyArray<SupervisedIntentToolDescriptor> = [
  descriptor("supervised.providers.list", ["supervisor", "lead", "acting_root"], true),
  descriptor("supervised.models.list", ["supervisor", "lead", "acting_root"], true),
  descriptor("supervised.models.recommend", ["supervisor", "lead", "acting_root"], true),
  descriptor("supervised.agents.list", observerRoles, true),
  descriptor("supervised.topology.read", observerRoles, true),
  descriptor("supervised.tasks.list", observerRoles, true),
  descriptor("supervised.task.get", observerRoles, true),
  descriptor("supervised.context.inspect", observerRoles, true),
  descriptor("supervised.notebook.search", ["supervisor", "lead", "acting_root"], true),
  descriptor("supervised.agent.create", coordinatorRoles, false, ["seat.provision", "seat.waitReady"]),
  descriptor("supervised.message.send", observerRoles, false),
  descriptor("supervised.work.assign", coordinatorRoles, false, ["task.claim"]),
  descriptor("supervised.task.delegate", rootRoles, false, ["task.transferOwnership"]),
  descriptor("supervised.lead.replace", ["supervisor", "acting_root"], false, [
    "seat.provision",
    "seat.waitReady",
    "handoff.prepare",
    "handoff.deliver",
    "handoff.acknowledge",
    "handoff.accept",
    "rootLease.transfer",
  ]),
  descriptor("supervised.role.assume", ["supervisor"], false, [
    "context.checkpoint",
    "handoff.prepare",
    "rootLease.acquire",
  ]),
  descriptor("supervised.role.release", ["acting_root"], false, [
    "handoff.prepare",
    "handoff.accept",
    "rootLease.transfer",
  ]),
  descriptor("supervised.intervention.open", ["supervisor", "acting_root"], false, [
    "intervention.open",
    "intervention.notifyLead",
  ]),
  descriptor("supervised.intervention.reconcile", coordinatorRoles, false, [
    "intervention.reconcile",
    "intervention.close",
  ]),
  descriptor("supervised.run.control", observerRoles, false, [
    "run.admit",
    "run.start",
    "run.pause",
    "run.resume",
    "run.retry",
    "run.stop",
  ]),
  descriptor("supervised.rlm.start", coordinatorRoles, false, [
    "rlm.admit",
    "rlm.branch",
    "rlm.synthesize",
  ]),
  descriptor("supervised.context.requestCompaction", coordinatorRoles, false, [
    "context.checkpoint",
    "context.compact",
  ]),
  descriptor("supervised.review.request", coordinatorRoles, false),
  descriptor("supervised.evidence.publish", observerRoles, false, ["evidence.attach"]),
  descriptor("supervised.room.complete", rootRoles, false, ["room.drain", "room.archive"]),
];

const descriptorsById = new Map(
  supervisedIntentToolRegistry.map((entry) => [entry.id, entry]),
);

const defaultRoleTools: Readonly<Record<AgentRole, ReadonlyArray<SupervisedIntentToolId>>> = {
  supervisor: [
    "supervised.models.list",
    "supervised.models.recommend",
    "supervised.agents.list",
    "supervised.topology.read",
    "supervised.tasks.list",
    "supervised.task.get",
    "supervised.context.inspect",
    "supervised.notebook.search",
    "supervised.agent.create",
    "supervised.message.send",
    "supervised.work.assign",
    "supervised.intervention.open",
    "supervised.intervention.reconcile",
  ],
  lead: [
    "supervised.models.list",
    "supervised.models.recommend",
    "supervised.agents.list",
    "supervised.topology.read",
    "supervised.tasks.list",
    "supervised.task.get",
    "supervised.context.inspect",
    "supervised.agent.create",
    "supervised.message.send",
    "supervised.task.delegate",
    "supervised.review.request",
    "supervised.evidence.publish",
  ],
  peer: [
    "supervised.agents.list",
    "supervised.topology.read",
    "supervised.tasks.list",
    "supervised.task.get",
    "supervised.context.inspect",
    "supervised.message.send",
    "supervised.run.control",
    "supervised.evidence.publish",
  ],
};

export const defaultSupervisedToolsForRole = (
  role: AgentRole,
): ReadonlyArray<SupervisedIntentToolId> => defaultRoleTools[role];

export const supervisedInternalCommandsForTools = (
  toolIds: ReadonlyArray<SupervisedIntentToolId>,
): ReadonlyArray<SupervisedInternalCommandId> => [
  ...new Set(
    toolIds.flatMap((toolId) => descriptorsById.get(toolId)?.internalCommands ?? []),
  ),
];

export const defaultSupervisedCommandsForRole = (
  role: AgentRole,
): ReadonlyArray<SupervisedInternalCommandId> =>
  supervisedInternalCommandsForTools(defaultSupervisedToolsForRole(role));

export type SupervisedToolAuthorizationDecision =
  | { readonly allowed: true; readonly descriptor: SupervisedIntentToolDescriptor }
  | { readonly allowed: false; readonly code: string; readonly reason: string };

export function authorizeSupervisedIntentTool(input: {
  readonly toolId: SupervisedIntentToolId;
  readonly seat: AgentSeat | undefined;
  readonly receipt: EffectiveAuthorityReceipt | undefined;
  readonly workspaceId?: string | null;
  readonly roomId?: string | null;
  readonly at: string;
}): SupervisedToolAuthorizationDecision {
  const descriptor = descriptorsById.get(input.toolId);
  if (!descriptor) {
    return { allowed: false, code: "supervised_tool_unknown", reason: "Unknown Supervised tool." };
  }
  if (!input.seat || !["ready", "active"].includes(input.seat.lifecycleState)) {
    return {
      allowed: false,
      code: "supervised_tool_seat_unavailable",
      reason: "The acting AgentSeat is not ready or active.",
    };
  }
  if (!input.receipt || input.receipt.id !== input.seat.authorityReceiptId) {
    return {
      allowed: false,
      code: "supervised_tool_authority_unavailable",
      reason: "The AgentSeat has no matching EffectiveAuthorityReceipt.",
    };
  }
  if (input.receipt.actorSeatId !== input.seat.id) {
    return {
      allowed: false,
      code: "supervised_tool_authority_mismatch",
      reason: "The EffectiveAuthorityReceipt belongs to another AgentSeat.",
    };
  }
  if (
    input.receipt.revokedAt !== null ||
    (input.receipt.expiresAt !== null && input.receipt.expiresAt <= input.at)
  ) {
    return {
      allowed: false,
      code: "supervised_tool_authority_revoked",
      reason: "The EffectiveAuthorityReceipt is revoked or expired.",
    };
  }
  if (!descriptor.roles.includes(input.receipt.effectiveRole)) {
    return {
      allowed: false,
      code: "supervised_tool_role_denied",
      reason: `Effective role '${input.receipt.effectiveRole}' cannot use '${input.toolId}'.`,
    };
  }
  if (!input.receipt.allowedTools.includes(input.toolId)) {
    return {
      allowed: false,
      code: "supervised_tool_capability_denied",
      reason: `The authority receipt does not grant '${input.toolId}'.`,
    };
  }
  const missingCommand = descriptor.internalCommands.find(
    (command) => !input.receipt.allowedCommands.includes(command),
  );
  if (missingCommand) {
    return {
      allowed: false,
      code: "supervised_tool_command_denied",
      reason: `The authority receipt does not grant internal command '${missingCommand}'.`,
    };
  }
  if (
    input.workspaceId &&
    !input.receipt.workspaceScopes.some((workspaceId) => workspaceId === input.workspaceId)
  ) {
    return {
      allowed: false,
      code: "supervised_tool_workspace_denied",
      reason: "The authority receipt does not cover this Workspace.",
    };
  }
  if (
    input.roomId &&
    !input.receipt.roomScopes.some((roomId) => roomId === input.roomId)
  ) {
    return {
      allowed: false,
      code: "supervised_tool_room_denied",
      reason: "The authority receipt does not cover this Room.",
    };
  }
  return { allowed: true, descriptor };
}

export function selectSupervisedIntentTools(input: {
  readonly seat: AgentSeat;
  readonly receipt: EffectiveAuthorityReceipt;
  readonly at: string;
  readonly maximum?: number;
}): ReadonlyArray<SupervisedIntentToolDescriptor> {
  const limit = Math.min(12, Math.max(0, input.maximum ?? 12));
  return defaultSupervisedToolsForRole(input.seat.identityRole)
    .flatMap((toolId) => {
      const decision = authorizeSupervisedIntentTool({
        toolId,
        seat: input.seat,
        receipt: input.receipt,
        workspaceId: input.seat.workspaceId,
        at: input.at,
      });
      return decision.allowed ? [decision.descriptor] : [];
    })
    .slice(0, limit);
}
