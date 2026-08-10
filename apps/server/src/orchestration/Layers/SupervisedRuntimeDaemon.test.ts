import assert from "node:assert/strict";

import type {
  DeadLetter,
  DerivedSignal,
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
  OrchestrationThread,
  SubscriptionDefinition,
  SubscriptionDelivery,
} from "@synara/contracts";
import {
  ControlPlaneEvent,
  emptySupervisedGovernanceSnapshot,
  emptySupervisedRuntimeSnapshot,
} from "@synara/contracts";
import { it } from "@effect/vitest";
import { Effect, Layer, Option, Schema, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { SupervisedGovernanceRepositoryLive } from "../../persistence/Layers/SupervisedGovernanceRepository.ts";
import { SupervisedRuntimeRepositoryLive } from "../../persistence/Layers/SupervisedRuntimeRepository.ts";
import { SupervisedGovernanceRepository } from "../../persistence/Services/SupervisedGovernanceRepository.ts";
import { SupervisedRuntimeRepository } from "../../persistence/Services/SupervisedRuntimeRepository.ts";
import { builtInSubscriptions } from "../../supervised/signal/BuiltInSubscriptions.ts";
import { SUPERVISED_BASE_POLICY_HASH } from "../../supervised/runtime/HarnessPatchPolicy.ts";
import { decideSupervisedCommand } from "../supervised/decider.ts";
import { SupervisedRuntimeDaemon } from "../Services/SupervisedRuntimeDaemon.ts";
import { SupervisedSignalDelivery } from "../Services/SupervisedSignalDelivery.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  failSubscriptionDelivery,
  shouldDeferRlmProvisioningReconciliation,
  orchestrationContextEvent,
  orchestrationReviewEvent,
  restartRunRecoveryPath,
  terminalRunRecoveryPath,
  SupervisedRuntimeDaemonLive,
} from "./SupervisedRuntimeDaemon.ts";
import { SupervisedSignalDeliveryLive } from "./SupervisedSignalDelivery.ts";

