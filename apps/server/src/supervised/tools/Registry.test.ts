import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { AgentSeat, EffectiveAuthorityReceipt } from "@synara/contracts";

import {
  authorizeSupervisedIntentTool,
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
  allowedCommands: [],
  allowedTools: [...defaultSupervisedToolsForRole("supervisor")],
  rootLeaseIds: [],
  mandateIds: [],
  runPolicyRevision: 1,
  issuedAt: now,
  expiresAt: null,
  revokedAt: null,
};

describe("Supervised intent tool registry", () => {
  it("registers the complete canonical Stage 3 intent surface", () => {
    assert.equal(supervisedIntentToolRegistry.length, 24);
    assert.equal(new Set(supervisedIntentToolRegistry.map((entry) => entry.id)).size, 24);
  });

  it("injects no more than twelve role-appropriate granted tools", () => {
    const selected = selectSupervisedIntentTools({ seat, receipt, at: now });
    assert.equal(selected.length, 12);
    assert.ok(selected.every((entry) => entry.roles.includes("supervisor")));
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
});
