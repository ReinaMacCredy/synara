import assert from "node:assert/strict";

import type { OrchestrationCommand } from "@synara/contracts";
import { ControlPlaneEvent, emptySupervisedGovernanceSnapshot } from "@synara/contracts";
import { it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { SupervisedGovernanceRepositoryLive } from "../../persistence/Layers/SupervisedGovernanceRepository.ts";
import { SupervisedRuntimeRepositoryLive } from "../../persistence/Layers/SupervisedRuntimeRepository.ts";
import { SupervisedGovernanceRepository } from "../../persistence/Services/SupervisedGovernanceRepository.ts";
import { SupervisedRuntimeRepository } from "../../persistence/Services/SupervisedRuntimeRepository.ts";
import { builtInSubscriptions } from "../../supervised/signal/BuiltInSubscriptions.ts";
import { decideSupervisedCommand } from "../supervised/decider.ts";
import { SupervisedRuntimeDaemon } from "../Services/SupervisedRuntimeDaemon.ts";
import { SupervisedSignalDelivery } from "../Services/SupervisedSignalDelivery.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { SupervisedRuntimeDaemonLive } from "./SupervisedRuntimeDaemon.ts";

const delivered: string[] = [];
const deliveryLayer = Layer.succeed(SupervisedSignalDelivery, {
  deliver: ({ signal }) => Effect.sync(() => delivered.push(signal.id)),
});
const dispatched: OrchestrationCommand[] = [];
const engineLayer = Layer.succeed(OrchestrationEngineService, {
  dispatch: (command: OrchestrationCommand) =>
    Effect.sync(() => {
      dispatched.push(command);
      return { sequence: dispatched.length };
    }),
} as never);
const repositoryLayer = SupervisedRuntimeRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);
const governanceRepositoryLayer = SupervisedGovernanceRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);
const daemonLayer = SupervisedRuntimeDaemonLive.pipe(
  Layer.provideMerge(repositoryLayer),
  Layer.provideMerge(governanceRepositoryLayer),
  Layer.provideMerge(deliveryLayer),
  Layer.provideMerge(engineLayer),
);
const testLayer = it.layer(
  Layer.mergeAll(
    SqlitePersistenceMemory,
    repositoryLayer,
    governanceRepositoryLayer,
    engineLayer,
    daemonLayer,
  ),
);

const at = (minutes: number) => new Date(Date.UTC(2026, 7, 6, 12, minutes)).toISOString();
const review = (index: number, graphRevision = 1) =>
  Schema.decodeUnknownSync(ControlPlaneEvent)({
    sequence: 0,
    eventId: `review-${graphRevision}-${index}`,
    schemaId: "schema-review-completed-v1",
    schemaVersion: "1.0.0",
    type: index % 2 === 0 ? "ReviewRejected" : "ReviewCompleted",
    scope: { kind: "task_node", taskNodeId: "node-1" },
    subjectId: "node-1",
    eventTime: at(index),
    recordedAt: at(index),
    revision: graphRevision,
    causationEventId: null,
    correlationId: null,
    payload: {
      taskId: "task-1",
      taskNodeId: "node-1",
      graphRevision,
      reviewerSeatId: `reviewer-${index % 2}`,
      rejectionReason: index % 2 === 0 ? "missing evidence" : null,
      evidenceRefs: [],
      costUsd: 0.01,
    },
    provenance: {
      actor: { kind: "daemon", actorId: "review-ingestion" },
      source: "review",
      confidence: 1,
    },
  });

