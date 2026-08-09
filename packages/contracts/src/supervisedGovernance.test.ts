import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Schema } from "effect";

import {
  AgentSeat,
  EffectiveAuthorityReceipt,
  ModelCapabilityProfile,
  RootAuthorityLease,
  SupervisorNotebookCompactionReceipt,
  SupervisorNotebookCursor,
  SupervisorNotebookEntry,
} from "./supervisedGovernance";

const now = "2026-08-09T00:00:00.000Z";

describe("Supervisor-first governance contracts", () => {
  it("keeps identity role separate from an assumed Root role", () => {
    const seat = Schema.decodeUnknownSync(AgentSeat)({
      id: "seat-supervisor",
      workspaceId: "workspace-default",
      roomIds: ["room-1"],
      identityRole: "supervisor",
      effectiveRole: "acting_root",
      profileId: "profile-supervisor",
      providerSessionId: null,
      lifecycleState: "active",
      workState: "running",
      authorityReceiptId: "receipt-supervisor",
      createdAt: now,
      retainedAt: null,
      retiredAt: null,
      revision: 1,
      updatedAt: now,
    });

    assert.equal(seat.identityRole, "supervisor");
    assert.equal(seat.effectiveRole, "acting_root");
  });

  it("represents authority as an immutable fail-closed snapshot", () => {
    const receipt = Schema.decodeUnknownSync(EffectiveAuthorityReceipt)({
      id: "receipt-peer",
      actorSeatId: "seat-peer",
      identityRole: "peer",
      effectiveRole: "peer",
      workspaceScopes: ["workspace-default"],
      roomScopes: ["room-1"],
      taskNodeScopes: [],
      allowedCommands: [],
      allowedTools: [],
      rootLeaseIds: [],
      mandateIds: [],
      runPolicyRevision: 0,
      issuedAt: now,
      expiresAt: null,
      revokedAt: null,
    });

    assert.deepEqual(receipt.allowedCommands, []);
    assert.deepEqual(receipt.rootLeaseIds, []);
  });

  it("models one concrete holder per Root lease", () => {
    const lease = Schema.decodeUnknownSync(RootAuthorityLease)({
      id: "lease-room-1",
      workspaceId: "workspace-default",
      roomId: "room-1",
      holderSeatId: "seat-lead",
      status: "active",
      acquiredUnderReceiptId: "receipt-lead",
      predecessorLeaseId: null,
      acquiredAt: now,
      releasedAt: null,
      expiresAt: null,
      revision: 0,
      updatedAt: now,
    });

    assert.equal(lease.holderSeatId, "seat-lead");
    assert.equal(lease.status, "active");
  });

  it("keeps notebook provenance and supersession explicit", () => {
    const entry = Schema.decodeUnknownSync(SupervisorNotebookEntry)({
      id: "notebook-entry-1",
      workspaceId: "workspace-default",
      roomId: "room-1",
      taskNodeId: null,
      concern: "architecture",
      authorSeatId: "seat-supervisor",
      kind: "decision",
      content: "Keep one canonical command bus.",
      evidenceRefs: ["evidence-1"],
      confidence: 1,
      supersedesEntryId: null,
      protectionClass: "internal",
      redactedAt: null,
      createdAt: now,
    });

    assert.equal(entry.kind, "decision");
    assert.deepEqual(entry.evidenceRefs, ["evidence-1"]);
  });

  it("keeps notebook cursors and compaction lineage durable", () => {
    const cursor = Schema.decodeUnknownSync(SupervisorNotebookCursor)({
      id: "notebook-cursor-stage-5",
      workspaceId: "workspace-default",
      seatId: "seat-supervisor",
      lastCreatedAt: now,
      lastEntryId: "notebook-summary-stage-5",
      updatedAt: now,
    });
    const receipt = Schema.decodeUnknownSync(SupervisorNotebookCompactionReceipt)({
      id: "notebook-compaction-stage-5",
      workspaceId: "workspace-default",
      summaryEntryId: "notebook-summary-stage-5",
      sourceEntryIds: ["notebook-source-a", "notebook-source-b"],
      evidenceRefs: ["evidence-a"],
      createdBySeatId: "seat-supervisor",
      createdAt: now,
    });

    assert.equal(cursor.lastEntryId, receipt.summaryEntryId);
    assert.deepEqual(receipt.sourceEntryIds, ["notebook-source-a", "notebook-source-b"]);
  });

  it("rejects capability scores outside the calibrated range", () => {
    assert.throws(() =>
      Schema.decodeUnknownSync(ModelCapabilityProfile)({
        id: "model-sol",
        provider: "codex",
        model: "gpt-5.6-sol",
        version: "2026-08-09",
        available: true,
        contextCapacity: 128_000,
        supportsVision: true,
        supportsTools: true,
        supportsReasoning: true,
        latencyScore: 5,
        costScore: 10,
        scores: {
          coding: 11,
          architecture: 8,
          debugging: 8,
          review: 7,
          uiUx: 5,
          visualUnderstanding: 6,
          longContext: 8,
          structuredOutput: 8,
          agenticEndurance: 9,
          multilingual: 8,
        },
        provenance: ["owner-curated"],
        confidence: 1,
        revision: 1,
        updatedAt: now,
      }),
    );
  });
});
