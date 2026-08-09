import assert from "node:assert/strict";

import {
  emptySupervisedGovernanceSnapshot,
  emptySupervisionSnapshot,
  type AgentSeat,
  type EffectiveAuthorityReceipt,
  type LeadSeat,
  type PeerBinding,
} from "@synara/contracts";
import { describe, it } from "vitest";

import {
  resolveEffectiveCanonicalAuthority,
  resolveProjectedSupervisionCaller,
} from "./canonicalCaller.ts";

const now = "2026-08-09T00:00:00.000Z";

const lead: LeadSeat = {
  id: "lead-1" as never,
  projectId: "project-1" as never,
  activeThreadId: "shared-thread" as never,
  predecessorThreadIds: [],
  profileSnapshotId: "lead-profile" as never,
  status: "active",
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  revision: 1,
};

const peer: PeerBinding = {
  threadId: "shared-thread" as never,
  projectId: "project-1" as never,
  leadSeatId: lead.id,
  rootThreadId: lead.activeThreadId,
  profileSnapshotId: "peer-profile" as never,
  status: "active",
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  revision: 1,
};

const seat: AgentSeat = {
  id: lead.id as never,
  workspaceId: "workspace:default" as never,
  roomIds: ["room-1" as never],
  identityRole: "lead",
  effectiveRole: "lead",
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
  id: seat.authorityReceiptId,
  actorSeatId: seat.id,
  identityRole: "lead",
  effectiveRole: "lead",
  workspaceScopes: [seat.workspaceId],
  roomScopes: seat.roomIds,
  taskNodeScopes: [],
  allowedCommands: [],
  allowedTools: [],
  rootLeaseIds: [],
  mandateIds: [],
  runPolicyRevision: 0,
  issuedAt: now,
  expiresAt: null,
  revokedAt: null,
};

describe("canonical Supervised caller resolution", () => {
  it("uses one stable supervisor-lead-peer precedence for projected identity", () => {
    const caller = resolveProjectedSupervisionCaller({
      supervision: {
        ...emptySupervisionSnapshot(now),
        leads: [lead],
        peers: [peer],
      },
      threadId: lead.activeThreadId,
    });

    assert.equal(caller?.role, "lead");
    assert.equal(caller?.seatId, lead.id);
    assert.equal(caller?.profileSnapshotId, lead.profileSnapshotId);
  });

  it("excludes revoked authority from provider prompts and execution", () => {
    const governance = {
      ...emptySupervisedGovernanceSnapshot(now),
      agentSeats: [seat],
      authorityReceipts: [receipt],
    };

    assert.deepStrictEqual(
      resolveEffectiveCanonicalAuthority({ governance, seatId: seat.id, at: now }),
      { seat, receipt },
    );
    assert.equal(
      resolveEffectiveCanonicalAuthority({
        governance: {
          ...governance,
          authorityReceipts: [{ ...receipt, revokedAt: now }],
        },
        seatId: seat.id,
        at: now,
      }),
      undefined,
    );
  });
});
