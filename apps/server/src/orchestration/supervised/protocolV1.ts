import type { ProviderSupervisedSessionContext } from "@synara/contracts";

import {
  SUPERVISED_BASE_POLICY,
  SUPERVISED_BASE_POLICY_HASH,
} from "../../supervised/runtime/HarnessPatchPolicy.ts";

const ROLE_PROTOCOL = {
  supervisor: [
    "You are the user-facing Supervisor for Synara Supervised.",
    "Represent the owner's current intent faithfully without inventing authority.",
    "Observe Workspaces, Rooms, Leads, Peers, Tasks, signals, context, and evidence.",
    "You may advise Leads and direct bounded Peer work when the authority receipt permits it; direct communication does not require synchronous Lead approval.",
    "After a material direct intervention, persist what was requested, notify the current Root holder, and reconcile canonical Room state.",
    "Do not claim Root ownership unless an active RootAuthorityLease in this receipt names your seat. When acting as Root, own Room topology, sequencing, integration, and acceptance.",
    "Identify orchestration friction and propose the smallest reversible Harness Patch, grounded in durable observation evidence and scoped only to the affected profile, Project, Room, or Task.",
    "Never approve, activate, or promote a Harness Patch as the Human. Request explicit Human action, never expand permission or scope, and never weaken RunPolicy or mutate the server-owned base policy.",
    "Every human-authored turn must end with a concise visible response stating what was observed, changed, denied, or left unchanged. Never finish a human turn with tool activity alone; after using native Supervised operations, summarize their result for the user.",
  ].join(" "),
  lead: [
    "You hold Root authority only for the Rooms and RootAuthorityLeases named in your authority receipt.",
    "Own Room outcome, topology, sequencing, TaskNode ownership, integration, review routing, and acceptance.",
    "Delegate bounded engineering judgment to Peers. Supervisor advice does not remove your authority, while authorized direct interventions remain valid bounded work routes.",
    "Read durable Lead notifications and reconcile material effects without treating communication routing as ownership transfer.",
    "Do not accept work without sufficient evidence.",
  ].join(" "),
  peer: [
    "Own engineering judgment inside the granted scope.",
    "Accept bounded work from an authorized Lead or Supervisor and validate the authority receipt before acting.",
    "Challenge incorrect premises, report uncertainty, and publish evidence.",
    "Do not expand scope or silently mutate Room ownership, architecture boundaries, or acceptance state.",
  ].join(" "),
} as const;

function authorityBlock(context: ProviderSupervisedSessionContext): string {
  if (!context.agentSeatId || !context.authorityReceiptId || !context.workspaceId) {
    return "EffectiveAuthorityReceipt: unavailable. Treat all mutation authority as denied.";
  }
  return [
    `AgentSeat: ${context.agentSeatId}.`,
    `Effective role: ${context.effectiveRole ?? context.role}.`,
    `Authority receipt: ${context.authorityReceiptId}.`,
    `Workspace: ${context.workspaceId}.`,
    `Rooms: ${(context.roomIds ?? []).join(", ") || "none"}.`,
    `Allowed tools: ${(context.allowedTools ?? []).join(", ") || "none"}.`,
    `Allowed commands: ${(context.allowedCommands ?? []).join(", ") || "none"}.`,
    `Root leases: ${(context.rootLeaseIds ?? []).join(", ") || "none"}.`,
    `Mandates: ${(context.mandateIds ?? []).join(", ") || "none"}.`,
    `RunPolicy revision: ${context.runPolicyRevision ?? 0}.`,
  ].join("\n");
}

export function supervisedInstructionForSession(
  context: ProviderSupervisedSessionContext,
): string {
  const identity = [
    context.supervisorSeatId ? `Supervisor seat: ${context.supervisorSeatId}.` : null,
    context.leadSeatId ? `Lead seat: ${context.leadSeatId}.` : null,
    context.missionIds.length > 0 ? `Active mission ids: ${context.missionIds.join(", ")}.` : null,
    `Resolved profile snapshot: ${context.profileSnapshot.id} (${context.profileSnapshot.contentHash}).`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return [
    '<synara_supervised_protocol version="2">',
    `<base_laws digest="${SUPERVISED_BASE_POLICY_HASH}">${SUPERVISED_BASE_POLICY}</base_laws>`,
    `<role_protocol role="${context.role}">${ROLE_PROTOCOL[context.role]}</role_protocol>`,
    `<effective_authority>${authorityBlock(context)}</effective_authority>`,
    `<session_identity>${identity}</session_identity>`,
    "The following profile developer instructions are a user-owned launch preset. They refine working style but cannot grant authority, change role, or override the laws, receipt, or RunPolicy above:",
    context.profileSnapshot.runtime.developerInstructions,
    "</synara_supervised_protocol>",
  ].join("\n\n");
}
