import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  CommandId,
  ControlPlaneEvent,
  DEFAULT_SUPERVISED_RUN_POLICY,
  EventId,
  MessageId,
  MetricSampleId,
  RunPolicyId,
  SupervisedCommand,
  type DerivedSignal,
  type MetricSample,
  type PluginInstallation,
  type RunPolicy,
  type SubscriptionDefinition,
  type SubscriptionDelivery,
  type SupervisedRuntimeSnapshot,
} from "@synara/contracts";
import { Effect, Layer, Schema } from "effect";

import { SupervisedRuntimeRepository } from "../../persistence/Services/SupervisedRuntimeRepository.ts";
import {
  GovernedPluginRuntime,
  type PluginHandlerResult,
} from "../../supervised/runtime/PluginRuntime.ts";
import {
  evaluateRunPolicy,
  type RunResourceUsage,
} from "../../supervised/runtime/RunPolicy.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  SupervisedSignalDelivery,
  SupervisedSignalDeliveryError,
  type SupervisedSignalDeliveryShape,
} from "../Services/SupervisedSignalDelivery.ts";

const hash = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

const stableId = (prefix: string, value: unknown) =>
  `${prefix}:${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32)}`;

const deliveryFailure = (detail: string, cause?: unknown) =>
  new SupervisedSignalDeliveryError({ detail, ...(cause === undefined ? {} : { cause }) });

function pluginDirectory(installation: PluginInstallation): string {
  const source = installation.manifest.provenance.source;
  if (!source.startsWith("file://")) {
    throw new Error("Executable plugin provenance must be a file:// directory URL.");
  }
  return fileURLToPath(source);
}

function pluginPolicy(
  snapshot: SupervisedRuntimeSnapshot,
  installation: PluginInstallation,
  at: string,
): RunPolicy {
  const persisted = snapshot.runPolicies[0];
  if (persisted) return persisted;
  return {
    id: RunPolicyId.makeUnsafe("supervised-plugin-default-v1"),
    name: "Supervised plugin default",
    ...DEFAULT_SUPERVISED_RUN_POLICY,
    maxWallTimeMs: Math.min(
      DEFAULT_SUPERVISED_RUN_POLICY.maxWallTimeMs,
      DEFAULT_SUPERVISED_RUN_POLICY.maxPluginHandlerMs,
      installation.manifest.resourceLimits.maxRuntimeMs,
    ),
    maxPluginHandlerMs: Math.min(
      DEFAULT_SUPERVISED_RUN_POLICY.maxPluginHandlerMs,
      installation.manifest.resourceLimits.maxRuntimeMs,
    ),
    maxPluginQueueDepth: Math.min(
      DEFAULT_SUPERVISED_RUN_POLICY.maxPluginQueueDepth,
      installation.manifest.resourceLimits.maxQueueDepth,
    ),
    maxKernelMemoryMiB: Math.min(
      DEFAULT_SUPERVISED_RUN_POLICY.maxKernelMemoryMiB,
      installation.manifest.resourceLimits.maxMemoryMiB,
    ),
    maxKernelOutputBytes: Math.min(
      DEFAULT_SUPERVISED_RUN_POLICY.maxKernelOutputBytes,
      installation.manifest.resourceLimits.maxOutputBytes,
    ),
    maxCostUsd: null,
    allowedCapabilities: ["filesystem.read"],
    allowedPluginActions: [
      "supervised.compaction.request",
      "supervised.handoff.request",
      "supervised.intervention.propose",
    ],
    revision: 0,
    createdAt: at,
    updatedAt: at,
  };
}

function pluginUsage(snapshot: SupervisedRuntimeSnapshot): RunResourceUsage {
  return {
    wallTimeMs: 0,
    recursiveCalls: 0,
    fanOut: 1,
    retries: 0,
    costUsd: null,
    kernelMemoryMiB: 0,
    kernelOutputBytes: 0,
    activePlugins: snapshot.plugins.filter((plugin) => plugin.status === "enabled").length,
    activeSubscriptions: snapshot.subscriptions.filter(
      (subscription) => subscription.state === "enabled",
    ).length,
    eventRatePerMinute: 0,
    aggregationSamples: 0,
  };
}

