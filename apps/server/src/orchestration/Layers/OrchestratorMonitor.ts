import {
  CommandId,
  MessageId,
  type OrchestrationEvent,
  type OrchestratorMonitor as OrchestratorMonitorRecord,
  type OrchestratorRun,
  type ThreadId,
} from "@synara/contracts";
import { Cause, Duration, Effect, Layer, Option, Semaphore, Stream } from "effect";

import { OrchestrationCommandReceiptRepository } from "../../persistence/Services/OrchestrationCommandReceipts.ts";
import { ProjectionOrchestratorRepository } from "../../persistence/Services/ProjectionOrchestrator.ts";
import { QueuedTurnPromotionRepository } from "../../persistence/Services/QueuedTurnPromotions.ts";
import {
  OrchestratorMonitor,
  type OrchestratorMonitorReconcileResult,
  type OrchestratorMonitorShape,
} from "../Services/OrchestratorMonitor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ORCHESTRATOR_MONITOR_POLICY_V1,
  ORCHESTRATOR_RESOURCE_POLICY_V1,
} from "../orchestrator/resourcePolicy.ts";

export interface OrchestratorMonitorLiveOptions {
  readonly now?: () => string;
  readonly reconcileIntervalMs?: number;
  readonly afterFirePersisted?: (
    monitor: OrchestratorMonitorRecord,
  ) => Effect.Effect<void, unknown>;
}

type MonitorCondition = {
  readonly runId: string | null;
  readonly eventTypes: ReadonlySet<string>;
  readonly aggregateId: string | null;
};

const emptyResult = (): OrchestratorMonitorReconcileResult => ({
  rootsVisited: 0,
  monitorsFired: 0,
  monitorsExpired: 0,
  monitorsCancelled: 0,
  wakesDispatched: 0,
});

const addResult = (
  left: OrchestratorMonitorReconcileResult,
  right: OrchestratorMonitorReconcileResult,
): OrchestratorMonitorReconcileResult => ({
  rootsVisited: left.rootsVisited + right.rootsVisited,
  monitorsFired: left.monitorsFired + right.monitorsFired,
  monitorsExpired: left.monitorsExpired + right.monitorsExpired,
  monitorsCancelled: left.monitorsCancelled + right.monitorsCancelled,
  wakesDispatched: left.wakesDispatched + right.wakesDispatched,
});

const parseCondition = (condition: string): MonitorCondition => {
  try {
    const value = JSON.parse(condition) as Record<string, unknown>;
    const eventTypes = Array.isArray(value.eventTypes)
      ? value.eventTypes.filter((entry): entry is string => typeof entry === "string")
      : [];
    return {
      runId: typeof value.runId === "string" ? value.runId : null,
      eventTypes: new Set(eventTypes),
      aggregateId: typeof value.aggregateId === "string" ? value.aggregateId : null,
    };
  } catch {
    return { runId: null, eventTypes: new Set(), aggregateId: null };
  }
};

const runIsTerminal = (run: OrchestratorRun | undefined): boolean =>
  run === undefined || run.state === "cancelled" || run.state === "packet_published";

const eventSettlesThread = (event: OrchestrationEvent, threadId: ThreadId): boolean =>
  event.type === "thread.session-set" &&
  event.payload.threadId === threadId &&
  event.payload.session.activeTurnId === null &&
  ["idle", "ready", "interrupted", "stopped", "error"].includes(event.payload.session.status);

const eventMatchesMonitor = (
  monitor: OrchestratorMonitorRecord,
  event: OrchestrationEvent | null,
): boolean => {
  if (event === null) return false;
  if (
    monitor.targetThreadId !== null &&
    (monitor.kind === "notify" || monitor.kind === "wait") &&
    eventSettlesThread(event, monitor.targetThreadId)
  ) {
    return true;
  }
  const condition = parseCondition(monitor.condition);
  return (
    (monitor.condition === event.type ||
      monitor.condition === `event:${event.type}` ||
      condition.eventTypes.has(event.type)) &&
    (condition.aggregateId === null || condition.aggregateId === event.aggregateId)
  );
};

const monitorWakeCommandId = (monitor: OrchestratorMonitorRecord) =>
  CommandId.makeUnsafe(`server:orchestrator-monitor:${monitor.id}:wake:${monitor.runCount}`);

const renderWake = (monitor: OrchestratorMonitorRecord): string =>
  [
    "<synara_orchestrator_monitor_wake>",
    "This is a durable mechanical Synara monitor notification, not a human user message.",
    `monitor_id: ${monitor.id}`,
    `kind: ${monitor.kind}`,
    `state: ${monitor.state}`,
    `run_count: ${monitor.runCount}/${monitor.maxRuns}`,
    `target_thread_id: ${monitor.targetThreadId ?? "none"}`,
    `condition: ${monitor.condition}`,
    "Inspect only the child view or durable evidence needed for your next decision. Do not poll.",
    "</synara_orchestrator_monitor_wake>",
  ].join("\n");

