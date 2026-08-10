import { createHash } from "node:crypto";

import type {
  DeadLetter,
  DeliveryCursor,
  DerivedSignal,
  HarnessPatch,
  ModelSessionTrace,
  OrchestrationEvent,
  OrchestrationReadModel,
  OrchestrationThread,
  RlmEpisode,
  Run,
  SubscriptionDefinition,
  SubscriptionDelivery,
  SupervisedGovernanceSnapshot,
  SupervisedCommand,
  SupervisedRuntimeSnapshot,
} from "@veylen/contracts";
import { CommandId, ControlPlaneEvent, EvidenceId, MessageId } from "@veylen/contracts";
import {
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Queue,
  Ref,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";

import { SupervisedRuntimeRepository } from "../../persistence/Services/SupervisedRuntimeRepository.ts";
import type { RlmReconciliationState } from "../../persistence/Services/SupervisedRuntimeRepository.ts";
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
  advanceHarnessPatchControlPlaneCursor,
  applyHarnessPatchSandboxEvaluation,
  awaitHarnessPatchApproval,
  recordHarnessPatchCanaryEvaluation,
  type HarnessPatchEvaluation,
} from "../../supervised/runtime/HarnessPatches.ts";
import {
  buildRlmSynthesisPrompt,
  extractRlmThreadResult,
  promptReceiptHash,
  type RlmThreadResult,
} from "../../supervised/runtime/RlmExecution.ts";
import {
  evaluateRunPolicy,
  mayTransitionRun,
  type RunResourceUsage,
} from "../../supervised/runtime/RunPolicy.ts";
import {
  SupervisedRuntimeDaemon,
  type SupervisedRuntimeDaemonShape,
} from "../Services/SupervisedRuntimeDaemon.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { SupervisedSignalDelivery } from "../Services/SupervisedSignalDelivery.ts";
import { resolveProjectedSupervisedCaller } from "../supervised/canonicalCaller.ts";

const hash = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const stableId = (prefix: string, value: unknown) =>
  `${prefix}:${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32)}`;
const RLM_PROVISIONING_GRACE_MS = 30_000;
const ORCHESTRATION_INGESTION_CURSOR = "orchestration-events-v1";
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

const RUN_STATUSES: ReadonlyArray<Run["status"]> = [
  "queued",
  "admitted",
  "starting",
  "running",
  "waiting",
  "reviewing",
  "paused",
  "retrying",
  "interrupted",
  "recovering",
  "stalled",
  "succeeded",
  "failed",
  "cancelled",
];

function shortestRunRecoveryPath(
  from: Run["status"],
  to: Run["status"],
): ReadonlyArray<Run["status"]> | null {
  if (from === to) return [];
  const pending: Array<{
    readonly status: Run["status"];
    readonly path: ReadonlyArray<Run["status"]>;
  }> = [{ status: from, path: [] }];
  const visited = new Set<Run["status"]>([from]);
  while (pending.length > 0) {
    const current = pending.shift()!;
    for (const candidate of RUN_STATUSES) {
      if (visited.has(candidate) || !mayTransitionRun(current.status, candidate)) continue;
      const path = [...current.path, candidate];
      if (candidate === to) return path;
      visited.add(candidate);
      pending.push({ status: candidate, path });
    }
  }
  return null;
}

export function terminalRunRecoveryPath(
  from: Run["status"],
  episodeStatus: Extract<
    RlmEpisode["status"],
    "completed" | "partially_completed" | "failed" | "cancelled"
  >,
): ReadonlyArray<Run["status"]> | null {
  if (episodeStatus === "completed" || episodeStatus === "partially_completed") {
    const reviewPath = shortestRunRecoveryPath(from, "reviewing");
    return reviewPath === null ? null : [...reviewPath, "succeeded"];
  }
  return shortestRunRecoveryPath(from, episodeStatus === "cancelled" ? "cancelled" : "failed");
}

export function restartRunRecoveryPath(
  run: Pick<Run, "status" | "daemonEpoch">,
  daemonEpoch: number,
): ReadonlyArray<Run["status"]> {
  if (run.daemonEpoch > daemonEpoch) return [];
  if (run.status === "running" && run.daemonEpoch < daemonEpoch) {
    return ["interrupted", "recovering", "running"];
  }
  if (run.status === "interrupted") return ["recovering", "running"];
  if (run.status === "recovering") return ["running"];
  return [];
}

export function orchestrationContextEvent(
  event: OrchestrationEvent,
  runtime: SupervisedRuntimeSnapshot,
  governance?: SupervisedGovernanceSnapshot,
): ControlPlaneEvent | null {
  if (event.type !== "thread.activity-appended") return null;
  const activity = event.payload.activity;
  if (activity.kind !== "context-window.updated") return null;
  const trace = runtime.modelSessions.find(
    (candidate) => candidate.threadId === event.payload.threadId,
  );
  const projectedCaller = governance
    ? resolveProjectedSupervisedCaller({
        governance,
        threadId: event.payload.threadId,
      })
    : undefined;
  const projectedLead = projectedCaller?.role === "lead" ? projectedCaller : undefined;
  if (trace?.role !== "lead" && !projectedLead) return null;
  const room =
    trace?.role === "lead"
      ? runtime.rooms.find((candidate) => candidate.id === trace.roomId)
      : runtime.rooms.find((candidate) => candidate.leadSeatId === projectedLead!.seatId);
  if (!room) return null;
  const payload = activity.payload as Record<string, unknown>;
  const usedTokens =
    typeof payload.usedTokens === "number" && Number.isFinite(payload.usedTokens)
      ? Math.max(0, Math.floor(payload.usedTokens))
      : null;
  const providerLimitTokens =
    typeof payload.maxTokens === "number" &&
    Number.isFinite(payload.maxTokens) &&
    payload.maxTokens > 0
      ? Math.floor(payload.maxTokens)
      : null;
  const measuredPercent =
    typeof payload.usedPercent === "number" && Number.isFinite(payload.usedPercent)
      ? payload.usedPercent
      : usedTokens !== null && providerLimitTokens !== null
        ? (usedTokens / providerLimitTokens) * 100
        : null;
  if (measuredPercent === null) {
    return null;
  }
  const contextUsagePercent = Math.min(100, Math.max(0, measuredPercent));
  return Schema.decodeUnknownSync(ControlPlaneEvent)({
    sequence: 0,
    eventId: event.eventId,
    schemaId: "schema-agent-context-measured-v1",
    schemaVersion: "1.0.0",
    type: "agent.context.measured",
    scope: { kind: "room", roomId: room.id },
    subjectId: trace?.role === "lead" ? trace.id : projectedLead!.seatId,
    eventTime: activity.createdAt,
    recordedAt: event.occurredAt,
    revision:
      trace?.role === "lead"
        ? trace.revision
        : (governance?.agentSeats.find((seat) => seat.id === projectedLead!.seatId)?.revision ?? 0),
    causationEventId: event.causationEventId,
    correlationId: event.correlationId,
    payload: {
      role: "lead",
      roomId: room.id,
      leadSeatId: room.leadSeatId,
      contextUsagePercent,
      usedTokensEstimate: usedTokens ?? 0,
      providerLimitTokens,
      activeObligations: [],
      unsummarizedEvidenceRefs:
        trace?.role === "lead"
          ? trace.items.filter((item) => item.type === "evidence").map((item) => item.evidenceId)
          : [],
    },
    provenance: {
      actor: { kind: "daemon", actorId: "supervised-runtime" },
      source: "orchestration-event-log",
      confidence: 1,
    },
  });
}

