import type { ServerDiagnosticsResult, SupervisedRuntimeSnapshot } from "@synara/contracts";

export type SupervisedRuntimeTraceKind =
  | "audit"
  | "signal"
  | "delivery"
  | "rlm"
  | "model_session"
  | "evidence";

export interface SupervisedRuntimeTraceEntry {
  readonly id: string;
  readonly kind: SupervisedRuntimeTraceKind;
  readonly title: string;
  readonly description: string;
  readonly occurredAt: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export function supervisedRuntimeTraceEntries(
  snapshot: SupervisedRuntimeSnapshot,
): readonly SupervisedRuntimeTraceEntry[] {
  const rlmEpisodes = snapshot.rlmEpisodes ?? [];
  const modelSessions = snapshot.modelSessions ?? [];
  const evidence = snapshot.evidence ?? [];
  const rlmModelSessions = modelSessions.filter((session) => session.rlmEpisodeId !== null);
  const rlmModelSessionIds = new Set(rlmModelSessions.map((session) => session.id));
  const rlmEvidence = evidence.filter((entry) => {
    const modelSessionId = entry.modelSessionId;
    return modelSessionId != null && rlmModelSessionIds.has(modelSessionId);
  });
  const audit = snapshot.audit ?? [];
  return [
    ...audit.map((entry) => ({
      id: `audit:${entry.sequence}`,
      kind: "audit" as const,
      title: `${entry.action} · ${entry.outcome}`,
      description: `${entry.targetKind} ${entry.targetId}`,
      occurredAt: entry.occurredAt,
      details: {
        sequence: entry.sequence,
        actor: entry.actor,
        targetKind: entry.targetKind,
        targetId: entry.targetId,
        outcome: entry.outcome,
      },
    })),
    ...snapshot.signals.map((signal) => ({
      id: `signal:${signal.id}`,
      kind: "signal" as const,
      title: `${signal.kind} · ${signal.state}`,
      description: `${signal.subjectId} · ${signal.measuredValue} ${signal.threshold.operator} ${signal.threshold.value}`,
      occurredAt: signal.triggeredAt,
      details: {
        signalId: signal.id,
        subscriptionId: signal.subscriptionId,
        scope: signal.scope,
        sourceEventIds: signal.sourceEventIds,
        metricSampleIds: signal.metricSampleIds,
        aggregationReceiptHash: signal.aggregationReceiptHash,
        revision: signal.revision,
      },
    })),
    ...snapshot.deliveries.map((delivery) => ({
      id: `delivery:${delivery.id}`,
      kind: "delivery" as const,
      title: `Delivery · ${delivery.status}`,
      description: `${delivery.subscriptionId} · ${delivery.attemptCount} attempt${delivery.attemptCount === 1 ? "" : "s"}`,
      occurredAt: delivery.updatedAt,
      details: {
        deliveryId: delivery.id,
        signalId: delivery.signalId,
        dedupeKey: delivery.dedupeKey,
        payloadHash: delivery.payloadHash,
        replay: delivery.replay,
        lastError: delivery.lastError,
        availableAt: delivery.availableAt,
        deliveredAt: delivery.deliveredAt,
      },
    })),
    ...rlmEpisodes.map((episode) => ({
      id: `rlm:${episode.id}`,
      kind: "rlm" as const,
      title: `RLM · ${episode.status.replaceAll("_", " ")}`,
      description: `${episode.completedBranchCount}/${episode.branchCount} branches · ${episode.coveragePercent}% coverage`,
      occurredAt: episode.updatedAt,
      details: {
        episodeId: episode.id,
        runId: episode.runId,
        rootModelSessionId: episode.rootModelSessionId,
        branchModelSessionIds: episode.branchModelSessionIds,
        completedBranchCount: episode.completedBranchCount,
        staleBranchCount: episode.staleBranchCount,
        contradictionCount: episode.contradictionCount,
        evidenceRefs: episode.evidenceRefs,
        failureSummaries: episode.failureSummaries,
        admission: episode.admission,
        revision: episode.revision,
      },
    })),
    ...rlmModelSessions.map((session) => ({
      id: `model-session:${session.id}`,
      kind: "model_session" as const,
      title: `${session.role.replaceAll("_", " ")} · ${session.status}`,
      description: `${session.provider}/${session.model} · ${session.id}`,
      occurredAt: session.updatedAt,
      details: {
        modelSessionId: session.id,
        rlmEpisodeId: session.rlmEpisodeId,
        parentSessionId: session.parentSessionId,
        threadId: session.threadId,
        runId: session.runId,
        taskId: session.taskId,
        taskNodeId: session.taskNodeId,
        providerSessionId: session.providerSessionId,
        providerCallId: session.providerCallId,
        promptHash: session.promptHash,
        contextViewId: session.contextView?.id ?? null,
        usage: session.usage,
        retryCount: session.retryCount,
        durationMs: session.durationMs,
        synthesisDestination: session.synthesisDestination,
        revision: session.revision,
      },
    })),
    ...rlmEvidence.map((entry) => ({
      id: `evidence:${entry.id}`,
      kind: "evidence" as const,
      title: `Evidence · ${entry.kind.replaceAll("_", " ")}`,
      description: `${entry.modelSessionId ?? "no model session"} · ${entry.sourceEventIds.length} source events`,
      occurredAt: entry.createdAt,
      details: {
        evidenceId: entry.id,
        scope: entry.scope,
        modelSessionId: entry.modelSessionId,
        sourceEventIds: entry.sourceEventIds,
        createdBy: entry.createdBy,
      },
    })),
  ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

const newestFirst = <T extends { readonly updatedAt?: string; readonly createdAt?: string }>(
  entries: readonly T[],
) =>
  [...entries]
    .sort((left, right) =>
      (right.updatedAt ?? right.createdAt ?? "").localeCompare(
        left.updatedAt ?? left.createdAt ?? "",
      ),
    )
    .slice(0, 20);

export function formatSupervisedRuntimeDiagnostics(input: {
  readonly runtime: SupervisedRuntimeSnapshot;
  readonly server: ServerDiagnosticsResult;
}): string {
  const { runtime, server } = input;
  const rlmEpisodes = runtime.rlmEpisodes ?? [];
  const modelSessions = runtime.modelSessions ?? [];
  const evidence = runtime.evidence ?? [];
  const rlmModelSessions = modelSessions.filter((session) => session.rlmEpisodeId !== null);
  const rlmModelSessionIds = new Set(rlmModelSessions.map((session) => session.id));
  const rlmEvidence = evidence.filter((entry) => {
    const modelSessionId = entry.modelSessionId;
    return modelSessionId != null && rlmModelSessionIds.has(modelSessionId);
  });
  return JSON.stringify(
    {
      generatedAt: server.generatedAt,
      server: {
        process: server.process,
        childProcessTotalCount: server.childProcessTotalCount,
        childProcessTotalRssBytes: server.childProcessTotalRssBytes,
        projection: server.projection,
        logsDirectory: server.logsDirectory,
        serverLogPath: server.serverLogPath,
      },
      supervised: {
        snapshotSequence: runtime.snapshotSequence,
        health: runtime.health,
        counts: {
          rooms: runtime.rooms.length,
          tasks: runtime.tasks.length,
          taskNodes: runtime.taskNodes.length,
          runs: runtime.runs.length,
          rlmEpisodes: rlmEpisodes.length,
          modelSessions: modelSessions.length,
          evidence: evidence.length,
          rlmModelSessions: rlmModelSessions.length,
          rlmEvidence: rlmEvidence.length,
          subscriptions: runtime.subscriptions.length,
          plugins: runtime.plugins.length,
          signals: runtime.signals.length,
          deliveries: runtime.deliveries.length,
          deadLetters: runtime.deadLetters.length,
        },
        rlm: {
          episodes: newestFirst(rlmEpisodes).map((episode) => ({
            id: episode.id,
            runId: episode.runId,
            status: episode.status,
            rootModelSessionId: episode.rootModelSessionId,
            branchModelSessionIds: episode.branchModelSessionIds,
            branchCount: episode.branchCount,
            completedBranchCount: episode.completedBranchCount,
            staleBranchCount: episode.staleBranchCount,
            coveragePercent: episode.coveragePercent,
            contradictionCount: episode.contradictionCount,
            evidenceRefs: episode.evidenceRefs,
            failureSummaries: episode.failureSummaries,
            admission: episode.admission,
            revision: episode.revision,
            updatedAt: episode.updatedAt,
          })),
          sessions: newestFirst(rlmModelSessions).map((session) => ({
            id: session.id,
            rlmEpisodeId: session.rlmEpisodeId,
            parentSessionId: session.parentSessionId,
            threadId: session.threadId,
            role: session.role,
            status: session.status,
            provider: session.provider,
            model: session.model,
            reasoningEffort: session.reasoningEffort,
            providerSessionId: session.providerSessionId,
            providerCallId: session.providerCallId,
            promptHash: session.promptHash,
            contextViewId: session.contextView?.id ?? null,
            usage: session.usage,
            retryCount: session.retryCount,
            durationMs: session.durationMs,
            synthesisDestination: session.synthesisDestination,
            revision: session.revision,
            updatedAt: session.updatedAt,
          })),
          evidence: newestFirst(rlmEvidence).map((entry) => ({
            id: entry.id,
            kind: entry.kind,
            scope: entry.scope,
            modelSessionId: entry.modelSessionId,
            sourceEventIds: entry.sourceEventIds,
            createdBy: entry.createdBy,
            createdAt: entry.createdAt,
          })),
        },
        recentTrace: supervisedRuntimeTraceEntries(runtime).slice(0, 20),
      },
    },
    null,
    2,
  );
}