export const makeOrchestratorMonitor = (options?: OrchestratorMonitorLiveOptions) =>
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const repository = yield* ProjectionOrchestratorRepository;
    const receipts = yield* OrchestrationCommandReceiptRepository;
    const queuedTurns = yield* QueuedTurnPromotionRepository;
    const lock = yield* Semaphore.make(1);
    const now = options?.now ?? (() => new Date().toISOString());

    const dispatchWake = Effect.fnUntraced(function* (monitor: OrchestratorMonitorRecord) {
      if (monitor.runCount === 0 || monitor.state === "cancelled") return "skipped" as const;
      const commandId = monitorWakeCommandId(monitor);
      const receipt = yield* receipts.getByCommandId({ commandId });
      if (Option.isSome(receipt)) {
        return receipt.value.status === "accepted" ? ("settled" as const) : ("failed" as const);
      }
      const readModel = yield* engine.getReadModel();
      const owner = readModel.threads.find(
        (thread) => thread.id === monitor.ownerThreadId && thread.deletedAt === null,
      );
      if (owner === undefined) return "failed" as const;
      if (
        monitor.targetThreadId !== null &&
        (monitor.kind === "notify" || monitor.kind === "wait")
      ) {
        const inboundMessages = (yield* repository.listMailboxMessages({
          rootThreadId: monitor.rootThreadId,
          limit:
            ORCHESTRATOR_RESOURCE_POLICY_V1.maxMailboxDepthPerThread *
            ORCHESTRATOR_RESOURCE_POLICY_V1.maxActiveSessions,
        })).filter(
          (message) =>
            message.senderThreadId === monitor.targetThreadId &&
            message.targetThreadId === monitor.ownerThreadId &&
            message.deliveryState !== "failed" &&
            message.deliveryState !== "expired",
        );
        const wakeClaims = yield* Effect.forEach(
          inboundMessages,
          (message) =>
            owner.latestTurn?.state === "running" &&
            owner.latestTurn.requestedAt === message.createdAt
              ? Effect.succeed(true)
              : queuedTurns.hasPendingMessage({
                  threadId: monitor.ownerThreadId,
                  messageId: message.messageId,
                }),
          { concurrency: 1 },
        );
        if (wakeClaims.some(Boolean)) return "settled" as const;
      }
      const result = yield* Effect.exit(
        engine.dispatch({
          type: "thread.turn.start",
          commandId,
          threadId: owner.id,
          message: {
            messageId: MessageId.makeUnsafe(
              `orchestrator-monitor:${monitor.id}:${monitor.runCount}`,
            ),
            role: "user",
            text: renderWake(monitor),
            attachments: [],
          },
          dispatchMode: "queue",
          dispatchOrigin: "automation",
          runtimeMode: owner.runtimeMode,
          interactionMode: owner.interactionMode,
          createdAt: now(),
        }),
      );
      return result._tag === "Success" ? ("dispatched" as const) : ("failed" as const);
    });

    const dispatchMonitorCommand = Effect.fnUntraced(function* (input: {
      readonly monitor: OrchestratorMonitorRecord;
      readonly action: "fire" | "cancel";
      readonly reason: string;
    }) {
      const root = yield* repository.getRoot(input.monitor.rootThreadId);
      if (Option.isNone(root)) return false;
      const nextRun = input.action === "fire" ? input.monitor.runCount + 1 : input.monitor.runCount;
      const outcome = yield* Effect.exit(
        engine.dispatch(
          input.action === "fire"
            ? {
                type: "orchestrator.monitor.fire",
                commandId: CommandId.makeUnsafe(
                  `server:orchestrator-monitor:${input.monitor.id}:fire:${nextRun}`,
                ),
                rootThreadId: input.monitor.rootThreadId,
                projectId: root.value.root.projectId,
                actor: { kind: "server", actorId: "orchestrator-monitor" },
                protocolVersion: 1,
                expectedRevision: root.value.root.revision,
                createdAt: now(),
                monitorId: input.monitor.id,
                reasonCode: input.reason,
              }
            : {
                type: "orchestrator.monitor.cancel",
                commandId: CommandId.makeUnsafe(
                  `server:orchestrator-monitor:${input.monitor.id}:cancel:${input.monitor.runCount}`,
                ),
                rootThreadId: input.monitor.rootThreadId,
                projectId: root.value.root.projectId,
                actor: { kind: "server", actorId: "orchestrator-monitor" },
                protocolVersion: 1,
                expectedRevision: root.value.root.revision,
                createdAt: now(),
                monitorId: input.monitor.id,
                reason: input.reason,
              },
        ),
      );
      return outcome._tag === "Success";
    });

    const updateCapacity = Effect.fnUntraced(function* (input: {
      readonly rootThreadId: ThreadId;
      readonly monitors: ReadonlyArray<OrchestratorMonitorRecord>;
    }) {
      const core = yield* repository.getCore(input.rootThreadId);
      if (Option.isNone(core)) return;
      const at = now();
      const readModel = yield* engine.getReadModel();
      const reachable = new Set<ThreadId>([
        input.rootThreadId,
        ...core.value.ownershipEdges.flatMap((edge) =>
          edge.retiredAt === null ? [edge.childThreadId] : [],
        ),
      ]);
      const sessions = readModel.threads.filter(
        (thread) =>
          reachable.has(thread.id) &&
          thread.session !== null &&
          !["stopped", "error"].includes(thread.session.status),
      );
      const claims = yield* repository.listActiveWriterClaims({
        rootThreadId: input.rootThreadId,
        at,
        limit: ORCHESTRATOR_RESOURCE_POLICY_V1.maxActiveWriters * 4,
      });
      const messages = yield* repository.listMailboxMessages({
        rootThreadId: input.rootThreadId,
        limit:
          ORCHESTRATOR_RESOURCE_POLICY_V1.maxMailboxDepthPerThread *
          ORCHESTRATOR_RESOURCE_POLICY_V1.maxActiveSessions,
      });
      yield* repository.upsertCapacity({
        rootThreadId: input.rootThreadId,
        capacity: {
          policyVersion: ORCHESTRATOR_RESOURCE_POLICY_V1.version,
          activeSessions: sessions.length,
          sessionLimit: ORCHESTRATOR_RESOURCE_POLICY_V1.maxActiveSessions,
          activeTurns: sessions.filter((thread) => thread.session?.activeTurnId !== null).length,
          turnLimit: ORCHESTRATOR_RESOURCE_POLICY_V1.maxActiveTurns,
          activeWriters: claims.filter((claim) => claim.mode === "write").length,
          writerLimit: ORCHESTRATOR_RESOURCE_POLICY_V1.maxActiveWriters,
          mailboxDepth: messages.filter(
            (message) =>
              message.deliveryState === "queued" || message.deliveryState === "processing",
          ).length,
          mailboxLimit:
            ORCHESTRATOR_RESOURCE_POLICY_V1.maxMailboxDepthPerThread *
            ORCHESTRATOR_RESOURCE_POLICY_V1.maxActiveSessions,
          activeMonitors: input.monitors.filter((monitor) => monitor.state === "active").length,
          monitorLimit: ORCHESTRATOR_RESOURCE_POLICY_V1.maxActiveMonitorsPerRoot,
          estimatedSpend: {
            kind: "unknown",
            reason: "Provider spend telemetry is not aggregated for this Root.",
            at,
          },
          observedAt: at,
        },
      });
    });

    const reconcileRootUnlocked = Effect.fnUntraced(function* (input: {
      readonly rootThreadId: ThreadId;
      readonly event: OrchestrationEvent | null;
    }) {
      let result = { ...emptyResult(), rootsVisited: 1 };
      const root = yield* repository.getRoot(input.rootThreadId);
      if (Option.isNone(root) || root.value.root.state !== "active") return result;
      const monitors = yield* repository.listMonitors({
        rootThreadId: input.rootThreadId,
        limit: ORCHESTRATOR_RESOURCE_POLICY_V1.maxActiveMonitorsPerRoot * 32,
      });
      const core = yield* repository.getCore(input.rootThreadId);
      const readModel = yield* engine.getReadModel();

      for (const monitor of monitors) {
        if (monitor.runCount > 0 && monitor.state !== "cancelled") {
          const wakeState = yield* dispatchWake(monitor);
          if (wakeState === "dispatched") {
            result = { ...result, wakesDispatched: result.wakesDispatched + 1 };
          }
        }
        if (monitor.state !== "active") continue;

        const condition = parseCondition(monitor.condition);
        const scopedRun =
          condition.runId === null
            ? undefined
            : Option.isSome(core)
              ? core.value.runs.find((run) => run.id === condition.runId)
              : undefined;
        if (condition.runId !== null && Option.isSome(core) && runIsTerminal(scopedRun)) {
          if (
            yield* dispatchMonitorCommand({
              monitor,
              action: "cancel",
              reason: "run_scope_terminal",
            })
          ) {
            result = { ...result, monitorsCancelled: result.monitorsCancelled + 1 };
          }
          continue;
        }

        const expired = monitor.expiresAt <= now();
        const due =
          monitor.nextWakeAt !== null &&
          monitor.nextWakeAt <= now() &&
          (monitor.kind === "schedule" || monitor.kind === "heartbeat");
        const targetAlreadySettled =
          input.event === null &&
          monitor.targetThreadId !== null &&
          (monitor.kind === "notify" || monitor.kind === "wait") &&
          readModel.threads.some(
            (thread) =>
              thread.id === monitor.targetThreadId &&
              thread.latestTurn !== null &&
              thread.latestTurn.state !== "running",
          );
        if (
          !expired &&
          !due &&
          !targetAlreadySettled &&
          !eventMatchesMonitor(monitor, input.event)
        ) {
          continue;
        }
        const reason = expired
          ? "expired"
          : due
            ? monitor.kind === "heartbeat"
              ? "heartbeat_missed"
              : "schedule_due"
            : "condition_matched";
        if (yield* dispatchMonitorCommand({ monitor, action: "fire", reason })) {
          if (options?.afterFirePersisted !== undefined) {
            yield* options.afterFirePersisted(monitor);
          }
          const firedMonitor: OrchestratorMonitorRecord = {
            ...monitor,
            runCount: monitor.runCount + 1,
            state: expired
              ? "expired"
              : monitor.kind === "schedule" || monitor.kind === "heartbeat"
                ? monitor.runCount + 1 < monitor.maxRuns
                  ? "active"
                  : "fired"
                : "fired",
          };
          const wakeState = yield* dispatchWake(firedMonitor);
          result = {
            ...result,
            monitorsFired: result.monitorsFired + (expired ? 0 : 1),
            monitorsExpired: result.monitorsExpired + (expired ? 1 : 0),
            wakesDispatched: result.wakesDispatched + (wakeState === "dispatched" ? 1 : 0),
          };
        }
      }

      const currentMonitors = yield* repository.listMonitors({
        rootThreadId: input.rootThreadId,
        limit: ORCHESTRATOR_RESOURCE_POLICY_V1.maxActiveMonitorsPerRoot * 32,
      });
      yield* updateCapacity({ rootThreadId: input.rootThreadId, monitors: currentMonitors });
      return result;
    });

    const reconcileRoot: OrchestratorMonitorShape["reconcileRoot"] = (rootThreadId) =>
      lock.withPermits(1)(reconcileRootUnlocked({ rootThreadId, event: null }));

    const reconcileEventUnlocked = Effect.fnUntraced(function* (event: OrchestrationEvent) {
      if (event.aggregateKind === "orchestrator") {
        return yield* reconcileRootUnlocked({
          rootThreadId: event.aggregateId as ThreadId,
          event,
        });
      }
      if (event.aggregateKind === "thread") {
        const root = yield* repository.findRootForThread(event.aggregateId as ThreadId);
        if (Option.isSome(root)) {
          return yield* reconcileRootUnlocked({ rootThreadId: root.value, event });
        }
      }
      return emptyResult();
    });
    const reconcileEvent: OrchestratorMonitorShape["reconcileEvent"] = (event) =>
      lock.withPermits(1)(reconcileEventUnlocked(event));

    const reconcileAllUnlocked = Effect.gen(function* () {
      let result = emptyResult();
      for (const root of yield* repository.listRoots()) {
        result = addResult(
          result,
          yield* reconcileRootUnlocked({ rootThreadId: root.root.rootThreadId, event: null }),
        );
      }
      return result;
    });
    const reconcileAll: OrchestratorMonitorShape["reconcileAll"] =
      lock.withPermits(1)(reconcileAllUnlocked);

    const start: OrchestratorMonitorShape["start"] = Effect.gen(function* () {
      yield* reconcileAll.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("orchestrator monitor startup reconciliation failed", {
            cause: Cause.pretty(cause),
          }),
        ),
      );
      yield* engine.streamDomainEvents.pipe(
        Stream.runForEach((event) =>
          reconcileEvent(event).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("orchestrator monitor event reconciliation failed", {
                eventSequence: event.sequence,
                eventType: event.type,
                cause: Cause.pretty(cause),
              }),
            ),
          ),
        ),
        Effect.forkScoped,
      );
      yield* Effect.sleep(
        Duration.millis(
          Math.max(
            100,
            options?.reconcileIntervalMs ?? ORCHESTRATOR_MONITOR_POLICY_V1.reconcileIntervalMs,
          ),
        ),
      ).pipe(
        Effect.andThen(
          reconcileAll.pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("orchestrator monitor periodic reconciliation failed", {
                cause: Cause.pretty(cause),
              }),
            ),
          ),
        ),
        Effect.forever,
        Effect.forkScoped,
      );
    });

    return {
      start,
      reconcileRoot,
      reconcileEvent,
      reconcileAll,
    } satisfies OrchestratorMonitorShape;
  });

export const OrchestratorMonitorLive = Layer.effect(OrchestratorMonitor, makeOrchestratorMonitor());