testLayer("SupervisedRuntimeDaemon", (it) => {
  it.effect("restarts the background loop and advances the durable daemon epoch", () =>
    Effect.gen(function* () {
      const daemon = yield* SupervisedRuntimeDaemon;
      const repository = yield* SupervisedRuntimeRepository;
      yield* daemon.start;
      const before = yield* repository.getSnapshot({ includeDisabled: true });
      const restarted = yield* daemon.restart;
      const after = yield* repository.getSnapshot({ includeDisabled: true });

      assert.equal(restarted.daemonEpoch, before.health.daemonEpoch + 1);
      assert.equal(after.health.daemonEpoch, restarted.daemonEpoch);
      assert.equal(after.health.status, "healthy");
      assert.ok(after.health.lastRecoveryAt);
    }),
  );

  it.effect("recovers an interrupted governed provider session after restart", () =>
    Effect.gen(function* () {
      const daemon = yield* SupervisedRuntimeDaemon;
      const governance = yield* SupervisedGovernanceRepository;
      const now = at(0);
      yield* governance.replaceSnapshot({
        ...emptySupervisedGovernanceSnapshot(now),
        workspaces: [
          {
            id: "workspace-1" as never,
            ownerNamespace: "owner",
            title: "Workspace",
            lifecycleState: "active",
            revision: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
        authorityReceipts: [
          {
            id: "receipt-lead" as never,
            actorSeatId: "lead-1" as never,
            identityRole: "lead",
            effectiveRole: "lead",
            workspaceScopes: ["workspace-1" as never],
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
            id: "lead-1" as never,
            workspaceId: "workspace-1" as never,
            roomIds: [],
            identityRole: "lead",
            effectiveRole: "lead",
            profileId: "profile-lead" as never,
            providerSessionId: "provider-lead",
            lifecycleState: "active",
            workState: "idle",
            authorityReceiptId: "receipt-lead" as never,
            createdAt: now,
            retainedAt: null,
            retiredAt: null,
            revision: 0,
            updatedAt: now,
          },
        ],
        providerSessions: [
          {
            id: "provider-lead" as never,
            workspaceId: "workspace-1" as never,
            seatId: "lead-1" as never,
            provider: "codex",
            nativeSessionId: "native-lead",
            lifecycleState: "interrupted",
            createdAt: now,
            retainedAt: null,
            closedAt: null,
            revision: 0,
            updatedAt: now,
          },
        ],
      });

      yield* daemon.restart;
      const recovered = yield* governance.getSnapshot();

      assert.equal(recovered.providerSessions[0]?.lifecycleState, "recovering");
      assert.equal(recovered.agentSeats[0]?.lifecycleState, "recovering");
      assert.equal(recovered.revision, 2);
    }),
  );

  it.effect("triggers review >3 exactly once and separates graph revisions", () =>
    Effect.gen(function* () {
      delivered.length = 0;
      const daemon = yield* SupervisedRuntimeDaemon;
      const repository = yield* SupervisedRuntimeRepository;
      for (let index = 1; index <= 4; index += 1) yield* daemon.ingest(review(index));
      yield* daemon.reconcile;
      yield* daemon.reconcile;
      let snapshot = yield* repository.getSnapshot({ includeDisabled: true });
      assert.equal(
        snapshot.signals.filter((signal) => signal.kind === "ReviewLoopSuspected").length,
        1,
      );
      assert.equal(delivered.length, 1, JSON.stringify(snapshot.deliveries));

      for (let index = 1; index <= 4; index += 1) yield* daemon.ingest(review(index, 2));
      yield* daemon.reconcile;
      snapshot = yield* repository.getSnapshot({ includeDisabled: true });
      assert.equal(
        snapshot.signals.filter((signal) => signal.kind === "ReviewLoopSuspected").length,
        2,
      );
      assert.equal(delivered.length, 2);
    }),
  );

  it.effect("wakes on Lead context pressure, resets below 65, and preserves authority", () =>
    Effect.gen(function* () {
      delivered.length = 0;
      const daemon = yield* SupervisedRuntimeDaemon;
      const repository = yield* SupervisedRuntimeRepository;
      const contextEvent = (id: string, value: number, minute: number) =>
        Schema.decodeUnknownSync(ControlPlaneEvent)({
          sequence: 0,
          eventId: id,
          schemaId: "schema-agent-context-measured-v1",
          schemaVersion: "1.0.0",
          type: "agent.context.measured",
          scope: { kind: "room", roomId: "room-1" },
          subjectId: "lead-1",
          eventTime: at(minute),
          recordedAt: at(minute),
          revision: 1,
          causationEventId: null,
          correlationId: null,
          payload: {
            role: "lead",
            roomId: "room-1",
            leadSeatId: "lead-1",
            contextUsagePercent: value,
            usedTokensEstimate: Math.round((value / 100) * 100_000),
            providerLimitTokens: 100_000,
            provider: "openai",
            model: "gpt-5.6-luna",
            trendPercentPerMinute: 2,
            activeObligations: ["Integrate node-4"],
            ownedTaskNodeIds: ["node-4"],
            unsummarizedEvidenceRefs: [],
            measurementSource: "provider-session",
            quality: "estimated",
            confidence: 0.9,
          },
          provenance: {
            actor: { kind: "daemon", actorId: "context-meter" },
            source: "provider-session",
            confidence: 0.9,
          },
        });
      yield* daemon.ingest(contextEvent("context-80", 80, 1));
      yield* daemon.reconcile;
      yield* daemon.ingest(contextEvent("context-60", 60, 2));
      yield* daemon.reconcile;
      yield* daemon.ingest(contextEvent("context-82", 82, 12));
      yield* daemon.reconcile;
      const snapshot = yield* repository.getSnapshot({ includeDisabled: true });
      const signals = snapshot.signals.filter((signal) => signal.kind === "ContextPressureHigh");
      assert.equal(signals.length, 2);
      assert.equal(signals.filter((signal) => signal.state === "triggered").length, 1);
      assert.ok(signals.every((signal) => signal.context.leadSeatId === "lead-1"));
      assert.equal(snapshot.rooms.length, 0, "signal delivery must not create or transfer Room authority");
    }),
  );

  it.effect("redrives observe-only delivery and resolves its DeadLetter after success", () =>
    Effect.gen(function* () {
      delivered.length = 0;
      const daemon = yield* SupervisedRuntimeDaemon;
      const repository = yield* SupervisedRuntimeRepository;
      const subscription = builtInSubscriptions(at(0))[0]!;
      yield* repository.upsertSubscription(subscription);
      const signal = {
        id: "signal-redrive" as const,
        kind: "ReviewLoopSuspected",
        subscriptionId: subscription.id,
        scope: { kind: "task_node" as const, taskNodeId: "node-redrive" as const },
        subjectId: "node-redrive",
        state: "triggered" as const,
        measuredValue: 4,
        threshold: { operator: "gt" as const, value: 3 },
        sourceEventIds: ["event-redrive" as const],
        metricSampleIds: [],
        aggregationReceiptHash: `sha256:${"a".repeat(64)}` as const,
        context: { graphRevision: 1 },
        triggeredAt: at(0),
        resetAt: null,
        revision: 0,
      };
      const delivery = {
        id: "delivery-redrive" as const,
        subscriptionId: subscription.id,
        signalId: signal.id,
        dedupeKey: "redrive:delivery",
        status: "dead_lettered" as const,
        attemptCount: 3,
        availableAt: at(0),
        deliveredAt: null,
        lastError: "timeout",
        payloadHash: `sha256:${"b".repeat(64)}` as const,
        replay: false,
        createdAt: at(0),
        updatedAt: at(0),
      };
      const letter = {
        id: "dead-letter-redrive" as const,
        subscriptionId: subscription.id,
        deliveryId: delivery.id,
        pluginId: null,
        reason: "timeout",
        payloadHash: delivery.payloadHash,
        attemptCount: 3,
        status: "open" as const,
        createdAt: at(0),
        updatedAt: at(0),
        resolvedAt: null,
      };
      yield* repository.upsertSignal(signal);
      yield* repository.enqueueDelivery(delivery);
      yield* repository.putDeadLetter(letter);
      const before = yield* repository.getSnapshot({ includeDisabled: true });
      const redrive = yield* decideSupervisedCommand({
        state: before,
        command: {
          type: "supervised.delivery.redrive",
          commandId: "command-redrive",
          actor: { kind: "user", actorId: "owner" },
          aggregateId: delivery.id,
          expectedRevision: delivery.attemptCount,
          idempotencyKey: "command-redrive",
          createdAt: at(1),
          deadLetterId: letter.id,
          replayBehavior: "observe_only",
        },
      });
      yield* repository.applyDomainEvent({ ...redrive, sequence: 1 });
      yield* daemon.reconcile;
      const after = yield* repository.getSnapshot({ includeDisabled: true });
      assert.equal(after.deliveries.find((candidate) => candidate.id === delivery.id)?.status, "delivered");
      assert.equal(after.deadLetters.find((candidate) => candidate.id === letter.id)?.status, "resolved");
      assert.equal(delivered.length, 1);
    }),
  );
});
