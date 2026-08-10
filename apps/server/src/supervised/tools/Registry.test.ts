import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { AgentSeat, EffectiveAuthorityReceipt } from "@synara/contracts";

import {
  authorizeSupervisedIntentTool,
  defaultSupervisedCommandsForRole,
  defaultSupervisedToolsForRole,
  selectSupervisedIntentTools,
  supervisedIntentToolRegistry,
} from "./Registry.ts";

const now = "2026-08-09T00:00:00.000Z";

const seat: AgentSeat = {
  id: "supervisor-1" as never,
  workspaceId: "workspace-1" as never,
  roomIds: ["room-1" as never],
  identityRole: "supervisor",
  effectiveRole: "supervisor",
  profileId: "profile-1" as never,
  providerSessionId: null,
  lifecycleState: "active",
  workState: "idle",
  authorityReceiptId: "receipt-1" as never,
  createdAt: now,
  retainedAt: null,
  retiredAt: null,
  revision: 1,
  updatedAt: now,
};

const receipt: EffectiveAuthorityReceipt = {
  id: "receipt-1" as never,
  actorSeatId: seat.id,
  identityRole: "supervisor",
  effectiveRole: "supervisor",
  workspaceScopes: [seat.workspaceId],
  roomScopes: seat.roomIds,
  taskNodeScopes: [],
  allowedCommands: [...defaultSupervisedCommandsForRole("supervisor")],
  allowedTools: [...defaultSupervisedToolsForRole("supervisor")],
  rootLeaseIds: [],
  mandateIds: [],
  runPolicyRevision: 1,
  issuedAt: now,
  expiresAt: null,
  revokedAt: null,
};

describe("Supervised intent tool registry", () => {
  it("registers the complete canonical intent surface through Stage 5", () => {
    assert.equal(supervisedIntentToolRegistry.length, 26);
    assert.equal(new Set(supervisedIntentToolRegistry.map((entry) => entry.id)).size, 26);
  });

  it("injects no more than twelve role-appropriate granted tools", () => {
    const selected = selectSupervisedIntentTools({ seat, receipt, at: now });
    assert.equal(selected.length, 12);
    assert.ok(selected.every((entry) => entry.roles.includes("supervisor")));
    assert.ok(selected.some((entry) => entry.id === "supervised.notebook.compact"));
  });

  it("fails closed when a receipt is revoked or lacks the tool grant", () => {
    const revoked = authorizeSupervisedIntentTool({
      toolId: "supervised.topology.read",
      seat,
      receipt: { ...receipt, revokedAt: now },
      workspaceId: seat.workspaceId,
      at: now,
    });
    assert.deepStrictEqual(revoked, {
      allowed: false,
      code: "supervised_tool_authority_revoked",
      reason: "The EffectiveAuthorityReceipt is revoked or expired.",
    });

    const ungranted = authorizeSupervisedIntentTool({
      toolId: "supervised.topology.read",
      seat,
      receipt: { ...receipt, allowedTools: [] },
      workspaceId: seat.workspaceId,
      at: now,
    });
    assert.equal(ungranted.allowed, false);
    if (!ungranted.allowed) assert.equal(ungranted.code, "supervised_tool_capability_denied");
  });

  it("fails closed when a granted tool requires an ungranted internal command", () => {
    const denied = authorizeSupervisedIntentTool({
      toolId: "supervised.work.assign",
      seat,
      receipt: { ...receipt, allowedCommands: [] },
      workspaceId: seat.workspaceId,
      at: now,
    });

    assert.equal(denied.allowed, false);
    if (!denied.allowed) assert.equal(denied.code, "supervised_tool_command_denied");
  });

  it("keeps Supervisor notebook search read-only with no cursor command", () => {
    const search = supervisedIntentToolRegistry.find(
      (entry) => entry.id === "supervised.notebook.search",
    );

    assert.equal(search?.readOnly, true);
    assert.deepEqual(search?.internalCommands, []);
  });

  it("authorizes bounded work as an intervention without a Task claim", () => {
    const workAssignment = supervisedIntentToolRegistry.find(
      (entry) => entry.id === "supervised.work.assign",
    );

    assert.deepEqual(workAssignment?.internalCommands, [
      "intervention.open",
      "intervention.notifyLead",
    ]);
    assert.equal(workAssignment?.internalCommands.includes("task.claim"), false);
  });
});