const delivered: string[] = [];
const deliveryLayer = Layer.succeed(SupervisedSignalDelivery, {
  deliver: ({ signal }) => Effect.sync(() => delivered.push(signal.id)),
});
const dispatched: OrchestrationCommand[] = [];
const threadDetails = new Map<string, OrchestrationThread>();
const engineLayer = Layer.succeed(OrchestrationEngineService, {
  dispatch: (command: OrchestrationCommand) =>
    Effect.sync(() => {
      dispatched.push(command);
      return { sequence: dispatched.length };
    }),
  getEventHighWaterSequence: Effect.succeed(0),
  readEventsThrough: () => Stream.empty,
  streamDomainEvents: Stream.never,
} as never);
const snapshotQueryLayer = Layer.succeed(ProjectionSnapshotQuery, {
  getThreadDetailById: (threadId: string) =>
    Effect.succeed(Option.fromNullishOr(threadDetails.get(threadId))),
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
  Layer.provideMerge(snapshotQueryLayer),
);
const testLayer = it.layer(
  Layer.mergeAll(
    SqlitePersistenceMemory,
    repositoryLayer,
    governanceRepositoryLayer,
    engineLayer,
    snapshotQueryLayer,
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
  it("derives legal Run transitions when a terminal RLM episode survives a crash", () => {
    assert.deepEqual(terminalRunRecoveryPath("interrupted", "completed"), [
      "recovering",
      "running",
      "reviewing",
      "succeeded",
    ]);
    assert.deepEqual(terminalRunRecoveryPath("queued", "failed"), ["admitted", "failed"]);
    assert.deepEqual(terminalRunRecoveryPath("paused", "cancelled"), ["cancelled"]);
  });

  it("derives an epoch-bounded ordinary Run restart path", () => {
    assert.deepEqual(restartRunRecoveryPath({ status: "running", daemonEpoch: 2 }, 3), [
      "interrupted",
      "recovering",
      "running",
    ]);
    assert.deepEqual(restartRunRecoveryPath({ status: "interrupted", daemonEpoch: 3 }, 3), [
      "recovering",
      "running",
    ]);
    assert.deepEqual(restartRunRecoveryPath({ status: "recovering", daemonEpoch: 3 }, 3), [
      "running",
    ]);
    assert.deepEqual(restartRunRecoveryPath({ status: "running", daemonEpoch: 3 }, 3), []);
  });

  it("projects committed Lead context activity into the signal plane", () => {
    const now = at(0);
    const runtime = {
      ...emptySupervisedRuntimeSnapshot(now),
      rooms: [
        {
          id: "room-context",
          projectId: "project-context",
          leadSeatId: "seat-lead",
        },
      ],
    } as never;
    const governance = {
      ...emptySupervisedGovernanceSnapshot(now),
      agentSeats: [
        {
          id: "seat-lead",
          workspaceId: "workspace-context",
          roomIds: ["room-context"],
          identityRole: "lead",
          effectiveRole: "lead",
          profileId: "profile-lead",
          providerSessionId: null,
          lifecycleState: "active",
          workState: "idle",
          authorityReceiptId: "receipt-lead",
          threadId: "thread-lead",
          projectId: "project-context",
          predecessorThreadIds: [],
          profileSnapshotId: "profile-lead",
          displayName: null,
          createdAt: now,
          retainedAt: null,
          retiredAt: null,
          updatedAt: now,
          revision: 4,
        },
      ],
    } as never;
    const projected = orchestrationContextEvent(
      {
        sequence: 12,
        eventId: "event-context",
        aggregateKind: "thread",
        aggregateId: "thread-lead",
        type: "thread.activity-appended",
        payload: {
          threadId: "thread-lead",
          activity: {
            id: "activity-context",
            kind: "context-window.updated",
            createdAt: now,
            payload: { usedTokens: 80_000, maxTokens: 100_000 },
          },
        },
        occurredAt: now,
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: {},
      } as never,
      runtime,
      governance,
    );
    assert.equal(projected?.type, "agent.context.measured");
    assert.equal(projected?.scope.kind, "room");
    assert.equal(projected?.payload.contextUsagePercent, 80);
    assert.deepEqual(projected?.payload.unsummarizedEvidenceRefs, []);
  });

  it("dead-letters at the earliest configured retry threshold", () => {
    const subscription = {
      ...builtInSubscriptions(at(0))[0]!,
      failurePolicy: {
        maxAttempts: 2,
        backoffMs: 1,
        deadLetterAfterAttempts: 5,
        critical: false,
      },
    };
    const delivery = {
      id: "delivery-failure-policy" as const,
      subscriptionId: subscription.id,
      signalId: "signal-failure-policy" as const,
      dedupeKey: "failure-policy",
      status: "delivering" as const,
      attemptCount: 0,
      availableAt: at(0),
      deliveredAt: null,
      lastError: null,
      payloadHash: `sha256:${"e".repeat(64)}` as const,
      replay: false,
      replayBehavior: "observe_only" as const,
      createdAt: at(0),
      updatedAt: at(0),
    };
    const first = failSubscriptionDelivery(
      subscription,
      delivery as unknown as SubscriptionDelivery,
      "timeout",
      at(1),
    );
    assert.equal(first.delivery.status, "failed");
    assert.equal(first.deadLetter, null);
    const second = failSubscriptionDelivery(
      subscription,
      { ...first.delivery, status: "delivering" },
      "timeout",
      at(2),
    );
    assert.equal(second.delivery.status, "dead_lettered");
    assert.equal(second.deadLetter?.attemptCount, 2);
  });

  it("does not reconcile a freshly provisioning RLM episode as failed recovery", () => {
    const now = Date.parse("2026-08-09T01:00:20.000Z");
    assert.equal(
      shouldDeferRlmProvisioningReconciliation(
        { status: "requested", updatedAt: "2026-08-09T01:00:00.000Z" },
        now,
      ),
      true,
    );
    assert.equal(
      shouldDeferRlmProvisioningReconciliation(
        { status: "requested", updatedAt: "2026-08-09T00:59:49.000Z" },
        now,
      ),
      false,
    );
    assert.equal(
      shouldDeferRlmProvisioningReconciliation(
        { status: "branches_running", updatedAt: "2026-08-09T01:00:19.000Z" },
        now,
      ),
      false,
    );
  });

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

  it.effect("leaves active provider startup alone until restart recovery", () =>
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
            providerSessionId: "provider-lead" as never,
            lifecycleState: "provisioning",
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
            lifecycleState: "creating",
            createdAt: now,
            retainedAt: null,
            closedAt: null,
            revision: 0,
            updatedAt: now,
          },
        ],
      });

      yield* daemon.reconcile;
      let recovered = yield* governance.getSnapshot();
      assert.equal(recovered.providerSessions[0]?.lifecycleState, "creating");
      assert.equal(recovered.agentSeats[0]?.lifecycleState, "provisioning");

      yield* daemon.restart;
      recovered = yield* governance.getSnapshot();

      assert.equal(recovered.providerSessions[0]?.lifecycleState, "failed");
      assert.equal(recovered.agentSeats[0]?.lifecycleState, "failed");
      assert.equal(recovered.revision, 3);
    }),
  );

  it.effect("requests recovery for interrupted Runs only during restart", () =>
    Effect.gen(function* () {
      dispatched.length = 0;
      const daemon = yield* SupervisedRuntimeDaemon;
      const repository = yield* SupervisedRuntimeRepository;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
        ) VALUES ('project-1', 'project', 'Project', '/tmp/project', '[]', ${at(0)}, ${at(0)})
      `;
      yield* repository.applyDomainEvent({
        sequence: 1,
        eventId: "event-room-for-interrupted-run",
        aggregateKind: "supervised_room",
        aggregateId: "room-1",
        type: "supervised.room-created",
        payload: {
          acceptedRevision: 0,
          actor: { kind: "daemon", actorId: "test" },
          room: {
            id: "room-1",
            projectId: "project-1",
            title: "Room",
            leadSeatId: null,
            status: "active",
            graphRevision: 0,
            revision: 0,
            createdAt: at(0),
            updatedAt: at(0),
          },
        },
        occurredAt: at(0),
        commandId: "command-room-for-interrupted-run",
        causationEventId: null,
        correlationId: "command-room-for-interrupted-run",
        metadata: { schemaVersion: "1.0.0" },
      } as never);
      yield* repository.applyDomainEvent({
        sequence: 2,
        eventId: "event-task-for-interrupted-run",
        aggregateKind: "supervised_task",
        aggregateId: "task-1",
        type: "supervised.task-created",
        payload: {
          acceptedRevision: 0,
          actor: { kind: "daemon", actorId: "test" },
          task: {
            id: "task-1",
            roomId: "room-1",
            title: "Task",
            intent: "Recover the interrupted Run.",
            acceptanceCriteria: [],
            lifecycle: "active",
            activeGraphRevision: 0,
            revision: 0,
            createdAt: at(0),
            updatedAt: at(0),
          },
        },
        occurredAt: at(0),
        commandId: "command-task-for-interrupted-run",
        causationEventId: null,
        correlationId: "command-task-for-interrupted-run",
        metadata: { schemaVersion: "1.0.0" },
      } as never);
      yield* repository.applyDomainEvent({
        sequence: 3,
        eventId: "event-interrupted-run",
        aggregateKind: "supervised_run",
        aggregateId: "run-interrupted",
        type: "supervised.run-requested",
        payload: {
          acceptedRevision: 0,
          actor: { kind: "daemon", actorId: "test" },
          run: {
            id: "run-interrupted",
            roomId: "room-1",
            taskId: "task-1",
            taskNodeId: null,
            taskNodeRevisionId: null,
            ownerSeatId: "peer-1",
            policyId: "policy-1",
            status: "interrupted",
            attempt: 1,
            daemonEpoch: 1,
            startedAt: at(0),
            lastProgressAt: at(0),
            finishedAt: null,
            revision: 2,
            createdAt: at(0),
            updatedAt: at(0),
          },
        },
        occurredAt: at(0),
        commandId: "command-interrupted-run",
        causationEventId: null,
        correlationId: "command-interrupted-run",
        metadata: { schemaVersion: "1.0.0" },
      } as never);

      yield* daemon.restart;

      assert.deepEqual(
        dispatched.flatMap((command) =>
          command.type === "supervised.run.transition" && command.runId === "run-interrupted"
            ? [command.status]
            : [],
        ),
        ["recovering", "running"],
      );
      yield* sql`DELETE FROM projection_projects WHERE project_id = 'project-1'`;
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
      assert.equal(
        snapshot.rooms.length,
        0,
        "signal delivery must not create or transfer Room authority",
      );
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
      yield* repository.upsertSignal(signal as unknown as DerivedSignal);
      yield* repository.enqueueDelivery(delivery as unknown as SubscriptionDelivery);
      yield* repository.putDeadLetter(letter as unknown as DeadLetter);
      const before = yield* repository.getSnapshot({ includeDisabled: true });
      const redrive = yield* decideSupervisedCommand({
        state: before,
        command: {
          type: "supervised.delivery.redrive",
          commandId: "command-redrive" as never,
          actor: { kind: "user", actorId: "owner" },
          aggregateId: delivery.id,
          expectedRevision: delivery.attemptCount,
          idempotencyKey: "command-redrive",
          createdAt: at(1),
          deadLetterId: letter.id as never,
          replayBehavior: "observe_only",
        },
      });
      yield* repository.applyDomainEvent({ ...redrive, sequence: 1 });
      yield* daemon.reconcile;
      const after = yield* repository.getSnapshot({ includeDisabled: true });
      assert.equal(
        after.deliveries.find((candidate) => candidate.id === delivery.id)?.status,
        "delivered",
      );
      assert.equal(
        after.deadLetters.find((candidate) => candidate.id === letter.id)?.status,
        "resolved",
      );
      assert.equal(delivered.length, 1);
    }),
  );

  it.effect("rolls a failed Harness Patch canary back without mutating its base policy", () =>
    Effect.gen(function* () {
      dispatched.length = 0;
      const daemon = yield* SupervisedRuntimeDaemon;
      const repository = yield* SupervisedRuntimeRepository;
      const basePolicyHash = SUPERVISED_BASE_POLICY_HASH;
      const patch = {
        id: "patch-daemon-rollback" as const,
        name: "Require evidence before completion",
        patchType: "evaluation" as const,
        scope: { kind: "project" as const, projectId: "project-patch" as const },
        content: "Require an evidence receipt before completion.",
        basePolicyHash,
        status: "canary" as const,
        observationEvidenceRefs: ["evidence-observed" as const],
        evaluationEvidenceRefs: ["evidence-sandbox" as const],
        sandboxEvaluation: {
          passed: true,
          basePolicyHash,
          evidenceRefs: ["evidence-sandbox" as const],
          regressions: [],
          evaluatedBy: { kind: "daemon" as const, actorId: "sandbox" },
          evaluatedAt: at(1),
          eventId: "event-sandbox-passed" as const,
          controlPlaneSequence: 1,
        },
        approval: {
          approvedBy: { kind: "user" as const, actorId: "owner" },
          approvedAt: at(2),
        },
        canary: {
          startedAt: at(2),
          failureThreshold: 1,
          observedFailures: 0,
          successfulEvaluations: 0,
          evidenceRefs: [],
          lastEvaluationAt: null,
          lastControlPlaneSequence: 0,
        },
        rollback: null,
        lastControlPlaneSequence: 0,
        version: 1,
        revision: 4,
        createdBy: {
          kind: "seat" as const,
          actorId: "supervisor-1",
          seatId: "supervisor-1" as const,
        },
        activatedBy: { kind: "user" as const, actorId: "owner" },
        createdAt: at(0),
        updatedAt: at(2),
      };
      yield* repository.applyDomainEvent({
        sequence: 91,
        eventId: "domain-patch-canary",
        type: "supervised.patch-upserted",
        aggregateKind: "harness_patch",
        aggregateId: patch.id,
        payload: {
          acceptedRevision: patch.revision,
          actor: { kind: "user", actorId: "owner" },
          patch,
        },
        occurredAt: at(2),
        commandId: "command-patch-canary",
        causationEventId: null,
        correlationId: "command-patch-canary",
        metadata: { schemaVersion: "1.0.0" },
      } as never);
      yield* daemon.ingest(
        Schema.decodeUnknownSync(ControlPlaneEvent)({
          sequence: 0,
          eventId: "event-canary-failed",
          schemaId: "schema-harness-patch-evaluated-v1",
          schemaVersion: "1.0.0",
          type: "HarnessPatchEvaluated",
          scope: patch.scope,
          subjectId: patch.id,
          eventTime: at(3),
          recordedAt: at(3),
          revision: patch.revision,
          causationEventId: null,
          correlationId: null,
          payload: {
            patchId: patch.id,
            phase: "canary",
            passed: false,
            basePolicyHash,
            evidenceRefs: ["evidence-canary-failed"],
            regressions: ["Completion accepted without evidence"],
          },
          provenance: {
            actor: { kind: "daemon", actorId: "harness-canary" },
            source: "isolated-canary",
            confidence: 1,
          },
        }),
      );
      yield* daemon.reconcile;

      const rollbackCommand = dispatched.find(
        (command) =>
          command.type === "supervised.patch.upsert" &&
          command.patch.id === patch.id &&
          command.patch.status === "rolled_back",
      );
      assert.ok(rollbackCommand && rollbackCommand.type === "supervised.patch.upsert");
      assert.equal(rollbackCommand.patch.basePolicyHash, basePolicyHash);
      assert.equal(rollbackCommand.patch.rollback?.evidenceRefs[0], "evidence-canary-failed");
    }),
  );

  it.effect("starts root synthesis only after real branch transcripts are retained", () =>
    Effect.gen(function* () {
      dispatched.length = 0;
      threadDetails.clear();
      const daemon = yield* SupervisedRuntimeDaemon;
      const repository = yield* SupervisedRuntimeRepository;
      const sql = yield* SqlClient.SqlClient;
      const createdAt = "2026-08-09T01:00:00.000Z";
      const policy =
        builtInSubscriptions(createdAt).length > 0
          ? (yield* repository.getSnapshot({ includeDisabled: true })).runPolicies[0]
          : undefined;
      const runPolicy = {
        ...(policy ?? {
          id: "policy-rlm-daemon",
          name: "RLM daemon",
          maxWallTimeMs: 60_000,
          maxRecursiveCalls: 4,
          maxFanOut: 4,
          maxRetries: 2,
          maxKernelMemoryMiB: 256,
          maxKernelOutputBytes: 1_000_000,
          maxPluginHandlerMs: 30_000,
          maxPluginQueueDepth: 100,
          maxSubscriptions: 100,
          maxPlugins: 20,
          maxEventRatePerMinute: 1_000,
          maxAggregationWindowMs: 60_000,
          maxAggregationSamples: 1_000,
          maxCostUsd: null,
          replayBehavior: "observe_only" as const,
          allowedCapabilities: [],
          allowedPluginActions: [],
          circuitBreakerFailureCount: 3,
          circuitBreakerResetMs: 1_000,
          revision: 0,
          createdAt,
          updatedAt: createdAt,
        }),
        maxWallTimeMs: 7 * 24 * 60 * 60 * 1_000,
      };
      yield* repository.upsertRunPolicy(runPolicy as never);
      yield* sql`
        INSERT OR IGNORE INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
        ) VALUES (
          'project-rlm-daemon', 'project', 'RLM daemon', '/tmp/rlm-daemon', '[]',
          ${createdAt}, ${createdAt}
        )
      `;
      const apply = (event: Record<string, unknown>) =>
        repository.applyDomainEvent({
          occurredAt: createdAt,
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: { schemaVersion: "1.0.0" },
          ...event,
        } as never);
      yield* apply({
        sequence: 101,
        eventId: "event-rlm-room",
        aggregateKind: "supervised_room",
        aggregateId: "room-rlm-daemon",
        type: "supervised.room-created",
        payload: {
          acceptedRevision: 0,
          actor: { kind: "daemon", actorId: "test" },
          room: {
            id: "room-rlm-daemon",
            projectId: "project-rlm-daemon",
            title: "RLM Room",
            leadSeatId: "lead-rlm-daemon",
            status: "active",
            graphRevision: 1,
            revision: 0,
            createdAt,
            updatedAt: createdAt,
          },
        },
      });
      yield* apply({
        sequence: 102,
        eventId: "event-rlm-task",
        aggregateKind: "supervised_task",
        aggregateId: "task-rlm-daemon",
        type: "supervised.task-created",
        payload: {
          acceptedRevision: 0,
          actor: { kind: "daemon", actorId: "test" },
          task: {
            id: "task-rlm-daemon",
            roomId: "room-rlm-daemon",
            title: "RLM Task",
            intent: "Synthesize branch evidence.",
            acceptanceCriteria: [],
            lifecycle: "active",
            activeGraphRevision: 1,
            revision: 0,
            createdAt,
            updatedAt: createdAt,
          },
        },
      });
      yield* apply({
        sequence: 103,
        eventId: "event-rlm-run",
        aggregateKind: "supervised_run",
        aggregateId: "run-rlm-daemon",
        type: "supervised.run-requested",
        payload: {
          acceptedRevision: 3,
          actor: { kind: "daemon", actorId: "test" },
          run: {
            id: "run-rlm-daemon",
            roomId: "room-rlm-daemon",
            taskId: "task-rlm-daemon",
            taskNodeId: null,
            taskNodeRevisionId: null,
            ownerSeatId: "lead-rlm-daemon",
            policyId: runPolicy.id,
            status: "running",
            attempt: 1,
            daemonEpoch: 1,
            startedAt: createdAt,
            lastProgressAt: createdAt,
            finishedAt: null,
            revision: 3,
            createdAt,
            updatedAt: createdAt,
          },
        },
      });
      const episode = {
        id: "episode-rlm-daemon",
        runId: "run-rlm-daemon",
        admission: {
          episodeId: "episode-rlm-daemon",
          requestedMode: "recursive",
          selectedMode: "recursive",
          estimatedContextPercent: 10,
          estimatedInputTokens: 100,
          independentEvidenceBranches: 2,
          reasons: ["test"],
          admittedByPolicyId: runPolicy.id,
          createdAt,
        },
        status: "branches_running",
        rootModelSessionId: "session-rlm-root",
        branchModelSessionIds: ["session-rlm-a", "session-rlm-b"],
        branchCount: 2,
        completedBranchCount: 0,
        staleBranchCount: 0,
        coveragePercent: 0,
        contradictionCount: 0,
        evidenceRefs: [],
        failureSummaries: [],
        revision: 3,
        createdAt,
        updatedAt: createdAt,
      };
      yield* apply({
        sequence: 104,
        eventId: "event-rlm-episode",
        aggregateKind: "rlm_episode",
        aggregateId: episode.id,
        type: "supervised.rlm-upserted",
        payload: {
          acceptedRevision: 3,
          actor: { kind: "daemon", actorId: "test" },
          rlmEpisode: episode,
        },
      });
      const trace = (
        id: string,
        threadId: string,
        role: "rlm_root" | "rlm_branch",
        title: string,
      ) => ({
        id,
        roomId: "room-rlm-daemon",
        runId: "run-rlm-daemon",
        taskId: "task-rlm-daemon",
        taskNodeId: null,
        actorSeatId: "lead-rlm-daemon",
        authorityReceiptId: "receipt-lead-rlm-daemon",
        effectiveRole: "lead",
        rootLeaseIds: ["root-lease-rlm-daemon"],
        rlmEpisodeId: episode.id,
        parentSessionId: role === "rlm_branch" ? "session-rlm-root" : null,
        peerSpecialtyId: null,
        threadId,
        role,
        title,
        provider: "codex",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        providerSessionId: null,
        providerCallId: null,
        contextViewRefs: [],
        contextView: null,
        promptHash: null,
        inputSummary: role === "rlm_root" ? "Synthesize branch evidence." : `Investigate ${title}.`,
        items: [],
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          contextTokens: 0,
          providerLimitTokens: null,
          contextUsagePercent: null,
        },
        usageProvenance: {
          inputOutputTokens: "unavailable",
          contextWindow: "unavailable",
        },
        status: "queued",
        retryCount: 0,
        durationMs: null,
        costUsd: null,
        synthesisDestination: role === "rlm_branch" ? "session-rlm-root" : null,
        createdAt,
        updatedAt: createdAt,
        revision: 0,
      });
      for (const [index, session] of [
        trace("session-rlm-root", "thread-rlm-root", "rlm_root", "Root"),
        trace("session-rlm-a", "thread-rlm-a", "rlm_branch", "Branch A"),
        trace("session-rlm-b", "thread-rlm-b", "rlm_branch", "Branch B"),
      ].entries()) {
        yield* apply({
          sequence: 105 + index,
          eventId: `event-rlm-session-${index}`,
          aggregateKind: "model_session",
          aggregateId: session.id,
          type: "supervised.model-session-upserted",
          payload: {
            acceptedRevision: 0,
            actor: { kind: "daemon", actorId: "test" },
            modelSession: session,
          },
        });
      }
      const branchThread = (id: string, answer: string, withTerminalSources = false) =>
        ({
          id,
          modelSelection: {
            provider: "codex",
            model: "gpt-5.6-sol",
            options: { reasoningEffort: "high" },
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          latestTurn: {
            turnId: `${id}:turn`,
            state: "completed",
            requestedAt: createdAt,
            startedAt: createdAt,
            completedAt: "2026-08-09T01:00:02.000Z",
            assistantMessageId: `${id}:assistant`,
          },
          messages: [
            {
              id: `${id}:assistant`,
              role: "assistant",
              text: answer,
              turnId: `${id}:turn`,
              streaming: false,
              createdAt: "2026-08-09T01:00:02.000Z",
              updatedAt: "2026-08-09T01:00:02.000Z",
            },
          ],
          activities: withTerminalSources
            ? [
                {
                  id: `${id}:context-event`,
                  tone: "info",
                  kind: "context-window.updated",
                  summary: "Context window updated",
                  payload: { usedTokens: 1_000, maxTokens: 128_000, usedPercent: 0.78125 },
                  turnId: `${id}:turn`,
                  createdAt: "2026-08-09T01:00:01.000Z",
                },
                {
                  id: `${id}:terminal-event`,
                  tone: "info",
                  kind: "turn.completed",
                  summary: "Turn completed",
                  payload: {
                    state: "completed",
                    modelUsage: { "gpt-5.6-sol": { inputTokens: 100, outputTokens: 25 } },
                  },
                  turnId: `${id}:turn`,
                  createdAt: "2026-08-09T01:00:02.000Z",
                },
              ]
            : [],
          session: {
            status: "ready",
            lastError: null,
          },
        }) as unknown as OrchestrationThread;
      threadDetails.set("thread-rlm-a", branchThread("thread-rlm-a", "Visible evidence A."));
      threadDetails.set("thread-rlm-b", branchThread("thread-rlm-b", "Visible evidence B."));

      const reconciliationState = yield* repository.getRlmReconciliationState();
      assert.deepEqual(
        reconciliationState.runs.map((candidate) => candidate.id),
        ["run-rlm-daemon"],
      );
      assert.equal(reconciliationState.runPolicies[0]?.id, runPolicy.id);
      assert.deepEqual(reconciliationState.modelSessions.map((candidate) => candidate.id).sort(), [
        "session-rlm-a",
        "session-rlm-b",
        "session-rlm-root",
      ]);

      yield* daemon.reconcile;

      assert.equal(
        dispatched.some((command) => command.type === "supervised.evidence.publish"),
        false,
      );
      assert.equal(
        dispatched.some(
          (command) =>
            command.type === "supervised.model-session.upsert" &&
            command.modelSession.status === "completed",
        ),
        false,
      );
      assert.equal(dispatched.filter((command) => command.type === "thread.turn.start").length, 2);

      threadDetails.set("thread-rlm-a", branchThread("thread-rlm-a", "Visible evidence A.", true));
      threadDetails.set("thread-rlm-b", branchThread("thread-rlm-b", "Visible evidence B.", true));
      dispatched.length = 0;
      yield* daemon.reconcile;

      const evidenceCommands = dispatched.filter(
        (command) => command.type === "supervised.evidence.publish",
      );
      const sessionCommands = dispatched.filter(
        (command) => command.type === "supervised.model-session.upsert",
      );
      const rootTurn = dispatched.find(
        (command) => command.type === "thread.turn.start" && command.threadId === "thread-rlm-root",
      );
      assert.equal(evidenceCommands.length, 2);
      assert.ok(
        evidenceCommands.every(
          (command) =>
            command.type !== "supervised.evidence.publish" ||
            command.evidence.sourceEventIds.length > 0,
        ),
      );
      assert.equal(
        sessionCommands.filter(
          (command) =>
            command.type === "supervised.model-session.upsert" &&
            command.modelSession.role === "rlm_branch" &&
            command.modelSession.status === "completed" &&
            command.modelSession.actorSeatId === "lead-rlm-daemon" &&
            command.modelSession.authorityReceiptId === "receipt-lead-rlm-daemon" &&
            command.modelSession.effectiveRole === "lead" &&
            command.modelSession.providerSessionId === null &&
            command.modelSession.usageProvenance?.inputOutputTokens === "provider_observed" &&
            command.modelSession.usageProvenance?.contextWindow === "provider_observed",
        ).length,
        2,
      );
      assert.ok(
        dispatched.some(
          (command) =>
            command.type === "supervised.rlm.upsert" && command.episode.status === "synthesizing",
        ),
      );
      assert.equal(rootTurn, undefined);
      assert.ok(
        dispatched.some(
          (command) =>
            command.type === "supervised.rlm.upsert" && command.episode.status === "stalled",
        ),
      );

      let nextSequence = 110;
      const applySupervisedDispatches = (commands: ReadonlyArray<OrchestrationCommand>) =>
        Effect.gen(function* () {
          for (const command of commands) {
            if (!command.type.startsWith("supervised.")) continue;
            const state = yield* repository.getSnapshot({ includeDisabled: true });
            const event = yield* decideSupervisedCommand({
              command: command as never,
              state,
            });
            yield* repository.applyDomainEvent({ ...event, sequence: nextSequence++ });
          }
        });
      yield* applySupervisedDispatches(dispatched);

      threadDetails.set("thread-rlm-root", {
        id: "thread-rlm-root",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.6-sol",
          options: { reasoningEffort: "high" },
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        latestTurn: null,
        messages: [],
        activities: [],
        session: null,
      } as unknown as OrchestrationThread);
      dispatched.length = 0;
      yield* daemon.reconcile;

      const resumedRootTurn = dispatched.find(
        (command) => command.type === "thread.turn.start" && command.threadId === "thread-rlm-root",
      );
      assert.equal(resumedRootTurn?.type, "thread.turn.start");
      if (resumedRootTurn?.type === "thread.turn.start") {
        assert.match(resumedRootTurn.message.text, /Visible evidence A/);
        assert.match(resumedRootTurn.message.text, /evidence:rlm-session/);
        assert.equal(resumedRootTurn.message.role, "user");
        assert.equal(resumedRootTurn.dispatchOrigin, "automation");
      }
      yield* applySupervisedDispatches(dispatched);

      const completedRoot = branchThread(
        "thread-rlm-root",
        "Root synthesis with evidence citations.",
        true,
      );
      threadDetails.set("thread-rlm-root", completedRoot);
      dispatched.length = 0;
      yield* daemon.reconcile;

      assert.ok(
        dispatched.some(
          (command) =>
            command.type === "supervised.model-session.upsert" &&
            command.modelSession.role === "rlm_root" &&
            command.modelSession.status === "completed",
        ),
      );
      assert.ok(
        dispatched.some(
          (command) =>
            command.type === "supervised.rlm.upsert" && command.episode.status === "completed",
        ),
      );
      assert.deepEqual(
        dispatched
          .filter((command) => command.type === "supervised.run.transition")
          .map((command) => (command.type === "supervised.run.transition" ? command.status : null)),
        ["reviewing", "succeeded"],
      );
      yield* applySupervisedDispatches(dispatched);

      const retained = yield* repository.getSnapshot({ includeDisabled: true });
      assert.equal(
        retained.rlmEpisodes.find((candidate) => candidate.id === episode.id)?.status,
        "completed",
      );
      assert.equal(
        retained.modelSessions.find((candidate) => candidate.id === "session-rlm-root")?.status,
        "completed",
      );
      assert.equal(
        retained.runs.find((candidate) => candidate.id === "run-rlm-daemon")?.status,
        "succeeded",
      );
      assert.equal(
        retained.evidence.filter((candidate) => candidate.modelSessionId !== null).length,
        3,
      );
      threadDetails.clear();
      yield* sql`DELETE FROM projection_projects WHERE project_id = 'project-rlm-daemon'`;
    }),
  );

  it.effect("defers excess deliveries when a subscription reaches its per-minute quota", () =>
    Effect.gen(function* () {
      const daemon = yield* SupervisedRuntimeDaemon;
      const repository = yield* SupervisedRuntimeRepository;
      const subscription = {
        ...builtInSubscriptions(at(0))[0]!,
        id: "subscription-rate-limit" as const,
        rateLimitPerMinute: 1,
      };
      yield* repository.upsertSubscription(subscription as unknown as SubscriptionDefinition);
      for (const suffix of ["a", "b"] as const) {
        const signal = {
          id: `signal-rate-${suffix}` as const,
          kind: "ReviewLoopSuspected",
          subscriptionId: subscription.id,
          scope: { kind: "global" as const },
          subjectId: `rate-${suffix}`,
          state: "triggered" as const,
          measuredValue: 4,
          threshold: { operator: "gt" as const, value: 3 },
          sourceEventIds: [`event-rate-${suffix}` as const],
          metricSampleIds: [],
          aggregationReceiptHash: `sha256:${suffix.repeat(64)}` as never,
          context: {},
          triggeredAt: at(0),
          resetAt: null,
          revision: 0,
        };
        yield* repository.upsertSignal(signal as unknown as DerivedSignal);
        yield* repository.enqueueDelivery({
          id: `delivery-rate-${suffix}` as const,
          subscriptionId: subscription.id,
          signalId: signal.id,
          dedupeKey: `rate-${suffix}`,
          status: "queued",
          attemptCount: 0,
          availableAt: at(0),
          deliveredAt: null,
          lastError: null,
          payloadHash: `sha256:${suffix.repeat(64)}` as never,
          replay: false,
          replayBehavior: "observe_only",
          createdAt: at(0),
          updatedAt: at(0),
        } as unknown as SubscriptionDelivery);
      }

      yield* daemon.reconcile;
      const snapshot = yield* repository.getSnapshot({ includeDisabled: true });
      const deliveries = snapshot.deliveries.filter(
        (delivery) => delivery.subscriptionId === subscription.id,
      );
      assert.equal(deliveries.filter((delivery) => delivery.status === "delivered").length, 1);
      const deferred = deliveries.find((delivery) => delivery.status === "queued");
      assert.ok(deferred);
      assert.match(deferred.lastError ?? "", /rate limit/);
      assert.ok(deferred.availableAt > new Date().toISOString());
    }),
  );

  it.effect("dead-letters a new signal when its durable subscription queue is full", () =>
    Effect.gen(function* () {
      const daemon = yield* SupervisedRuntimeDaemon;
      const repository = yield* SupervisedRuntimeRepository;
      const subscription = {
        ...builtInSubscriptions(at(0))[0]!,
        id: "subscription-queue-limit" as const,
        selector: { sourceKind: "event" as const, names: ["QueueDepthEvent"] },
        aggregation: { function: "count" as const, field: null, groupBy: ["subjectId"] },
        condition: { operator: "gte" as const, value: 1 },
        hysteresis: {
          trigger: { operator: "gte" as const, value: 1 },
          reset: { operator: "lt" as const, value: 1 },
        },
        maxQueueDepth: 1,
      };
      const existingSignal = {
        id: "signal-queue-existing" as const,
        kind: "QueueDepth",
        subscriptionId: subscription.id,
        scope: { kind: "global" as const },
        subjectId: "queue-existing",
        state: "triggered" as const,
        measuredValue: 1,
        threshold: subscription.condition,
        sourceEventIds: ["event-queue-existing" as const],
        metricSampleIds: [],
        aggregationReceiptHash: `sha256:${"f".repeat(64)}` as const,
        context: {},
        triggeredAt: at(0),
        resetAt: null,
        revision: 0,
      };
      yield* repository.upsertSubscription(subscription as unknown as SubscriptionDefinition);
      yield* repository.upsertSignal(existingSignal as unknown as DerivedSignal);
      yield* repository.enqueueDelivery({
        id: "delivery-queue-existing" as const,
        subscriptionId: subscription.id,
        signalId: existingSignal.id,
        dedupeKey: "queue-existing",
        status: "queued",
        attemptCount: 0,
        availableAt: "2099-01-01T00:00:00.000Z",
        deliveredAt: null,
        lastError: null,
        payloadHash: `sha256:${"f".repeat(64)}` as const,
        replay: false,
        replayBehavior: "observe_only",
        createdAt: at(0),
        updatedAt: at(0),
      } as unknown as SubscriptionDelivery);
      yield* daemon.ingest(
        Schema.decodeUnknownSync(ControlPlaneEvent)({
          sequence: 0,
          eventId: "event-queue-new",
          schemaId: "schema-queue-depth",
          schemaVersion: "1.0.0",
          type: "QueueDepthEvent",
          scope: { kind: "global" },
          subjectId: "queue-new",
          eventTime: at(5),
          recordedAt: at(5),
          revision: 0,
          causationEventId: null,
          correlationId: null,
          payload: {},
          provenance: {
            actor: { kind: "daemon", actorId: "queue-test" },
            source: "queue-test",
            confidence: 1,
          },
        }),
      );
      yield* daemon.reconcile;

      const snapshot = yield* repository.getSnapshot({ includeDisabled: true });
      const deadLetter = snapshot.deadLetters.find(
        (letter) =>
          letter.subscriptionId === subscription.id &&
          letter.deliveryId !== "delivery-queue-existing",
      );
      assert.ok(deadLetter);
      assert.match(deadLetter.reason, /queue depth/);
    }),
  );
});

type ScenarioJReviewStatus = "accepted" | "rejected";

const scenarioJReviewFact = (index: number, status: ScenarioJReviewStatus) => {
  const resolvedAt = at(index);
  const intervention = {
    id: `intervention-review-${index}`,
    roomId: "room-review",
    requestedBy: {
      kind: "seat" as const,
      actorId: "supervisor-delivery",
      seatId: "supervisor-delivery",
    },
    specialistThreadId: "thread-supervisor-delivery",
    reason: `Review concern ${index}`,
    material: true,
    evidenceRefs: [`evidence-review-${index}`],
    status: status === "rejected" ? ("rejected" as const) : ("reconciled" as const),
    createdAt: at(index - 1),
    updatedAt: resolvedAt,
    revision: 1,
  };
  const reconciliation = {
    id: `reconciliation-review-${index}`,
    interventionId: intervention.id,
    roomId: "room-review",
    leadSeatId: "lead-review",
    status,
    taskNodeRevisionId: "revision-review",
    reason: status === "rejected" ? "Evidence is incomplete." : null,
    createdAt: at(index - 1),
    resolvedAt,
    revision: 1,
  };
  const event = {
    sequence: index,
    eventId: `event-review-committed-${index}`,
    aggregateKind: "intervention",
    aggregateId: intervention.id,
    type: "supervised.intervention-reconciled",
    payload: {
      acceptedRevision: 1,
      actor: { kind: "seat", actorId: "lead-review", seatId: "lead-review" },
      intervention,
      reconciliation,
    },
    occurredAt: resolvedAt,
    commandId: `command-review-${index}`,
    causationEventId: null,
    correlationId: `command-review-${index}`,
    metadata: { schemaVersion: "1.0.0" },
  } as unknown as OrchestrationEvent;
  return { event, intervention, reconciliation };
};

const scenarioJReadModelFor = (
  facts: ReadonlyArray<ReturnType<typeof scenarioJReviewFact>>,
): OrchestrationReadModel =>
  ({
    snapshotSequence: facts.length,
    spaces: [{ id: "space-review" }],
    projects: [{ id: "project-review", spaceId: "space-review" }],
    threads: [
      {
        id: "thread-lead-review",
        deletedAt: null,
        runtimeMode: "full-access",
        interactionMode: "default",
      },
      {
        id: "thread-supervisor-delivery",
        deletedAt: null,
        runtimeMode: "full-access",
        interactionMode: "default",
      },
    ],
    supervised: {
      ...emptySupervisedRuntimeSnapshot(at(0)),
      rooms: [
        {
          id: "room-review",
          projectId: "project-review",
          title: "Review Room",
          leadSeatId: "lead-review",
          status: "active",
          graphRevision: 7,
          revision: 1,
          createdAt: at(0),
          updatedAt: at(0),
        },
      ],
      tasks: [
        {
          id: "task-review",
          roomId: "room-review",
          title: "Review Task",
          intent: "Exercise the committed review loop.",
          acceptanceCriteria: ["Supervisor observes without acquiring Root."],
          lifecycle: "review",
          activeGraphRevision: 7,
          revision: 1,
          createdAt: at(0),
          updatedAt: at(0),
        },
      ],
      taskNodes: [
        {
          id: "node-review",
          taskId: "task-review",
          roomId: "room-review",
          parentNodeId: null,
          title: "Review Node",
          description: null,
          lifecycle: "review",
          activeRevisionId: "revision-review",
          graphRevision: 7,
          revision: 1,
          createdAt: at(0),
          updatedAt: at(0),
        },
      ],
      taskNodeRevisions: [
        {
          id: "revision-review",
          taskNodeId: "node-review",
          graphRevision: 7,
          scope: "Review the durable change.",
          acceptanceCriteria: ["Evidence is canonical."],
          dependencyNodeIds: [],
          evidenceRefs: [],
          createdBy: { kind: "seat", actorId: "lead-review", seatId: "lead-review" },
          createdAt: at(0),
        },
      ],
      interventions: facts.map((fact) => fact.intervention),
      reconciliations: facts.map((fact) => fact.reconciliation),
    },
    updatedAt: facts.at(-1)?.event.occurredAt ?? at(0),
  }) as never;

const scenarioJGovernanceSnapshot = () => {
  const now = at(0);
  const empty = emptySupervisedGovernanceSnapshot(now);
  return {
    ...empty,
    workspaces: [
      {
        id: "workspace-review",
        ownerNamespace: "owner",
        title: "Review Workspace",
        lifecycleState: "active",
        revision: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
    agentSeats: [
      {
        id: "lead-review",
        workspaceId: "workspace-review",
        roomIds: ["room-review"],
        identityRole: "lead",
        effectiveRole: "lead",
        profileId: "profile-lead-review",
        providerSessionId: null,
        lifecycleState: "active",
        workState: "idle",
        authorityReceiptId: "receipt-lead-review",
        threadId: "thread-lead-review",
        projectId: "project-review",
        profileSnapshotId: null,
        predecessorThreadIds: [],
        displayName: "Review Room Lead",
        createdAt: now,
        retainedAt: null,
        retiredAt: null,
        revision: 0,
        updatedAt: now,
      },
      {
        id: "supervisor-delivery",
        workspaceId: "workspace-review",
        roomIds: ["room-review"],
        identityRole: "supervisor",
        effectiveRole: "supervisor",
        profileId: "profile-supervisor-delivery",
        concern: "delivery",
        providerSessionId: null,
        lifecycleState: "active",
        workState: "idle",
        authorityReceiptId: "receipt-supervisor-delivery",
        threadId: "thread-supervisor-delivery",
        projectId: null,
        profileSnapshotId: null,
        predecessorThreadIds: [],
        displayName: "Delivery Supervisor",
        createdAt: now,
        retainedAt: null,
        retiredAt: null,
        revision: 0,
        updatedAt: now,
      },
    ],
    authorityReceipts: [
      {
        id: "receipt-lead-review",
        actorSeatId: "lead-review",
        identityRole: "lead",
        effectiveRole: "lead",
        workspaceScopes: ["workspace-review"],
        roomScopes: ["room-review"],
        taskNodeScopes: [],
        allowedCommands: [],
        allowedTools: [],
        rootLeaseIds: ["root-lease-review"],
        mandateIds: [],
        runPolicyRevision: 0,
        issuedAt: now,
        expiresAt: null,
        revokedAt: null,
      },
      {
        id: "receipt-supervisor-delivery",
        actorSeatId: "supervisor-delivery",
        identityRole: "supervisor",
        effectiveRole: "supervisor",
        workspaceScopes: ["workspace-review"],
        roomScopes: ["room-review"],
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
        id: "root-lease-review",
        workspaceId: "workspace-review",
        roomId: "room-review",
        holderSeatId: "lead-review",
        status: "active",
        acquiredUnderReceiptId: "receipt-lead-review",
        predecessorLeaseId: null,
        acquiredAt: now,
        releasedAt: null,
        expiresAt: null,
        revision: 0,
        updatedAt: now,
      },
    ],
    orchestration: {
      ...empty.orchestration,
      missions: [
        {
          id: "mission-delivery-review",
          supervisorSeatId: "supervisor-delivery",
          brief: "Observe delivery review churn.",
          focus: "delivery",
          scope: [{ kind: "project", projectId: "project-review" }],
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
  } as never;
};

const scenarioJCommittedEvents: OrchestrationEvent[] = [];
const scenarioJDispatched: OrchestrationCommand[] = [];
let scenarioJReadModel = scenarioJReadModelFor([]);

const scenarioJEngineLayer = Layer.succeed(OrchestrationEngineService, {
  dispatch: (command: OrchestrationCommand) =>
    Effect.sync(() => {
      scenarioJDispatched.push(command);
      return { sequence: 10_000 + scenarioJDispatched.length };
    }),
  getReadModel: () => Effect.sync(() => scenarioJReadModel),
  getEventHighWaterSequence: Effect.sync(() => scenarioJCommittedEvents.at(-1)?.sequence ?? 0),
  readEventsThrough: (fromSequenceExclusive: number, throughSequenceInclusive: number) =>
    Stream.fromIterable(
      scenarioJCommittedEvents.filter(
        (event) =>
          event.sequence > fromSequenceExclusive && event.sequence <= throughSequenceInclusive,
      ),
    ),
  streamDomainEvents: Stream.never,
} as never);
const scenarioJSnapshotQueryLayer = Layer.succeed(ProjectionSnapshotQuery, {
  getSnapshot: () => Effect.sync(() => scenarioJReadModel),
  getThreadDetailById: () => Effect.succeed(Option.none()),
} as never);
const scenarioJRepositoryLayer = SupervisedRuntimeRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);
const scenarioJGovernanceRepositoryLayer = SupervisedGovernanceRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);
const scenarioJDeliveryLayer = SupervisedSignalDeliveryLive.pipe(
  Layer.provideMerge(scenarioJRepositoryLayer),
  Layer.provideMerge(scenarioJGovernanceRepositoryLayer),
  Layer.provideMerge(scenarioJEngineLayer),
);
const scenarioJDaemonLayer = SupervisedRuntimeDaemonLive.pipe(
  Layer.provideMerge(scenarioJRepositoryLayer),
  Layer.provideMerge(scenarioJGovernanceRepositoryLayer),
  Layer.provideMerge(scenarioJDeliveryLayer),
  Layer.provideMerge(scenarioJEngineLayer),
  Layer.provideMerge(scenarioJSnapshotQueryLayer),
);
const scenarioJProductionLayer = it.layer(
  Layer.mergeAll(
    SqlitePersistenceMemory,
    scenarioJRepositoryLayer,
    scenarioJGovernanceRepositoryLayer,
    scenarioJEngineLayer,
    scenarioJSnapshotQueryLayer,
    scenarioJDeliveryLayer,
    scenarioJDaemonLayer,
  ),
);

scenarioJProductionLayer("Scenario J committed review signal path", (it) => {
  it("maps only canonical accepted and rejected review facts", () => {
    const accepted = scenarioJReviewFact(1, "accepted");
    const rejected = scenarioJReviewFact(2, "rejected");
    const readModel = scenarioJReadModelFor([accepted, rejected]);

    const completed = orchestrationReviewEvent(accepted.event, readModel);
    const failed = orchestrationReviewEvent(rejected.event, readModel);
    const humanCompleted = orchestrationReviewEvent(
      {
        ...accepted.event,
        payload: {
          ...accepted.event.payload,
          actor: { kind: "user", actorId: "user-review" },
        },
      } as never,
      readModel,
    );
    assert.equal(completed?.type, "ReviewCompleted");
    assert.equal(failed?.type, "ReviewRejected");
    assert.equal(humanCompleted?.payload.reviewerSeatId, "lead-review");
    assert.deepEqual(completed?.payload, {
      taskId: "task-review",
      taskNodeId: "node-review",
      graphRevision: 7,
      roomId: "room-review",
      leadSeatId: "lead-review",
      reviewerSeatId: "lead-review",
      rejectionReason: null,
      evidenceRefs: ["evidence-review-1"],
    });
    assert.deepEqual(failed?.payload, {
      taskId: "task-review",
      taskNodeId: "node-review",
      graphRevision: 7,
      roomId: "room-review",
      leadSeatId: "lead-review",
      reviewerSeatId: "lead-review",
      rejectionReason: "Evidence is incomplete.",
      evidenceRefs: ["evidence-review-2"],
    });
    assert.equal(
      orchestrationReviewEvent(
        {
          ...accepted.event,
          payload: {
            ...accepted.event.payload,
            reconciliation: { ...accepted.reconciliation, status: "revised" },
          },
        } as never,
        readModel,
      ),
      null,
    );
    assert.equal(orchestrationReviewEvent(accepted.event, scenarioJReadModelFor([])), null);
  });

  it.effect(
    "wakes the distinct delivery Supervisor after four committed reviews without transferring Root or Lead authority",
    () =>
      Effect.gen(function* () {
        scenarioJCommittedEvents.length = 0;
        scenarioJDispatched.length = 0;
        const facts = [
          scenarioJReviewFact(1, "accepted"),
          scenarioJReviewFact(2, "rejected"),
          scenarioJReviewFact(3, "accepted"),
          scenarioJReviewFact(4, "rejected"),
        ];
        scenarioJCommittedEvents.push(...facts.map((fact) => fact.event));
        scenarioJReadModel = scenarioJReadModelFor(facts);

        const daemon = yield* SupervisedRuntimeDaemon;
        const repository = yield* SupervisedRuntimeRepository;
        const governance = yield* SupervisedGovernanceRepository;
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          INSERT INTO projection_projects (
            project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
          ) VALUES (
            'project-review', 'project', 'Review Project', '/tmp/project-review', '[]',
            ${at(0)}, ${at(0)}
          )
        `;
        yield* repository.replaceSnapshot(scenarioJReadModel.supervised);
        yield* governance.replaceSnapshot(scenarioJGovernanceSnapshot());
        const beforeGovernance = yield* governance.getSnapshot();
        const beforeLeadReceipt = beforeGovernance.authorityReceipts.find(
          (receipt) => receipt.actorSeatId === "lead-review",
        );
        const beforeSupervisorReceipt = beforeGovernance.authorityReceipts.find(
          (receipt) => receipt.actorSeatId === "supervisor-delivery",
        );

        yield* daemon.reconcile;

        const projectedEvents = yield* repository.listControlPlaneEvents({
          afterSequence: 0,
          limit: 100,
        });
        assert.deepEqual(
          projectedEvents.map((event) => event.type),
          ["ReviewCompleted", "ReviewRejected", "ReviewCompleted", "ReviewRejected"],
        );
        assert.ok(
          projectedEvents.every((event) => {
            const payload = event.payload as Record<string, unknown>;
            return (
              payload.roomId === "room-review" &&
              payload.leadSeatId === "lead-review" &&
              payload.reviewerSeatId === "lead-review" &&
              Array.isArray(payload.evidenceRefs) &&
              payload.evidenceRefs.length === 1
            );
          }),
        );

        let snapshot = yield* repository.getSnapshot({ includeDisabled: true });
        const reviewSignals = snapshot.signals.filter(
          (signal) => signal.kind === "ReviewLoopSuspected",
        );
        assert.equal(reviewSignals.length, 1);
        assert.equal(reviewSignals[0]?.measuredValue, 4);
        assert.deepEqual(reviewSignals[0]?.context, {
          taskId: "task-review",
          taskNodeId: "node-review",
          roomId: "room-review",
          leadSeatId: "lead-review",
          graphRevision: 7,
          reviewCount: 4,
          reviewerSeatIds: ["lead-review"],
          rejectionReasons: ["Evidence is incomplete.", "Evidence is incomplete."],
          repeatedProblems: ["Evidence is incomplete."],
          elapsedMs: 180_000,
          costUsd: 0,
          evidenceRefs: [
            "evidence-review-1",
            "evidence-review-2",
            "evidence-review-3",
            "evidence-review-4",
          ],
        });
        const wake = scenarioJDispatched.find((command) => command.type === "thread.turn.start");
        assert.equal(wake?.type, "thread.turn.start");
        if (wake?.type !== "thread.turn.start") return;
        assert.equal(wake.threadId, "thread-supervisor-delivery");
        assert.notEqual(wake.threadId, "thread-lead-review");
        assert.match(wake.message.text, /mission_id: mission-delivery-review/);
        assert.match(wake.message.text, /grants no new authority/);
        assert.equal(
          scenarioJDispatched.filter((command) => command.type === "thread.turn.start").length,
          1,
        );

        const fifth = scenarioJReviewFact(5, "accepted");
        facts.push(fifth);
        scenarioJCommittedEvents.push(fifth.event);
        scenarioJReadModel = scenarioJReadModelFor(facts);
        yield* daemon.reconcile;

        snapshot = yield* repository.getSnapshot({ includeDisabled: true });
        assert.equal(
          snapshot.signals.filter((signal) => signal.kind === "ReviewLoopSuspected").length,
          1,
        );
        assert.equal(
          scenarioJDispatched.filter((command) => command.type === "thread.turn.start").length,
          1,
        );
        const evaluation = yield* repository.getSubscriptionEvaluationState(
          "builtin-review-loop-v1" as never,
        );
        const evaluationGroup = Object.values(evaluation.groups)[0];
        assert.equal(evaluationGroup?.armed, false);
        assert.equal(
          Date.parse(evaluationGroup?.nextEligibleAt ?? "") -
            Date.parse(reviewSignals[0]?.triggeredAt ?? ""),
          600_000,
        );

        const afterGovernance = yield* governance.getSnapshot();
        const supervisor = afterGovernance.agentSeats.find(
          (seat) => seat.id === "supervisor-delivery",
        );
        assert.equal(supervisor?.identityRole, "supervisor");
        assert.equal(supervisor?.effectiveRole, "supervisor");
        assert.deepEqual(afterGovernance.rootLeases, beforeGovernance.rootLeases);
        assert.deepEqual(
          afterGovernance.authorityReceipts.find(
            (receipt) => receipt.actorSeatId === "lead-review",
          ),
          beforeLeadReceipt,
        );
        assert.deepEqual(
          afterGovernance.authorityReceipts.find(
            (receipt) => receipt.actorSeatId === "supervisor-delivery",
          ),
          beforeSupervisorReceipt,
        );
        assert.deepEqual(beforeSupervisorReceipt?.rootLeaseIds, []);
        assert.deepEqual(beforeLeadReceipt?.rootLeaseIds, ["root-lease-review"]);
        assert.equal(
          scenarioJReadModel.supervised.rooms.find((room) => room.id === "room-review")?.leadSeatId,
          "lead-review",
        );
        assert.equal(
          snapshot.audit.filter((entry) => entry.outcome === "supervisor_woken").length,
          1,
        );
      }),
  );
});
