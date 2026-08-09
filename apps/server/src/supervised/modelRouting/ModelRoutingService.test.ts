import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, it } from "vitest";
import {
  AgentSeatId,
  ModelCapabilityProfileId,
  ModelSelectionReceiptId,
  SupervisedGovernanceSnapshot,
  SupervisedWorkspaceId,
  emptySupervisedGovernanceSnapshot,
} from "@synara/contracts";
import { Effect, Layer, Schema } from "effect";

import { SupervisedGovernanceRepositoryLive } from "../../persistence/Layers/SupervisedGovernanceRepository.ts";
import { runMigrations } from "../../persistence/Migrations.ts";
import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import { SupervisedGovernanceRepository } from "../../persistence/Services/SupervisedGovernanceRepository.ts";
import { builtInRunPolicy } from "../signal/BuiltInSubscriptions.ts";
import type { ModelRoutingRequest } from "./ModelRouting.ts";
import {
  ModelRoutingDomainError,
  ModelRoutingService,
  ModelRoutingServiceLive,
} from "./ModelRoutingService.ts";

const now = "2026-08-09T05:00:00.000Z";
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

const makeLayer = (filename: string) => {
  const sqlite = NodeSqliteClient.layer({ filename });
  return ModelRoutingServiceLive.pipe(
    Layer.provideMerge(SupervisedGovernanceRepositoryLive),
    Layer.provideMerge(sqlite),
  );
};

const seed = Schema.decodeUnknownSync(SupervisedGovernanceSnapshot)({
  ...emptySupervisedGovernanceSnapshot(now),
  workspaces: [
    {
      id: "workspace-routing",
      ownerNamespace: "owner-routing",
      title: "Routing Workspace",
      lifecycleState: "active",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    },
  ],
  authorityReceipts: [
    {
      id: "authority-routing",
      actorSeatId: "seat-routing",
      identityRole: "supervisor",
      effectiveRole: "supervisor",
      workspaceScopes: ["workspace-routing"],
      roomScopes: [],
      taskNodeScopes: [],
      allowedCommands: [],
      allowedTools: [],
      rootLeaseIds: [],
      mandateIds: [],
      runPolicyRevision: 0,
      issuedAt: now,
      expiresAt: null,
      revokedAt: null,
    },
  ],
  agentSeats: [
    {
      id: "seat-routing",
      workspaceId: "workspace-routing",
      roomIds: [],
      identityRole: "supervisor",
      effectiveRole: "supervisor",
      profileId: "agent-profile-routing",
      concern: "routing",
      providerSessionId: null,
      lifecycleState: "active",
      workState: "idle",
      authorityReceiptId: "authority-routing",
      createdAt: now,
      retainedAt: null,
      retiredAt: null,
      revision: 1,
      updatedAt: now,
    },
  ],
  modelCapabilityProfiles: [
    {
      id: "model-routing",
      provider: "codex",
      model: "gpt-routing",
      version: "2026-08-09",
      available: true,
      contextCapacity: 200_000,
      supportsVision: true,
      supportsTools: true,
      supportsReasoning: true,
      latencyScore: 8,
      costScore: 8,
      inputCostUsdPerMillionTokens: 1,
      outputCostUsdPerMillionTokens: 2,
      failureRate: 0,
      retryRate: 0,
      scores: {
        coding: 9,
        architecture: 9,
        debugging: 9,
        review: 9,
        uiUx: 9,
        visualUnderstanding: 9,
        longContext: 9,
        structuredOutput: 9,
        agenticEndurance: 9,
        multilingual: 9,
      },
      provenance: ["provider-metadata", "owner-curated"],
      confidence: 0.9,
      revision: 1,
      updatedAt: now,
    },
  ],
  userModelPreferenceProfiles: [
    {
      id: "preference-routing",
      userId: "user-routing",
      revision: 1,
      ratings: { "model-routing": 9 },
      relativePreferences: [],
      preferredFor: { implementation: ["model-routing"] },
      avoidFor: {},
      priorities: { quality: 10, speed: 5, cost: 5, contextCapacity: 5 },
      defaultModels: { supervisor: "model-routing" },
      fallbackChains: { implementation: ["model-routing"] },
      updatedAt: now,
    },
  ],
});

const request: ModelRoutingRequest = {
  userId: "user-routing",
  taskCategory: "implementation",
  agentRole: "supervisor",
  workspaceId: SupervisedWorkspaceId.makeUnsafe("workspace-routing"),
  roomId: null,
  taskNodeId: null,
  actorSeatId: AgentSeatId.makeUnsafe("seat-routing"),
  providerAvailability: { codex: true },
  requirements: { requiresTools: true },
  runPolicy: builtInRunPolicy(now),
  routingRevision: 1,
  createdAt: now,
};

