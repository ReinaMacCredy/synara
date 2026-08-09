import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";

import { SupervisedGovernanceSnapshot } from "@synara/contracts";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { SupervisedGovernanceRepositoryLive } from "./SupervisedGovernanceRepository.ts";
import { SupervisedGovernanceRepository } from "../Services/SupervisedGovernanceRepository.ts";

const testLayer = it.layer(
  Layer.mergeAll(
    SupervisedGovernanceRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

const now = "2026-08-09T00:00:00.000Z";

const snapshot = Schema.decodeUnknownSync(SupervisedGovernanceSnapshot)({
  workspaces: [
    {
      id: "workspace-1",
      ownerNamespace: "owner-1",
      title: "Workspace",
      lifecycleState: "active",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    },
  ],
  authorityReceipts: [
    {
      id: "receipt-supervisor",
      actorSeatId: "seat-supervisor",
      identityRole: "supervisor",
      effectiveRole: "supervisor",
      workspaceScopes: ["workspace-1"],
      roomScopes: [],
      taskNodeScopes: [],
      allowedCommands: ["supervised.agent.create"],
      allowedTools: ["supervised.agents.list"],
      rootLeaseIds: [],
      mandateIds: ["mandate-1"],
      runPolicyRevision: 1,
      issuedAt: now,
      expiresAt: null,
      revokedAt: null,
    },
  ],
  agentSeats: [
    {
      id: "seat-supervisor",
      workspaceId: "workspace-1",
      roomIds: [],
      identityRole: "supervisor",
      effectiveRole: "supervisor",
      profileId: "profile-supervisor",
      concern: "primary",
      providerSessionId: null,
      lifecycleState: "active",
      workState: "idle",
      authorityReceiptId: "receipt-supervisor",
      createdAt: now,
      retainedAt: null,
      retiredAt: null,
      revision: 1,
      updatedAt: now,
    },
  ],
  rootLeases: [],
  humanDirectives: [
    {
      id: "directive-1",
      workspaceId: "workspace-1",
      roomId: null,
      text: "Observe the workspace and report material blockers.",
      scope: [{ kind: "workspace", workspaceId: "workspace-1" }],
      status: "active",
      sourceMessageId: "message-1",
      issuedAt: now,
      fulfilledAt: null,
      revokedAt: null,
      revision: 1,
      updatedAt: now,
    },
  ],
  standingMandates: [
    {
      id: "mandate-1",
      workspaceId: "workspace-1",
      sourceDirectiveId: "directive-1",
      subjectSeatId: "seat-supervisor",
      concern: "delivery",
      scope: [{ kind: "workspace", workspaceId: "workspace-1" }],
      allowedCommands: ["supervised.message.send"],
      status: "active",
      grantedAt: now,
      expiresAt: null,
      revokedAt: null,
      revision: 1,
      updatedAt: now,
    },
  ],
  directInterventions: [],
  notebookEntries: [
    {
      id: "notebook-1",
      workspaceId: "workspace-1",
      roomId: null,
      taskNodeId: null,
      concern: "delivery",
      authorSeatId: "seat-supervisor",
      kind: "observation",
      content: "No active Rooms.",
      evidenceRefs: [],
      confidence: 1,
      supersedesEntryId: null,
      protectionClass: "internal",
      redactedAt: null,
      createdAt: now,
    },
  ],
  modelCapabilityProfiles: [
    {
      id: "model-sol",
      provider: "codex",
      model: "gpt-5.6-sol",
      version: "2026-08-09",
      available: true,
      contextCapacity: 128000,
      supportsVision: true,
      supportsTools: true,
      supportsReasoning: true,
      latencyScore: 5,
      costScore: 10,
      scores: {
        coding: 8,
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
    },
  ],
  userModelPreferenceProfiles: [
    {
      id: "preference-owner",
      userId: "owner-1",
      revision: 1,
      ratings: { "model-sol": 9 },
      relativePreferences: [],
      preferredFor: { implementation: ["model-sol"] },
      avoidFor: {},
      priorities: { quality: 10, speed: 5, cost: 1, contextCapacity: 8 },
      defaultModels: { supervisor: "model-sol" },
      fallbackChains: { implementation: ["model-sol"] },
      updatedAt: now,
    },
  ],
  modelSelectionReceipts: [
    {
      id: "selection-1",
      workspaceId: "workspace-1",
      roomId: null,
      taskNodeId: null,
      actorSeatId: "seat-supervisor",
      selectedModelId: "model-sol",
      candidateModelIds: ["model-sol"],
      hardConstraints: ["tools"],
      explanation: "Only candidate satisfied the hard constraints.",
      rejectedReasons: {},
      capabilityProfileRevision: 1,
      preferenceProfileRevision: 1,
      runPolicyRevision: 1,
      overrideReason: null,
      createdAt: now,
    },
  ],
  updatedAt: now,
});

testLayer("SupervisedGovernanceRepository", (it) => {
  it.effect("round-trips the canonical governance snapshot", () =>
    Effect.gen(function* () {
      const repository = yield* SupervisedGovernanceRepository;
      yield* repository.replaceSnapshot(snapshot);

      const reloaded = yield* repository.getSnapshot();

      assert.deepStrictEqual(reloaded, snapshot);
    }),
  );
});
