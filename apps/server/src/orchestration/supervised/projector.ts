import type {
  SupervisedDomainEvent,
  SupervisedRuntimeSnapshot,
} from "@synara/contracts";

const upsert = <T extends { readonly id: string }>(items: ReadonlyArray<T>, item: T) => {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index < 0) return [...items, item];
  const next = items.slice();
  next[index] = item;
  return next;
};

export function projectSupervisedEvent(
  snapshot: SupervisedRuntimeSnapshot,
  event: SupervisedDomainEvent,
): SupervisedRuntimeSnapshot {
  const next: SupervisedRuntimeSnapshot = {
    ...snapshot,
    snapshotSequence: event.sequence,
    updatedAt: event.occurredAt,
  };
  const payload = event.payload;
  switch (event.type) {
    case "supervised.room-created":
    case "supervised.room-updated":
      return payload.room ? { ...next, rooms: upsert(next.rooms, payload.room) } : next;
    case "supervised.task-created":
      return payload.task ? { ...next, tasks: upsert(next.tasks, payload.task) } : next;
      case "supervised.task-node-committed":
        return payload.taskNode
          ? {
              ...next,
              taskNodes: upsert(next.taskNodes, payload.taskNode),
              taskNodeRevisions: payload.taskNodeRevision
                ? upsert(next.taskNodeRevisions, payload.taskNodeRevision)
                : next.taskNodeRevisions,
            }
          : next;
    case "supervised.run-requested":
    case "supervised.run-transitioned":
      return payload.run ? { ...next, runs: upsert(next.runs, payload.run) } : next;
      case "supervised.run-policy-upserted":
      return payload.runPolicy
        ? { ...next, runPolicies: upsert(next.runPolicies, payload.runPolicy) }
          : next;
      case "supervised.claim-acquired":
      case "supervised.claim-state-changed":
        return payload.workClaim
          ? { ...next, workClaims: upsert(next.workClaims, payload.workClaim) }
          : next;
      case "supervised.lease-granted":
      case "supervised.lease-state-changed":
        return payload.capabilityLease
          ? { ...next, capabilityLeases: upsert(next.capabilityLeases, payload.capabilityLease) }
          : next;
      case "supervised.context-workspace-upserted":
        return payload.contextWorkspace
          ? { ...next, contextWorkspaces: upsert(next.contextWorkspaces, payload.contextWorkspace) }
          : next;
      case "supervised.context-appended":
        return {
          ...next,
          contextWorkspaces: payload.contextWorkspace
            ? upsert(next.contextWorkspaces, payload.contextWorkspace)
            : next.contextWorkspaces,
          contextRecords: payload.contextRecord
            ? upsert(next.contextRecords, payload.contextRecord)
            : next.contextRecords,
        };
      case "supervised.rlm-upserted":
        return payload.rlmEpisode
          ? { ...next, rlmEpisodes: upsert(next.rlmEpisodes, payload.rlmEpisode) }
          : next;
      case "supervised.patch-upserted":
        return payload.patch
          ? { ...next, harnessPatches: upsert(next.harnessPatches, payload.patch) }
          : next;
      case "supervised.specialist-upserted":
        return {
          ...next,
          specialists: payload.specialist
            ? upsert(next.specialists, payload.specialist)
            : next.specialists,
          specialistSnapshots: payload.specialistSnapshot
            ? upsert(next.specialistSnapshots, payload.specialistSnapshot)
            : next.specialistSnapshots,
        };
      case "supervised.kernel-session-upserted":
        return payload.kernelSession
          ? { ...next, kernelSessions: upsert(next.kernelSessions, payload.kernelSession) }
          : next;
      case "supervised.kernel-execution-upserted":
        return payload.kernelExecution
          ? { ...next, kernelExecutions: upsert(next.kernelExecutions, payload.kernelExecution) }
          : next;
    case "supervised.subscription-upserted":
    case "supervised.subscription-state-changed":
      return payload.subscription
        ? { ...next, subscriptions: upsert(next.subscriptions, payload.subscription) }
        : next;
    case "supervised.plugin-installed":
    case "supervised.plugin-upgraded":
    case "supervised.plugin-state-changed":
      return payload.plugin ? { ...next, plugins: upsert(next.plugins, payload.plugin) } : next;
    case "supervised.plugin-circuit-reset":
      return payload.pluginHealth
        ? { ...next, pluginHealth: upsert(next.pluginHealth, payload.pluginHealth) }
        : next;
    case "supervised.signal-derived":
    case "supervised.signal-acknowledged":
    case "supervised.signal-reset":
      return payload.signal ? { ...next, signals: upsert(next.signals, payload.signal) } : next;
    case "supervised.delivery-enqueued":
    case "supervised.delivery-updated": {
      const withDelivery = payload.delivery
        ? { ...next, deliveries: upsert(next.deliveries, payload.delivery) }
        : next;
      return payload.deadLetter
        ? { ...withDelivery, deadLetters: upsert(withDelivery.deadLetters, payload.deadLetter) }
        : withDelivery;
    }
    case "supervised.dead-lettered":
      return payload.deadLetter
        ? { ...next, deadLetters: upsert(next.deadLetters, payload.deadLetter) }
        : next;
      case "supervised.metric-recorded":
      case "supervised.compaction-requested":
      case "supervised.handoff-requested":
        return next;
      case "supervised.intervention-proposed":
      case "supervised.intervention-reconciled":
        return {
          ...next,
          interventions: payload.intervention
            ? upsert(next.interventions, payload.intervention)
            : next.interventions,
          leadNotifications: payload.leadNotification
            ? upsert(next.leadNotifications, payload.leadNotification)
            : next.leadNotifications,
          reconciliations: payload.reconciliation
            ? upsert(next.reconciliations, payload.reconciliation)
            : next.reconciliations,
        };
  }
}
