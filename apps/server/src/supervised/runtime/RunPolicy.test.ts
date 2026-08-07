import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { Run, RunPolicy } from "@synara/contracts";

import { evaluateRunPolicy, mayTransitionRun, transitionRun } from "./RunPolicy.ts";

const now = "2026-08-07T00:00:00.000Z";
const policy: RunPolicy = {
  id: "policy-1" as RunPolicy["id"],
  name: "Default",
  maxWallTimeMs: 1_000,
  maxRecursiveCalls: 2,
  maxFanOut: 4,
  maxRetries: 2,
  maxKernelMemoryMiB: 256,
  maxKernelOutputBytes: 1_024,
  maxPluginHandlerMs: 1_000,
  maxPluginQueueDepth: 10,
  maxSubscriptions: 5,
  maxPlugins: 2,
  maxEventRatePerMinute: 100,
  maxAggregationWindowMs: 60_000,
  maxAggregationSamples: 1_000,
  maxCostUsd: 1,
  replayBehavior: "observe_only",
  allowedCapabilities: ["filesystem.read"],
  allowedPluginActions: ["supervised.compaction.request"],
  circuitBreakerFailureCount: 3,
  circuitBreakerResetMs: 1_000,
  revision: 0,
  createdAt: now,
  updatedAt: now,
};
const usage = {
  wallTimeMs: 100,
  recursiveCalls: 0,
  fanOut: 1,
  retries: 0,
  costUsd: 0.1,
  kernelMemoryMiB: 64,
  kernelOutputBytes: 10,
  activePlugins: 1,
  activeSubscriptions: 1,
  eventRatePerMinute: 10,
  aggregationSamples: 10,
};

describe("RunPolicy", () => {
  it("admits only allowlisted capabilities and actions", () => {
    assert.equal(
      evaluateRunPolicy(policy, usage, {
        capability: "filesystem.read",
        pluginAction: "supervised.compaction.request",
      }).allowed,
      true,
    );
    assert.equal(
      evaluateRunPolicy(policy, usage, { pluginAction: "supervised.plugin.enable" }).denialCode,
      "plugin_action",
    );
  });

  it("keeps observe-only replay side-effect free", () => {
    assert.equal(evaluateRunPolicy(policy, usage, { replay: true }).denialCode, "replay");
  });

  it("blocks exhausted recursive budgets before another call", () => {
    assert.equal(
      evaluateRunPolicy(policy, { ...usage, recursiveCalls: 2 }).denialCode,
      "recursive_calls",
    );
  });

  it("enforces the Run state machine", () => {
    assert.equal(mayTransitionRun("succeeded", "running"), false);
    const run = {
      id: "run-1",
      roomId: "room-1",
      taskId: "task-1",
      taskNodeId: null,
      taskNodeRevisionId: null,
      ownerSeatId: "lead-1",
      policyId: "policy-1",
      status: "queued",
      attempt: 1,
      daemonEpoch: 1,
      startedAt: null,
      lastProgressAt: null,
      finishedAt: null,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    } as Run;
    const running = transitionRun(run, "running", "2026-08-07T00:00:01.000Z");
    assert.equal(running.status, "running");
    assert.equal(running.revision, 1);
    assert.throws(() => transitionRun(running, "admitted", now));
  });
});
