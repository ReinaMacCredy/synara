import type { Run, RunPolicy } from "@synara/contracts";

export interface RunResourceUsage {
  readonly wallTimeMs: number;
  readonly recursiveCalls: number;
  readonly fanOut: number;
  readonly retries: number;
  readonly costUsd: number | null;
  readonly kernelMemoryMiB: number;
  readonly kernelOutputBytes: number;
  readonly activePlugins: number;
  readonly activeSubscriptions: number;
  readonly eventRatePerMinute: number;
  readonly aggregationSamples: number;
}

export interface RunActionRequest {
  readonly capability?: string;
  readonly pluginAction?: string;
  readonly replay?: boolean;
  readonly aggregationWindowMs?: number;
}

export type RunPolicyDenialCode =
  | "wall_time"
  | "recursive_calls"
  | "fan_out"
  | "retries"
  | "cost"
  | "kernel_memory"
  | "kernel_output"
  | "plugin_count"
  | "subscription_count"
  | "event_rate"
  | "aggregation_samples"
  | "aggregation_window"
  | "capability"
  | "plugin_action"
  | "replay";

export interface RunPolicyDecision {
  readonly allowed: boolean;
  readonly denialCode: RunPolicyDenialCode | null;
  readonly reason: string;
}

const denied = (denialCode: RunPolicyDenialCode, reason: string): RunPolicyDecision => ({
  allowed: false,
  denialCode,
  reason,
});

export function evaluateRunPolicy(
  policy: RunPolicy,
  usage: RunResourceUsage,
  request: RunActionRequest = {},
): RunPolicyDecision {
  if (usage.wallTimeMs >= policy.maxWallTimeMs) {
    return denied("wall_time", `Wall time ${usage.wallTimeMs}ms reached ${policy.maxWallTimeMs}ms.`);
  }
  if (usage.recursiveCalls >= policy.maxRecursiveCalls) {
    return denied("recursive_calls", `Recursive calls reached ${policy.maxRecursiveCalls}.`);
  }
  if (usage.fanOut > policy.maxFanOut) {
    return denied("fan_out", `Fan-out ${usage.fanOut} exceeds ${policy.maxFanOut}.`);
  }
  if (usage.retries > policy.maxRetries) {
    return denied("retries", `Retries ${usage.retries} exceed ${policy.maxRetries}.`);
  }
  if (policy.maxCostUsd !== null && usage.costUsd !== null && usage.costUsd >= policy.maxCostUsd) {
    return denied("cost", `Cost ${usage.costUsd} reached ${policy.maxCostUsd}.`);
  }
  if (usage.kernelMemoryMiB > policy.maxKernelMemoryMiB) {
    return denied("kernel_memory", `Kernel memory ${usage.kernelMemoryMiB} MiB exceeds ${policy.maxKernelMemoryMiB} MiB.`);
  }
  if (usage.kernelOutputBytes > policy.maxKernelOutputBytes) {
    return denied("kernel_output", `Kernel output ${usage.kernelOutputBytes} bytes exceeds ${policy.maxKernelOutputBytes}.`);
  }
  if (usage.activePlugins > policy.maxPlugins) {
    return denied("plugin_count", `Plugin count ${usage.activePlugins} exceeds ${policy.maxPlugins}.`);
  }
  if (usage.activeSubscriptions > policy.maxSubscriptions) {
    return denied(
      "subscription_count",
      `Subscription count ${usage.activeSubscriptions} exceeds ${policy.maxSubscriptions}.`,
    );
  }
  if (usage.eventRatePerMinute > policy.maxEventRatePerMinute) {
    return denied("event_rate", `Event rate ${usage.eventRatePerMinute}/min exceeds ${policy.maxEventRatePerMinute}/min.`);
  }
  if (usage.aggregationSamples > policy.maxAggregationSamples) {
    return denied(
      "aggregation_samples",
      `Aggregation samples ${usage.aggregationSamples} exceed ${policy.maxAggregationSamples}.`,
    );
  }
  if (
    request.aggregationWindowMs !== undefined &&
    request.aggregationWindowMs > policy.maxAggregationWindowMs
  ) {
    return denied(
      "aggregation_window",
      `Aggregation window ${request.aggregationWindowMs}ms exceeds ${policy.maxAggregationWindowMs}ms.`,
    );
  }
  if (request.capability && !policy.allowedCapabilities.includes(request.capability)) {
    return denied("capability", `Capability '${request.capability}' is not allowed by RunPolicy.`);
  }
  if (request.pluginAction && !policy.allowedPluginActions.includes(request.pluginAction)) {
    return denied("plugin_action", `Plugin action '${request.pluginAction}' is not allowed by RunPolicy.`);
  }
  if (request.replay && policy.replayBehavior !== "idempotent_actions") {
    return denied("replay", `Replay behavior '${policy.replayBehavior}' does not permit actions.`);
  }
  return { allowed: true, denialCode: null, reason: "RunPolicy admitted the request." };
}

const RUN_TRANSITIONS: Readonly<Record<Run["status"], ReadonlySet<Run["status"]>>> = {
  admitted: new Set(["queued", "cancelled"]),
  queued: new Set(["running", "paused", "cancelled", "failed"]),
  running: new Set(["waiting", "paused", "stalled", "succeeded", "failed", "cancelled"]),
  waiting: new Set(["running", "paused", "stalled", "failed", "cancelled"]),
  paused: new Set(["queued", "running", "cancelled"]),
  stalled: new Set(["running", "paused", "failed", "cancelled"]),
  succeeded: new Set(),
  failed: new Set(["queued"]),
  cancelled: new Set(),
};

export function mayTransitionRun(from: Run["status"], to: Run["status"]): boolean {
  return RUN_TRANSITIONS[from].has(to);
}

export function transitionRun(run: Run, to: Run["status"], at: string): Run {
  if (!mayTransitionRun(run.status, to)) {
    throw new Error(`Illegal Run transition: ${run.status} -> ${to}.`);
  }
  const terminal = to === "succeeded" || to === "failed" || to === "cancelled";
  return {
    ...run,
    status: to,
    startedAt: run.startedAt ?? (to === "running" ? at : null),
    lastProgressAt: to === "running" ? at : run.lastProgressAt,
    finishedAt: terminal ? at : null,
    revision: run.revision + 1,
    updatedAt: at,
  };
}