export function orchestrationReviewEvent(
  event: OrchestrationEvent,
  readModel: OrchestrationReadModel,
): ControlPlaneEvent | null {
  if (event.type !== "supervised.intervention-reconciled") return null;
  const eventIntervention = event.payload.intervention;
  const eventReconciliation = event.payload.reconciliation;
  if (
    !eventIntervention ||
    !eventReconciliation ||
    (eventReconciliation.status !== "accepted" && eventReconciliation.status !== "rejected") ||
    eventReconciliation.taskNodeRevisionId === null
  ) {
    return null;
  }

  const intervention = readModel.supervised.interventions.find(
    (candidate) => candidate.id === eventIntervention.id,
  );
  const reconciliation = readModel.supervised.reconciliations.find(
    (candidate) => candidate.id === eventReconciliation.id,
  );
  const taskNodeRevision = readModel.supervised.taskNodeRevisions.find(
    (candidate) => candidate.id === eventReconciliation.taskNodeRevisionId,
  );
  const taskNode = taskNodeRevision
    ? readModel.supervised.taskNodes.find(
        (candidate) => candidate.id === taskNodeRevision.taskNodeId,
      )
    : undefined;
  const task = taskNode
    ? readModel.supervised.tasks.find((candidate) => candidate.id === taskNode.taskId)
    : undefined;
  const room = taskNode
    ? readModel.supervised.rooms.find((candidate) => candidate.id === taskNode.roomId)
    : undefined;
  const actorSeatId = event.payload.actor.seatId;
  if (
    !intervention ||
    !reconciliation ||
    !taskNodeRevision ||
    !taskNode ||
    !task ||
    !room?.leadSeatId ||
    intervention.roomId !== room.id ||
    reconciliation.interventionId !== intervention.id ||
    reconciliation.roomId !== room.id ||
    reconciliation.leadSeatId !== room.leadSeatId ||
    reconciliation.status !== eventReconciliation.status ||
    (event.payload.actor.kind === "seat" && actorSeatId !== reconciliation.leadSeatId)
  ) {
    return null;
  }

  const type = reconciliation.status === "accepted" ? "ReviewCompleted" : "ReviewRejected";
  return Schema.decodeUnknownSync(ControlPlaneEvent)({
    sequence: 0,
    eventId: event.eventId,
    schemaId:
      type === "ReviewCompleted" ? "schema-review-completed-v1" : "schema-review-rejected-v1",
    schemaVersion: "1.0.0",
    type,
    scope: { kind: "task_node", taskNodeId: taskNode.id },
    subjectId: taskNode.id,
    eventTime: reconciliation.resolvedAt ?? event.occurredAt,
    recordedAt: event.occurredAt,
    revision: taskNodeRevision.graphRevision,
    causationEventId: event.causationEventId,
    correlationId: event.correlationId,
    payload: {
      taskId: task.id,
      taskNodeId: taskNode.id,
      graphRevision: taskNodeRevision.graphRevision,
      roomId: room.id,
      leadSeatId: room.leadSeatId,
      reviewerSeatId: reconciliation.leadSeatId,
      rejectionReason: reconciliation.status === "rejected" ? reconciliation.reason : null,
      evidenceRefs: intervention.evidenceRefs,
    },
    provenance: {
      actor: { kind: "daemon", actorId: "supervised-runtime" },
      source: "orchestration-event-log",
      confidence: 1,
    },
  });
}

const makeDelivery = (
  subscription: SubscriptionDefinition,
  signal: DerivedSignal,
  at: string,
): SubscriptionDelivery => ({
  id: stableId("delivery", {
    subscriptionId: subscription.id,
    signalId: signal.id,
  }) as SubscriptionDelivery["id"],
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
  replayBehavior: subscription.replayPolicy,
  createdAt: at,
  updatedAt: at,
});

export function failSubscriptionDelivery(
  subscription: SubscriptionDefinition,
  delivery: SubscriptionDelivery,
  detail: string,
  at: string,
): { readonly delivery: SubscriptionDelivery; readonly deadLetter: DeadLetter | null } {
  const attemptCount = delivery.attemptCount + 1;
  const deadLetterThreshold = Math.min(
    subscription.failurePolicy.maxAttempts,
    subscription.failurePolicy.deadLetterAfterAttempts,
  );
  if (attemptCount >= deadLetterThreshold) {
    const failed: SubscriptionDelivery = {
      ...delivery,
      status: "dead_lettered",
      attemptCount,
      lastError: detail,
      updatedAt: at,
    };
    return {
      delivery: failed,
      deadLetter: {
        id: stableId("dead-letter", delivery.id) as DeadLetter["id"],
        subscriptionId: subscription.id,
        deliveryId: delivery.id,
        pluginId:
          subscription.destination.kind === "plugin" ? subscription.destination.pluginId : null,
        reason: detail,
        payloadHash: delivery.payloadHash,
        attemptCount,
        status: "open",
        createdAt: at,
        updatedAt: at,
        resolvedAt: null,
      },
    };
  }
  return {
    delivery: {
      ...delivery,
      status: "failed",
      attemptCount,
      availableAt: new Date(
        Date.parse(at) + subscription.failurePolicy.backoffMs * 2 ** (attemptCount - 1),
      ).toISOString(),
      lastError: detail,
      updatedAt: at,
    },
    deadLetter: null,
  };
}