describe("ModelRoutingService persistence", () => {
  it("reloads selection receipts and telemetry after the SQLite connection restarts", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "synara-model-routing-"));
    tempDirectories.push(directory);
    const filename = path.join(directory, "state.sqlite");

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* runMigrations();
        const repository = yield* SupervisedGovernanceRepository;
        const service = yield* ModelRoutingService;
        yield* repository.replaceSnapshot(seed);
        yield* service.putCapabilityProfile({
          profile: { ...seed.modelCapabilityProfiles[0]!, latencyScore: 9, revision: 2 },
          expectedRevision: 1,
        });
        yield* service.putUserPreferenceProfile({
          profile: { ...seed.userModelPreferenceProfiles[0]!, revision: 2 },
          expectedRevision: 1,
        });
        const routingRevision = (yield* repository.getSnapshot()).revision;
        const staleError = yield* service
          .select({
            receiptId: ModelSelectionReceiptId.makeUnsafe("selection-stale"),
            request: { ...request, routingRevision: routingRevision - 1 },
          })
          .pipe(Effect.flip);
        assert.ok(staleError instanceof ModelRoutingDomainError);
        assert.equal(staleError.code, "routing_revision_conflict");
        yield* service.select({
          receiptId: ModelSelectionReceiptId.makeUnsafe("selection-routing"),
          request: { ...request, routingRevision },
        });
        yield* service.recordOutcome({
          modelProfileId: ModelCapabilityProfileId.makeUnsafe("model-routing"),
          category: "implementation",
          succeeded: true,
          retries: 0,
          latencyMs: 800,
          costUsd: 0.01,
          completedAt: "2026-08-09T05:00:01.000Z",
        });
      }).pipe(Effect.provide(makeLayer(filename))),
    );

    const reloaded = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SupervisedGovernanceRepository;
        const service = yield* ModelRoutingService;
        return {
          snapshot: yield* repository.getSnapshot(),
          ownState: yield* service.getState("user-routing"),
          otherState: yield* service.getState("another-user"),
        };
      }).pipe(Effect.provide(makeLayer(filename))),
    );

    assert.equal(reloaded.snapshot.modelSelectionReceipts.length, 1);
    assert.equal(reloaded.snapshot.modelSelectionReceipts[0]!.selectedModelId, "model-routing");
    assert.equal(reloaded.snapshot.modelSelectionReceipts[0]!.capabilityProfileRevision, 2);
    assert.equal(reloaded.snapshot.modelSelectionReceipts[0]!.preferenceProfileRevision, 2);
    assert.equal(reloaded.snapshot.modelSelectionReceipts[0]!.runPolicyRevision, 0);
    assert.equal(reloaded.snapshot.modelSelectionReceipts[0]!.routingRevision, 3);
    assert.equal(reloaded.snapshot.modelCapabilityProfiles[0]!.revision, 2);
    assert.equal(reloaded.snapshot.userModelPreferenceProfiles[0]!.revision, 2);
    assert.equal(reloaded.snapshot.modelTelemetryAggregates.length, 1);
    assert.equal(reloaded.snapshot.modelTelemetryAggregates[0]!.sampleCount, 1);
    assert.equal(reloaded.snapshot.modelTelemetryAggregates[0]!.successCount, 1);
    assert.equal(reloaded.snapshot.workspaces[0]!.id, seed.workspaces[0]!.id);
    assert.equal(reloaded.snapshot.agentSeats[0]!.id, seed.agentSeats[0]!.id);
    assert.equal(
      reloaded.snapshot.authorityReceipts[0]!.id,
      seed.authorityReceipts[0]!.id,
    );
    assert.equal(reloaded.ownState.preferenceProfile?.userId, "user-routing");
    assert.equal(reloaded.otherState.preferenceProfile, null);
  });

  it("rejects selection when the acting seat's canonical authority is revoked", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "synara-model-routing-revoked-"));
    tempDirectories.push(directory);
    const filename = path.join(directory, "state.sqlite");

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        yield* runMigrations();
        const repository = yield* SupervisedGovernanceRepository;
        const service = yield* ModelRoutingService;
        yield* repository.replaceSnapshot({
          ...seed,
          authorityReceipts: [{ ...seed.authorityReceipts[0]!, revokedAt: now }],
        });
        const routingRevision = (yield* repository.getSnapshot()).revision;
        return yield* service
          .select({
            receiptId: ModelSelectionReceiptId.makeUnsafe("selection-revoked"),
            request: { ...request, routingRevision },
          })
          .pipe(Effect.flip);
      }).pipe(Effect.provide(makeLayer(filename))),
    );

    assert.ok(error instanceof ModelRoutingDomainError);
    assert.equal(error.code, "routing_authority_denied");
  });
});
