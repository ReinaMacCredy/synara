import { createHash } from "node:crypto";

import type {
  DeadLetter,
  DeliveryCursor,
  DerivedSignal,
  SubscriptionDefinition,
  SubscriptionDelivery,
  SupervisedCommand,
} from "@synara/contracts";
import { CommandId } from "@synara/contracts";
import { Effect, Exit, Fiber, Layer, Ref, Scope, Semaphore } from "effect";

import { SupervisedRuntimeRepository } from "../../persistence/Services/SupervisedRuntimeRepository.ts";
import { SupervisedGovernanceRepository } from "../../persistence/Services/SupervisedGovernanceRepository.ts";
import { recoverGovernanceSnapshot } from "../../supervised/governance/Lifecycle.ts";
import {
  builtInEventSchemas,
  builtInRunPolicy,
  builtInSubscriptions,
} from "../../supervised/signal/BuiltInSubscriptions.ts";
import {
  evaluateSubscriptionEvent,
} from "../../supervised/signal/SubscriptionEvaluator.ts";
import {
  SupervisedRuntimeDaemon,
  type SupervisedRuntimeDaemonShape,
} from "../Services/SupervisedRuntimeDaemon.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { SupervisedSignalDelivery } from "../Services/SupervisedSignalDelivery.ts";

const hash = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const stableId = (prefix: string, value: unknown) =>
  `${prefix}:${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32)}`;

const makeDelivery = (
  subscription: SubscriptionDefinition,
  signal: DerivedSignal,
  at: string,
): SubscriptionDelivery => ({
  id: stableId("delivery", { subscriptionId: subscription.id, signalId: signal.id }) as SubscriptionDelivery["id"],
  subscriptionId: subscription.id,
  signalId: signal.id,
  dedupeKey: `${subscription.id}:${signal.id}`,
  status: "queued",
  attemptCount: 0,
  availableAt: at,
  deliveredAt: null,
  lastError: null,
  payloadHash: hash(signal) as SubscriptionDelivery["payloadHash"],
  replay: false,
  createdAt: at,
  updatedAt: at,
});

