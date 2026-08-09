import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  emptySupervisedGovernanceSnapshot,
  emptySupervisedRuntimeSnapshot,
  type OrchestrationCommand,
} from "@synara/contracts";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { SupervisedRuntimeRepositoryLive } from "../../persistence/Layers/SupervisedRuntimeRepository.ts";
import { SupervisedGovernanceRepository } from "../../persistence/Services/SupervisedGovernanceRepository.ts";
import { SupervisedRuntimeRepository } from "../../persistence/Services/SupervisedRuntimeRepository.ts";
import { builtInSubscriptions } from "../../supervised/signal/BuiltInSubscriptions.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
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

const engineLayer = Layer.succeed(OrchestrationEngineService, {
  getReadModel: () =>
    Effect.succeed({
      threads: [
        {
          id: "thread-lead-context",
          deletedAt: null,
          runtimeMode: "full-access",
          interactionMode: "default",
        },
      ],
    } as never),
  dispatch: (command: OrchestrationCommand) =>
    Effect.sync(() => {
      dispatched.push(command);
      return { sequence: dispatched.length };
    }),
} as never);
const governanceLayer = Layer.succeed(SupervisedGovernanceRepository, {
  getSnapshot: () =>
    Effect.succeed({
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
          displayName: null,
          createdAt: now,
          retainedAt: null,
          retiredAt: null,
          revision: 0,
          updatedAt: now,
        },
      ],
    } as never),
} as never);
const repositoryLayer = SupervisedRuntimeRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);
const deliveryLayer = SupervisedSignalDeliveryLive.pipe(
  Layer.provideMerge(repositoryLayer),
  Layer.provideMerge(engineLayer),
  Layer.provideMerge(governanceLayer),
);
const layer = it.layer(
  Layer.mergeAll(
    SqlitePersistenceMemory,
    repositoryLayer,
    engineLayer,
    governanceLayer,
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
};
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
};

layer("SupervisedSignalDelivery", (it) => {
  it.effect("wakes the matching Lead with an idempotent queued command", () =>
    Effect.gen(function* () {
      dispatched.length = 0;
      const service = yield* SupervisedSignalDelivery;
      const subscription = {
        ...builtInSubscriptions(now)[1]!,
        ownerLeadSeatId: "lead-1" as const,
        destination: { kind: "lead_seat" as const, leadSeatId: "lead-1" as const },
      };
      yield* service.deliver({ subscription, signal, delivery });
      assert.equal(dispatched.length, 1);
      const command = dispatched[0];
      assert.equal(command?.type, "thread.turn.start");
      if (command?.type !== "thread.turn.start") return;
      assert.equal(command.threadId, "thread-lead-context");
      assert.match(command.message.text, /grants no new authority/);
    }),
  );

  it.effect("keeps historical observe-only replay from waking a provider", () =>
    Effect.gen(function* () {
      dispatched.length = 0;
      const service = yield* SupervisedSignalDelivery;
      const subscription = {
        ...builtInSubscriptions(now)[1]!,
        ownerLeadSeatId: "lead-1" as const,
        destination: { kind: "lead_seat" as const, leadSeatId: "lead-1" as const },
      };
      yield* service.deliver({ subscription, signal, delivery: { ...delivery, replay: true } });
      assert.equal(dispatched.length, 0);
    }),
  );

  it.effect("falls back to a durable concern inbox audit when no Seat exists", () =>
    Effect.gen(function* () {
      dispatched.length = 0;
      const service = yield* SupervisedSignalDelivery;
      const subscription = {
        ...builtInSubscriptions(now)[1]!,
        ownerLeadSeatId: null,
        destination: { kind: "concern" as const, concern: "missing-concern" },
      };
      yield* service.deliver({
        subscription,
        signal: { ...signal, context: { ...signal.context, leadSeatId: "missing-lead" } },
        delivery,
      });
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ readonly outcome: string }>`
        SELECT outcome FROM supervised_runtime_audit ORDER BY audit_sequence DESC LIMIT 1
      `;
      assert.equal(dispatched.length, 0);
      assert.equal(rows[0]?.outcome, "concern_inbox_delivered");
    }),
  );

  it.effect("persists plugin failures and opens the circuit without blocking the Signal Plane", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.tryPromise(() =>
        mkdtemp(path.join(os.tmpdir(), "synara-delivery-plugin-")),
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
            handler: { runtime: "javascript" as const, entry: "missing.mjs", protocolVersion: "1" as const },
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
        yield* repository.upsertPlugin(plugin);
        const subscription = {
          ...builtInSubscriptions(now)[1]!,
          destination: { kind: "plugin" as const, pluginId: plugin.pluginId, handler: "handle" },
        };
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const exit = yield* Effect.exit(service.deliver({ subscription, signal, delivery }));
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
