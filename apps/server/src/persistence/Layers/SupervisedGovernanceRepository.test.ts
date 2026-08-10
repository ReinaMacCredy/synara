import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

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
  revision: 0,
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
      providerSessionId: "provider-supervisor",
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
  providerSessions: [
    {
      id: "provider-supervisor",
      workspaceId: "workspace-1",
      seatId: "seat-supervisor",
      provider: "codex",
      nativeSessionId: "native-supervisor",
      lifecycleState: "active",
      createdAt: now,
      retainedAt: null,
      closedAt: null,
      revision: 1,
      updatedAt: now,
    },
  ],
  rootLeases: [],
  handoffs: [],
  roleAssumptions: [],
  leadReplacements: [],
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
  modelTelemetryAggregates: [
    {
      id: "telemetry-model-sol-implementation",
      modelProfileId: "model-sol",
      category: "implementation",
      sampleCount: 20,
      successCount: 18,
      failureCount: 2,
      retryCount: 1,
      totalLatencyMs: 20_000,
      totalCostUsd: 0.2,
      confidence: 0.8,
      revision: 20,
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

      const { orchestration, ...reloadedGovernance } = reloaded;
      const { orchestration: _emptyOrchestration, ...expectedGovernance } = snapshot;
      assert.deepStrictEqual(reloadedGovernance, { ...expectedGovernance, revision: 1 });
      assert.deepStrictEqual(orchestration.agentSeats, reloaded.agentSeats);
      assert.deepStrictEqual(
        orchestration.profiles.map((profile) => profile.id),
        [
          "profile-lead-default",
          "profile-peer-implementer",
          "profile-peer-reviewer",
          "profile-supervisor-default",
        ],
      );
    }),
  );

  it.effect("rejects a stale competing snapshot writer", () =>
    Effect.gen(function* () {
      const repository = yield* SupervisedGovernanceRepository;
      const before = yield* repository.getSnapshot();
      const competingSnapshot = { ...snapshot, revision: before.revision };
      yield* repository.replaceSnapshot(competingSnapshot);

      const competingWrite = yield* Effect.exit(repository.replaceSnapshot(competingSnapshot));
      const reloaded = yield* repository.getSnapshot();

      assert.equal(competingWrite._tag, "Failure");
      assert.equal(reloaded.revision, before.revision + 1);
    }),
  );

  it.effect("updates only the orchestration slice for canonical governance events", () =>
    Effect.gen(function* () {
      const repository = yield* SupervisedGovernanceRepository;
      const sql = yield* SqlClient.SqlClient;
      const initial = yield* repository.getSnapshot();
      yield* repository.replaceSnapshot({ ...snapshot, revision: initial.revision });
      const before = yield* repository.getSnapshot();
      yield* sql`
        CREATE TRIGGER reject_governance_workspace_delete
        BEFORE DELETE ON projection_supervised_workspaces
        BEGIN
          SELECT RAISE(FAIL, 'orchestration-only update deleted governance entities');
        END
      `;

      const profile = before.orchestration.profiles[0]!;
      yield* repository.replaceOrchestration({
        expectedRevision: before.revision,
        orchestration: {
          ...before.orchestration,
          profiles: [{ ...profile, name: "Lead Updated", revision: profile.revision + 1 }],
          revision: before.orchestration.revision + 1,
          updatedAt: "2026-08-09T00:01:00.000Z",
        },
        updatedAt: "2026-08-09T00:01:00.000Z",
      });

      const reloaded = yield* repository.getSnapshot();
      assert.equal(reloaded.revision, before.revision + 1);
      assert.equal(reloaded.orchestration.profiles[0]?.name, "Lead Updated");
      assert.deepStrictEqual(reloaded.workspaces, before.workspaces);
      yield* sql`DROP TRIGGER reject_governance_workspace_delete`;
    }),
  );

  it.effect("preserves persisted Supervisor profiles while adding missing defaults", () =>
    Effect.gen(function* () {
      const repository = yield* SupervisedGovernanceRepository;
      const before = yield* repository.getSnapshot();
      const supervisorProfile = {
        id: "profile-primary-supervisor" as const,
        name: "Primary Supervisor",
        roleHints: ["supervisor" as const],
        runtime: {
          provider: "codex" as const,
          model: "gpt-5.6-luna",
          reasoningEffort: "high",
          sandboxMode: "danger-full-access" as const,
          approvalPolicy: "never" as const,
          developerInstructions: "Preserve this owner-authored profile.",
          providerOptions: { features: { multi_agent: false } },
        },
        isDefault: false,
        createdAt: now,
        updatedAt: now,
        archivedAt: now,
        revision: 7,
      };
      const customizedBuiltInProfile = {
        ...supervisorProfile,
        id: "profile-peer-implementer" as const,
        name: "My retained implementation profile",
        roleHints: ["peer" as const],
      };

      yield* repository.replaceSnapshot({
        ...snapshot,
        revision: before.revision,
        orchestration: {
          ...snapshot.orchestration,
          profiles: [supervisorProfile, customizedBuiltInProfile],
        },
      });

      const reloaded = yield* repository.getSnapshot();
      assert.deepStrictEqual(
        reloaded.orchestration.profiles.find((profile) => profile.id === supervisorProfile.id),
        supervisorProfile,
      );
      assert.deepStrictEqual(
        reloaded.orchestration.profiles.find(
          (profile) => profile.id === customizedBuiltInProfile.id,
        ),
        customizedBuiltInProfile,
      );
      assert.deepStrictEqual(
        reloaded.orchestration.profiles.map((profile) => profile.id),
        [
          supervisorProfile.id,
          customizedBuiltInProfile.id,
          "profile-lead-default",
          "profile-peer-reviewer",
          "profile-supervisor-default",
        ],
      );
    }),
  );

  it.effect("reinserts notebook supersession chains in foreign-key order", () =>
    Effect.gen(function* () {
      const repository = yield* SupervisedGovernanceRepository;
      const before = yield* repository.getSnapshot();
      const predecessor = snapshot.notebookEntries[0]!;
      const successor = {
        ...predecessor,
        id: "notebook-2" as typeof predecessor.id,
        content: "Updated observation.",
        supersedesEntryId: predecessor.id,
        createdAt: "2026-08-09T00:01:00.000Z",
      };

      yield* repository.replaceSnapshot({
        ...snapshot,
        revision: before.revision,
        notebookEntries: [successor, predecessor],
      });
      const reloaded = yield* repository.getSnapshot();

      assert.deepStrictEqual(
        reloaded.notebookEntries.map((entry) => entry.id),
        [successor.id, predecessor.id],
      );
    }),
  );

  it.effect("appends notebook facts idempotently without overwriting concurrent entries", () =>
    Effect.gen(function* () {
      const repository = yield* SupervisedGovernanceRepository;
      let current = yield* repository.getSnapshot();
      if (!current.workspaces.some((workspace) => workspace.id === snapshot.workspaces[0]!.id)) {
        yield* repository.replaceSnapshot({ ...snapshot, revision: current.revision });
        current = yield* repository.getSnapshot();
      }
      const primarySeat = current.agentSeats.find((seat) => seat.id === "seat-supervisor")!;
      const primaryReceipt = current.authorityReceipts.find(
        (receipt) => receipt.id === primarySeat.authorityReceiptId,
      )!;
      if (!current.agentSeats.some((seat) => seat.id === "seat-supervisor-successor")) {
        yield* repository.replaceSnapshot({
          ...current,
          authorityReceipts: [
            ...current.authorityReceipts,
            {
              ...primaryReceipt,
              id: "receipt-supervisor-successor" as typeof primaryReceipt.id,
              actorSeatId: "seat-supervisor-successor" as typeof primaryReceipt.actorSeatId,
              rootLeaseIds: [],
            },
          ],
          agentSeats: [
            ...current.agentSeats,
            {
              ...primarySeat,
              id: "seat-supervisor-successor" as typeof primarySeat.id,
              authorityReceiptId:
                "receipt-supervisor-successor" as typeof primarySeat.authorityReceiptId,
              providerSessionId: null,
              threadId: "thread-supervisor-successor" as typeof primarySeat.threadId,
              displayName: "Successor Supervisor",
            },
          ],
        });
      }
      const first = {
        ...snapshot.notebookEntries[0]!,
        id: "notebook-concurrent-1" as (typeof snapshot.notebookEntries)[number]["id"],
      };
      const second = {
        ...first,
        id: "notebook-concurrent-2" as typeof first.id,
        content: "A separately appended observation.",
        authorSeatId: "seat-supervisor-successor" as typeof first.authorSeatId,
        createdAt: "2026-08-09T00:01:00.000Z",
      };

      const inserted = yield* Effect.all(
        [repository.appendNotebookEntry(first), repository.appendNotebookEntry(second)],
        { concurrency: "unbounded" },
      );
      assert.deepEqual(inserted, [true, true]);
      assert.equal(yield* repository.appendNotebookEntry({ ...first, content: "must not replace" }), false);
      const invalidSupersession = yield* Effect.exit(
        repository.appendNotebookEntry({
          ...first,
          id: "notebook-invalid-supersession" as typeof first.id,
          supersedesEntryId: "notebook-missing" as typeof first.id,
        }),
      );
      assert.equal(invalidSupersession._tag, "Failure");

      const state = yield* repository.getNotebookState({
        workspaceId: first.workspaceId,
        seatId: first.authorSeatId,
        limit: 20,
      });
      assert.equal(state.entries.some((entry) => entry.id === first.id), true);
      assert.equal(state.entries.some((entry) => entry.id === second.id), true);
      assert.equal(state.entries.find((entry) => entry.id === first.id)?.content, first.content);
      assert.deepEqual(
        state.entries
          .filter((entry) => entry.id === first.id || entry.id === second.id)
          .map((entry) => entry.authorSeatId)
          .toSorted(),
        [first.authorSeatId, second.authorSeatId].toSorted(),
      );
    }),
  );

  it.effect("applies notebook authority and content scope before the repository limit", () =>
    Effect.gen(function* () {
      const repository = yield* SupervisedGovernanceRepository;
      const sql = yield* SqlClient.SqlClient;
      const current = yield* repository.getSnapshot();
      if (!current.workspaces.some((workspace) => workspace.id === snapshot.workspaces[0]!.id)) {
        yield* repository.replaceSnapshot({ ...snapshot, revision: current.revision });
      }
      yield* sql`
        INSERT OR IGNORE INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
        ) VALUES (
          'project-notebook-scope', 'project', 'Notebook scope', '/tmp/notebook-scope', '[]',
          ${now}, ${now}
        )
      `;
      for (const roomId of ["room-notebook-visible", "room-notebook-hidden"] as const) {
        yield* sql`
          INSERT OR IGNORE INTO projection_supervised_rooms (
            room_id, project_id, lead_seat_id, status, graph_revision, revision,
            updated_at, entity_json
          ) VALUES (
            ${roomId}, 'project-notebook-scope', NULL, 'active', 0, 0, ${now}, '{}'
          )
        `;
        const taskId = `task-${roomId}`;
        const taskNodeId = `node-${roomId}`;
        yield* sql`
          INSERT OR IGNORE INTO projection_supervised_tasks (
            task_id, room_id, lifecycle, graph_revision, revision, updated_at, entity_json
          ) VALUES (${taskId}, ${roomId}, 'active', 0, 0, ${now}, '{}')
        `;
        yield* sql`
          INSERT OR IGNORE INTO projection_supervised_task_nodes (
            task_node_id, task_id, room_id, active_revision_id, lifecycle,
            graph_revision, revision, updated_at, entity_json
          ) VALUES (
            ${taskNodeId}, ${taskId}, ${roomId}, 'revision-notebook-scope', 'ready',
            0, 0, ${now}, '{}'
          )
        `;
      }

      const template = snapshot.notebookEntries[0]!;
      const visible = {
        ...template,
        id: "notebook-scope-visible" as typeof template.id,
        roomId: "room-notebook-visible" as typeof template.roomId,
        taskNodeId: "node-room-notebook-visible" as typeof template.taskNodeId,
        content: "Needle retained in the authorized TaskNode.",
        createdAt: "2026-08-09T00:01:00.000Z",
      };
      const hiddenRoom = {
        ...visible,
        id: "notebook-scope-hidden-room" as typeof visible.id,
        roomId: "room-notebook-hidden" as typeof visible.roomId,
        taskNodeId: "node-room-notebook-hidden" as typeof visible.taskNodeId,
        createdAt: "2026-08-09T00:04:00.000Z",
      };
      const hiddenProtection = {
        ...visible,
        id: "notebook-scope-hidden-protection" as typeof visible.id,
        protectionClass: "secret",
        createdAt: "2026-08-09T00:03:00.000Z",
      };
      const hiddenQuery = {
        ...visible,
        id: "notebook-scope-hidden-query" as typeof visible.id,
        content: "Does not contain the requested term.",
        createdAt: "2026-08-09T00:02:00.000Z",
      };
      for (const notebookEntry of [visible, hiddenRoom, hiddenProtection, hiddenQuery]) {
        assert.equal(yield* repository.appendNotebookEntry(notebookEntry), true);
      }

      const scoped = yield* repository.getNotebookState({
        workspaceId: visible.workspaceId,
        seatId: visible.authorSeatId,
        roomIds: [visible.roomId!],
        includeWorkspaceEntries: false,
        taskNodeIds: [visible.taskNodeId!],
        includeUnscopedTaskNodes: false,
        concern: visible.concern,
        query: "needle",
        allowedProtectionClasses: ["internal"],
        includeRedacted: false,
        limit: 1,
      });
      assert.deepEqual(scoped.entries.map((entry) => entry.id), [visible.id]);
    }),
  );

  it.effect("persists compaction receipts and never regresses a seat cursor", () =>
    Effect.gen(function* () {
      const repository = yield* SupervisedGovernanceRepository;
      const current = yield* repository.getSnapshot();
      if (!current.workspaces.some((workspace) => workspace.id === snapshot.workspaces[0]!.id)) {
        yield* repository.replaceSnapshot({ ...snapshot, revision: current.revision });
      }
      const source = {
        ...snapshot.notebookEntries[0]!,
        id: "notebook-compaction-source" as (typeof snapshot.notebookEntries)[number]["id"],
        evidenceRefs: ["evidence:source"],
      };
      const summary = {
        ...source,
        id: "notebook-summary" as typeof source.id,
        kind: "lesson" as const,
        content: "Compacted lesson.",
        evidenceRefs: ["evidence:source"],
        createdAt: "2026-08-09T00:02:00.000Z",
      };
      const receipt = {
        id: "notebook-compaction-1" as const,
        workspaceId: source.workspaceId,
        summaryEntryId: summary.id,
        sourceEntryIds: [source.id],
        evidenceRefs: ["evidence:source"],
        createdBySeatId: source.authorSeatId,
        createdAt: summary.createdAt,
      };
      assert.equal(yield* repository.appendNotebookEntry(source), true);
      const invalid = yield* Effect.exit(
        repository.appendNotebookCompaction({
          summaryEntry: { ...summary, id: "notebook-summary-invalid" as typeof summary.id },
          receipt: {
            ...receipt,
            id: "notebook-compaction-invalid" as typeof receipt.id,
            summaryEntryId: "notebook-summary-invalid" as typeof summary.id,
            sourceEntryIds: ["notebook-source-missing" as typeof source.id],
          },
        }),
      );
      assert.equal(invalid._tag, "Failure");
      const invalidEvidence = yield* Effect.exit(
        repository.appendNotebookCompaction({
          summaryEntry: {
            ...summary,
            id: "notebook-summary-evidence-invalid" as typeof summary.id,
            evidenceRefs: [],
          },
          receipt: {
            ...receipt,
            id: "notebook-compaction-evidence-invalid" as typeof receipt.id,
            summaryEntryId: "notebook-summary-evidence-invalid" as typeof summary.id,
            evidenceRefs: [],
          },
        }),
      );
      assert.equal(invalidEvidence._tag, "Failure");
      assert.equal(yield* repository.appendNotebookCompaction({ summaryEntry: summary, receipt }), true);
      assert.equal(yield* repository.appendNotebookCompaction({ summaryEntry: summary, receipt }), false);

      const newestCursor = {
        id: "cursor-newest" as const,
        workspaceId: source.workspaceId,
        seatId: source.authorSeatId,
        lastCreatedAt: summary.createdAt,
        lastEntryId: summary.id,
        updatedAt: summary.createdAt,
      };
      yield* repository.putNotebookCursor(newestCursor);
      yield* repository.putNotebookCursor({
        ...newestCursor,
        id: "cursor-stale" as typeof newestCursor.id,
        lastCreatedAt: source.createdAt,
        lastEntryId: source.id,
      });

      const state = yield* repository.getNotebookState({
        workspaceId: source.workspaceId,
        seatId: source.authorSeatId,
        limit: 20,
      });
      assert.deepEqual(state.compactionReceipts, [receipt]);
      assert.equal(state.cursor?.lastEntryId, summary.id);
    }),
  );
});
