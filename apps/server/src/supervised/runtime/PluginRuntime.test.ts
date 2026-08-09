import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { ControlPlaneEvent, PluginInstallation, RunPolicy } from "@synara/contracts";

import { GovernedPluginRuntime, type PluginKernelFactory } from "./PluginRuntime.ts";

const hash = `sha256:${"a".repeat(64)}`;
const now = "2026-08-07T00:00:00.000Z";
const schema = {
  id: "schema-context",
  eventType: "agent.context.measured",
  version: "1.0.0",
  compatibility: "backward",
  jsonSchema: {},
  fieldClassifications: { role: "public", contextUsagePercent: "internal", secret: "secret" },
  status: "active",
  createdAt: now,
  updatedAt: now,
};
const installation = {
  pluginId: "plugin-1",
  manifest: {
    pluginId: "plugin-1",
    name: "Context plugin",
    version: "1.0.0",
    manifestVersion: "1",
    description: "Test",
    handler: { runtime: "javascript", entry: "handler.js", protocolVersion: "1" },
    eventSchemas: [schema],
    subscriptions: [],
    requestedCapabilities: ["event.read", "signal.propose", "command.request"],
    requestedPayloadFields: ["role", "contextUsagePercent"],
    resourceLimits: { maxRuntimeMs: 100, maxMemoryMiB: 64, maxOutputBytes: 1_024, maxConcurrentHandlers: 1, maxQueueDepth: 10 },
    provenance: { source: "test", contentHash: hash, signature: null },
  },
  grant: {
    id: "grant-1",
    pluginId: "plugin-1",
    capabilities: ["event.read", "signal.propose", "command.request"],
    payloadFields: ["role", "contextUsagePercent"],
    scopes: [{ kind: "global" }],
    allowedActionRequests: ["supervised.compaction.request"],
    status: "active",
    grantedBy: { kind: "user", actorId: "owner" },
    grantedAt: now,
    revokedAt: null,
    revision: 0,
  },
  status: "enabled",
  installedAt: now,
  updatedAt: now,
  revision: 0,
} as PluginInstallation;
  const policy = {
    allowedCapabilities: ["event.read"],
    allowedPluginActions: ["supervised.compaction.request"],
    maxWallTimeMs: 1_000,
    maxPluginHandlerMs: 100,
    circuitBreakerFailureCount: 2,
  circuitBreakerResetMs: 10_000,
} as RunPolicy;
const usage = {
  wallTimeMs: 0,
  recursiveCalls: 0,
  fanOut: 1,
  retries: 0,
  costUsd: 0,
  kernelMemoryMiB: 0,
  kernelOutputBytes: 0,
  activePlugins: 1,
  activeSubscriptions: 0,
  eventRatePerMinute: 1,
  aggregationSamples: 0,
};
const event = {
  sequence: 1,
  eventId: "event-1",
  schemaId: "schema-context",
  schemaVersion: "1.0.0",
  type: "agent.context.measured",
  scope: { kind: "global" },
  subjectId: "lead-1",
  eventTime: now,
  recordedAt: now,
  revision: 1,
  causationEventId: null,
  correlationId: null,
  payload: { role: "lead", contextUsagePercent: 82, secret: "must-not-leak" },
  provenance: { actor: { kind: "daemon", actorId: "daemon-1" }, source: "test", confidence: 1 },
} as ControlPlaneEvent;

