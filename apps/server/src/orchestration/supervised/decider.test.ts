import assert from "node:assert/strict";

import {
  DEFAULT_SUPERVISED_RUN_POLICY,
  emptySupervisedRuntimeSnapshot,
  type PluginInstallation,
  type Room,
  type SupervisedCommand,
} from "@synara/contracts";
import { describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { decideSupervisedCommand } from "./decider.ts";

const now = "2026-08-07T00:00:00.000Z";
const hash = `sha256:${"a".repeat(64)}` as const;
const room: Room = {
  id: "room-1" as Room["id"],
  projectId: "project-1" as Room["projectId"],
  title: "Room one",
  leadSeatId: "lead-1" as NonNullable<Room["leadSeatId"]>,
  status: "active",
  graphRevision: 1,
  revision: 2,
  createdAt: now,
  updatedAt: now,
};

const baseCommand = {
  commandId: "command-1",
  aggregateId: room.id,
  expectedRevision: room.revision,
  idempotencyKey: "command-1",
  createdAt: now,
} as const;

const installation = (overrides: Partial<PluginInstallation> = {}): PluginInstallation => ({
  pluginId: "plugin-context" as PluginInstallation["pluginId"],
  manifest: {
    pluginId: "plugin-context" as PluginInstallation["pluginId"],
    name: "Context plugin",
    version: "1.0.0",
    manifestVersion: "1",
    description: "Requests bounded context compaction.",
    handler: null,
    eventSchemas: [],
    subscriptions: [],
    requestedCapabilities: ["event.read", "command.request"],
    requestedPayloadFields: ["contextUsagePercent"],
    resourceLimits: {
      maxRuntimeMs: 1_000,
      maxMemoryMiB: 64,
      maxOutputBytes: 65_536,
      maxConcurrentHandlers: 1,
      maxQueueDepth: 10,
    },
    provenance: { source: "builtin", contentHash: hash, signature: null },
  },
  grant: {
    id: "grant-context" as PluginInstallation["grant"]["id"],
    pluginId: "plugin-context" as PluginInstallation["pluginId"],
    capabilities: ["event.read", "command.request"],
    payloadFields: ["contextUsagePercent"],
    scopes: [{ kind: "room", roomId: room.id }],
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
  ...overrides,
});

describe("Supervised command authority", () => {
  it("denies a Seat that does not own the Room mutation", async () => {
    const command: SupervisedCommand = {
      ...baseCommand,
      type: "supervised.room.update",
      actor: { kind: "seat", actorId: "specialist-1", seatId: "specialist-1" },
      room: { ...room, title: "Unauthorized", revision: room.revision },
    };
    const exit = await Effect.runPromiseExit(
      decideSupervisedCommand({
        command,
        state: { ...emptySupervisedRuntimeSnapshot(now), rooms: [room] },
      }),
    );
    assert.equal(exit._tag, "Failure");
  });

  it("admits a scoped plugin request only through its grant and RunPolicy", async () => {
    const plugin = installation({
      manifest: {
        ...installation().manifest,
        subscriptions: [
          {
            id: "subscription-context" as PluginInstallation["manifest"]["subscriptions"][number]["id"],
            schemaVersion: "1.0.0",
            name: "Context pressure",
            owner: { kind: "user", actorId: "owner" },
            concern: "context",
            ownerLeadSeatId: null,
            selector: { sourceKind: "metric", names: ["contextUsagePercent"] },
            scope: [{ kind: "room", roomId: room.id }],
            where: [],
            aggregation: { function: "latest", field: "contextUsagePercent", groupBy: [] },
            window: { kind: "latest", durationMs: 60_000, allowedLatenessMs: 0, maxSamples: 10 },
            condition: { operator: "gte", value: 80 },
            hysteresis: {
              trigger: { operator: "gte", value: 80 },
              reset: { operator: "lt", value: 65 },
            },
            debounceMs: 0,
            cooldownMs: 60_000,
            destination: { kind: "plugin", pluginId: "plugin-context", handler: "handle" },
            allowedActionRequests: ["supervised.compaction.request"],
            cursor: { lastSequence: 0, lastEventTime: null, lastDeliveryKey: null },
            replayPolicy: "observe_only",
            state: "enabled",
            rateLimitPerMinute: 10,
            maxQueueDepth: 10,
            failurePolicy: { maxAttempts: 3, backoffMs: 1_000, deadLetterAfterAttempts: 3, critical: false },
            armed: true,
            createdBy: { kind: "user", actorId: "owner" },
            updatedBy: { kind: "user", actorId: "owner" },
            createdAt: now,
            updatedAt: now,
            revision: 0,
          },
        ],
      },
    });
    const policy = {
      id: "policy-1" as NonNullable<SupervisedCommand["runPolicyId"]>,
      name: "Policy",
      ...DEFAULT_SUPERVISED_RUN_POLICY,
      maxCostUsd: null,
      allowedCapabilities: [],
      allowedPluginActions: ["supervised.compaction.request"],
      revision: 0,
      createdAt: now,
      updatedAt: now,
    };
    const command: SupervisedCommand = {
      ...baseCommand,
      type: "supervised.compaction.request",
      actor: { kind: "plugin", actorId: plugin.pluginId },
      runPolicyId: policy.id,
      leadSeatId: "lead-1",
      roomId: room.id,
      reason: "Context threshold crossed.",
    };
    const result = await Effect.runPromise(
      decideSupervisedCommand({
        command,
        state: {
          ...emptySupervisedRuntimeSnapshot(now),
          rooms: [room],
          plugins: [plugin],
          runPolicies: [policy],
        },
      }),
    );
    assert.equal(result.type, "supervised.compaction-requested");

    const denied = await Effect.runPromiseExit(
      decideSupervisedCommand({
        command,
        state: {
          ...emptySupervisedRuntimeSnapshot(now),
          rooms: [room],
          plugins: [{ ...plugin, grant: { ...plugin.grant, scopes: [{ kind: "room", roomId: "room-2" }] } }],
          runPolicies: [policy],
        },
      }),
    );
    assert.equal(denied._tag, "Failure");
  });

  it("rejects a Human plugin install whose grant exceeds its manifest", async () => {
    const plugin = installation();
    const command: SupervisedCommand = {
      ...baseCommand,
      type: "supervised.plugin.install",
      actor: { kind: "user", actorId: "owner" },
      aggregateId: plugin.pluginId,
      expectedRevision: 0,
      installation: {
        ...plugin,
        grant: { ...plugin.grant, capabilities: ["event.read", "filesystem.write"] },
      },
    };
    const exit = await Effect.runPromiseExit(
      decideSupervisedCommand({ command, state: emptySupervisedRuntimeSnapshot(now) }),
    );
    assert.equal(exit._tag, "Failure");
  });

  it("admits one bounded WorkClaim and rejects a competing active claim", async () => {
    const run = {
      id: "run-1",
      roomId: room.id,
      taskId: "task-1",
      taskNodeId: "node-1",
      taskNodeRevisionId: "node-revision-1",
      ownerSeatId: "specialist-1",
      policyId: "policy-1",
      status: "running",
      attempt: 1,
      daemonEpoch: 1,
      startedAt: now,
      lastProgressAt: now,
      finishedAt: null,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    } as const;
    const claim = {
      id: "claim-1",
      taskNodeId: run.taskNodeId,
      taskNodeRevisionId: run.taskNodeRevisionId,
      runId: run.id,
      ownerSeatId: run.ownerSeatId,
      status: "active",
      acquiredAt: now,
      expiresAt: "2026-08-07T00:05:00.000Z",
      releasedAt: null,
      revision: 0,
    } as const;
    const command = {
      ...baseCommand,
      type: "supervised.claim.acquire",
      actor: { kind: "seat", actorId: run.ownerSeatId, seatId: run.ownerSeatId },
      aggregateId: claim.id,
      expectedRevision: 0,
      claim,
    } as SupervisedCommand;
    const state = { ...emptySupervisedRuntimeSnapshot(now), rooms: [room], runs: [run] };
    const accepted = await Effect.runPromise(decideSupervisedCommand({ command, state }));
    assert.equal(accepted.type, "supervised.claim-acquired");

    const denied = await Effect.runPromiseExit(
      decideSupervisedCommand({
        command: { ...command, aggregateId: "claim-2", claim: { ...claim, id: "claim-2" } },
        state: { ...state, workClaims: [claim] },
      }),
    );
    assert.equal(denied._tag, "Failure");
  });

  it("atomically records intervention, Lead notification, and reconciliation", async () => {
    const intervention = {
      id: "intervention-1",
      roomId: room.id,
      requestedBy: {
        kind: "seat",
        actorId: "lead-architecture",
        seatId: "lead-architecture",
      },
      specialistThreadId: "specialist-thread-1",
      reason: "Architecture boundary drifted.",
      evidenceRefs: [],
      status: "open",
      createdAt: now,
      updatedAt: now,
      revision: 0,
    } as const;
    const command = {
      ...baseCommand,
      type: "supervised.intervention.propose",
      actor: intervention.requestedBy,
      aggregateId: intervention.id,
      expectedRevision: 0,
      intervention,
      leadNotification: {
        id: "notification-1",
        interventionId: intervention.id,
        roomId: room.id,
        leadSeatId: room.leadSeatId,
        status: "queued",
        createdAt: now,
        deliveredAt: null,
        acknowledgedAt: null,
      },
      reconciliation: {
        id: "reconciliation-1",
        interventionId: intervention.id,
        roomId: room.id,
        leadSeatId: room.leadSeatId,
        status: "open",
        taskNodeRevisionId: null,
        reason: null,
        createdAt: now,
        resolvedAt: null,
        revision: 0,
      },
    } as SupervisedCommand;
    const accepted = await Effect.runPromise(
      decideSupervisedCommand({
        command,
        state: { ...emptySupervisedRuntimeSnapshot(now), rooms: [room] },
      }),
    );
    assert.equal(accepted.type, "supervised.intervention-proposed");
    assert.equal(accepted.payload.leadNotification?.leadSeatId, room.leadSeatId);
    assert.equal(accepted.payload.reconciliation?.status, "open");
  });
});
