import { createHash } from "node:crypto";

import type {
  DeadLetter,
  DeliveryCursor,
  DerivedSignal,
  ModelSessionTrace,
  OrchestrationThread,
  RlmEpisode,
  SubscriptionDefinition,
  SubscriptionDelivery,
  SupervisedCommand,
} from "@synara/contracts";
import { CommandId, EvidenceId, MessageId } from "@synara/contracts";
import { Effect, Exit, Fiber, Layer, Option, Queue, Ref, Scope, Semaphore } from "effect";

import { SupervisedRuntimeRepository } from "../../persistence/Services/SupervisedRuntimeRepository.ts";
import { SupervisedGovernanceRepository } from "../../persistence/Services/SupervisedGovernanceRepository.ts";
import {
  recoverGovernanceSnapshot,
  settleGovernanceRecoveryActions,
} from "../../supervised/governance/Lifecycle.ts";
import {
  builtInEventSchemas,
  builtInRunPolicy,
  builtInSubscriptions,
} from "../../supervised/signal/BuiltInSubscriptions.ts";
import { evaluateSubscriptionEvent } from "../../supervised/signal/SubscriptionEvaluator.ts";
import {
  buildRlmSynthesisPrompt,
  extractRlmThreadResult,
  promptReceiptHash,
  type RlmThreadResult,
} from "../../supervised/runtime/RlmExecution.ts";
import {
  SupervisedRuntimeDaemon,
  type SupervisedRuntimeDaemonShape,
} from "../Services/SupervisedRuntimeDaemon.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { SupervisedSignalDelivery } from "../Services/SupervisedSignalDelivery.ts";

const hash = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const stableId = (prefix: string, value: unknown) =>
  `${prefix}:${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32)}`;
const RLM_PROVISIONING_GRACE_MS = 30_000;
const PROVISIONING_RLM_STATUSES = new Set<RlmEpisode["status"]>([
  "requested",
  "admitted",
  "branching",
  "planned",
]);

