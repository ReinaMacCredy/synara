import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  emptySupervisedGovernanceSnapshot,
  emptySupervisedRuntimeSnapshot,
  type DerivedSignal,
  type OrchestrationCommand,
  type PluginInstallation,
  type SubscriptionDefinition,
  type SubscriptionDelivery,
} from "@veylen/contracts";
import { it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { SupervisedRuntimeRepositoryLive } from "../../persistence/Layers/SupervisedRuntimeRepository.ts";
import { SupervisedGovernanceRepository } from "../../persistence/Services/SupervisedGovernanceRepository.ts";
import { SupervisedRuntimeRepository } from "../../persistence/Services/SupervisedRuntimeRepository.ts";
import { builtInSubscriptions } from "../../supervised/signal/BuiltInSubscriptions.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { SupervisedSignalDelivery } from "../Services/SupervisedSignalDelivery.ts";
import {
  subscriptionAllowsPluginRequest,
  SupervisedSignalDeliveryLive,
} from "./SupervisedSignalDelivery.ts";

const now = "2026-08-07T00:00:00.000Z";
const hash = `sha256:${"a".repeat(64)}` as const;
const dispatched: OrchestrationCommand[] = [];

const interventionRequest = (roomId: string) => ({
  type: "supervised.intervention.propose",
  payload: { intervention: { roomId } },
});

it("keeps plugin command requests inside the triggering subscription scope", () => {
  const runtime = {
    ...emptySupervisedRuntimeSnapshot(now),
    rooms: [
      { id: "room-a", projectId: "project-a" },
      { id: "room-b", projectId: "project-b" },
    ],
  } as never;
  const subscription = builtInSubscriptions(now)[0]!;

  assert.equal(
    subscriptionAllowsPluginRequest(
      { ...subscription, scope: [{ kind: "project", projectId: "project-a" as never }] },
      interventionRequest("room-a") as never,
      runtime,
    ),
    true,
  );
  assert.equal(
    subscriptionAllowsPluginRequest(
      { ...subscription, scope: [{ kind: "task", taskId: "task-a" as never }] },
      interventionRequest("room-a") as never,
      runtime,
    ),
    false,
  );
  assert.equal(
    subscriptionAllowsPluginRequest(
      { ...subscription, scope: [{ kind: "room", roomId: "room-a" as never }] },
      interventionRequest("room-b") as never,
      runtime,
    ),
    false,
  );
});

const readModel = {
  projects: [
    { id: "project-1", spaceId: "space-1" },
    { id: "project-2", spaceId: "space-1" },
  ],
  threads: [
    {
      id: "thread-lead-context",
      deletedAt: null,
      runtimeMode: "full-access",
      interactionMode: "default",
    },
    {
      id: "thread-supervisor-context",
      deletedAt: null,
      runtimeMode: "full-access",
      interactionMode: "default",
    },
    {
      id: "thread-primary-supervisor",
      deletedAt: null,
      runtimeMode: "full-access",
      interactionMode: "default",
    },
  ],
  supervised: {
    ...emptySupervisedRuntimeSnapshot(now),
    rooms: [
      {
        id: "room-1",
        projectId: "project-1",
        leadSeatId: "lead-1",
        status: "active",
        graphRevision: 1,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "room-2",
        projectId: "project-2",
        leadSeatId: "lead-2",
        status: "active",
        graphRevision: 1,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
    ],
  },
};

const governanceSnapshot = {
  ...emptySupervisedGovernanceSnapshot(now),
  agentSeats: [
    {
      id: "lead-1",
      workspaceId: "workspace-1",
      roomIds: ["room-1"],
      identityRole: "lead",
      effectiveRole: "lead",
      profileId: "profile-lead",
      providerSessionId: null,
      lifecycleState: "active",
      workState: "idle",
      authorityReceiptId: "receipt-lead",
      threadId: "thread-lead-context",
      projectId: "project-1",
      profileSnapshotId: "snapshot-lead",
      predecessorThreadIds: [],
      displayName: "Project Lead",
      createdAt: now,
      retainedAt: null,
      retiredAt: null,
      revision: 0,
      updatedAt: now,
    },
    {
      id: "supervisor-context",
      workspaceId: "workspace-1",
      roomIds: ["room-1"],
      identityRole: "supervisor",
      effectiveRole: "supervisor",
      profileId: "profile-supervisor-context",
      concern: "context",
      providerSessionId: null,
      lifecycleState: "active",
      workState: "idle",
      authorityReceiptId: "receipt-supervisor-context",
      threadId: "thread-supervisor-context",
      projectId: null,
      profileSnapshotId: "snapshot-supervisor-context",
      predecessorThreadIds: [],
      displayName: "Context Supervisor",
      createdAt: now,
      retainedAt: null,
      retiredAt: null,
      revision: 0,
      updatedAt: now,
    },
    {
      id: "lead-2",
      workspaceId: "workspace-1",
      roomIds: ["room-2"],
      identityRole: "lead",
      effectiveRole: "lead",
      profileId: "profile-lead",
      providerSessionId: null,
      lifecycleState: "active",
      workState: "idle",
      authorityReceiptId: "receipt-lead-2",
      threadId: "thread-lead-2",
      projectId: "project-2",
      profileSnapshotId: "snapshot-lead-2",
      predecessorThreadIds: [],
      displayName: "Second Project Lead",
      createdAt: now,
      retainedAt: null,
      retiredAt: null,
      revision: 0,
      updatedAt: now,
    },
    {
      id: "supervisor-primary",
      workspaceId: "workspace-1",
      roomIds: ["room-1"],
      identityRole: "supervisor",
      effectiveRole: "supervisor",
      profileId: "profile-supervisor-default",
      providerSessionId: null,
      lifecycleState: "active",
      workState: "idle",
      authorityReceiptId: "receipt-supervisor-primary",
      threadId: "thread-primary-supervisor",
      projectId: null,
      profileSnapshotId: "snapshot-supervisor-primary",
      predecessorThreadIds: [],
      displayName: "Primary Supervisor",
      createdAt: now,
      retainedAt: null,
      retiredAt: null,
      revision: 0,
      updatedAt: now,
    },
  ],
  authorityReceipts: [
    {
      id: "receipt-lead",
      actorSeatId: "lead-1",
      identityRole: "lead",
      effectiveRole: "lead",
      workspaceScopes: ["workspace-1"],
      roomScopes: ["room-1"],
      taskNodeScopes: [],
      allowedCommands: [],
      allowedTools: [],
      rootLeaseIds: ["root-room-1"],
      mandateIds: [],
      runPolicyRevision: 0,
      issuedAt: now,
      expiresAt: null,
      revokedAt: null,
    },
    {
      id: "receipt-supervisor-context",
      actorSeatId: "supervisor-context",
      identityRole: "supervisor",
      effectiveRole: "supervisor",
      workspaceScopes: ["workspace-1"],
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
    },
    {
      id: "receipt-lead-2",
      actorSeatId: "lead-2",
      identityRole: "lead",
      effectiveRole: "lead",
      workspaceScopes: ["workspace-1"],
      roomScopes: ["room-2"],
      taskNodeScopes: [],
      allowedCommands: [],
      allowedTools: [],
      rootLeaseIds: ["root-room-2"],
      mandateIds: [],
      runPolicyRevision: 0,
      issuedAt: now,
      expiresAt: null,
      revokedAt: null,
    },
    {
      id: "receipt-supervisor-primary",
      actorSeatId: "supervisor-primary",
      identityRole: "supervisor",
      effectiveRole: "supervisor",
      workspaceScopes: ["workspace-1"],
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
    },
  ],
  rootLeases: [
    {
      id: "root-room-1",
      roomId: "room-1",
      holderSeatId: "lead-1",
      status: "active",
      revision: 1,
    },
    {
      id: "root-room-2",
      roomId: "room-2",
      holderSeatId: "lead-2",
      status: "active",
      revision: 1,
    },
  ],
  orchestration: {
    ...emptySupervisedGovernanceSnapshot(now).orchestration,
    missions: [
      {
        id: "mission-context",
        supervisorSeatId: "supervisor-context",
        brief: "Watch context pressure.",
        focus: "context",
        scope: [{ kind: "project", projectId: "project-1" }],
        grants: ["lead.observe"],
        endCondition: { kind: "manual" },
        status: "active",
        sourceMessageId: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        revision: 0,
      },
      {
        id: "mission-primary",
        supervisorSeatId: "supervisor-primary",
        brief: "Watch project delivery.",
        focus: "delivery",
        scope: [{ kind: "project", projectId: "project-1" }],
        grants: ["lead.observe"],
        endCondition: { kind: "manual" },
        status: "active",
        sourceMessageId: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        revision: 0,
      },
    ],
  },
};

const engineLayer = Layer.succeed(OrchestrationEngineService, {
  getReadModel: () => Effect.succeed(readModel as never),
  dispatch: (command: OrchestrationCommand) =>
    Effect.sync(() => {
      dispatched.push(command);
      return { sequence: dispatched.length };
    }),
} as never);
const governanceLayer = Layer.succeed(SupervisedGovernanceRepository, {
  getSnapshot: () => Effect.succeed(governanceSnapshot as never),
} as never);
const snapshotQueryLayer = Layer.succeed(ProjectionSnapshotQuery, {
  getCommandReadModel: () => Effect.succeed(readModel as never),
  getThreadDetailById: () => Effect.succeed(Option.none()),
} as never);
const repositoryLayer = SupervisedRuntimeRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);
const deliveryLayer = SupervisedSignalDeliveryLive.pipe(
  Layer.provideMerge(repositoryLayer),
  Layer.provideMerge(engineLayer),
  Layer.provideMerge(governanceLayer),
  Layer.provideMerge(snapshotQueryLayer),
);
const layer = it.layer(
  Layer.mergeAll(
    SqlitePersistenceMemory,
    repositoryLayer,
    engineLayer,
    governanceLayer,
    snapshotQueryLayer,
    deliveryLayer,
  ),
);

const signal = {
  id: "signal-context" as const,
  kind: "ContextPressureHigh",
  subscriptionId: "builtin-lead-context-pressure-v1" as const,
  scope: { kind: "room" as const, roomId: "room-1" as const },
  subjectId: "lead-1",
  state: "triggered" as const,
  measuredValue: 82,
  threshold: { operator: "gte" as const, value: 80 },
  sourceEventIds: ["event-context-1" as const],
  metricSampleIds: [],
  aggregationReceiptHash: hash,
  context: { leadSeatId: "lead-1", roomId: "room-1", activeObligations: ["node-1"] },
  triggeredAt: now,
  resetAt: null,
  revision: 0,
} as unknown as DerivedSignal;
const delivery = {
  id: "delivery-context" as const,
  subscriptionId: signal.subscriptionId,
  signalId: signal.id,
  dedupeKey: "context:signal-context",
  status: "delivering" as const,
  attemptCount: 0,
  availableAt: now,
  deliveredAt: null,
  lastError: null,
  payloadHash: hash,
  replay: false,
  createdAt: now,
  updatedAt: now,
} as unknown as SubscriptionDelivery;

layer("SupervisedSignalDelivery", (it) => {
  it.effect("wakes the active concern Supervisor without changing Root or Room Lead", () =>
    Effect.gen(function* () {
      dispatched.length = 0;
      const service = yield* SupervisedSignalDelivery;
      const governanceRepository = yield* SupervisedGovernanceRepository;
      const orchestrationEngine = yield* OrchestrationEngineService;
      const beforeGovernance = yield* governanceRepository.getSnapshot();
      const beforeReadModel = yield* orchestrationEngine.getReadModel();
      const subscription = builtInSubscriptions(now)[1]!;
      yield* service.deliver({ subscription, signal, delivery });
      assert.equal(dispatched.length, 1);
      const command = dispatched[0];
      assert.equal(command?.type, "thread.turn.start");
      if (command?.type !== "thread.turn.start") return;
      assert.equal(command.threadId, "thread-supervisor-context");
      assert.notEqual(command.threadId, "thread-lead-context");
      assert.match(command.message.text, /grants no new authority/);
      assert.match(command.message.text, /mission_id: mission-context/);
      const afterGovernance = yield* governanceRepository.getSnapshot();
      const afterReadModel = yield* orchestrationEngine.getReadModel();
      assert.deepEqual(afterGovernance.rootLeases, beforeGovernance.rootLeases);
      assert.equal(
        afterReadModel.supervised.rooms.find((room) => room.id === "room-1")?.leadSeatId,
        beforeReadModel.supervised.rooms.find((room) => room.id === "room-1")?.leadSeatId,
      );
      assert.deepEqual(
        afterGovernance.authorityReceipts.find(
          (receipt) => receipt.actorSeatId === "supervisor-context",
        )?.rootLeaseIds,
        [],
      );
      assert.deepEqual(
        afterGovernance.authorityReceipts.find((receipt) => receipt.actorSeatId === "lead-1")
          ?.rootLeaseIds,
        ["root-room-1"],
      );
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ readonly outcome: string; readonly detailJson: string }>`
        SELECT outcome, detail_json AS "detailJson"
        FROM supervised_runtime_audit
        ORDER BY audit_sequence DESC
        LIMIT 1
      `;
      assert.equal(rows[0]?.outcome, "supervisor_woken");
      assert.deepEqual(JSON.parse(rows[0]!.detailJson), {
        signalId: "signal-context",
        signalKind: "ContextPressureHigh",
        measuredValue: 82,
        threshold: { operator: "gte", value: 80 },
        authorityUnchanged: true,
        supervisorSeatId: "supervisor-context",
        supervisorThreadId: "thread-supervisor-context",
        missionId: "mission-context",
        affectedLeadSeatId: "lead-1",
        affectedRoomId: "room-1",
        selection: "concern",
      });
    }),
  );

  it.effect("keeps Supervisor wake command and message identities stable across a retry", () =>
    Effect.gen(function* () {
      dispatched.length = 0;
      const service = yield* SupervisedSignalDelivery;
      const subscription = builtInSubscriptions(now)[1]!;
      yield* service.deliver({ subscription, signal, delivery });
      yield* service.deliver({ subscription, signal, delivery });
      assert.equal(dispatched.length, 2);
      const [first, second] = dispatched;
      assert.equal(first?.type, "thread.turn.start");
      assert.equal(second?.type, "thread.turn.start");
      if (first?.type !== "thread.turn.start" || second?.type !== "thread.turn.start") return;
      assert.equal(second.commandId, first.commandId);
      assert.equal(second.message.messageId, first.message.messageId);
      assert.equal(second.threadId, first.threadId);
    }),
  );

  it.effect("falls back to the active Primary Supervisor for an uncovered concern", () =>
    Effect.gen(function* () {
      dispatched.length = 0;
      const service = yield* SupervisedSignalDelivery;
      const subscription = builtInSubscriptions(now)[0]!;
      yield* service.deliver({
        subscription,
        signal: {
          ...signal,
          id: "signal-review" as const,
          kind: "ReviewLoopSuspected",
          subscriptionId: subscription.id,
          context: {
            taskNodeId: "node-1",
            graphRevision: 1,
            leadSeatId: "lead-1",
            roomId: "room-1",
          },
        } as unknown as DerivedSignal,
        delivery: {
          ...delivery,
          id: "delivery-review" as const,
          subscriptionId: subscription.id,
          signalId: "signal-review" as const,
        } as unknown as SubscriptionDelivery,
      });
      assert.equal(dispatched.length, 1);
      const command = dispatched[0];
      assert.equal(command?.type, "thread.turn.start");
      if (command?.type !== "thread.turn.start") return;
      assert.equal(command.threadId, "thread-primary-supervisor");
      assert.match(command.message.text, /mission_id: mission-primary/);
    }),
  );

  it.effect("keeps historical observe-only replay from waking a provider", () =>
    Effect.gen(function* () {
      dispatched.length = 0;
      const service = yield* SupervisedSignalDelivery;
      const subscription = builtInSubscriptions(now)[1]!;
      yield* service.deliver({ subscription, signal, delivery: { ...delivery, replay: true } });
      assert.equal(dispatched.length, 0);
    }),
  );

  it.effect("fails an unresolved destination so the daemon can retry and dead-letter it", () =>
    Effect.gen(function* () {
      dispatched.length = 0;
      const service = yield* SupervisedSignalDelivery;
      const subscription = {
        ...builtInSubscriptions(now)[1]!,
        ownerLeadSeatId: null,
        destination: { kind: "concern" as const, concern: "missing-concern" },
      };
      const exit = yield* Effect.exit(
        service.deliver({
          subscription,
          signal: {
            ...signal,
            scope: { kind: "room", roomId: "room-2" },
            subjectId: "lead-2",
            context: { ...signal.context, roomId: "room-2", leadSeatId: "lead-2" },
          } as unknown as DerivedSignal,
          delivery,
        }),
      );
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ readonly outcome: string; readonly detailJson: string }>`
        SELECT outcome, detail_json AS "detailJson"
        FROM supervised_runtime_audit
        ORDER BY audit_sequence DESC
        LIMIT 1
      `;
      assert.equal(exit._tag, "Failure");
      assert.equal(dispatched.length, 0);
      assert.equal(rows[0]?.outcome, "delivery_unresolved");
      assert.match(JSON.parse(rows[0]!.detailJson).reason, /No active 'missing-concern'/);
    }),
  );

  it.effect(
    "persists plugin failures and opens the circuit without blocking the Signal Plane",
    () =>
      Effect.gen(function* () {
        const directory = yield* Effect.tryPromise(() =>
          mkdtemp(path.join(os.tmpdir(), "veylen-delivery-plugin-")),
        );
        try {
          const repository = yield* SupervisedRuntimeRepository;
          const service = yield* SupervisedSignalDelivery;
          const plugin = {
            pluginId: "plugin-failing" as const,
            manifest: {
              pluginId: "plugin-failing" as const,
              name: "Failing plugin",
              version: "1.0.0",
              manifestVersion: "1" as const,
              description: "Fails while loading its missing handler.",
              handler: {
                runtime: "javascript" as const,
                entry: "missing.mjs",
                protocolVersion: "1" as const,
              },
              eventSchemas: [
                {
                  id: "schema-supervised-signal-derived-v1" as const,
                  eventType: "supervised.signal.derived",
                  version: "1.0.0",
                  compatibility: "backward" as const,
                  jsonSchema: {},
                  fieldClassifications: {},
                  status: "active" as const,
                  createdAt: now,
                  updatedAt: now,
                },
              ],
              subscriptions: [],
              requestedCapabilities: ["event.read" as const],
              requestedPayloadFields: [],
              resourceLimits: {
                maxRuntimeMs: 1_000,
                maxMemoryMiB: 64,
                maxOutputBytes: 65_536,
                maxConcurrentHandlers: 1,
                maxQueueDepth: 10,
              },
              provenance: {
                source: pathToFileURL(directory).href,
                contentHash: hash,
                signature: null,
              },
            },
            grant: {
              id: "grant-failing" as const,
              pluginId: "plugin-failing" as const,
              capabilities: ["event.read" as const],
              payloadFields: [],
              scopes: [{ kind: "global" as const }],
              allowedActionRequests: [],
              status: "active" as const,
              grantedBy: { kind: "user" as const, actorId: "owner" },
              grantedAt: now,
              revokedAt: null,
              revision: 0,
            },
            status: "enabled" as const,
            installedAt: now,
            updatedAt: now,
            revision: 0,
          };
          yield* repository.upsertPlugin(plugin as unknown as PluginInstallation);
          const subscription = {
            ...builtInSubscriptions(now)[1]!,
            destination: { kind: "plugin" as const, pluginId: plugin.pluginId, handler: "handle" },
          };
          for (let attempt = 0; attempt < 5; attempt += 1) {
            const exit = yield* Effect.exit(
              service.deliver({
                subscription: subscription as unknown as SubscriptionDefinition,
                signal,
                delivery,
              }),
            );
            assert.equal(exit._tag, "Failure");
          }
          const snapshot = yield* repository.getSnapshot({ includeDisabled: true });
          const health = snapshot.pluginHealth.find(
            (candidate) => candidate.pluginId === plugin.pluginId,
          );
          assert.equal(health?.consecutiveFailures, 5);
          assert.equal(health?.circuitState, "open");
          assert.ok(health?.circuitOpenedUntil);
          assert.ok(
            dispatched.some(
              (command) =>
                command.type === "supervised.plugin.mark-unhealthy" &&
                command.pluginId === plugin.pluginId,
            ),
          );
        } finally {
          yield* Effect.tryPromise(() => rm(directory, { recursive: true, force: true }));
        }
      }),
  );
});