const makeSupervisedRuntimeDaemon = Effect.gen(function* () {
  const repository = yield* SupervisedRuntimeRepository;
  const governanceRepository = yield* SupervisedGovernanceRepository;
  const signalDelivery = yield* SupervisedSignalDelivery;
  const engine = yield* OrchestrationEngineService;
  const workerId = `supervised-daemon:${process.pid}`;
  const lifecycleLock = yield* Semaphore.make(1);
  const workerScope = yield* Effect.acquireRelease(Scope.make("sequential"), (scope) =>
    Scope.close(scope, Exit.void),
  );
  const workerFiber = yield* Ref.make<Fiber.Fiber<void, never> | null>(null);

  const ensureBuiltIns = Effect.gen(function* () {
    const snapshot = yield* repository.getSnapshot({ includeDisabled: true });
    const schemaIds = new Set(snapshot.schemas.map((schema) => schema.id));
    const subscriptionIds = new Set(snapshot.subscriptions.map((subscription) => subscription.id));
    const at = new Date().toISOString();
    if (snapshot.runPolicies.length === 0) {
      yield* repository.upsertRunPolicy(builtInRunPolicy(at));
    }
    yield* Effect.forEach(
      builtInEventSchemas(at).filter((schema) => !schemaIds.has(schema.id)),
      repository.upsertEventSchema,
      { concurrency: 1, discard: true },
    );
    yield* Effect.forEach(
      builtInSubscriptions(at).filter((subscription) => !subscriptionIds.has(subscription.id)),
      repository.upsertSubscription,
      { concurrency: 1, discard: true },
    );
  });

  const evaluateSubscription = (subscription: SubscriptionDefinition) =>
    Effect.gen(function* () {
      let state = yield* repository.getSubscriptionEvaluationState(subscription.id);
      const events = yield* repository.listControlPlaneEvents({
        afterSequence: subscription.cursor.lastSequence,
        limit: 1_000,
      });
      let lastSequence = subscription.cursor.lastSequence;
      let lastEventTime = subscription.cursor.lastEventTime;
      for (const event of events) {
        const result = evaluateSubscriptionEvent(subscription, state, event);
        state = result.state;
        lastSequence = Math.max(lastSequence, event.sequence);
        lastEventTime =
          lastEventTime === null || event.eventTime > lastEventTime
            ? event.eventTime
            : lastEventTime;
        yield* Effect.forEach(result.metricSamples, repository.recordMetricSample, {
          concurrency: 1,
          discard: true,
        });
        yield* Effect.forEach(
          [...result.triggeredSignals, ...result.resetSignals],
          repository.upsertSignal,
          { concurrency: 1, discard: true },
        );
        for (const signal of result.triggeredSignals) {
          yield* repository.enqueueDelivery(makeDelivery(subscription, signal, event.recordedAt));
        }
      }
      if (events.length > 0) {
        const updatedAt = events.at(-1)!.recordedAt;
        yield* repository.putSubscriptionEvaluationState(subscription.id, state, updatedAt);
        const cursor: DeliveryCursor = {
          subscriptionId: subscription.id,
          lastSequence,
          lastEventTime,
          watermark: lastEventTime,
          updatedAt,
        };
        yield* repository.upsertCursor(cursor);
      }
    });

  const settleDelivery = (input: {
    readonly subscription: SubscriptionDefinition;
    readonly signal: DerivedSignal;
    readonly delivery: SubscriptionDelivery;
  }) =>
    signalDelivery.deliver(input).pipe(
      Effect.matchEffect({
        onSuccess: () => {
          const now = new Date().toISOString();
          const completed = repository.updateDelivery({
            ...input.delivery,
            status: "delivered",
            attemptCount: input.delivery.attemptCount + 1,
            deliveredAt: now,
            lastError: null,
            updatedAt: now,
          });
          if (!input.delivery.replay) return completed;
          return repository.getSnapshot({ includeDisabled: true }).pipe(
            Effect.flatMap((snapshot) => {
              const letter = snapshot.deadLetters.find(
                (candidate) => candidate.deliveryId === input.delivery.id,
              );
              if (!letter) return completed;
              return Effect.all([
                completed,
                repository.putDeadLetter({
                  ...letter,
                  status: "resolved",
                  updatedAt: now,
                  resolvedAt: now,
                }),
              ]).pipe(Effect.asVoid);
            }),
          );
        },
        onFailure: (error) => {
          const now = new Date().toISOString();
          const attemptCount = input.delivery.attemptCount + 1;
          if (attemptCount >= input.subscription.failurePolicy.deadLetterAfterAttempts) {
            const failed: SubscriptionDelivery = {
              ...input.delivery,
              status: "dead_lettered",
              attemptCount,
              lastError: error.detail,
              updatedAt: now,
            };
            const deadLetter: DeadLetter = {
              id: stableId("dead-letter", input.delivery.id) as DeadLetter["id"],
              subscriptionId: input.subscription.id,
              deliveryId: input.delivery.id,
              pluginId:
                input.subscription.destination.kind === "plugin"
                  ? input.subscription.destination.pluginId
                  : null,
              reason: error.detail,
              payloadHash: input.delivery.payloadHash,
              attemptCount,
              status: "open",
              createdAt: now,
              updatedAt: now,
              resolvedAt: null,
            };
            return Effect.all([
              repository.updateDelivery(failed),
              repository.putDeadLetter(deadLetter),
            ]).pipe(Effect.asVoid);
          }
          return repository.updateDelivery({
            ...input.delivery,
            status: "failed",
            attemptCount,
            availableAt: new Date(
              Date.parse(now) +
                input.subscription.failurePolicy.backoffMs * 2 ** (attemptCount - 1),
            ).toISOString(),
            lastError: error.detail,
            updatedAt: now,
          });
        },
      }),
    );

  const reconcile: SupervisedRuntimeDaemonShape["reconcile"] = Effect.gen(function* () {
    const governanceBefore = yield* governanceRepository.getSnapshot();
    const governanceRecovery = recoverGovernanceSnapshot(
      governanceBefore,
      new Date().toISOString(),
    );
    if (governanceRecovery.snapshot !== governanceBefore) {
      yield* governanceRepository.replaceSnapshot(governanceRecovery.snapshot);
    }
    yield* ensureBuiltIns;
    const before = yield* repository.getSnapshot({ includeDisabled: true });
    const now = new Date().toISOString();
    const expiredCommands: SupervisedCommand[] = [
      ...before.workClaims
        .filter((claim) => claim.status === "active" && claim.expiresAt <= now)
        .map((claim) => ({
          type: "supervised.claim.expire" as const,
          commandId: CommandId.makeUnsafe(stableId("command:claim-expire", claim.id)),
          actor: { kind: "daemon" as const, actorId: workerId },
          aggregateId: claim.id,
          expectedRevision: claim.revision,
          idempotencyKey: `claim-expire:${claim.id}:${claim.expiresAt}`,
          claimId: claim.id,
          createdAt: now,
        })),
      ...before.capabilityLeases
        .filter((lease) => lease.status === "active" && lease.expiresAt <= now)
        .map((lease) => ({
          type: "supervised.lease.expire" as const,
          commandId: CommandId.makeUnsafe(stableId("command:lease-expire", lease.id)),
          actor: { kind: "daemon" as const, actorId: workerId },
          aggregateId: lease.id,
          expectedRevision: lease.revision,
          idempotencyKey: `lease-expire:${lease.id}:${lease.expiresAt}`,
          leaseId: lease.id,
          createdAt: now,
        })),
    ];
    yield* Effect.forEach(expiredCommands, (command) => engine.dispatch(command), {
      concurrency: 1,
      discard: true,
    });
    yield* repository.setHealth(
      { ...before.health, status: "recovering", updatedAt: now },
      before.snapshotSequence,
    );
    yield* Effect.forEach(
      before.subscriptions.filter((subscription) => subscription.state === "enabled"),
      evaluateSubscription,
      { concurrency: 1, discard: true },
    );
    const evaluated = yield* repository.getSnapshot({ includeDisabled: true });
    const claimed = yield* repository.claimDeliveries({
      workerId,
      now: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(),
      limit: 100,
    });
    for (const delivery of claimed) {
      const subscription = evaluated.subscriptions.find(
        (candidate) => candidate.id === delivery.subscriptionId,
      );
      const signal = evaluated.signals.find((candidate) => candidate.id === delivery.signalId);
      if (!subscription || !signal || subscription.state !== "enabled") {
        yield* repository.updateDelivery({
          ...delivery,
          status: "failed",
          attemptCount: delivery.attemptCount + 1,
          availableAt: new Date(Date.now() + 1_000).toISOString(),
          lastError: "Subscription or signal is unavailable.",
          updatedAt: new Date().toISOString(),
        });
        continue;
      }
      yield* settleDelivery({ subscription, signal, delivery });
    }
    const after = yield* repository.getSnapshot({ includeDisabled: true });
    const queued = after.deliveries.filter((delivery) => delivery.status !== "delivered").length;
    yield* repository.setHealth(
      {
        ...after.health,
        status: after.deadLetters.length > 0 ? "degraded" : "healthy",
        journalLag: 0,
        deliveryQueueDepth: queued,
        deadLetterCount: after.deadLetters.filter((letter) => letter.status === "open").length,
        unhealthyPluginCount: after.plugins.filter((plugin) => plugin.status === "unhealthy")
          .length,
        lastRecoveryAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      after.snapshotSequence,
    );
  });

  const ingest: SupervisedRuntimeDaemonShape["ingest"] = (event) =>
    repository.appendControlPlaneEvent(event);

  const backgroundLoop = Effect.forever(
    Effect.sleep("1 second").pipe(
      Effect.andThen(reconcile),
      Effect.catch((error) =>
        Effect.logError("Supervised runtime reconciliation failed", { error }),
      ),
    ),
  );

  const launchBackgroundLoop = Effect.gen(function* () {
    const fiber = yield* Scope.provide(Effect.forkScoped(backgroundLoop), workerScope);
    yield* Ref.set(workerFiber, fiber);
  });

  const stopBackgroundLoop = Effect.gen(function* () {
    const current = yield* Ref.get(workerFiber);
    if (current) yield* Fiber.interrupt(current);
    yield* Ref.set(workerFiber, null);
  });

  const start: SupervisedRuntimeDaemonShape["start"] = Effect.gen(function* () {
    yield* reconcile.pipe(
      Effect.catch((error) =>
        Effect.logError("Supervised runtime startup reconciliation failed", { error }),
      ),
    );
    yield* launchBackgroundLoop;
  });

  const restart: SupervisedRuntimeDaemonShape["restart"] = lifecycleLock.withPermits(1)(
    Effect.gen(function* () {
      yield* stopBackgroundLoop;
      const before = yield* repository.getSnapshot({ includeDisabled: true });
      const now = new Date().toISOString();
      yield* repository.setHealth(
        {
          ...before.health,
          daemonEpoch: before.health.daemonEpoch + 1,
          status: "starting",
          updatedAt: now,
        },
        before.snapshotSequence,
      );
      yield* reconcile;
      yield* launchBackgroundLoop;
      return (yield* repository.getSnapshot({ includeDisabled: true })).health;
    }),
  );

  return { ingest, reconcile, restart, start } satisfies SupervisedRuntimeDaemonShape;
});

export const SupervisedRuntimeDaemonLive = Layer.effect(
  SupervisedRuntimeDaemon,
  makeSupervisedRuntimeDaemon,
);