export const shouldDeferRlmProvisioningReconciliation = (
  episode: Pick<RlmEpisode, "status" | "updatedAt">,
  nowMs: number,
) => {
  const updatedAtMs = Date.parse(episode.updatedAt);
  return (
    PROVISIONING_RLM_STATUSES.has(episode.status) &&
    Number.isFinite(updatedAtMs) &&
    nowMs - updatedAtMs < RLM_PROVISIONING_GRACE_MS
  );
};

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
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const workerId = `supervised-daemon:${process.pid}`;
  const lifecycleLock = yield* Semaphore.make(1);
  const workerScope = yield* Effect.acquireRelease(Scope.make("sequential"), (scope) =>
    Scope.close(scope, Exit.void),
  );
  const workerFiber = yield* Ref.make<Fiber.Fiber<void, never> | null>(null);
  const reconcileWake = yield* Queue.sliding<void>(1);

  const activeRlmStatuses = new Set<RlmEpisode["status"]>([
    "requested",
    "admitted",
    "branching",
    "branches_running",
    "synthesizing",
    "stalled",
    "planned",
    "running",
  ]);

  const daemonCommandBase = (aggregateId: string, expectedRevision: number, suffix: string, at: string) => ({
    commandId: CommandId.makeUnsafe(
      stableId("command:rlm-daemon", { aggregateId, expectedRevision, suffix }),
    ),
    actor: { kind: "daemon" as const, actorId: workerId },
    aggregateId,
    expectedRevision,
    idempotencyKey: `rlm-daemon:${aggregateId}:${expectedRevision}:${suffix}`,
    createdAt: at,
  });

  const upsertModelSession = (session: ModelSessionTrace, at: string, suffix: string) =>
    engine.dispatch({
      type: "supervised.model-session.upsert",
      ...daemonCommandBase(session.id, session.revision - 1, suffix, at),
      modelSession: session,
    });

  const upsertEpisode = (episode: RlmEpisode, at: string, suffix: string) =>
    engine.dispatch({
      type: "supervised.rlm.upsert",
      ...daemonCommandBase(episode.id, episode.revision - 1, suffix, at),
      episode,
    });

  const stallEpisode = (episode: RlmEpisode, reason: string) => {
    const failureSummaries = [...new Set([...episode.failureSummaries, reason])].slice(-64);
    if (
      episode.status === "stalled" &&
      JSON.stringify(episode.failureSummaries) === JSON.stringify(failureSummaries)
    ) {
      return Effect.void;
    }
    const at = new Date().toISOString();
    return upsertEpisode(
      {
        ...episode,
        status: "stalled",
        failureSummaries,
        updatedAt: at,
        revision: episode.revision + 1,
      },
      at,
      "episode-stalled",
    ).pipe(Effect.asVoid);
  };

  const evidenceIdFor = (sessionId: string) =>
    EvidenceId.makeUnsafe(stableId("evidence:rlm-session", sessionId));

  const responseFromTrace = (trace: ModelSessionTrace): string | null =>
    trace.items
      .filter((item) => item.type === "message" && item.role === "assistant")
      .at(-1)?.content ?? null;

  const mergeSessionUsage = (
    trace: ModelSessionTrace,
    observed: ModelSessionTrace["usage"],
  ): ModelSessionTrace["usage"] => ({
    inputTokens: observed.inputTokens,
    outputTokens: observed.outputTokens,
    contextTokens:
      observed.contextTokens > 0 ? observed.contextTokens : trace.usage.contextTokens,
    providerLimitTokens: observed.providerLimitTokens ?? trace.usage.providerLimitTokens,
    contextUsagePercent:
      observed.contextUsagePercent ?? trace.usage.contextUsagePercent,
  });

  const appendEvidenceItem = (
    items: ReadonlyArray<ModelSessionTrace["items"][number]>,
    evidenceId: EvidenceId,
    summary: string,
    at: string,
  ) =>
    [
      ...items.filter(
        (item) => !(item.type === "evidence" && item.evidenceId === evidenceId),
      ),
      {
        id: `${evidenceId}:transcript`,
        type: "evidence" as const,
        evidenceId,
        summary,
        createdAt: at,
      },
    ].slice(-10_000);

  const publishRlmEvidence = (input: {
    readonly runtimeEvidenceIds: ReadonlySet<string>;
    readonly trace: ModelSessionTrace;
    readonly response: string;
    readonly at: string;
  }) => {
    const evidenceId = evidenceIdFor(input.trace.id);
    if (input.runtimeEvidenceIds.has(evidenceId)) return Effect.succeed(evidenceId);
    return engine
      .dispatch({
        type: "supervised.evidence.publish",
        ...daemonCommandBase(evidenceId, 0, "evidence-publish", input.at),
        evidence: {
          id: evidenceId,
          scope: { kind: "room", roomId: input.trace.roomId },
          kind: "provider_receipt",
          summary: input.response,
          blob: null,
          sourceEventIds: [],
          modelSessionId: input.trace.id,
          createdBy: { kind: "daemon", actorId: workerId },
          createdAt: input.at,
        },
      })
      .pipe(Effect.as(evidenceId));
  };

  const startSessionTurn = (input: {
    readonly thread: OrchestrationThread;
    readonly trace: ModelSessionTrace;
    readonly prompt: string;
    readonly at: string;
    readonly suffix: string;
  }) =>
    engine.dispatch({
      type: "thread.turn.start",
      commandId: CommandId.makeUnsafe(
        stableId("command:rlm-turn", {
          sessionId: input.trace.id,
          retryCount: input.trace.retryCount,
          suffix: input.suffix,
        }),
      ),
      threadId: input.thread.id,
      message: {
        messageId: MessageId.makeUnsafe(
          stableId("message:rlm-turn", {
            sessionId: input.trace.id,
            retryCount: input.trace.retryCount,
            suffix: input.suffix,
          }),
        ),
        role: "user",
        text: input.prompt,
        attachments: [],
      },
      modelSelection: input.thread.modelSelection,
      dispatchMode: "queue",
      dispatchOrigin: "automation",
      runtimeMode: input.thread.runtimeMode,
      interactionMode: input.thread.interactionMode,
      createdAt: input.at,
    });

  const terminalSession = (status: ModelSessionTrace["status"]) =>
    status === "completed" || status === "failed" || status === "cancelled";

  const reconcileRlmEpisodes = Effect.gen(function* () {
    const runtime = yield* repository.getSnapshot({ includeDisabled: true });
    const activeEpisodes = runtime.rlmEpisodes.filter((episode) =>
      activeRlmStatuses.has(episode.status),
    );
    for (const initialEpisode of activeEpisodes) {
      if (shouldDeferRlmProvisioningReconciliation(initialEpisode, Date.now())) {
        continue;
      }
      const run = runtime.runs.find((candidate) => candidate.id === initialEpisode.runId);
      const policy = run
        ? runtime.runPolicies.find((candidate) => candidate.id === run.policyId)
        : undefined;
      const root = runtime.modelSessions.find(
        (session) => session.id === initialEpisode.rootModelSessionId,
      );
      const branches = initialEpisode.branchModelSessionIds.flatMap((sessionId) => {
        const trace = runtime.modelSessions.find((session) => session.id === sessionId);
        return trace ? [trace] : [];
      });
      if (!run || !policy) continue;
      if (
        !root ||
        initialEpisode.branchCount < 2 ||
        branches.length !== initialEpisode.branchCount
      ) {
        yield* stallEpisode(
          initialEpisode,
          "RLM model-session lineage is incomplete after recovery.",
        );
        continue;
      }

      const runtimeEvidenceIds = new Set(runtime.evidence.map((evidence) => evidence.id));
      const currentBranches: ModelSessionTrace[] = [];
      const branchResults = new Map<string, RlmThreadResult>();
      let missingBranchThreadCount = 0;
      for (const branch of branches) {
        if (terminalSession(branch.status)) {
          currentBranches.push(branch);
          continue;
        }
        if (branch.threadId === null) {
          missingBranchThreadCount += 1;
          currentBranches.push(branch);
          continue;
        }
        const detail = yield* snapshotQuery.getThreadDetailById(branch.threadId);
        if (Option.isNone(detail)) {
          missingBranchThreadCount += 1;
          currentBranches.push(branch);
          continue;
        }
        const result = extractRlmThreadResult(detail.value);
        branchResults.set(branch.id, result);
        const completedWithResponse = result.status === "completed" && result.response !== null;
        if (completedWithResponse) {
          const at = detail.value.latestTurn?.completedAt ?? new Date().toISOString();
          const evidenceId = yield* publishRlmEvidence({
            runtimeEvidenceIds,
            trace: branch,
            response: result.response!,
            at,
          });
          runtimeEvidenceIds.add(evidenceId);
          const updated: ModelSessionTrace = {
            ...branch,
            providerCallId: result.providerCallId,
            items: appendEvidenceItem(result.items, evidenceId, result.response!, at),
            usage: mergeSessionUsage(branch, result.usage),
            status: "completed",
            durationMs: result.durationMs,
            costUsd: result.costUsd,
            updatedAt: at,
            revision: branch.revision + 1,
          };
          yield* upsertModelSession(updated, at, "branch-completed");
          currentBranches.push(updated);
          continue;
        }
        if (result.status === "failed" || result.status === "cancelled" || result.status === "completed") {
          const at = new Date().toISOString();
          if (branch.retryCount < policy.maxRetries) {
            const retry: ModelSessionTrace = {
              ...branch,
              status: "running",
              retryCount: branch.retryCount + 1,
              providerCallId: result.providerCallId,
              items: result.items,
              usage: mergeSessionUsage(branch, result.usage),
              durationMs: result.durationMs,
              costUsd: result.costUsd,
              updatedAt: at,
              revision: branch.revision + 1,
            };
            yield* upsertModelSession(retry, at, "branch-retry");
            yield* startSessionTurn({
              thread: detail.value,
              trace: retry,
              prompt: branch.inputSummary,
              at,
              suffix: "branch-retry",
            });
            currentBranches.push(retry);
          } else {
            const failed: ModelSessionTrace = {
              ...branch,
              status: result.status === "cancelled" ? "cancelled" : "failed",
              providerCallId: result.providerCallId,
              items: result.items,
              usage: mergeSessionUsage(branch, result.usage),
              durationMs: result.durationMs,
              costUsd: result.costUsd,
              updatedAt: at,
              revision: branch.revision + 1,
            };
            yield* upsertModelSession(failed, at, "branch-failed");
            currentBranches.push(failed);
          }
          continue;
        }
        if (result.status === "running" && branch.status !== "running") {
          const at = new Date().toISOString();
          const running: ModelSessionTrace = {
            ...branch,
            status: "running",
            updatedAt: at,
            revision: branch.revision + 1,
          };
          yield* upsertModelSession(running, at, "branch-running");
          currentBranches.push(running);
          continue;
        }
        currentBranches.push(branch);
      }

      if (missingBranchThreadCount > 0) {
        yield* stallEpisode(
          initialEpisode,
          `${missingBranchThreadCount} RLM branch thread(s) are unavailable after recovery.`,
        );
        continue;
      }

      const completedBranches = currentBranches.filter((branch) => branch.status === "completed");
      const failedBranches = currentBranches.filter(
        (branch) => branch.status === "failed" || branch.status === "cancelled",
      );
      const allBranchesTerminal = currentBranches.every((branch) => terminalSession(branch.status));
      const evidenceRefs = completedBranches.map((branch) => evidenceIdFor(branch.id));
      const failureSummaries = failedBranches.map((branch) =>
        `${branch.title}: branch exhausted ${branch.retryCount} retries.`.slice(0, 512),
      );
      let episode = initialEpisode;
      const nextBranchStatus: RlmEpisode["status"] =
        allBranchesTerminal
          ? completedBranches.length > 0
            ? "synthesizing"
            : "failed"
          : "branches_running";
      const branchProjectionChanged =
        episode.status !== nextBranchStatus ||
        episode.completedBranchCount !== completedBranches.length ||
        episode.staleBranchCount !== failedBranches.length ||
        JSON.stringify(episode.evidenceRefs) !== JSON.stringify(evidenceRefs) ||
        JSON.stringify(episode.failureSummaries) !== JSON.stringify(failureSummaries);
      if (branchProjectionChanged) {
        const at = new Date().toISOString();
        episode = {
          ...episode,
          status: nextBranchStatus,
          completedBranchCount: completedBranches.length,
          staleBranchCount: failedBranches.length,
          coveragePercent: (completedBranches.length / episode.branchCount) * 100,
          evidenceRefs,
          failureSummaries,
          updatedAt: at,
          revision: episode.revision + 1,
        };
        yield* upsertEpisode(episode, at, "branch-projection");
      }

      if (!allBranchesTerminal) continue;
      if (completedBranches.length === 0) {
        if (run.status !== "failed" && run.status !== "cancelled" && run.status !== "succeeded") {
          yield* engine.dispatch({
            type: "supervised.run.transition",
            ...daemonCommandBase(run.id, run.revision, "run-failed", new Date().toISOString()),
            runId: run.id,
            status: "failed",
            reason: "All RLM branches failed after policy-bounded retries.",
          });
        }
        continue;
      }

      if (root.threadId === null) {
        yield* stallEpisode(episode, "RLM root synthesis thread is unavailable after recovery.");
        continue;
      }
      const rootDetail = yield* snapshotQuery.getThreadDetailById(root.threadId);
      if (Option.isNone(rootDetail)) {
        yield* stallEpisode(episode, "RLM root synthesis thread is unavailable after recovery.");
        continue;
      }
      if (root.status === "queued" || root.status === "waiting") {
        const synthesisBranches = completedBranches.flatMap((branch) => {
          const response = branchResults.get(branch.id)?.response ?? responseFromTrace(branch);
          return response
            ? [{ title: branch.title, modelSessionId: branch.id, response, evidenceId: evidenceIdFor(branch.id) }]
            : [];
        });
        if (synthesisBranches.length !== completedBranches.length) continue;
        const at = new Date().toISOString();
        const prompt = buildRlmSynthesisPrompt({
          objective: root.inputSummary,
          branches: synthesisBranches,
        });
        const runningRoot: ModelSessionTrace = {
          ...root,
          status: "running",
          promptHash: promptReceiptHash(prompt),
          inputSummary: prompt,
          updatedAt: at,
          revision: root.revision + 1,
        };
        yield* upsertModelSession(runningRoot, at, "root-running");
        yield* startSessionTurn({
          thread: rootDetail.value,
          trace: runningRoot,
          prompt,
          at,
          suffix: "root-synthesis",
        });
        continue;
      }
      if (root.status === "completed" && episode.status !== "synthesizing") continue;

      const rootResult = extractRlmThreadResult(rootDetail.value);
      const rootCompleted = rootResult.status === "completed" && rootResult.response !== null;
      if (rootCompleted) {
        const at = rootDetail.value.latestTurn?.completedAt ?? new Date().toISOString();
        const evidenceId = yield* publishRlmEvidence({
          runtimeEvidenceIds,
          trace: root,
          response: rootResult.response!,
          at,
        });
        const completedRoot: ModelSessionTrace = {
          ...root,
          providerCallId: rootResult.providerCallId,
          items: appendEvidenceItem(rootResult.items, evidenceId, rootResult.response!, at),
          usage: mergeSessionUsage(root, rootResult.usage),
          status: "completed",
          durationMs: rootResult.durationMs,
          costUsd: rootResult.costUsd,
          updatedAt: at,
          revision: root.revision + 1,
        };
        yield* upsertModelSession(completedRoot, at, "root-completed");
        episode = {
          ...episode,
          status:
            failedBranches.length > 0 ? "partially_completed" : "completed",
          evidenceRefs: [...new Set([...episode.evidenceRefs, evidenceId])],
          updatedAt: at,
          revision: episode.revision + 1,
        };
        yield* upsertEpisode(episode, at, "episode-completed");
        let runRevision = run.revision;
        if (run.status === "running" || run.status === "waiting") {
          yield* engine.dispatch({
            type: "supervised.run.transition",
            ...daemonCommandBase(run.id, runRevision, "run-reviewing", at),
            runId: run.id,
            status: "reviewing",
            reason: "RLM root synthesis completed with retained evidence.",
          });
          runRevision += 1;
        }
        if (run.status === "reviewing" || runRevision > run.revision) {
          yield* engine.dispatch({
            type: "supervised.run.transition",
            ...daemonCommandBase(run.id, runRevision, "run-succeeded", at),
            runId: run.id,
            status: "succeeded",
            reason: "RLM episode completed.",
          });
        }
        continue;
      }
      if (
        rootResult.status === "failed" ||
        rootResult.status === "cancelled" ||
        rootResult.status === "completed"
      ) {
        const at = new Date().toISOString();
        if (root.retryCount < policy.maxRetries) {
          const retryRoot: ModelSessionTrace = {
            ...root,
            status: "running",
            retryCount: root.retryCount + 1,
            providerCallId: rootResult.providerCallId,
            items: rootResult.items,
            usage: mergeSessionUsage(root, rootResult.usage),
            durationMs: rootResult.durationMs,
            costUsd: rootResult.costUsd,
            updatedAt: at,
            revision: root.revision + 1,
          };
          yield* upsertModelSession(retryRoot, at, "root-retry");
          yield* startSessionTurn({
            thread: rootDetail.value,
            trace: retryRoot,
            prompt: root.inputSummary,
            at,
            suffix: "root-retry",
          });
        } else {
          const failedRoot: ModelSessionTrace = {
            ...root,
            status: rootResult.status === "cancelled" ? "cancelled" : "failed",
            providerCallId: rootResult.providerCallId,
            items: rootResult.items,
            usage: mergeSessionUsage(root, rootResult.usage),
            durationMs: rootResult.durationMs,
            costUsd: rootResult.costUsd,
            updatedAt: at,
            revision: root.revision + 1,
          };
          yield* upsertModelSession(failedRoot, at, "root-failed");
          episode = {
            ...episode,
            status: "failed",
            failureSummaries: [
              ...new Set([...episode.failureSummaries, "Root synthesis exhausted retries."]),
            ].slice(-64),
            updatedAt: at,
            revision: episode.revision + 1,
          };
          yield* upsertEpisode(episode, at, "root-failed");
          if (run.status !== "failed" && run.status !== "cancelled" && run.status !== "succeeded") {
            yield* engine.dispatch({
              type: "supervised.run.transition",
              ...daemonCommandBase(run.id, run.revision, "run-root-failed", at),
              runId: run.id,
              status: "failed",
              reason: "RLM root synthesis failed after policy-bounded retries.",
            });
          }
        }
      }
    }
  });

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

  const recoverDurableWork = Effect.gen(function* () {
    const now = new Date().toISOString();
    const governanceBefore = yield* governanceRepository.getSnapshot();
    const governanceRecovery = recoverGovernanceSnapshot(governanceBefore, now);
    const recoveredGovernance = settleGovernanceRecoveryActions(
      governanceRecovery.snapshot,
      governanceRecovery.actions,
      now,
    );
    if (recoveredGovernance !== governanceBefore) {
      yield* governanceRepository.replaceSnapshot(recoveredGovernance);
    }
    if (governanceRecovery.actions.length > 0) {
      yield* Effect.logWarning("Supervised governance restart actions settled", {
        resumedOrFailedProviders: governanceRecovery.actions.filter(
          (action) => action.kind === "resume_provider",
        ).length,
        failedInterventions: governanceRecovery.actions.filter(
          (action) => action.kind === "resume_intervention",
        ).length,
        reconciledRootTransfers: governanceRecovery.actions.filter(
          (action) => action.kind === "reconcile_root_transfer",
        ).length,
      });
    }

    const runtimeBefore = yield* repository.getSnapshot({ includeDisabled: true });
    const interruptedRuns = runtimeBefore.runs.filter((run) => run.status === "interrupted");
    yield* Effect.forEach(
      interruptedRuns,
      (run) =>
        engine.dispatch({
          type: "supervised.run.transition",
          commandId: CommandId.makeUnsafe(
            stableId("command:run-recover", {
              runId: run.id,
              revision: run.revision,
              daemonEpoch: runtimeBefore.health.daemonEpoch,
            }),
          ),
          actor: { kind: "daemon", actorId: workerId },
          aggregateId: run.id,
          expectedRevision: run.revision,
          idempotencyKey: `run-recover:${run.id}:${run.revision}:${runtimeBefore.health.daemonEpoch}`,
          runId: run.id,
          status: "recovering",
          reason: "Daemon restart recovery.",
          createdAt: now,
        }),
      { concurrency: 1, discard: true },
    );
    const runtimeAfter = yield* repository.getSnapshot({ includeDisabled: true });
    yield* repository.setHealth(
      {
        ...runtimeAfter.health,
        status: "recovering",
        lastRecoveryAt: now,
        updatedAt: now,
      },
      runtimeAfter.snapshotSequence,
    );
  });

  const reconcile: SupervisedRuntimeDaemonShape["reconcile"] = Effect.gen(function* () {
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
    yield* reconcileRlmEpisodes;
    const recovering = yield* repository.getSnapshot({ includeDisabled: true });
    yield* repository.setHealth(
      { ...recovering.health, status: "recovering", updatedAt: now },
      recovering.snapshotSequence,
    );
    yield* Effect.forEach(
      recovering.subscriptions.filter((subscription) => subscription.state === "enabled"),
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
        lastRecoveryAt: after.health.lastRecoveryAt,
        updatedAt: new Date().toISOString(),
      },
      after.snapshotSequence,
    );
  });

  const ingest: SupervisedRuntimeDaemonShape["ingest"] = (event) =>
    repository.appendControlPlaneEvent(event).pipe(
      Effect.andThen(Queue.offer(reconcileWake, undefined)),
      Effect.asVoid,
    );

  const wake: SupervisedRuntimeDaemonShape["wake"] = Queue.offer(reconcileWake, undefined).pipe(
    Effect.asVoid,
  );

  const nextReconcileDelay = repository.getSnapshot({ includeDisabled: true }).pipe(
    Effect.map((snapshot) =>
      snapshot.rlmEpisodes.some((episode) => activeRlmStatuses.has(episode.status))
        ? ("1 second" as const)
        : ("30 seconds" as const),
    ),
    Effect.orElseSucceed(() => "30 seconds" as const),
  );

  const backgroundLoop = Effect.forever(
    nextReconcileDelay.pipe(
      Effect.flatMap((delay) => Effect.race(Queue.take(reconcileWake), Effect.sleep(delay))),
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
    yield* recoverDurableWork.pipe(
      Effect.catch((error) =>
        Effect.logError("Supervised durable work recovery failed", { error }),
      ),
    );
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

      yield* recoverDurableWork;
      yield* reconcile;
      yield* launchBackgroundLoop;
      return (yield* repository.getSnapshot({ includeDisabled: true })).health;
    }),
  );

  return { ingest, reconcile, restart, start, wake } satisfies SupervisedRuntimeDaemonShape;
});

export const SupervisedRuntimeDaemonLive = Layer.effect(
  SupervisedRuntimeDaemon,
  makeSupervisedRuntimeDaemon,
);
