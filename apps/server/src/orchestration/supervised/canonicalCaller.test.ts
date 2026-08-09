import assert from "node:assert/strict";

import {
  emptySupervisedGovernanceSnapshot,
  type AgentSeat,
  type EffectiveAuthorityReceipt,
} from "@synara/contracts";
import { describe, it } from "vitest";

import {
  resolveEffectiveCanonicalAuthority,
  resolveProjectedSupervisedCaller,
  resolveProjectedSupervisedCallerForThread,
} from "./canonicalCaller.ts";

const now = "2026-08-09T00:00:00.000Z";

const seat: AgentSeat = {
  id: "lead-1" as never,
  workspaceId: "workspace:default" as never,
  roomIds: ["room-1" as never],
  identityRole: "lead",
  effectiveRole: "lead",
  profileId: "profile-1" as never,
  providerSessionId: null,
  lifecycleState: "active",
  workState: "idle",
  authorityReceiptId: "receipt-1" as never,
  threadId: "shared-thread" as never,
  projectId: "project-1" as never,
  profileSnapshotId: "lead-profile" as never,
  predecessorThreadIds: [],
  displayName: null,
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
  it("resolves projected identity from the canonical AgentSeat", () => {
    const caller = resolveProjectedSupervisedCaller({
      governance: { ...emptySupervisedGovernanceSnapshot(now), agentSeats: [seat] },
      threadId: seat.threadId!,
    });

    assert.equal(caller?.role, "lead");
    assert.equal(caller?.seatId, seat.id);
    assert.equal(caller?.profileSnapshotId, seat.profileSnapshotId);
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

  it("inherits canonical authority through the supervised native RLM lineage", () => {
    const result = resolveProjectedSupervisedCallerForThread({
      governance: { ...emptySupervisedGovernanceSnapshot(now), agentSeats: [seat] },
      threads: [
        {
          id: "rlm-root" as never,
          creationSource: "supervised_native",
          sourceThreadId: seat.threadId,
        },
        {
          id: "rlm-branch" as never,
          creationSource: "supervised_native",
          sourceThreadId: "rlm-root" as never,
        },
      ],
      threadId: "rlm-branch" as never,
    });

    assert.equal(result.requiresCanonicalAuthority, true);
    assert.equal(result.caller?.seatId, seat.id);
    assert.equal(result.caller?.role, "lead");
  });

  it("fails closed for an orphaned supervised native descendant", () => {
    const result = resolveProjectedSupervisedCallerForThread({
      governance: emptySupervisedGovernanceSnapshot(now),
      threads: [
        {
          id: "rlm-orphan" as never,
          creationSource: "supervised_native",
          sourceThreadId: null,
        },
      ],
      threadId: "rlm-orphan" as never,
    });

    assert.equal(result.requiresCanonicalAuthority, true);
    assert.equal(result.caller, undefined);
  });
});