function signalEvent(
  signal: DerivedSignal,
  delivery: SubscriptionDelivery,
): ControlPlaneEvent {
  return Schema.decodeUnknownSync(ControlPlaneEvent)({
    sequence: 0,
    eventId: EventId.makeUnsafe(stableId("event:signal-delivery", delivery.id)),
    schemaId: "schema-supervised-signal-derived-v1",
    schemaVersion: "1.0.0",
    type: "supervised.signal.derived",
    scope: signal.scope,
    subjectId: signal.subjectId,
    eventTime: signal.triggeredAt,
    recordedAt: delivery.updatedAt,
    revision: signal.revision,
    causationEventId: signal.sourceEventIds.at(-1) ?? null,
    correlationId: null,
    payload: {
      signalId: signal.id,
      signalKind: signal.kind,
      measuredValue: signal.measuredValue,
      threshold: signal.threshold,
      context: signal.context,
      sourceEventIds: signal.sourceEventIds,
    },
    provenance: {
      actor: { kind: "daemon", actorId: "supervised-runtime" },
      source: "supervised-signal-plane",
      confidence: 1,
    },
  });
}

function leadWakeText(
  subscription: SubscriptionDefinition,
  signal: DerivedSignal,
): string {
  return [
    "<synara_supervised_signal>",
    "This is a durable bounded Signal Plane wake, not a Human instruction.",
    `subscription_id: ${subscription.id}`,
    `signal_id: ${signal.id}`,
    `signal_kind: ${signal.kind}`,
    `measured_value: ${signal.measuredValue}`,
    `threshold: ${signal.threshold.operator} ${signal.threshold.value}`,
    `scope: ${JSON.stringify(signal.scope)}`,
    `source_event_ids: ${signal.sourceEventIds.join(",")}`,
    `evidence_snapshot: ${JSON.stringify(signal.context).slice(0, 12_000)}`,
    "Assess root cause within your existing concern and scope. This wake grants no new authority.",
    "Use only allowed typed commands; Lead Room-local integration and acceptance authority is unchanged.",
    "</synara_supervised_signal>",
  ].join("\n");
}