function deadLetterUnresolvableDelivery(
  delivery: SubscriptionDelivery,
  detail: string,
  at: string,
): { readonly delivery: SubscriptionDelivery; readonly deadLetter: DeadLetter } {
  const attemptCount = delivery.attemptCount + 1;
  const failed: SubscriptionDelivery = {
    ...delivery,
    status: "dead_lettered",
    attemptCount,
    lastError: detail,
    updatedAt: at,
  };
  return {
    delivery: failed,
    deadLetter: {
      id: stableId("dead-letter", delivery.id) as DeadLetter["id"],
      subscriptionId: delivery.subscriptionId,
      deliveryId: delivery.id,
      pluginId: null,
      reason: detail,
      payloadHash: delivery.payloadHash,
      attemptCount,
      status: "open",
      createdAt: at,
      updatedAt: at,
      resolvedAt: null,
    },
  };
}

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
  const eventWakeFiber = yield* Ref.make<Fiber.Fiber<void, never> | null>(null);
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
  const terminalRlmStatuses = new Set<RlmEpisode["status"]>([
    "completed",
    "partially_completed",
    "failed",
    "cancelled",
  ]);
  const terminalRunStatuses = new Set<Run["status"]>(["succeeded", "failed", "cancelled"]);

  const daemonCommandBase = (
    aggregateId: string,
    expectedRevision: number,
    suffix: string,
    at: string,
  ) => ({
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
    trace.items.filter((item) => item.type === "message" && item.role === "assistant").at(-1)
      ?.content ?? null;

  const mergeSessionUsage = (
    trace: ModelSessionTrace,
    observed: Pick<RlmThreadResult, "usage" | "usageProvenance">,
  ): Pick<ModelSessionTrace, "usage" | "usageProvenance"> => ({
    usage: {
      inputTokens:
        observed.usageProvenance.inputOutputTokens === "provider_observed"
          ? observed.usage.inputTokens
          : trace.usage.inputTokens,
      outputTokens:
        observed.usageProvenance.inputOutputTokens === "provider_observed"
          ? observed.usage.outputTokens
          : trace.usage.outputTokens,
      contextTokens:
        observed.usageProvenance.contextWindow === "provider_observed"
          ? observed.usage.contextTokens
          : trace.usage.contextTokens,
      providerLimitTokens:
        observed.usageProvenance.contextWindow === "provider_observed"
          ? observed.usage.providerLimitTokens
          : trace.usage.providerLimitTokens,
      contextUsagePercent:
        observed.usageProvenance.contextWindow === "provider_observed"
          ? observed.usage.contextUsagePercent
          : trace.usage.contextUsagePercent,
    },
    usageProvenance: {
      inputOutputTokens:
        observed.usageProvenance.inputOutputTokens === "provider_observed"
          ? "provider_observed"
          : trace.usageProvenance.inputOutputTokens,
      contextWindow:
        observed.usageProvenance.contextWindow === "provider_observed"
          ? "provider_observed"
          : trace.usageProvenance.contextWindow,
    },
  });

  const appendEvidenceItem = (
    items: ReadonlyArray<ModelSessionTrace["items"][number]>,
    evidenceId: EvidenceId,
    summary: string,
    at: string,
  ) =>
    [
      ...items.filter((item) => !(item.type === "evidence" && item.evidenceId === evidenceId)),
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
    readonly terminalSourceEventId: RlmThreadResult["terminalSourceEventId"];
    readonly sourceEventIds: RlmThreadResult["sourceEventIds"];
    readonly at: string;
  }) => {
    if (
      input.terminalSourceEventId === null ||
      !input.sourceEventIds.includes(input.terminalSourceEventId)
    ) {
      return Effect.fail(
        new Error("RLM provider receipt requires at least one terminal source event."),
      );
    }
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
          sourceEventIds: input.sourceEventIds,
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

  const currentRlmUsage = (
    runtime: RlmReconciliationState,
    run: Run,
    episode: RlmEpisode,
    sessions: ReadonlyArray<ModelSessionTrace>,
    at: string,
  ): RunResourceUsage => ({
    wallTimeMs:
      run.startedAt === null ? 0 : Math.max(0, Date.parse(at) - Date.parse(run.startedAt)),
    recursiveCalls: Math.max(
      0,
      runtime.rlmEpisodes.filter((candidate) => candidate.runId === run.id).length - 1,
    ),
    fanOut: episode.branchCount,
    retries: sessions.reduce((total, session) => total + session.retryCount, 0),
    costUsd: sessions.some((session) => session.costUsd !== null)
      ? sessions.reduce((total, session) => total + (session.costUsd ?? 0), 0)
      : null,
    kernelMemoryMiB: 0,
    kernelOutputBytes: 0,
    activePlugins: runtime.activePluginCount,
    activeSubscriptions: runtime.activeSubscriptionCount,
    eventRatePerMinute: 0,
    aggregationSamples: 0,
  });

  const ingestCommittedOrchestrationEvents = Effect.gen(function* () {
    const cursor = yield* repository.getIngestionCursor(ORCHESTRATION_INGESTION_CURSOR);
    const highWater = yield* engine.getEventHighWaterSequence;
    if (cursor >= highWater) return;
    const runtime = yield* repository.getDaemonSnapshot();
    const projection = yield* snapshotQuery.getSnapshot();
    const governance = yield* governanceRepository.getSnapshot();
    yield* engine.readEventsThrough(cursor, highWater).pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          const projected =
            orchestrationContextEvent(event, runtime, governance) ??
            orchestrationReviewEvent(event, projection);
          if (projected) yield* repository.appendControlPlaneEvent(projected);
          yield* repository.putIngestionCursor({
            key: ORCHESTRATION_INGESTION_CURSOR,
            sourceSequence: event.sequence,
            updatedAt: event.occurredAt,
          });
        }),
      ),
    );
  });

  const reconcileRlmEpisodes = Effect.gen(function* () {
    const runtime = yield* repository.getRlmReconciliationState();
    const activeEpisodes = runtime.rlmEpisodes.filter((episode) => {
      if (activeRlmStatuses.has(episode.status)) return true;
      if (!terminalRlmStatuses.has(episode.status)) return false;
      const run = runtime.runs.find((candidate) => candidate.id === episode.runId);
      return run !== undefined && !terminalRunStatuses.has(run.status);
    });
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
        initialEpisode.status === "completed" ||
        initialEpisode.status === "partially_completed"
      ) {
        const at = new Date().toISOString();
        const recoveryPath = terminalRunRecoveryPath(run.status, initialEpisode.status);
        if (recoveryPath === null) {
          yield* Effect.logError("No legal Run recovery path exists for a terminal RLM episode", {
            episodeId: initialEpisode.id,
            episodeStatus: initialEpisode.status,
            runId: run.id,
            runStatus: run.status,
          });
          continue;
        }
        for (const [index, status] of recoveryPath.entries()) {
          yield* engine.dispatch({
            type: "supervised.run.transition",
            ...daemonCommandBase(run.id, run.revision + index, `run-recovery-${status}`, at),
            runId: run.id,
            status,
            reason: "Recovered completed RLM episode with retained evidence.",
          });
        }
        continue;
      }
      if (initialEpisode.status === "failed" || initialEpisode.status === "cancelled") {
        const at = new Date().toISOString();
        const recoveryPath = terminalRunRecoveryPath(run.status, initialEpisode.status);
        if (recoveryPath === null) {
          yield* Effect.logError("No legal Run recovery path exists for a terminal RLM episode", {
            episodeId: initialEpisode.id,
            episodeStatus: initialEpisode.status,
            runId: run.id,
            runStatus: run.status,
          });
          continue;
        }
        for (const [index, status] of recoveryPath.entries()) {
          yield* engine.dispatch({
            type: "supervised.run.transition",
            ...daemonCommandBase(run.id, run.revision + index, `run-recovery-${status}`, at),
            runId: run.id,
            status,
            reason: `Recovered terminal RLM episode '${initialEpisode.status}'.`,
          });
        }
        continue;
      }
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
      const sideEffectPolicyDecision = (retryIncrement = 0) => {
        const usage = currentRlmUsage(
          runtime,
          run,
          initialEpisode,
          [root, ...branches],
          new Date().toISOString(),
        );
        return evaluateRunPolicy(policy, {
          ...usage,
          retries: usage.retries + retryIncrement,
        });
      };

      const runtimeEvidenceIds = new Set(runtime.evidence.map((evidence) => evidence.id));
      const currentBranches: ModelSessionTrace[] = [];
      const branchResults = new Map<string, RlmThreadResult>();
      let missingBranchThreadCount = 0;
      let policyFailureReason: string | null = null;
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
        if (result.status === "waiting" && detail.value.latestTurn === null) {
          const decision = sideEffectPolicyDecision();
          if (!decision.allowed) {
            policyFailureReason = decision.reason;
            currentBranches.push(branch);
            continue;
          }
          const at = new Date().toISOString();
          const running =
            branch.status === "running"
              ? result.providerSessionId === null ||
                result.providerSessionId === branch.providerSessionId
                ? branch
                : {
                    ...branch,
                    providerSessionId: result.providerSessionId,
                    updatedAt: at,
                    revision: branch.revision + 1,
                  }
              : {
                  ...branch,
                  providerSessionId: result.providerSessionId ?? branch.providerSessionId,
                  status: "running" as const,
                  updatedAt: at,
                  revision: branch.revision + 1,
                };
          if (running !== branch) {
            yield* upsertModelSession(running, at, "branch-initial-running");
          }
          yield* startSessionTurn({
            thread: detail.value,
            trace: running,
            prompt: branch.inputSummary,
            at,
            suffix: "branch-initial",
          });
          currentBranches.push(running);
          continue;
        }
        const completedWithResponse =
          result.status === "completed" &&
          result.response !== null &&
          result.terminalSourceEventId !== null;
        if (completedWithResponse) {
          const at = detail.value.latestTurn?.completedAt ?? new Date().toISOString();
          const evidenceId = yield* publishRlmEvidence({
            runtimeEvidenceIds,
            trace: branch,
            response: result.response!,
            terminalSourceEventId: result.terminalSourceEventId,
            sourceEventIds: result.sourceEventIds,
            at,
          });
          runtimeEvidenceIds.add(evidenceId);
          const updated: ModelSessionTrace = {
            ...branch,
            providerSessionId: result.providerSessionId ?? branch.providerSessionId,
            providerCallId: result.providerCallId,
            items: appendEvidenceItem(result.items, evidenceId, result.response!, at),
            ...mergeSessionUsage(branch, result),
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
        if (
          result.status === "failed" ||
          result.status === "cancelled" ||
          result.status === "completed"
        ) {
          const at = new Date().toISOString();
          if (branch.retryCount < policy.maxRetries) {
            const decision = sideEffectPolicyDecision(1);
            if (!decision.allowed) {
              policyFailureReason = decision.reason;
              currentBranches.push(branch);
              continue;
            }
            const retry: ModelSessionTrace = {
              ...branch,
              providerSessionId: result.providerSessionId ?? branch.providerSessionId,
              status: "running",
              retryCount: branch.retryCount + 1,
              providerCallId: result.providerCallId,
              items: result.items,
              ...mergeSessionUsage(branch, result),
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
              providerSessionId: result.providerSessionId ?? branch.providerSessionId,
              status: result.status === "cancelled" ? "cancelled" : "failed",
              providerCallId: result.providerCallId,
              items: result.items,
              ...mergeSessionUsage(branch, result),
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
            providerSessionId: result.providerSessionId ?? branch.providerSessionId,
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
      if (policyFailureReason !== null) {
        yield* stallEpisode(
          initialEpisode,
          `RunPolicy stopped RLM provider execution: ${policyFailureReason}`,
        );
        if (run.status === "running" || run.status === "waiting") {
          const at = new Date().toISOString();
          yield* engine.dispatch({
            type: "supervised.run.transition",
            ...daemonCommandBase(run.id, run.revision, "run-policy-stalled", at),
            runId: run.id,
            status: "stalled",
            reason: policyFailureReason,
          });
        }
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
      const nextBranchStatus: RlmEpisode["status"] = allBranchesTerminal
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
            ? [
                {
                  title: branch.title,
                  modelSessionId: branch.id,
                  response,
                  evidenceId: evidenceIdFor(branch.id),
                },
              ]
            : [];
        });
        if (synthesisBranches.length !== completedBranches.length) continue;
        const decision = sideEffectPolicyDecision();
        if (!decision.allowed) {
          yield* stallEpisode(episode, `RunPolicy stopped RLM root synthesis: ${decision.reason}`);
          continue;
        }
        const at = new Date().toISOString();
        const prompt = buildRlmSynthesisPrompt({
          objective: root.inputSummary,
          branches: synthesisBranches,
        });
        const runningRoot: ModelSessionTrace = {
          ...root,
          providerSessionId: rootDetail.value.session?.providerSessionId ?? root.providerSessionId,
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
      const rootCompleted =
        rootResult.status === "completed" &&
        rootResult.response !== null &&
        rootResult.terminalSourceEventId !== null;
      if (rootCompleted) {
        const at = rootDetail.value.latestTurn?.completedAt ?? new Date().toISOString();
        const evidenceId = yield* publishRlmEvidence({
          runtimeEvidenceIds,
          trace: root,
          response: rootResult.response!,
          terminalSourceEventId: rootResult.terminalSourceEventId,
          sourceEventIds: rootResult.sourceEventIds,
          at,
        });
        const completedRoot: ModelSessionTrace = {
          ...root,
          providerSessionId: rootResult.providerSessionId ?? root.providerSessionId,
          providerCallId: rootResult.providerCallId,
          items: appendEvidenceItem(rootResult.items, evidenceId, rootResult.response!, at),
          ...mergeSessionUsage(root, rootResult),
          status: "completed",
          durationMs: rootResult.durationMs,
          costUsd: rootResult.costUsd,
          updatedAt: at,
          revision: root.revision + 1,
        };
        yield* upsertModelSession(completedRoot, at, "root-completed");
        episode = {
          ...episode,
          status: failedBranches.length > 0 ? "partially_completed" : "completed",
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
          const decision = sideEffectPolicyDecision(1);
          if (!decision.allowed) {
            yield* stallEpisode(episode, `RunPolicy stopped RLM root retry: ${decision.reason}`);
            continue;
          }
          const retryRoot: ModelSessionTrace = {
            ...root,
            providerSessionId: rootResult.providerSessionId ?? root.providerSessionId,
            status: "running",
            retryCount: root.retryCount + 1,
            providerCallId: rootResult.providerCallId,
            items: rootResult.items,
            ...mergeSessionUsage(root, rootResult),
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
            providerSessionId: rootResult.providerSessionId ?? root.providerSessionId,
            status: rootResult.status === "cancelled" ? "cancelled" : "failed",
            providerCallId: rootResult.providerCallId,
            items: rootResult.items,
            ...mergeSessionUsage(root, rootResult),
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
    const snapshot = yield* repository.getDaemonSnapshot();
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
      let pendingDeliveryCount = yield* repository.countPendingDeliveries(subscription.id);
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
          const delivery = makeDelivery(subscription, signal, event.recordedAt);
          if (pendingDeliveryCount >= subscription.maxQueueDepth) {
            const deadLettered: SubscriptionDelivery = {
              ...delivery,
              status: "dead_lettered",
              attemptCount: 1,
              lastError: `Subscription queue depth ${pendingDeliveryCount} reached ${subscription.maxQueueDepth}.`,
            };
            yield* repository.enqueueDelivery(deadLettered);
            yield* repository.putDeadLetter({
              id: stableId("dead-letter", deadLettered.id) as DeadLetter["id"],
              subscriptionId: subscription.id,
              deliveryId: deadLettered.id,
              pluginId:
                subscription.destination.kind === "plugin"
                  ? subscription.destination.pluginId
                  : null,
              reason: deadLettered.lastError!,
              payloadHash: deadLettered.payloadHash,
              attemptCount: deadLettered.attemptCount,
              status: "open",
              createdAt: event.recordedAt,
              updatedAt: event.recordedAt,
              resolvedAt: null,
            });
            continue;
          }
          if (yield* repository.enqueueDelivery(delivery)) pendingDeliveryCount += 1;
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

  const dispatchHarnessPatch = (current: HarnessPatch, next: HarnessPatch, suffix: string) =>
    engine.dispatch({
      type: "supervised.patch.upsert",
      commandId: CommandId.makeUnsafe(
        stableId("command:harness-patch", {
          patchId: current.id,
          revision: current.revision,
          nextRevision: next.revision,
          suffix,
        }),
      ),
      actor: { kind: "daemon", actorId: workerId },
      aggregateId: current.id,
      expectedRevision: current.revision,
      idempotencyKey: `harness-patch:${current.id}:${current.revision}:${suffix}`,
      patch: next,
      createdAt: next.updatedAt,
    });

  const parseHarnessPatchEvaluation = (
    patch: HarnessPatch,
    event: ControlPlaneEvent,
  ): {
    readonly phase: "sandbox" | "canary";
    readonly evaluation: HarnessPatchEvaluation;
  } | null => {
    if (event.type !== "HarnessPatchEvaluated") return null;
    const payload = event.payload as Record<string, unknown>;
    if (payload.patchId !== patch.id) return null;
    const phase = payload.phase;
    const evidenceRefs = Array.isArray(payload.evidenceRefs)
      ? payload.evidenceRefs.filter(
          (value): value is string => typeof value === "string" && value.length > 0,
        )
      : [];
    const regressions = Array.isArray(payload.regressions)
      ? payload.regressions.filter((value): value is string => typeof value === "string")
      : [];
    if (
      (phase !== "sandbox" && phase !== "canary") ||
      typeof payload.passed !== "boolean" ||
      payload.basePolicyHash !== patch.basePolicyHash ||
      evidenceRefs.length === 0
    ) {
      return null;
    }
    return {
      phase,
      evaluation: {
        passed: payload.passed,
        basePolicyHash: patch.basePolicyHash,
        evidenceRefs: evidenceRefs.map(EvidenceId.makeUnsafe),
        regressions,
        evaluatedBy: { kind: "daemon", actorId: workerId },
        evaluatedAt: event.recordedAt,
        eventId: event.eventId,
        controlPlaneSequence: event.sequence,
      },
    };
  };

  const reconcileHarnessPatches = Effect.gen(function* () {
    const snapshot = yield* repository.getDaemonSnapshot();
    for (const initial of snapshot.harnessPatches) {
      let patch = initial;
      if (patch.status === "proposed") {
        const next: HarnessPatch = {
          ...patch,
          status: "sandboxed",
          updatedAt: new Date().toISOString(),
          revision: patch.revision + 1,
        };
        yield* dispatchHarnessPatch(patch, next, "sandbox");
        patch = next;
      }
      if (patch.status === "evaluated") {
        const next = awaitHarnessPatchApproval(
          patch,
          { kind: "daemon", actorId: workerId },
          new Date().toISOString(),
        );
        yield* dispatchHarnessPatch(patch, next, "awaiting-approval");
        patch = next;
      }
      if (patch.status !== "sandboxed" && patch.status !== "canary") continue;
      const events = yield* repository.listControlPlaneEvents({
        afterSequence: patch.lastControlPlaneSequence,
        limit: 1_000,
      });
      for (const event of events) {
        const parsed = parseHarnessPatchEvaluation(patch, event);
        if (
          !parsed &&
          event.type === "HarnessPatchEvaluated" &&
          (event.payload as Record<string, unknown>).patchId === patch.id
        ) {
          yield* repository.appendAudit({
            action: "harness.patch.evaluate",
            actor: { kind: "daemon", actorId: workerId },
            targetKind: "harness_patch",
            targetId: patch.id,
            outcome: "rejected_schema",
            detail: {
              eventId: event.eventId,
              eventSequence: event.sequence,
              basePolicyUnchanged: true,
            },
            occurredAt: event.recordedAt,
          });
        }
        if (!parsed) continue;
        if (patch.status === "sandboxed" && parsed.phase === "sandbox") {
          const next = applyHarnessPatchSandboxEvaluation(patch, parsed.evaluation);
          yield* dispatchHarnessPatch(patch, next, `sandbox-evaluation:${event.sequence}`);
          patch = next;
          if (patch.status === "evaluated") {
            const awaiting = awaitHarnessPatchApproval(
              patch,
              { kind: "daemon", actorId: workerId },
              event.recordedAt,
            );
            yield* dispatchHarnessPatch(patch, awaiting, `awaiting-approval:${event.sequence}`);
            patch = awaiting;
          }
          break;
        }
        if (
          patch.status === "canary" &&
          parsed.phase === "canary" &&
          patch.canary &&
          event.eventTime >= patch.canary.startedAt
        ) {
          const next = recordHarnessPatchCanaryEvaluation(patch, parsed.evaluation);
          if (next === patch) continue;
          yield* dispatchHarnessPatch(patch, next, `canary-evaluation:${event.sequence}`);
          patch = next;
          if (patch.status === "rolled_back") break;
        }
      }
      const lastSequence = events.at(-1)?.sequence ?? patch.lastControlPlaneSequence;
      if (
        (patch.status === "sandboxed" || patch.status === "canary") &&
        lastSequence > patch.lastControlPlaneSequence
      ) {
        const next = advanceHarnessPatchControlPlaneCursor(
          patch,
          { kind: "daemon", actorId: workerId },
          lastSequence,
          events.at(-1)!.recordedAt,
        );
        yield* dispatchHarnessPatch(patch, next, `cursor:${lastSequence}`);
      }
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
          return repository.getDaemonSnapshot().pipe(
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
          const failed = failSubscriptionDelivery(
            input.subscription,
            input.delivery,
            error.detail,
            now,
          );
          if (failed.deadLetter) {
            return Effect.all([
              repository.updateDelivery(failed.delivery),
              repository.putDeadLetter(failed.deadLetter),
            ]).pipe(Effect.asVoid);
          }
          return repository.updateDelivery(failed.delivery);
        },
      }),
    );

  const beginRecoveryEpoch = (incrementEpoch: boolean) =>
    Effect.gen(function* () {
      const before = yield* repository.getDaemonSnapshot();
      const now = new Date().toISOString();
      yield* repository.setHealth(
        {
          ...before.health,
          daemonEpoch: before.health.daemonEpoch + (incrementEpoch ? 1 : 0),
          status: "degraded",
          updatedAt: now,
        },
        before.snapshotSequence,
      );
    });

  const markRecoveryDegraded = Effect.gen(function* () {
    const before = yield* repository.getDaemonSnapshot();
    yield* repository.setHealth(
      {
        ...before.health,
        status: "degraded",
        updatedAt: new Date().toISOString(),
      },
      before.snapshotSequence,
    );
  });

  const dispatchRestartRunTransition = (input: {
    readonly run: Run;
    readonly status: Run["status"];
    readonly daemonEpoch: number;
    readonly at: string;
  }) =>
    engine.dispatch({
      type: "supervised.run.transition",
      commandId: CommandId.makeUnsafe(
        stableId("command:run-restart-recovery", {
          runId: input.run.id,
          expectedRevision: input.run.revision,
          daemonEpoch: input.daemonEpoch,
          status: input.status,
        }),
      ),
      actor: { kind: "daemon", actorId: workerId },
      aggregateId: input.run.id,
      expectedRevision: input.run.revision,
      idempotencyKey: `run-restart-recovery:${input.run.id}:${input.run.revision}:${input.daemonEpoch}:${input.status}`,
      runId: input.run.id,
      status: input.status,
      reason:
        input.status === "failed"
          ? "Daemon restart recovery could not resume this Run."
          : `Daemon restart recovery: ${input.run.status} -> ${input.status}.`,
      daemonEpoch: input.daemonEpoch,
      createdAt: input.at,
    });

  const recoverRestartRun = (runId: Run["id"], daemonEpoch: number, at: string) =>
    Effect.gen(function* () {
      const initial = yield* repository.getDaemonSnapshot();
      let run = initial.runs.find((candidate) => candidate.id === runId);
      for (let attempt = 0; attempt < 6; attempt += 1) {
        if (!run) return;
        const nextStatus = restartRunRecoveryPath(run, daemonEpoch)[0];
        if (!nextStatus) return;
        const transitionExit = yield* Effect.exit(
          dispatchRestartRunTransition({ run, status: nextStatus, daemonEpoch, at }),
        );
        if (Exit.isSuccess(transitionExit)) {
          run = {
            ...run,
            status: nextStatus,
            daemonEpoch,
            revision: run.revision + 1,
          };
          continue;
        }

        const observed = yield* repository.getDaemonSnapshot();
        const observedRun = observed.runs.find((candidate) => candidate.id === runId);
        if (
          observedRun &&
          (observedRun.revision !== run.revision ||
            observedRun.status !== run.status ||
            observedRun.daemonEpoch !== run.daemonEpoch)
        ) {
          run = observedRun;
          continue;
        }
        if (
          !observedRun ||
          observedRun.status === "succeeded" ||
          observedRun.status === "failed" ||
          observedRun.status === "cancelled"
        ) {
          return;
        }
        const failureExit = yield* Effect.exit(
          dispatchRestartRunTransition({
            run: observedRun,
            status: "failed",
            daemonEpoch,
            at,
          }),
        );
        if (Exit.isSuccess(failureExit)) return;
        const failedSnapshot = yield* repository.getDaemonSnapshot();
        if (failedSnapshot.runs.find((candidate) => candidate.id === runId)?.status === "failed") {
          return;
        }
        return yield* Effect.failCause(failureExit.cause);
      }

      if (!run || restartRunRecoveryPath(run, daemonEpoch).length === 0) return;
      yield* dispatchRestartRunTransition({ run, status: "failed", daemonEpoch, at });
    });

  const recoverDurableWork = Effect.gen(function* () {
    const now = new Date().toISOString();
    const recoveringRuntime = yield* repository.getDaemonSnapshot();
    yield* repository.setHealth(
      {
        ...recoveringRuntime.health,
        status: "recovering",
        lastRecoveryAt: now,
        updatedAt: now,
      },
      recoveringRuntime.snapshotSequence,
    );

    const governanceBefore = yield* governanceRepository.getSnapshot();
    const governanceRecovery = recoverGovernanceSnapshot(governanceBefore, now);
    let recoveringGovernance = governanceRecovery.snapshot;
    if (recoveringGovernance !== governanceBefore) {
      yield* governanceRepository.replaceSnapshot(recoveringGovernance);
      recoveringGovernance = yield* governanceRepository.getSnapshot();
    }
    const settledGovernance = settleGovernanceRecoveryActions(
      recoveringGovernance,
      governanceRecovery.actions,
      now,
    );
    if (settledGovernance !== recoveringGovernance) {
      yield* governanceRepository.replaceSnapshot(settledGovernance);
    }
    if (governanceRecovery.actions.length > 0) {
      yield* Effect.logWarning("Supervised governance restart actions settled", {
        failedProviders: governanceRecovery.actions.filter(
          (action) => action.kind === "resume_provider",
        ).length,
        failedInterventions: governanceRecovery.actions.filter(
          (action) => action.kind === "resume_intervention",
        ).length,
        reconciledRoleAssumptions: governanceRecovery.actions.filter(
          (action) => action.kind === "reconcile_role_assumption",
        ).length,
        reconciledLeadReplacements: governanceRecovery.actions.filter(
          (action) => action.kind === "reconcile_lead_replacement",
        ).length,
      });
    }

    const runtimeBefore = yield* repository.getDaemonSnapshot();
    const recoverableRunIds = runtimeBefore.runs
      .filter((run) => restartRunRecoveryPath(run, runtimeBefore.health.daemonEpoch).length > 0)
      .map((run) => run.id);
    yield* Effect.forEach(
      recoverableRunIds,
      (runId) => recoverRestartRun(runId, runtimeBefore.health.daemonEpoch, now),
      { concurrency: 1, discard: true },
    );
  });

  const reconcile: SupervisedRuntimeDaemonShape["reconcile"] = Effect.gen(function* () {
    const phaseFailures: string[] = [];
    const runPhase = (name: string, effect: Effect.Effect<void, unknown>) =>
      effect.pipe(
        Effect.catch((error) =>
          Effect.sync(() => phaseFailures.push(name)).pipe(
            Effect.andThen(
              Effect.logError("Supervised runtime reconciliation phase failed", {
                phase: name,
                error,
              }),
            ),
          ),
        ),
      );
    const now = new Date().toISOString();
    yield* runPhase("built-ins", ensureBuiltIns);
    yield* runPhase("orchestration-ingestion", ingestCommittedOrchestrationEvents);
    yield* runPhase(
      "lease-expiration",
      Effect.gen(function* () {
        const before = yield* repository.getDaemonSnapshot();
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
      }),
    );
    yield* runPhase("rlm", reconcileRlmEpisodes);
    yield* runPhase("harness-patches", reconcileHarnessPatches);
    yield* runPhase(
      "subscriptions",
      Effect.gen(function* () {
        const recovering = yield* repository.getDaemonSnapshot();
        yield* repository.setHealth(
          { ...recovering.health, status: "recovering", updatedAt: now },
          recovering.snapshotSequence,
        );
        yield* Effect.forEach(
          recovering.subscriptions.filter((subscription) => subscription.state === "enabled"),
          (subscription) =>
            runPhase(`subscription:${subscription.id}`, evaluateSubscription(subscription)),
          { concurrency: 1, discard: true },
        );
      }),
    );
    yield* runPhase(
      "deliveries",
      Effect.gen(function* () {
        const evaluated = yield* repository.getDaemonSnapshot();
        const claimNow = new Date().toISOString();
        const claimed = yield* repository.claimDeliveries({
          workerId,
          now: claimNow,
          leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(),
          limit: 100,
        });
        for (const delivery of claimed) {
          yield* runPhase(
            `delivery:${delivery.id}`,
            Effect.gen(function* () {
              const subscription = evaluated.subscriptions.find(
                (candidate) => candidate.id === delivery.subscriptionId,
              );
              const signal = evaluated.signals.find(
                (candidate) => candidate.id === delivery.signalId,
              );
              if (!subscription || !signal || subscription.state !== "enabled") {
                const at = new Date().toISOString();
                const detail = !subscription
                  ? "Subscription is unavailable."
                  : subscription.state !== "enabled"
                    ? `Subscription is ${subscription.state}.`
                    : "Signal is unavailable.";
                const failed = subscription
                  ? failSubscriptionDelivery(subscription, delivery, detail, at)
                  : deadLetterUnresolvableDelivery(delivery, detail, at);
                yield* repository.updateDelivery(failed.delivery);
                if (failed.deadLetter) yield* repository.putDeadLetter(failed.deadLetter);
                return;
              }
              const deliveredLastMinute = yield* repository.countDeliveredSince({
                subscriptionId: subscription.id,
                since: new Date(Date.parse(claimNow) - 60_000).toISOString(),
              });
              if (deliveredLastMinute >= subscription.rateLimitPerMinute) {
                yield* repository.updateDelivery({
                  ...delivery,
                  status: "queued",
                  availableAt: new Date(Date.parse(claimNow) + 60_000).toISOString(),
                  lastError: `Subscription rate limit ${subscription.rateLimitPerMinute}/min reached.`,
                  updatedAt: claimNow,
                });
                return;
              }
              yield* settleDelivery({ subscription, signal, delivery });
            }),
          );
        }
      }),
    );
    yield* runPhase(
      "health",
      Effect.gen(function* () {
        const after = yield* repository.getDaemonSnapshot();
        const queued = after.deliveries.filter(
          (delivery) => delivery.status !== "delivered",
        ).length;
        yield* repository.setHealth(
          {
            ...after.health,
            status:
              phaseFailures.length > 0 ||
              after.deadLetters.some((letter) => letter.status === "open")
                ? "degraded"
                : "healthy",
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
      }),
    );
  });

  const ingest: SupervisedRuntimeDaemonShape["ingest"] = (event) =>
    repository
      .appendControlPlaneEvent(event)
      .pipe(Effect.andThen(Queue.offer(reconcileWake, undefined)), Effect.asVoid);

  const wake: SupervisedRuntimeDaemonShape["wake"] = Queue.offer(reconcileWake, undefined).pipe(
    Effect.asVoid,
  );

  const nextReconcileDelay = repository.hasActiveRlmWork().pipe(
    Effect.map((active) => (active ? ("1 second" as const) : ("30 seconds" as const))),
    Effect.orElseSucceed(() => "30 seconds" as const),
  );

  const backgroundLoop = Effect.forever(
    nextReconcileDelay.pipe(
      Effect.flatMap((delay) =>
        Effect.race(
          Queue.take(reconcileWake).pipe(Effect.as("wake" as const)),
          Effect.sleep(delay).pipe(
            Effect.as(delay === "1 second" ? ("rlm-tick" as const) : ("scheduled" as const)),
          ),
        ),
      ),
      Effect.flatMap((trigger) => (trigger === "rlm-tick" ? reconcileRlmEpisodes : reconcile)),
      Effect.catch((error) =>
        Effect.logError("Supervised runtime reconciliation failed", { error }),
      ),
    ),
  );

  const launchBackgroundLoop = Effect.gen(function* () {
    const fiber = yield* Scope.provide(Effect.forkScoped(backgroundLoop), workerScope);
    yield* Ref.set(workerFiber, fiber);
  });

  const launchEventWakeLoop = Effect.gen(function* () {
    const current = yield* Ref.get(eventWakeFiber);
    if (current) return;
    const fiber = yield* Scope.provide(
      Effect.forkScoped(
        engine.streamDomainEvents.pipe(
          Stream.runForEach(() => Queue.offer(reconcileWake, undefined)),
          Effect.catch((error) =>
            Effect.logError("Supervised orchestration event wake loop failed", { error }),
          ),
        ),
      ),
      workerScope,
    );
    yield* Ref.set(eventWakeFiber, fiber);
  });

  const stopBackgroundLoop = Effect.gen(function* () {
    const current = yield* Ref.get(workerFiber);
    if (current) yield* Fiber.interrupt(current);
    yield* Ref.set(workerFiber, null);
  });

  const start: SupervisedRuntimeDaemonShape["start"] = Effect.gen(function* () {
    const before = yield* repository.getDaemonSnapshot();
    yield* beginRecoveryEpoch(before.health.status !== "starting");
    const startupExit = yield* Effect.exit(recoverDurableWork.pipe(Effect.andThen(reconcile)));
    if (Exit.isFailure(startupExit)) {
      yield* markRecoveryDegraded;
      yield* Effect.logError("Supervised runtime startup recovery failed", {
        cause: startupExit.cause,
      });
    }
    yield* launchEventWakeLoop;
    yield* launchBackgroundLoop;
  }).pipe(
    Effect.catch((error) =>
      Effect.logError("Supervised runtime startup could not initialize recovery", { error }),
    ),
  );

  const restart: SupervisedRuntimeDaemonShape["restart"] = lifecycleLock.withPermits(1)(
    Effect.gen(function* () {
      yield* stopBackgroundLoop;
      const restartExit = yield* Effect.exit(
        beginRecoveryEpoch(true).pipe(
          Effect.andThen(recoverDurableWork),
          Effect.andThen(reconcile),
        ),
      );
      if (Exit.isFailure(restartExit)) {
        yield* markRecoveryDegraded.pipe(
          Effect.catch((error) =>
            Effect.logError("Supervised runtime could not persist degraded recovery health", {
              error,
            }),
          ),
        );
        yield* launchBackgroundLoop;
        return yield* Effect.failCause(restartExit.cause);
      }
      yield* launchBackgroundLoop;
      return (yield* repository.getDaemonSnapshot()).health;
    }),
  );

  return { ingest, reconcile, restart, start, wake } satisfies SupervisedRuntimeDaemonShape;
});

export const SupervisedRuntimeDaemonLive = Layer.effect(
  SupervisedRuntimeDaemon,
  makeSupervisedRuntimeDaemon,
);
