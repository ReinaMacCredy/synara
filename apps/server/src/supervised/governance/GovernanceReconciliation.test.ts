import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Schema } from "effect";

import {
  SupervisedGovernanceSnapshot,
  SupervisedRuntimeSnapshot,
  emptySupervisedGovernanceSnapshot,
  emptySupervisedRuntimeSnapshot,
} from "@synara/contracts";

import { emptySupervisedGovernanceDecisionState } from "../../orchestration/supervised/governanceState.ts";
import type { SupervisedGovernanceDecisionState } from "../../orchestration/supervised/governanceState.ts";
import { reconcileGovernanceProjection } from "./GovernanceReconciliation.ts";
import { defaultSupervisedCommandsForRole } from "../tools/Registry.ts";

const now = "2026-08-09T00:00:00.000Z";
const reconcileLegacyProjection = (
  input: Omit<Parameters<typeof reconcileGovernanceProjection>[0], "source">,
) => reconcileGovernanceProjection({ ...input, source: "legacy" });

describe("Supervised governance reconciliation", () => {
  it("projects a canonical Lead Room without minting legacy authority identifiers", () => {
    const state = ({
      ...emptySupervisedGovernanceDecisionState(now),
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
    }) as SupervisedGovernanceDecisionState;
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

    const reconciled = reconcileGovernanceProjection({
      governance: emptySupervisedGovernanceSnapshot(now),
      state,
      runtime,
      at: now,
      source: "canonical",
    });
    const decoded = Schema.decodeUnknownSync(SupervisedGovernanceSnapshot)(reconciled);

    assert.equal(decoded.agentSeats[0]?.identityRole, "lead");
    assert.ok(
      decoded.authorityReceipts[0]?.allowedCommands.includes("supervised.peer.create"),
    );
    for (const command of defaultSupervisedCommandsForRole("lead")) {
      assert.ok(decoded.authorityReceipts[0]?.allowedCommands.includes(command));
    }
    assert.ok(
      decoded.authorityReceipts[0]?.allowedTools.includes("supervised.agent.create"),
    );
    assert.equal(decoded.rootLeases.length, 1);
    assert.equal(decoded.rootLeases[0]?.holderSeatId, "lead-seat-1");
    assert.match(decoded.agentSeats[0]!.authorityReceiptId, /^supervised-projection-receipt:/);
    assert.match(decoded.rootLeases[0]!.id, /^supervised-projection-root-lease:/);
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

    const reconciled = reconcileLegacyProjection({
      governance: emptySupervisedGovernanceSnapshot(now),
      state: emptySupervisedGovernanceDecisionState(now),
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
    const reconciled = reconcileLegacyProjection({
      governance,
      state: emptySupervisedGovernanceDecisionState(now),
      runtime,
      at: now,
    });

    assert.equal(reconciled.agentSeats[0]?.profileId, "canonical-profile");
    assert.equal(reconciled.authorityReceipts.length, 1);
    assert.equal(reconciled.rootLeases[0]?.acquiredUnderReceiptId, "canonical-receipt");
  });

  it("keeps authority receipts append-only and skips unchanged rewrites", () => {
    const state = ({
      ...emptySupervisedGovernanceDecisionState(now),
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
    }) as SupervisedGovernanceDecisionState;
    const firstRuntime = Schema.decodeUnknownSync(SupervisedRuntimeSnapshot)({
      ...emptySupervisedRuntimeSnapshot(now),
      rooms: [
        {
          id: "room-1",
          projectId: "project-1",
          title: "Room one",
          leadSeatId: "lead-seat-1",
          status: "active",
          graphRevision: 0,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    const first = reconcileLegacyProjection({
      governance: emptySupervisedGovernanceSnapshot(now),
      state,
      runtime: firstRuntime,
      at: now,
    });
    const unchanged = reconcileLegacyProjection({
      governance: first,
      state,
      runtime: firstRuntime,
      at: now,
    });
    assert.strictEqual(unchanged, first);

    const expanded = reconcileLegacyProjection({
      governance: first,
      state,
      runtime: {
        ...firstRuntime,
        rooms: [
          ...firstRuntime.rooms,
          {
            ...firstRuntime.rooms[0]!,
            id: "room-2" as typeof firstRuntime.rooms[number]["id"],
            title: "Room two",
            revision: 0,
          },
        ],
      },
      at: "2026-08-09T00:01:00.000Z",
    });
    const currentReceiptId = expanded.agentSeats.find(
      (seat) => seat.id === "lead-seat-1",
    )?.authorityReceiptId;

    assert.equal(expanded.authorityReceipts.length, 2);
    assert.notEqual(currentReceiptId, first.agentSeats[0]?.authorityReceiptId);
    assert.ok(expanded.authorityReceipts.some((receipt) => receipt.id === currentReceiptId));
  });

  it("preserves revoked legacy authority instead of issuing a successor", () => {
    const state = ({
      ...emptySupervisedGovernanceDecisionState(now),
      leads: [
        {
          id: "lead-seat-revoked",
          projectId: "project-1",
          activeThreadId: "thread-revoked",
          predecessorThreadIds: [],
          profileSnapshotId: "profile-snapshot-revoked",
          status: "active",
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          revision: 1,
        },
      ],
    }) as SupervisedGovernanceDecisionState;
    const runtime = Schema.decodeUnknownSync(SupervisedRuntimeSnapshot)({
      ...emptySupervisedRuntimeSnapshot(now),
      rooms: [
        {
          id: "room-revoked-1",
          projectId: "project-1",
          title: "Room one",
          leadSeatId: "lead-seat-revoked",
          status: "active",
          graphRevision: 0,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    const first = reconcileLegacyProjection({
      governance: emptySupervisedGovernanceSnapshot(now),
      state,
      runtime,
      at: now,
    });
    const firstReceipt = first.authorityReceipts[0]!;
    const revokedAt = "2026-08-09T00:01:00.000Z";
    const revoked = {
      ...first,
      authorityReceipts: [{ ...firstReceipt, revokedAt }],
    };

    const reconciled = reconcileLegacyProjection({
      governance: revoked,
      state,
      runtime: {
        ...runtime,
        rooms: [
          ...runtime.rooms,
          {
            ...runtime.rooms[0]!,
            id: "room-revoked-2" as typeof runtime.rooms[number]["id"],
            title: "Room two",
          },
        ],
      },
      at: "2026-08-09T00:02:00.000Z",
    });

    assert.equal(reconciled.authorityReceipts.length, 1);
    assert.equal(reconciled.authorityReceipts[0]?.id, firstReceipt.id);
    assert.equal(reconciled.authorityReceipts[0]?.revokedAt, revokedAt);
    assert.equal(reconciled.agentSeats[0]?.authorityReceiptId, firstReceipt.id);
    assert.ok(reconciled.rootLeases.every((lease) => lease.status === "released"));
  });
});
