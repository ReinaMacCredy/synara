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
  UserModelPreferenceProfileId,
  emptySupervisedGovernanceSnapshot,
} from "@veylen/contracts";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SupervisedGovernanceRepositoryLive } from "../../persistence/Layers/SupervisedGovernanceRepository.ts";
import { runMigrations } from "../../persistence/Migrations.ts";
import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import { SupervisedGovernanceRepository } from "../../persistence/Services/SupervisedGovernanceRepository.ts";
import { makeSupervisedTools } from "../../orchestration/supervised/toolRegistry.ts";
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
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "veylen-model-routing-"));
    tempDirectories.push(directory);
    const filename = path.join(directory, "state.sqlite");

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* runMigrations();
        const repository = yield* SupervisedGovernanceRepository;
        const service = yield* ModelRoutingService;
        yield* repository.replaceSnapshot(seed);
        const invalidCreation = yield* service
          .putCapabilityProfile({
            profile: {
              ...seed.modelCapabilityProfiles[0]!,
              id: ModelCapabilityProfileId.makeUnsafe("model-invalid-initial-revision"),
              model: "invalid-initial-revision",
              revision: 2,
            },
            expectedRevision: null,
          })
          .pipe(Effect.flip);
        assert.ok(invalidCreation instanceof ModelRoutingDomainError);
        assert.equal(invalidCreation.code, "capability_profile_conflict");
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
    assert.equal(reloaded.snapshot.authorityReceipts[0]!.id, seed.authorityReceipts[0]!.id);
    assert.equal(reloaded.ownState.preferenceProfile?.userId, "user-routing");
    assert.equal(reloaded.otherState.preferenceProfile, null);
  });

  it("rejects selection when the acting seat's canonical authority is revoked", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "veylen-model-routing-revoked-"));
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

  it("uses the next owner preference through the Supervisor HostTool without changing Root/Lead authority", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "veylen-model-preference-"));
    tempDirectories.push(directory);
    const filename = path.join(directory, "state.sqlite");

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* runMigrations();
        const repository = yield* SupervisedGovernanceRepository;
        const service = yield* ModelRoutingService;
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          INSERT INTO projection_projects (
            project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
          ) VALUES (
            'project-lead', 'project', 'Lead authority project', '/tmp/project-lead', '[]',
            ${now}, ${now}
          )
        `;
        yield* sql`
          INSERT INTO projection_supervised_rooms (
            room_id, project_id, lead_seat_id, status, graph_revision, revision,
            updated_at, entity_json
          ) VALUES (
            'room-lead', 'project-lead', NULL, 'active', 0, 0, ${now}, '{}'
          )
        `;
        const sol = {
          ...seed.modelCapabilityProfiles[0]!,
          id: ModelCapabilityProfileId.makeUnsafe("model-sol"),
          provider: "codex" as const,
          model: "gpt-5.6-sol",
        };
        const fable = {
          ...seed.modelCapabilityProfiles[0]!,
          id: ModelCapabilityProfileId.makeUnsafe("model-fable"),
          provider: "claudeAgent" as const,
          model: "claude-fable-5",
        };
        const withoutTools = {
          ...seed.modelCapabilityProfiles[0]!,
          id: ModelCapabilityProfileId.makeUnsafe("model-without-tools"),
          model: "fixture-without-tools",
          supportsTools: false,
        };
        const ownerPreference = (
          preferred: typeof sol.id,
          other: typeof sol.id,
          revision: number,
        ) => ({
          id: UserModelPreferenceProfileId.makeUnsafe("owner-preference"),
          userId: "owner",
          revision,
          ratings: { [preferred]: 10, [other]: 0, [withoutTools.id]: 10 },
          relativePreferences: [
            {
              preferredModelId: preferred,
              overModelId: other,
              category: "implementation",
              reason: "Owner preference",
            },
          ],
          preferredFor: { implementation: [preferred] },
          avoidFor: {},
          priorities: { quality: 10, speed: 5, cost: 5, contextCapacity: 5 },
          defaultModels: { supervisor: preferred },
          fallbackChains: { implementation: [preferred, other] },
          ownerNotes: "Persisted from Settings.",
          updatedAt: "2026-08-09T05:01:00.000Z",
        });
        const scenarioSeed = Schema.decodeUnknownSync(SupervisedGovernanceSnapshot)({
          ...seed,
          agentSeats: [
            {
              ...seed.agentSeats[0]!,
              id: "seat-supervisor-routing",
              authorityReceiptId: "authority-supervisor-routing",
              threadId: "thread-supervisor-routing",
            },
            {
              ...seed.agentSeats[0]!,
              id: "seat-lead-authority",
              roomIds: ["room-lead"],
              identityRole: "lead",
              effectiveRole: "lead",
              authorityReceiptId: "authority-lead",
              threadId: "thread-lead-authority",
              projectId: "project-lead",
            },
          ],
          authorityReceipts: [
            {
              ...seed.authorityReceipts[0]!,
              id: "authority-supervisor-routing",
              actorSeatId: "seat-supervisor-routing",
              allowedCommands: ["model.selection.record"],
              allowedTools: ["supervised.models.recommend"],
            },
            {
              ...seed.authorityReceipts[0]!,
              id: "authority-lead",
              actorSeatId: "seat-lead-authority",
              identityRole: "lead",
              effectiveRole: "lead",
              roomScopes: ["room-lead"],
              allowedCommands: ["task.accept"],
              allowedTools: ["supervised.task.get"],
              rootLeaseIds: ["lease-lead-root"],
            },
          ],
          rootLeases: [
            {
              id: "lease-lead-root",
              workspaceId: "workspace-routing",
              roomId: "room-lead",
              holderSeatId: "seat-lead-authority",
              status: "active",
              acquiredUnderReceiptId: "authority-lead",
              predecessorLeaseId: null,
              acquiredAt: now,
              releasedAt: null,
              expiresAt: null,
              revision: 1,
              updatedAt: now,
            },
          ],
          modelCapabilityProfiles: [sol, fable, withoutTools],
          userModelPreferenceProfiles: [ownerPreference(sol.id, fable.id, 1)],
        });
        yield* repository.replaceSnapshot(scenarioSeed);
        const authorityBefore = structuredClone({
          lead: scenarioSeed.agentSeats.find((seat) => seat.id === "seat-lead-authority"),
          receipt: scenarioSeed.authorityReceipts.find(
            (receipt) => receipt.id === "authority-lead",
          ),
          leases: scenarioSeed.rootLeases,
        });
        const tools = makeSupervisedTools({
          governanceRepository: repository,
          modelRoutingService: service,
          snapshotQuery: {
            getSnapshot: () =>
              Effect.succeed({
                snapshotSequence: 0,
                spaces: [],
                projects: [],
                threads: [],
                supervised: {
                  rooms: [],
                  taskNodes: [],
                  runPolicies: [builtInRunPolicy(now)],
                },
                updatedAt: now,
              } as never),
          } as never,
          orchestrationEngine: {} as never,
          runtimeDaemon: {} as never,
          getProviderAvailability: () =>
            Effect.succeed({ codex: true, claudeAgent: providerAvailability.claudeAgent }),
        });
        const recommend = tools.find(
          (tool) => tool.definition.name === "recommend_supervised_model",
        )!;
        const context = {
          callerThreadId: "thread-supervisor-routing",
          callerSessionKey: "session-supervisor-routing",
          callerProvider: "codex" as const,
          callerTurnId: "turn-supervisor-routing",
          callerDispatchOrigin: "supervised" as const,
          assertCallerTurnActive: () => Effect.succeed(undefined),
        };
        const providerAvailability = { claudeAgent: true };
        const withoutProfilesRevision = (yield* repository.getSnapshot()).revision;
        yield* repository.replaceSnapshot({
          ...scenarioSeed,
          revision: withoutProfilesRevision,
          modelCapabilityProfiles: [],
          userModelPreferenceProfiles: [],
        });
        const missingProfile = yield* recommend.execute(
          { taskCategory: "implementation" },
          context,
        );
        assert.equal(missingProfile.ok, false);
        if (missingProfile.ok) assert.fail("Expected a missing-profile failure.");
        assert.equal(missingProfile.error.code, "supervised_model_profile_required");
        assert.deepEqual(missingProfile.error.details, {
          status: "needs_owner_curated_profile",
        });
        const restoreRevision = (yield* repository.getSnapshot()).revision;
        yield* repository.replaceSnapshot({ ...scenarioSeed, revision: restoreRevision });
        const before = yield* recommend.execute({ taskCategory: "implementation" }, context);
        yield* service.putUserPreferenceProfile({
          profile: ownerPreference(fable.id, sol.id, 2),
          expectedRevision: 1,
        });
        const after = yield* recommend.execute({ taskCategory: "implementation" }, context);
        providerAvailability.claudeAgent = false;
        const afterProviderFailure = yield* recommend.execute(
          { taskCategory: "implementation" },
          context,
        );
        const persisted = yield* repository.getSnapshot();
        const authorityAfter = structuredClone({
          lead: persisted.agentSeats.find((seat) => seat.id === "seat-lead-authority"),
          receipt: persisted.authorityReceipts.find((receipt) => receipt.id === "authority-lead"),
          leases: persisted.rootLeases,
        });
        return {
          before,
          after,
          afterProviderFailure,
          persisted,
          authorityBefore,
          authorityAfter,
        };
      }).pipe(Effect.provide(makeLayer(filename))),
    );

    assert.equal(result.before.ok, true);
    assert.equal(result.after.ok, true);
    assert.equal(result.afterProviderFailure.ok, true);
    if (!result.before.ok || !result.after.ok || !result.afterProviderFailure.ok) {
      assert.fail("Expected successful recommendations.");
    }
    const first = result.before.value as {
      receipt: { selectedModelId: string; rejectedReasons: Record<string, string> };
    };
    const second = result.after.value as { receipt: { selectedModelId: string } };
    const providerFallback = result.afterProviderFailure.value as {
      receipt: { selectedModelId: string; rejectedReasons: Record<string, string> };
    };
    assert.equal(first.receipt.selectedModelId, "model-sol");
    assert.equal(second.receipt.selectedModelId, "model-fable");
    assert.equal(providerFallback.receipt.selectedModelId, "model-sol");
    assert.match(providerFallback.receipt.rejectedReasons["model-fable"]!, /unavailable/);
    assert.match(first.receipt.rejectedReasons["model-without-tools"]!, /Tool use is required/);
    assert.equal(result.persisted.modelSelectionReceipts.length, 3);
    assert.ok(
      result.persisted.modelSelectionReceipts.every((receipt) =>
        /Owner preference|Personal rating/.test(receipt.explanation),
      ),
    );
    assert.equal(
      result.persisted.modelSelectionReceipts.find(
        (receipt) => receipt.selectedModelId === "model-fable",
      )?.preferenceProfileRevision,
      2,
    );
    assert.deepEqual(result.authorityAfter, result.authorityBefore);
  });
});