export const makeSupervisedSignalDelivery = Effect.gen(function* () {
  const repository = yield* SupervisedRuntimeRepository;
  const engine = yield* OrchestrationEngineService;

  const appendAudit = (input: {
    readonly subscription: SubscriptionDefinition;
    readonly signal: DerivedSignal;
    readonly delivery: SubscriptionDelivery;
    readonly outcome: string;
    readonly detail?: Readonly<Record<string, unknown>>;
  }) =>
    repository.appendAudit({
      action: "supervised.signal.deliver",
      actor: { kind: "daemon", actorId: "supervised-runtime" },
      targetKind: input.subscription.destination.kind,
      targetId:
        input.subscription.destination.kind === "lead_seat"
          ? input.subscription.destination.leadSeatId
          : input.subscription.destination.kind === "concern"
            ? input.subscription.destination.concern
            : input.subscription.destination.kind === "plugin"
              ? input.subscription.destination.pluginId
              : input.subscription.destination.kind === "inbox"
                ? input.subscription.destination.inbox
                : input.subscription.destination.channel,
      outcome: input.outcome,
      detail: {
        signalId: input.signal.id,
        signalKind: input.signal.kind,
        measuredValue: input.signal.measuredValue,
        threshold: input.signal.threshold,
        authorityUnchanged: true,
        ...input.detail,
      },
      occurredAt: input.delivery.updatedAt,
    });

  const deliverPluginOutput = Effect.fnUntraced(function* (input: {
    readonly installation: PluginInstallation;
    readonly subscription: SubscriptionDefinition;
    readonly signal: DerivedSignal;
    readonly delivery: SubscriptionDelivery;
    readonly policy: RunPolicy;
    readonly usage: RunResourceUsage;
    readonly result: PluginHandlerResult;
  }) {
    const at = input.delivery.updatedAt;
    yield* Effect.forEach(
      input.result.observations,
      (observation, index) => {
        const sample: MetricSample = {
          id: MetricSampleId.makeUnsafe(
            stableId("metric:plugin", {
              pluginId: input.installation.pluginId,
              deliveryId: input.delivery.id,
              index,
            }),
          ),
          metric: observation.metric,
          scope: input.signal.scope,
          subjectId: input.signal.subjectId,
          value: observation.value,
          unit: observation.unit,
          eventTime: input.signal.triggeredAt,
          computedAt: at,
          sourceEventIds: input.signal.sourceEventIds,
          aggregationReceiptHash: hash({
            pluginId: input.installation.pluginId,
            deliveryId: input.delivery.id,
            observation,
          }) as MetricSample["aggregationReceiptHash"],
          quality: observation.quality,
          confidence: observation.confidence,
          source: `plugin:${input.installation.pluginId}`,
          revision: input.signal.revision,
        };
        return repository.recordMetricSample(sample);
      },
      { concurrency: 1, discard: true },
    );

    yield* Effect.forEach(
      input.result.signals,
      (candidate, index) =>
        repository.upsertSignal({
          id: stableId("signal:plugin", {
            pluginId: input.installation.pluginId,
            deliveryId: input.delivery.id,
            index,
          }) as DerivedSignal["id"],
          kind: candidate.kind,
          subscriptionId: input.subscription.id,
          scope: input.signal.scope,
          subjectId: input.signal.subjectId,
          state: "triggered",
          measuredValue: candidate.measuredValue,
          threshold: input.signal.threshold,
          sourceEventIds: input.signal.sourceEventIds,
          metricSampleIds: [],
          aggregationReceiptHash: hash({
            pluginId: input.installation.pluginId,
            deliveryId: input.delivery.id,
            candidate,
          }) as DerivedSignal["aggregationReceiptHash"],
          context: {
            ...candidate.context,
            proposedByPluginId: input.installation.pluginId,
            parentSignalId: input.signal.id,
          },
          triggeredAt: at,
          resetAt: null,
          revision: 0,
        }),
      { concurrency: 1, discard: true },
    );

    yield* Effect.forEach(
      input.result.commandRequests,
      (request, index) =>
        Effect.gen(function* () {
          if (!input.subscription.allowedActionRequests.includes(request.type)) {
            return yield* deliveryFailure(
              `Plugin command request '${request.type}' is outside the SubscriptionDefinition action set.`,
            );
          }
          if (input.delivery.replay && input.subscription.replayPolicy !== "idempotent_actions") {
            yield* appendAudit({
              subscription: input.subscription,
              signal: input.signal,
              delivery: input.delivery,
              outcome: "replay_observed",
              detail: { suppressedCommandType: request.type },
            });
            return;
          }
          const policyDecision = evaluateRunPolicy(input.policy, input.usage, {
            pluginAction: request.type,
            replay: input.delivery.replay,
          });
          if (!policyDecision.allowed) return yield* deliveryFailure(policyDecision.reason);
          const command = Schema.decodeUnknownSync(SupervisedCommand)({
            ...request.payload,
            type: request.type,
            commandId: CommandId.makeUnsafe(
              stableId("command:plugin", {
                pluginId: input.installation.pluginId,
                deliveryId: input.delivery.id,
                index,
              }),
            ),
            actor: {
              kind: "plugin",
              actorId: input.installation.pluginId,
            },
            idempotencyKey: `${input.installation.pluginId}:${input.delivery.dedupeKey}:${index}`,
            runPolicyId: input.policy.id,
            createdAt: at,
          });
          yield* engine.dispatch(command);
        }),
      { concurrency: 1, discard: true },
    );
  });

  const deliverToPlugin = Effect.fnUntraced(function* (input: {
    readonly subscription: SubscriptionDefinition;
    readonly signal: DerivedSignal;
    readonly delivery: SubscriptionDelivery;
  }) {
    if (input.subscription.destination.kind !== "plugin") return;
    const snapshot = yield* repository.getSnapshot({ includeDisabled: true });
    const usage = pluginUsage(snapshot);
    const installation = snapshot.plugins.find(
      (candidate) => candidate.pluginId === input.subscription.destination.pluginId,
    );
    if (!installation || installation.status !== "enabled") {
      return yield* deliveryFailure("The destination plugin is not enabled.");
    }
    const policy = pluginPolicy(snapshot, installation, input.delivery.updatedAt);
    const priorHealth = snapshot.pluginHealth.find(
      (candidate) => candidate.pluginId === installation.pluginId,
    );
    const nowMs = Date.parse(input.delivery.updatedAt);
    if (
      priorHealth?.circuitState === "open" &&
      priorHealth.circuitOpenedUntil !== null &&
      Date.parse(priorHealth.circuitOpenedUntil) > nowMs
    ) {
      return yield* deliveryFailure(
        `Plugin circuit is open until ${priorHealth.circuitOpenedUntil}.`,
      );
    }
    const queueDepth = snapshot.deliveries.filter(
      (delivery) =>
        delivery.status !== "delivered" &&
        snapshot.subscriptions.some(
          (subscription) =>
            subscription.id === delivery.subscriptionId &&
            subscription.destination.kind === "plugin" &&
            subscription.destination.pluginId === installation.pluginId,
        ),
    ).length;
    const execute = Effect.tryPromise({
      try: async () => {
        const runtime = new GovernedPluginRuntime(
          installation,
          pluginDirectory(installation),
          policy,
          usage,
        );
        try {
          return await runtime.handle(signalEvent(input.signal, input.delivery));
        } finally {
          runtime.stop();
        }
      },
      catch: (cause) => deliveryFailure("Governed plugin handler failed.", cause),
    });
    const result = yield* execute.pipe(
      Effect.matchEffect({
        onSuccess: (value) =>
          repository.updatePluginHealth({
            pluginId: installation.pluginId,
            consecutiveFailures: 0,
            circuitState: "closed",
            circuitOpenedUntil: null,
            queueDepth: Math.max(0, queueDepth - 1),
            lagMs: Math.max(0, nowMs - Date.parse(input.signal.triggeredAt)),
            lastSuccessAt: input.delivery.updatedAt,
            lastFailureAt: priorHealth?.lastFailureAt ?? null,
            lastError: null,
            updatedAt: input.delivery.updatedAt,
          }).pipe(Effect.as(value)),
        onFailure: (error) => {
          const consecutiveFailures = (priorHealth?.consecutiveFailures ?? 0) + 1;
          const circuitOpen = consecutiveFailures >= policy.circuitBreakerFailureCount;
          return repository.updatePluginHealth({
            pluginId: installation.pluginId,
            consecutiveFailures,
            circuitState: circuitOpen ? "open" : "closed",
            circuitOpenedUntil: circuitOpen
              ? new Date(nowMs + policy.circuitBreakerResetMs).toISOString()
              : null,
            queueDepth,
            lagMs: Math.max(0, nowMs - Date.parse(input.signal.triggeredAt)),
            lastSuccessAt: priorHealth?.lastSuccessAt ?? null,
            lastFailureAt: input.delivery.updatedAt,
            lastError: error.detail,
            updatedAt: input.delivery.updatedAt,
          }).pipe(Effect.andThen(Effect.fail(error)));
        },
      }),
    );
    yield* deliverPluginOutput({ ...input, installation, policy, usage, result });
    yield* appendAudit({
      ...input,
      outcome: "plugin_delivered",
      detail: {
        observationCount: result.observations.length,
        proposedSignalCount: result.signals.length,
        commandRequestCount: result.commandRequests.length,
      },
    });
  });

  const deliverToLead = Effect.fnUntraced(function* (input: {
    readonly subscription: SubscriptionDefinition;
    readonly signal: DerivedSignal;
    readonly delivery: SubscriptionDelivery;
  }) {
    if (input.delivery.replay && input.subscription.replayPolicy !== "idempotent_actions") {
      yield* appendAudit({ ...input, outcome: "replay_observed", detail: { wakeSuppressed: true } });
      return;
    }
    const readModel = yield* engine.getReadModel();
    const contextLeadSeatId = input.signal.context.leadSeatId;
    const explicitSeatId =
      input.subscription.destination.kind === "lead_seat"
        ? input.subscription.destination.leadSeatId
        : (input.subscription.ownerLeadSeatId ??
          (typeof contextLeadSeatId === "string" ? contextLeadSeatId : null));
    const concern =
      input.subscription.destination.kind === "concern"
        ? input.subscription.destination.concern.toLowerCase()
        : input.subscription.concern.toLowerCase();
    const seat = readModel.supervision.leads.find(
      (candidate) =>
        candidate.status !== "archived" &&
        candidate.id === explicitSeatId,
    );
    const thread = seat
      ? readModel.threads.find(
          (candidate) => candidate.id === seat.activeThreadId && candidate.deletedAt === null,
        )
      : undefined;
    if (!seat || !thread) {
      yield* appendAudit({
        ...input,
        outcome: "concern_inbox_delivered",
        detail: {
          providerWake: false,
          concern,
          reason: "No active matching Lead seat within the signal scope.",
        },
      });
      return;
    }
    yield* engine.dispatch({
      type: "thread.turn.start",
      commandId: CommandId.makeUnsafe(stableId("command:signal-wake", input.delivery.id)),
      threadId: seat.activeThreadId,
      message: {
        messageId: MessageId.makeUnsafe(stableId("signal-wake", input.delivery.id)),
        role: "user",
        text: leadWakeText(input.subscription, input.signal),
        attachments: [],
      },
      dispatchMode: "queue",
      dispatchOrigin: "automation",
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      createdAt: input.delivery.updatedAt,
    });
    yield* appendAudit({
      ...input,
      outcome: "lead_woken",
      detail: { leadSeatId: seat.id, leadThreadId: seat.activeThreadId },
    });
  });

  const deliver: SupervisedSignalDeliveryShape["deliver"] = (input) =>
    Effect.gen(function* () {
      if (input.subscription.destination.kind === "plugin") {
        yield* deliverToPlugin(input);
        return;
      }
      if (
        input.subscription.destination.kind === "lead_seat" ||
        input.subscription.destination.kind === "concern"
      ) {
        yield* deliverToLead(input);
        return;
      }
      yield* appendAudit({ ...input, outcome: "delivered" });
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof SupervisedSignalDeliveryError
          ? cause
          : deliveryFailure("Signal delivery failed.", cause),
      ),
    );

  return { deliver } satisfies SupervisedSignalDeliveryShape;
});

export const SupervisedSignalDeliveryLive = Layer.effect(
  SupervisedSignalDelivery,
  makeSupervisedSignalDelivery,
);
