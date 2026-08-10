import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Schema } from "effect";

import {
  DirectIntervention,
  EffectiveAuthorityReceiptId,
  LeadReplacement,
  RoleAssumption,
  RootAuthorityLeaseId,
  Room,
  SupervisedGovernanceSnapshot,
} from "@synara/contracts";

import {
  assertExclusiveRootLeases,
  recoverGovernanceSnapshot,
  settleGovernanceRecoveryActions,
  transferRootAuthority,
  transitionAgentSeat,
  transitionDirectIntervention,
  transitionHandoff,
  transitionLeadReplacement,
  transitionRoom,
  transitionRoleAssumption,
} from "./Lifecycle.ts";

const now = "2026-08-09T00:00:00.000Z";
const later = "2026-08-09T00:01:00.000Z";

const baseSnapshot = () =>
  Schema.decodeUnknownSync(SupervisedGovernanceSnapshot)({
    revision: 0,
    workspaces: [
      {
        id: "workspace-1",
        ownerNamespace: "owner",
        title: "Workspace",
        lifecycleState: "active",
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
    ],
    agentSeats: [
      {
        id: "lead-old",
        workspaceId: "workspace-1",
        roomIds: ["room-1"],
        identityRole: "lead",
        effectiveRole: "lead",
        profileId: "profile-lead",
        providerSessionId: null,
        lifecycleState: "active",
        workState: "idle",
        authorityReceiptId: "receipt-old",
        createdAt: now,
        retainedAt: null,
        retiredAt: null,
        revision: 1,
        updatedAt: now,
      },
      {
        id: "supervisor-1",
        workspaceId: "workspace-1",
        roomIds: ["room-1"],
        identityRole: "supervisor",
        effectiveRole: "supervisor",
        profileId: "profile-supervisor",
        providerSessionId: "provider-supervisor",
        lifecycleState: "ready",
        workState: "idle",
        authorityReceiptId: "receipt-supervisor",
        createdAt: now,
        retainedAt: null,
        retiredAt: null,
        revision: 1,
        updatedAt: now,
      },
    ],
    providerSessions: [],
    authorityReceipts: [
      {
        id: "receipt-old",
        actorSeatId: "lead-old",
        identityRole: "lead",
        effectiveRole: "lead",
        workspaceScopes: ["workspace-1"],
        roomScopes: ["room-1"],
        taskNodeScopes: [],
        allowedCommands: ["supervised.task.delegate"],
        allowedTools: [],
        rootLeaseIds: ["lease-old"],
        mandateIds: [],
        runPolicyRevision: 1,
        issuedAt: now,
        expiresAt: null,
        revokedAt: null,
      },
      {
        id: "receipt-supervisor",
        actorSeatId: "supervisor-1",
        identityRole: "supervisor",
        effectiveRole: "supervisor",
        workspaceScopes: ["workspace-1"],
        roomScopes: ["room-1"],
        taskNodeScopes: [],
        allowedCommands: ["supervised.role.assume"],
        allowedTools: [],
        rootLeaseIds: [],
        mandateIds: [],
        runPolicyRevision: 1,
        issuedAt: now,
        expiresAt: null,
        revokedAt: null,
      },
    ],
    rootLeases: [
      {
        id: "lease-old",
        workspaceId: "workspace-1",
        roomId: "room-1",
        holderSeatId: "lead-old",
        status: "active",
        acquiredUnderReceiptId: "receipt-old",
        predecessorLeaseId: null,
        acquiredAt: now,
        releasedAt: null,
        expiresAt: null,
        revision: 1,
        updatedAt: now,
      },
    ],
    handoffs: [
      {
        id: "handoff-1",
        workspaceId: "workspace-1",
        roomId: "room-1",
        fromSeatId: "lead-old",
        toSeatId: "supervisor-1",
        lifecycleState: "accepted",
        scope: [{ kind: "room", roomId: "room-1" }],
        summary: "Supervisor assumes Root.",
        evidenceRefs: [],
        preparedAt: now,
        acceptedAt: now,
        transferredAt: null,
        reconciledAt: null,
        revision: 4,
        updatedAt: now,
      },
    ],
    roleAssumptions: [],
    leadReplacements: [],
    humanDirectives: [],
    standingMandates: [],
    directInterventions: [],
    notebookEntries: [],
    modelCapabilityProfiles: [],
    userModelPreferenceProfiles: [],
    modelSelectionReceipts: [],
    updatedAt: now,
  });

describe("Supervisor-first lifecycle", () => {
  it("rejects illegal seat and handoff jumps", () => {
    const snapshot = baseSnapshot();
    assert.throws(() => transitionAgentSeat(snapshot.agentSeats[1]!, "retained", later));
    assert.throws(() => transitionHandoff(snapshot.handoffs[0]!, "reconciled", later));
  });

  it("moves a Room through every durable activation boundary", () => {
    const room = Schema.decodeUnknownSync(Room)({
      id: "room-lifecycle",
      projectId: "project-1",
      title: "Room",
      leadSeatId: null,
      status: "draft",
      graphRevision: 0,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });

    assert.throws(() => transitionRoom(room, "active", later));
    const provisioning = transitionRoom(room, "provisioning", later);
    const ready = transitionRoom(provisioning, "ready", later);
    assert.equal(transitionRoom(ready, "active", later).status, "active");
  });

  it("transfers Root only after acceptance and leaves exactly one active lease", () => {
    const snapshot = baseSnapshot();
    const transferred = transferRootAuthority(snapshot, {
      roomId: "room-1",
      fromSeatId: "lead-old",
      toSeatId: "supervisor-1",
      handoffId: "handoff-1",
      nextLeaseId: RootAuthorityLeaseId.makeUnsafe("lease-supervisor"),
      previousReceiptId: EffectiveAuthorityReceiptId.makeUnsafe("receipt-old-released"),
      nextReceiptId: EffectiveAuthorityReceiptId.makeUnsafe("receipt-supervisor-root"),
      at: later,
    });

    assert.doesNotThrow(() => assertExclusiveRootLeases(transferred));
    assert.equal(
      transferred.rootLeases.find((lease) => lease.id === "lease-old")?.status,
      "released",
    );
    assert.equal(
      transferred.rootLeases.find((lease) => lease.id === "lease-supervisor")?.status,
      "active",
    );
    assert.equal(
      transferred.agentSeats.find((seat) => seat.id === "supervisor-1")?.effectiveRole,
      "acting_root",
    );
    assert.equal(transferred.authorityReceipts.find((receipt) => receipt.id === "receipt-old")?.rootLeaseIds[0], "lease-old");

    const duplicate = transferRootAuthority(transferred, {
      roomId: "room-1",
      fromSeatId: "lead-old",
      toSeatId: "supervisor-1",
      handoffId: "handoff-1",
      nextLeaseId: RootAuthorityLeaseId.makeUnsafe("lease-supervisor"),
      previousReceiptId: EffectiveAuthorityReceiptId.makeUnsafe("receipt-old-released"),
      nextReceiptId: EffectiveAuthorityReceiptId.makeUnsafe("receipt-supervisor-root"),
      at: later,
    });
    assert.strictEqual(duplicate, transferred);
  });

  it("preserves the old Root when handoff has not been accepted", () => {
    const snapshot = baseSnapshot();
    snapshot.handoffs[0] = { ...snapshot.handoffs[0]!, lifecycleState: "acknowledged" };

    assert.throws(() =>
      transferRootAuthority(snapshot, {
        roomId: "room-1",
        fromSeatId: "lead-old",
        toSeatId: "supervisor-1",
        handoffId: "handoff-1",
        nextLeaseId: RootAuthorityLeaseId.makeUnsafe("lease-supervisor"),
        previousReceiptId: EffectiveAuthorityReceiptId.makeUnsafe("receipt-old-released"),
        nextReceiptId: EffectiveAuthorityReceiptId.makeUnsafe("receipt-supervisor-root"),
        at: later,
      }),
    );
    assert.equal(snapshot.rootLeases[0]?.status, "active");
    assert.equal(snapshot.rootLeases.length, 1);
  });

  it("resumes post-transfer reconciliation but fails closed before transfer on restart", () => {
    const snapshot = baseSnapshot();
    snapshot.roleAssumptions = [
      Schema.decodeUnknownSync(RoleAssumption)({
        id: "assumption-before",
        workspaceId: "workspace-1",
        roomId: "room-1",
        actorSeatId: "supervisor-1",
        previousRootSeatId: "lead-old",
        handoffId: "handoff-1",
        previousLeaseId: "lease-old",
        nextLeaseId: "lease-supervisor",
        operation: "assume",
        lifecycleState: "previous_root_notified",
        requestedUnderReceiptId: "receipt-supervisor",
        failureReason: null,
        createdAt: now,
        completedAt: null,
        revision: 3,
        updatedAt: now,
      }),
    ];

    const recovered = recoverGovernanceSnapshot(snapshot, later);

    assert.equal(recovered.snapshot.roleAssumptions[0]?.lifecycleState, "failed");
    assert.equal(recovered.snapshot.rootLeases[0]?.status, "active");
  });

  it("settles post-transfer recovery actions instead of advancing them implicitly", () => {
    const snapshot = baseSnapshot();
    snapshot.roleAssumptions = [
      Schema.decodeUnknownSync(RoleAssumption)({
        id: "assumption-after",
        workspaceId: "workspace-1",
        roomId: "room-1",
        actorSeatId: "supervisor-1",
        previousRootSeatId: "lead-old",
        handoffId: "handoff-1",
        previousLeaseId: "lease-old",
        nextLeaseId: "lease-supervisor",
        operation: "assume",
        lifecycleState: "lease_transferred",
        requestedUnderReceiptId: "receipt-supervisor",
        failureReason: null,
        createdAt: now,
        completedAt: null,
        revision: 4,
        updatedAt: now,
      }),
    ];

    const recovered = recoverGovernanceSnapshot(snapshot, later);
    assert.equal(recovered.snapshot.roleAssumptions[0]?.lifecycleState, "lease_transferred");
    assert.deepEqual(recovered.actions, [
      {
        kind: "reconcile_role_assumption",
        roleAssumptionId: "assumption-after",
      },
    ]);
    const settled = settleGovernanceRecoveryActions(
      recovered.snapshot,
      recovered.actions,
      later,
    );

    assert.equal(settled.roleAssumptions[0]?.lifecycleState, "topology_reconciled");
    assert.strictEqual(
      settleGovernanceRecoveryActions(settled, recovered.actions, later),
      settled,
    );
  });

  it("requires Lead notification before intervention reconciliation", () => {
    const intervention = Schema.decodeUnknownSync(DirectIntervention)({
      id: "intervention-1",
      workspaceId: "workspace-1",
      roomId: "room-1",
      supervisorSeatId: "supervisor-1",
      targetPeerSeatId: "peer-1",
      rootHolderSeatId: "lead-old",
      taskNodeId: null,
      workRequest: "Investigate the bounded failure.",
      material: true,
      lifecycleState: "completed",
      evidenceRefs: [],
      openedUnderReceiptId: "receipt-supervisor",
      openedAt: now,
      leadNotifiedAt: null,
      reconciledAt: null,
      closedAt: null,
      revision: 4,
      updatedAt: now,
    });

    assert.throws(() => transitionDirectIntervention(intervention, "reconciled", later));
    const notified = transitionDirectIntervention(intervention, "lead_notified", later);
    assert.equal(transitionDirectIntervention(notified, "reconciled", later).lifecycleState, "reconciled");
    assert.throws(() => transitionDirectIntervention(notified, "not_required", later));

    const communication = { ...notified, material: false };
    assert.equal(
      transitionDirectIntervention(communication, "not_required", later).lifecycleState,
      "not_required",
    );
  });

  it("fails an executing intervention exactly once during restart recovery", () => {
    const snapshot = baseSnapshot();
    snapshot.directInterventions = [
      Schema.decodeUnknownSync(DirectIntervention)({
        id: "intervention-restart",
        workspaceId: "workspace-1",
        roomId: "room-1",
        supervisorSeatId: "supervisor-1",
        targetPeerSeatId: "peer-1",
        rootHolderSeatId: "lead-old",
        taskNodeId: null,
        workRequest: "Observe the bounded work.",
        material: true,
        lifecycleState: "executing",
        evidenceRefs: [],
        openedUnderReceiptId: "receipt-supervisor",
        openedAt: now,
        leadNotifiedAt: null,
        reconciledAt: null,
        closedAt: null,
        revision: 3,
        updatedAt: now,
      }),
    ];

    const recovered = recoverGovernanceSnapshot(snapshot, later);
    assert.deepEqual(recovered.actions, [
      {
        kind: "resume_intervention",
        interventionId: "intervention-restart",
      },
    ]);
    const settled = settleGovernanceRecoveryActions(
      recovered.snapshot,
      recovered.actions,
      later,
    );
    assert.equal(settled.directInterventions[0]?.lifecycleState, "failed");
    assert.strictEqual(
      settleGovernanceRecoveryActions(settled, recovered.actions, later),
      settled,
    );
  });

  it("routes Root release through the second lease transfer boundary", () => {
    const assumption = Schema.decodeUnknownSync(RoleAssumption)({
      id: "assumption-release",
      workspaceId: "workspace-1",
      roomId: "room-1",
      actorSeatId: "supervisor-1",
      previousRootSeatId: "lead-old",
      handoffId: "handoff-1",
      previousLeaseId: "lease-old",
      nextLeaseId: "lease-supervisor",
      operation: "assume",
      lifecycleState: "active",
      requestedUnderReceiptId: "receipt-supervisor",
      failureReason: null,
      createdAt: now,
      completedAt: now,
      revision: 7,
      updatedAt: now,
    });

    const requested = transitionRoleAssumption(assumption, "release_requested", later);
    const ready = transitionRoleAssumption(requested, "successor_ready", later);
    const accepted = transitionRoleAssumption(ready, "handoff_accepted", later);
    const transferred = transitionRoleAssumption(accepted, "lease_transferred", later);

    assert.equal(transferred.operation, "release");
    assert.equal(transitionRoleAssumption(transferred, "released", later).lifecycleState, "released");
  });

  it("drains the previous Lead only after replacement topology is reconciled", () => {
    let replacement = Schema.decodeUnknownSync(LeadReplacement)({
      id: "replacement-1",
      workspaceId: "workspace-1",
      roomId: "room-1",
      previousLeadSeatId: "lead-old",
      replacementLeadSeatId: "lead-new",
      handoffId: "handoff-replacement",
      previousLeaseId: "lease-old",
      replacementLeaseId: "lease-new",
      lifecycleState: "requested",
      retirePreviousLineage: false,
      failureReason: null,
      createdAt: now,
      completedAt: null,
      revision: 0,
      updatedAt: now,
    });
    assert.throws(() => transitionLeadReplacement(replacement, "replacement_ready", later));
    for (const state of [
      "provisioning_replacement",
      "replacement_ready",
      "handoff_prepared",
      "handoff_accepted",
      "lease_transferred",
      "topology_reconciled",
      "draining_previous",
      "completed",
    ] as const) {
      replacement = transitionLeadReplacement(replacement, state, later);
    }

    assert.equal(replacement.lifecycleState, "completed");
    assert.equal(replacement.completedAt, later);
  });
});