describe("GovernedPluginRuntime", () => {
  it("removes network and filesystem mutation capabilities during observe-only replay", async () => {
    let kernelOptions: Parameters<PluginKernelFactory>[0] | null = null;
    const runtime = new GovernedPluginRuntime(
      {
        ...installation,
        grant: {
          ...installation.grant,
          capabilities: [
            ...installation.grant.capabilities,
            "network.connect",
            "filesystem.write",
          ],
        },
      } as PluginInstallation,
      "/tmp/plugin-1",
      {
        ...policy,
        allowedCapabilities: ["event.read", "network.connect", "filesystem.write"],
      } as RunPolicy,
      usage,
      async (options) => {
        kernelOptions = options;
        return {
          execute: async () => ({ result: { observations: [], signals: [], commandRequests: [] }, stdout: "", outputBytes: 0 }),
          stop: () => undefined,
        };
      },
      async () => "async function handle() {}",
      "observe_only",
    );

    await runtime.handle(event);
    assert.equal(kernelOptions?.allowNetwork, false);
    assert.equal(kernelOptions?.allowFilesystemWrites, false);
  });

  it("passes only granted payload fields and returns request candidates without executing them", async () => {
    let observedInput: unknown;
    const factory: PluginKernelFactory = async () => ({
      execute: async (_code, input) => {
        observedInput = input;
        return {
          result: {
            observations: [],
            signals: [],
            commandRequests: [{ type: "supervised.compaction.request", payload: { leadSeatId: "lead-1" } }],
          },
          stdout: "",
          outputBytes: 10,
        };
      },
      stop: () => undefined,
    });
    const runtime = new GovernedPluginRuntime(
      installation,
      "/tmp/plugin-1",
      policy,
      usage,
      factory,
      async () => "async function handle() {}",
    );
    const result = await runtime.handle(event);
    assert.equal(result.commandRequests.length, 1);
    assert.deepEqual((observedInput as { payload: unknown }).payload, {
      role: "lead",
      contextUsagePercent: 82,
    });
  });

  it("fails closed for unknown schema versions", async () => {
    const runtime = new GovernedPluginRuntime(
      installation,
      "/tmp/plugin-1",
      policy,
      usage,
      async () => {
        throw new Error("must not start");
      },
      async () => "async function handle() {}",
    );
    await assert.rejects(() => runtime.handle({ ...event, schemaVersion: "2.0.0" }), /does not support schema/);
  });

  it("does not grant command authority through a subscription", async () => {
    const denied = {
      ...installation,
      grant: { ...installation.grant, allowedActionRequests: [] },
    } as PluginInstallation;
    const runtime = new GovernedPluginRuntime(
      denied,
      "/tmp/plugin-1",
      policy,
      usage,
      async () => ({
        execute: async () => ({
          result: {
            observations: [],
            signals: [],
            commandRequests: [{ type: "supervised.compaction.request", payload: {} }],
          },
          stdout: "",
          outputBytes: 10,
        }),
        stop: () => undefined,
      }),
      async () => "async function handle() {}",
    );
    await assert.rejects(() => runtime.handle(event), /outside its grant/);
  });

    it("rejects observation output without metric.emit capability", async () => {
    const runtime = new GovernedPluginRuntime(
      installation,
      "/tmp/plugin-1",
      policy,
      usage,
      async () => ({
        execute: async () => ({
          result: {
            observations: [
              {
                metric: "contextTrend",
                value: 2,
                unit: "percent_per_minute",
                quality: "estimated",
                confidence: 0.8,
              },
            ],
            signals: [],
            commandRequests: [],
          },
          stdout: "",
          outputBytes: 10,
        }),
        stop: () => undefined,
      }),
      async () => "async function handle() {}",
    );

      await assert.rejects(() => runtime.handle(event), /without metric.emit capability/);
    });

    it("stops an isolated handler that exceeds the tighter plugin timeout", async () => {
      let stopped = false;
      const runtime = new GovernedPluginRuntime(
        {
          ...installation,
          manifest: {
            ...installation.manifest,
            resourceLimits: { ...installation.manifest.resourceLimits, maxRuntimeMs: 5 },
          },
        },
        "/tmp/plugin-1",
        policy,
        usage,
        async () => ({
          execute: () => new Promise(() => undefined),
          stop: () => {
            stopped = true;
          },
        }),
        async () => "async function handle() {}",
      );

      await assert.rejects(() => runtime.handle(event), /5ms time limit/);
      assert.equal(stopped, true);
    });
  });
