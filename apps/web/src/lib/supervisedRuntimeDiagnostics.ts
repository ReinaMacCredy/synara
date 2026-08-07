import type { ServerDiagnosticsResult, SupervisedRuntimeSnapshot } from "@synara/contracts";

export type SupervisedRuntimeTraceKind = "audit" | "signal" | "delivery";

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
  return [
    ...snapshot.audit.map((entry) => ({
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
  ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

export function formatSupervisedRuntimeDiagnostics(input: {
  readonly runtime: SupervisedRuntimeSnapshot;
  readonly server: ServerDiagnosticsResult;
}): string {
  const { runtime, server } = input;
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
          subscriptions: runtime.subscriptions.length,
          plugins: runtime.plugins.length,
          signals: runtime.signals.length,
          deliveries: runtime.deliveries.length,
          deadLetters: runtime.deadLetters.length,
        },
        recentTrace: supervisedRuntimeTraceEntries(runtime).slice(0, 20),
      },
    },
    null,
    2,
  );
}
