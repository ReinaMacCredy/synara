import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Schema } from "effect";

import {
  SupervisedGovernanceSnapshot,
  SupervisedRuntimeSnapshot,
  SupervisionSnapshot,
  emptySupervisedGovernanceSnapshot,
  emptySupervisedRuntimeSnapshot,
  emptySupervisionSnapshot,
} from "@synara/contracts";

import { reconcileLegacyGovernance } from "./LegacyReconciliation.ts";

const now = "2026-08-09T00:00:00.000Z";

describe("legacy Supervised reconciliation", () => {
  it("mirrors an activated Lead Room into canonical seats and one fail-closed Root lease", () => {
    const supervision = Schema.decodeUnknownSync(SupervisionSnapshot)({
      ...emptySupervisionSnapshot(now),
      profileSnapshots: [
        {
          id: "profile-snapshot-1",
          sourcePresetId: null,
          sourcePresetName: "Lead",
          runtime: {
            provider: "codex",
            model: "gpt-5.6-sol",
            reasoningEffort: "medium",
            sandboxMode: "workspace-write",
            approvalPolicy: "on-request",
            developerInstructions: "",
          },
          contentHash: "hash",
          createdAt: now,
        },
      ],
      leads: [
        {
          id: "lead-seat-1",
          projectId: "project-1",
          activeThreadId: "thread-1",
          predecessorThreadIds: [],
          profileSnapshotId: "profile-snapshot-1",
          status: "active",
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          revision: 1,
        },
      ],
    });
    const runtime = Schema.decodeUnknownSync(SupervisedRuntimeSnapshot)({
      ...emptySupervisedRuntimeSnapshot(now),
      rooms: [
        {
          id: "room-1",
          projectId: "project-1",
          title: "Room",
          leadSeatId: "lead-seat-1",
          status: "active",
          graphRevision: 0,
          revision: 3,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });

    const reconciled = reconcileLegacyGovernance({
      governance: emptySupervisedGovernanceSnapshot(now),
      supervision,
      runtime,
      at: now,
    });
    const decoded = Schema.decodeUnknownSync(SupervisedGovernanceSnapshot)(reconciled);

    assert.equal(decoded.agentSeats[0]?.identityRole, "lead");
    assert.deepStrictEqual(decoded.authorityReceipts[0]?.allowedCommands, []);
    assert.equal(decoded.rootLeases.length, 1);
    assert.equal(decoded.rootLeases[0]?.holderSeatId, "lead-seat-1");
  });

  it("materializes a provisional Lead seat when Room activation projects first", () => {
    const runtime = Schema.decodeUnknownSync(SupervisedRuntimeSnapshot)({
      ...emptySupervisedRuntimeSnapshot(now),
      rooms: [
        {
          id: "room-before-lead",
          projectId: "project-1",
          title: "Room",
          leadSeatId: "lead-before-bootstrap",
          status: "provisioning",
          graphRevision: 0,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });

    const reconciled = reconcileLegacyGovernance({
      governance: emptySupervisedGovernanceSnapshot(now),
      supervision: emptySupervisionSnapshot(now),
      runtime,
      at: now,
    });
    const decoded = Schema.decodeUnknownSync(SupervisedGovernanceSnapshot)(reconciled);

    assert.equal(decoded.agentSeats[0]?.id, "lead-before-bootstrap");
    assert.equal(decoded.agentSeats[0]?.lifecycleState, "active");
    assert.equal(decoded.rootLeases[0]?.holderSeatId, "lead-before-bootstrap");
    assert.equal(
      decoded.rootLeases[0]?.acquiredUnderReceiptId,
      decoded.agentSeats[0]?.authorityReceiptId,
    );
  });

  it("does not overwrite a seat that already uses a canonical authority receipt", () => {
    const governance = Schema.decodeUnknownSync(SupervisedGovernanceSnapshot)({
      ...emptySupervisedGovernanceSnapshot(now),
      workspaces: [
        {
          id: "workspace:default",
          ownerNamespace: "local",
          title: "Workspace",
          lifecycleState: "active",
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
      authorityReceipts: [
        {
          id: "canonical-receipt",
          actorSeatId: "lead-seat-1",
          identityRole: "lead",
          effectiveRole: "lead",
          workspaceScopes: ["workspace:default"],
          roomScopes: [],
          taskNodeScopes: [],
          allowedCommands: ["supervised.task.delegate"],
          allowedTools: [],
          rootLeaseIds: [],
          mandateIds: [],
          runPolicyRevision: 1,
          issuedAt: now,
          expiresAt: null,
          revokedAt: null,
        },
      ],
      agentSeats: [
        {
          id: "lead-seat-1",
          workspaceId: "workspace:default",
          roomIds: [],
          identityRole: "lead",
          effectiveRole: "lead",
          profileId: "canonical-profile",
          providerSessionId: null,
          lifecycleState: "active",
          workState: "idle",
          authorityReceiptId: "canonical-receipt",
          createdAt: now,
          retainedAt: null,
          retiredAt: null,
          revision: 1,
          updatedAt: now,
        },
      ],
    });

    const runtime = Schema.decodeUnknownSync(SupervisedRuntimeSnapshot)({
      ...emptySupervisedRuntimeSnapshot(now),
      rooms: [
        {
          id: "room-canonical",
          projectId: "project-1",
          title: "Room",
          leadSeatId: "lead-seat-1",
          status: "active",
          graphRevision: 0,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    const reconciled = reconcileLegacyGovernance({
      governance,
      supervision: emptySupervisionSnapshot(now),
      runtime,
      at: now,
    });

    assert.equal(reconciled.agentSeats[0]?.profileId, "canonical-profile");
    assert.equal(reconciled.authorityReceipts.length, 1);
    assert.equal(reconciled.rootLeases[0]?.acquiredUnderReceiptId, "canonical-receipt");
  });
});
