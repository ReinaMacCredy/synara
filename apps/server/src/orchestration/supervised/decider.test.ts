import assert from "node:assert/strict";

import {
  DEFAULT_SUPERVISED_RUN_POLICY,
  emptySupervisedGovernanceSnapshot,
  emptySupervisedRuntimeSnapshot,
  type HarnessPatch,
  type PeerSpecialty,
  type PluginInstallation,
  type Room,
  type SupervisedActor,
  type SupervisedCommand,
  type SupervisedDomainEvent,
  type SupervisedGovernanceSnapshot,
  type SupervisedRuntimeSnapshot,
} from "@synara/contracts";
import { describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { builtInSubscriptions } from "../../supervised/signal/BuiltInSubscriptions.ts";
import { SUPERVISED_BASE_POLICY_HASH } from "../../supervised/runtime/HarnessPatchPolicy.ts";
import {
  applyHarnessPatchSandboxEvaluation,
  awaitHarnessPatchApproval,
  createHarnessPatchProposal,
  recordHarnessPatchCanaryEvaluation,
  startHarnessPatchCanary,
} from "../../supervised/runtime/HarnessPatches.ts";
import { decideSupervisedCommand } from "./decider.ts";
import { projectSupervisedEvent } from "./projector.ts";

const now = "2026-08-07T00:00:00.000Z";
const hash = SUPERVISED_BASE_POLICY_HASH;
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

const governanceForSeat = (
  seatId: string,
  allowedCommands: ReadonlyArray<string>,
): SupervisedGovernanceSnapshot => {
  const role = seatId.startsWith("lead")
    ? ("lead" as const)
    : seatId.startsWith("supervisor")
      ? ("supervisor" as const)
      : ("peer" as const);
  return {
    ...emptySupervisedGovernanceSnapshot(now),
    workspaces: [
      {
        id: "workspace-1" as never,
        ownerNamespace: "owner",
        title: "Workspace",
        lifecycleState: "active",
        revision: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
    authorityReceipts: [
      {
        id: `receipt-${seatId}` as never,
        actorSeatId: seatId as never,
        identityRole: role,
        effectiveRole: role,
        workspaceScopes: ["workspace-1" as never],
        roomScopes: [room.id],
        taskNodeScopes: [],
        allowedCommands,
        allowedTools: [],
        rootLeaseIds: [],
        mandateIds: [],
        runPolicyRevision: 0,
        issuedAt: now,
        expiresAt: null,
        revokedAt: null,
      },
    ],
    agentSeats: [
      {
        id: seatId as never,
        workspaceId: "workspace-1" as never,
        roomIds: [room.id],
        identityRole: role,
        effectiveRole: role,
        profileId: `profile-${seatId}` as never,
        providerSessionId: null,
        lifecycleState: "active",
        workState: "idle",
        authorityReceiptId: `receipt-${seatId}` as never,
        threadId: seatId as never,
        projectId: role === "supervisor" ? null : (room.projectId as never),
        createdAt: now,
        retainedAt: null,
        retiredAt: null,
        revision: 0,
        updatedAt: now,
      },
    ],
  };
};

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

  it("rejects a Room activation that skips durable lifecycle boundaries", async () => {
    const draft = { ...room, status: "draft" as const, revision: 0 };
    const command: SupervisedCommand = {
      ...baseCommand,
      type: "supervised.room.update",
      actor: { kind: "user", actorId: "owner" },
      aggregateId: draft.id,
      expectedRevision: draft.revision,
      room: { ...draft, status: "active" },
    };

    const exit = await Effect.runPromiseExit(
      decideSupervisedCommand({
        command,
        state: { ...emptySupervisedRuntimeSnapshot(now), rooms: [draft] },
      }),
    );

    assert.equal(exit._tag, "Failure");
  });

  it("rejects direct rebinding of an active Room Lead", async () => {
    const exit = await Effect.runPromiseExit(
      decideSupervisedCommand({
        command: {
          ...baseCommand,
          type: "supervised.room.update",
          actor: { kind: "user", actorId: "owner" },
          room: { ...room, leadSeatId: "lead-2" as typeof room.leadSeatId },
        },
        state: { ...emptySupervisedRuntimeSnapshot(now), rooms: [room] },
      }),
    );

    assert.equal(exit._tag, "Failure");
  });

  it("allows the Human to move an unassigned draft Room to its selected Project", async () => {
    const draft = {
      ...room,
      leadSeatId: null,
      status: "draft" as const,
      revision: 0,
    };
    const event = await Effect.runPromise(
      decideSupervisedCommand({
        command: {
          ...baseCommand,
          type: "supervised.room.update",
          actor: { kind: "user", actorId: "owner" },
          expectedRevision: draft.revision,
          room: { ...draft, projectId: "project-2" as Room["projectId"] },
        },
        state: { ...emptySupervisedRuntimeSnapshot(now), rooms: [draft] },
      }),
    );

    assert.equal(event.payload.room?.projectId, "project-2");
  });

  it("rejects moving an active Room to another Project", async () => {
    const exit = await Effect.runPromiseExit(
      decideSupervisedCommand({
        command: {
          ...baseCommand,
          type: "supervised.room.update",
          actor: { kind: "user", actorId: "owner" },
          room: { ...room, projectId: "project-2" as Room["projectId"] },
        },
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
            failurePolicy: {
              maxAttempts: 3,
              backoffMs: 1_000,
              deadLetterAfterAttempts: 3,
              critical: false,
            },
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
          plugins: [
            { ...plugin, grant: { ...plugin.grant, scopes: [{ kind: "room", roomId: "room-2" }] } },
          ],
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

  it("rejects plugin subscriptions that bypass the plugin identity", async () => {
    const declaredSubscription = {
      ...builtInSubscriptions(now)[1]!,
      scope: [{ kind: "room" as const, roomId: room.id }],
    };
    const plugin = installation({
      manifest: {
        ...installation().manifest,
        subscriptions: [declaredSubscription],
      },
    });
    const command: SupervisedCommand = {
      ...baseCommand,
      type: "supervised.plugin.install",
      actor: { kind: "user", actorId: "owner" },
      aggregateId: plugin.pluginId,
      expectedRevision: 0,
      installation: plugin,
    };
    const exit = await Effect.runPromiseExit(
      decideSupervisedCommand({ command, state: emptySupervisedRuntimeSnapshot(now) }),
    );
    assert.equal(exit._tag, "Failure");
  });

  it("moves an enabled plugin to unhealthy only through the daemon lifecycle command", async () => {
    const plugin = installation();
    const command: SupervisedCommand = {
      ...baseCommand,
      type: "supervised.plugin.mark-unhealthy",
      actor: { kind: "daemon", actorId: "supervised-runtime" },
      aggregateId: plugin.pluginId,
      expectedRevision: plugin.revision,
      pluginId: plugin.pluginId,
    };
    const accepted = await Effect.runPromise(
      decideSupervisedCommand({
        command,
        state: { ...emptySupervisedRuntimeSnapshot(now), plugins: [plugin] },
      }),
    );
    assert.equal(accepted.payload.plugin?.status, "unhealthy");
    assert.equal(accepted.payload.plugin?.revision, 1);

    const denied = await Effect.runPromiseExit(
      decideSupervisedCommand({
        command: { ...command, actor: { kind: "user", actorId: "owner" } },
        state: { ...emptySupervisedRuntimeSnapshot(now), plugins: [plugin] },
      }),
    );
    assert.equal(denied._tag, "Failure");
  });

  it("does not let a DeadLetter redrive exceed the subscription replay policy", async () => {
    const subscription = builtInSubscriptions(now)[0]!;
    const delivery = {
      id: "delivery-replay-policy" as const,
      subscriptionId: subscription.id,
      signalId: "signal-replay-policy" as const,
      dedupeKey: "replay-policy",
      status: "dead_lettered" as const,
      attemptCount: 3,
      availableAt: now,
      deliveredAt: null,
      lastError: "failed",
      payloadHash: hash,
      replay: false,
      replayBehavior: "observe_only" as const,
      createdAt: now,
      updatedAt: now,
    };
    const deadLetter = {
      id: "dead-letter-replay-policy" as const,
      subscriptionId: subscription.id,
      deliveryId: delivery.id,
      pluginId: null,
      reason: "failed",
      payloadHash: hash,
      attemptCount: 3,
      status: "open" as const,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
    };
    const command: SupervisedCommand = {
      ...baseCommand,
      type: "supervised.delivery.redrive",
      actor: { kind: "user", actorId: "owner" },
      aggregateId: delivery.id,
      expectedRevision: delivery.attemptCount,
      deadLetterId: deadLetter.id,
      replayBehavior: "idempotent_actions",
    };
    const exit = await Effect.runPromiseExit(
      decideSupervisedCommand({
        command,
        state: {
          ...emptySupervisedRuntimeSnapshot(now),
          subscriptions: [subscription],
          deliveries: [delivery],
          deadLetters: [deadLetter],
        },
      }),
    );
    assert.equal(exit._tag, "Failure");

    const resolvedExit = await Effect.runPromiseExit(
      decideSupervisedCommand({
        command: { ...command, replayBehavior: "observe_only" },
        state: {
          ...emptySupervisedRuntimeSnapshot(now),
          subscriptions: [subscription],
          deliveries: [delivery],
          deadLetters: [{ ...deadLetter, status: "resolved", resolvedAt: now }],
        },
      }),
    );
    assert.equal(resolvedExit._tag, "Failure");
  });

  it("rejects a subscription that exceeds the current RunPolicy quota", async () => {
    const [existing, candidate] = builtInSubscriptions(now);
    const policy = {
      id: "policy-subscription-limit",
      name: "One subscription",
      ...DEFAULT_SUPERVISED_RUN_POLICY,
      maxSubscriptions: 1,
      maxCostUsd: null,
      allowedCapabilities: [],
      allowedPluginActions: [],
      revision: 0,
      createdAt: now,
      updatedAt: now,
    } as const;
    const command: SupervisedCommand = {
      ...baseCommand,
      type: "supervised.subscription.upsert",
      actor: { kind: "user", actorId: "owner" },
      aggregateId: candidate!.id,
      expectedRevision: 0,
      subscription: candidate!,
    };
    const exit = await Effect.runPromiseExit(
      decideSupervisedCommand({
        command,
        state: {
          ...emptySupervisedRuntimeSnapshot(now),
          subscriptions: [existing!],
          runPolicies: [policy],
        },
      }),
    );
    assert.equal(exit._tag, "Failure");
  });

  it("allows a governed Seat to propose but not activate a Harness Patch", async () => {
    const actor = {
      kind: "seat" as const,
      actorId: "lead-1",
      seatId: "lead-1" as const,
    };
    const patch = {
      id: "patch-proposed",
      name: "Evidence first",
      patchType: "evaluation",
      scope: { kind: "room", roomId: room.id },
      content: "Require evidence before completion.",
      basePolicyHash: hash,
      status: "proposed",
      observationEvidenceRefs: ["evidence-observed"],
      evaluationEvidenceRefs: [],
      sandboxEvaluation: null,
      approval: null,
      canary: null,
      rollback: null,
      lastControlPlaneSequence: 0,
      version: 1,
      revision: 0,
      createdBy: actor,
      activatedBy: null,
      createdAt: now,
      updatedAt: now,
    } as HarnessPatch;
    const command: SupervisedCommand = {
      ...baseCommand,
      type: "supervised.patch.upsert",
      actor,
      authorityReceiptId: "receipt-lead-1",
      aggregateId: patch.id,
      expectedRevision: 0,
      patch,
    };
    const accepted = await Effect.runPromise(
      decideSupervisedCommand({
        command,
        state: { ...emptySupervisedRuntimeSnapshot(now), rooms: [room] },
        governance: governanceForSeat("lead-1", ["supervised.patch.upsert"]),
      }),
    );
    assert.equal(accepted.payload.patch?.status, "proposed");

    const denied = await Effect.runPromiseExit(
      decideSupervisedCommand({
        command: {
          ...command,
          actor: { kind: "user", actorId: "owner" },
          authorityReceiptId: undefined,
          patch: { ...patch, status: "promoted" },
        },
        state: emptySupervisedRuntimeSnapshot(now),
      }),
    );
    assert.equal(denied._tag, "Failure");
  });

  it("runs a Supervisor proposal through failed-canary rollback without mutating Root, Lead, or TaskNode authority", async () => {
    const supervisorSeatId = "supervisor-patch";
    const supervisorGovernance = governanceForSeat(supervisorSeatId, ["supervised.patch.upsert"]);
    const leadGovernance = governanceForSeat("lead-1", []);
    const rootLeaseId = "lease-lead-root";
    const leadReceipt = {
      ...leadGovernance.authorityReceipts[0]!,
      rootLeaseIds: [rootLeaseId as never],
    };
    const governance: SupervisedGovernanceSnapshot = {
      ...supervisorGovernance,
      agentSeats: [supervisorGovernance.agentSeats[0]!, leadGovernance.agentSeats[0]!],
      authorityReceipts: [supervisorGovernance.authorityReceipts[0]!, leadReceipt],
      rootLeases: [
        {
          id: rootLeaseId as never,
          workspaceId: "workspace-1" as never,
          roomId: room.id,
          holderSeatId: "lead-1" as never,
          status: "active",
          acquiredUnderReceiptId: leadReceipt.id,
          predecessorLeaseId: null,
          acquiredAt: now,
          releasedAt: null,
          expiresAt: null,
          revision: 1,
          updatedAt: now,
        },
      ],
    };
    const taskNode = {
      id: "task-node-patch" as never,
      taskId: "task-patch" as never,
      roomId: room.id,
      parentNodeId: null,
      title: "Patch-observed task",
      description: null,
      lifecycle: "running" as const,
      activeRevisionId: "task-node-revision-patch" as never,
      graphRevision: 1,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    const workClaim = {
      id: "work-claim-patch" as never,
      taskNodeId: taskNode.id,
      taskNodeRevisionId: taskNode.activeRevisionId,
      runId: "run-patch" as never,
      ownerSeatId: "lead-1",
      status: "active" as const,
      acquiredAt: now,
      expiresAt: "2026-08-08T00:00:00.000Z",
      releasedAt: null,
      revision: 0,
    };
    let state: SupervisedRuntimeSnapshot = {
      ...emptySupervisedRuntimeSnapshot(now),
      rooms: [room],
      taskNodes: [taskNode],
      workClaims: [workClaim],
    };
    const authorityView = () => ({
      rootLeases: governance.rootLeases,
      leadSeat: governance.agentSeats.find((seat) => seat.id === "lead-1"),
      leadReceipt: governance.authorityReceipts.find((receipt) => receipt.id === leadReceipt.id),
      taskNode: state.taskNodes.find((candidate) => candidate.id === taskNode.id),
      workClaim: state.workClaims.find((candidate) => candidate.id === workClaim.id),
    });
    const authorityBefore = structuredClone(authorityView());
    let commandSequence = 0;
    let eventSequence = 0;
    const upsertPatch = async (
      patch: HarnessPatch,
      actor: SupervisedActor,
      authorityReceiptId?: string,
    ) => {
      const current = state.harnessPatches.find((candidate) => candidate.id === patch.id);
      commandSequence += 1;
      const event = await Effect.runPromise(
        decideSupervisedCommand({
          command: {
            type: "supervised.patch.upsert",
            commandId: `command-patch-${commandSequence}`,
            aggregateId: patch.id,
            expectedRevision: current?.revision ?? 0,
            idempotencyKey: `patch-${commandSequence}`,
            actor,
            ...(authorityReceiptId ? { authorityReceiptId: authorityReceiptId as never } : {}),
            patch,
            createdAt: patch.updatedAt,
          },
          state,
          governance,
        }),
      );
      eventSequence += 1;
      state = projectSupervisedEvent(state, {
        ...event,
        sequence: eventSequence,
      } as SupervisedDomainEvent);
    };

    const supervisor: SupervisedActor = {
      kind: "seat",
      actorId: supervisorSeatId,
      seatId: supervisorSeatId as never,
    };
    const daemon: SupervisedActor = {
      kind: "daemon",
      actorId: "supervised-runtime",
    };
    const owner: SupervisedActor = { kind: "user", actorId: "owner" };
    const proposed = createHarnessPatchProposal({
      id: "patch-supervisor-canary" as never,
      name: "Preserve review evidence",
      patchType: "evaluation",
      scope: { kind: "room", roomId: room.id },
      content: "Require durable review evidence without changing canonical ownership.",
      observationEvidenceRefs: ["evidence-supervisor-friction" as never],
      createdBy: supervisor,
      createdAt: now,
    });
    await upsertPatch(proposed, supervisor, supervisorGovernance.authorityReceipts[0]!.id);

    const sandboxed: HarnessPatch = {
      ...proposed,
      status: "sandboxed",
      revision: proposed.revision + 1,
      updatedAt: "2026-08-07T00:01:00.000Z",
    };
    await upsertPatch(sandboxed, daemon);
    const evaluated = applyHarnessPatchSandboxEvaluation(sandboxed, {
      passed: true,
      basePolicyHash: hash,
      evidenceRefs: ["evidence-sandbox-passed" as never],
      regressions: [],
      evaluatedBy: daemon,
      evaluatedAt: "2026-08-07T00:02:00.000Z",
      eventId: "event-sandbox-passed" as never,
      controlPlaneSequence: 1,
    });
    await upsertPatch(evaluated, daemon);
    const awaitingApproval = awaitHarnessPatchApproval(
      evaluated,
      daemon,
      "2026-08-07T00:03:00.000Z",
    );
    await upsertPatch(awaitingApproval, daemon);
    assert.throws(
      () => startHarnessPatchCanary(awaitingApproval, supervisor, "2026-08-07T00:04:00.000Z", 1),
      /Only the Human may approve/,
    );
    const canary = startHarnessPatchCanary(awaitingApproval, owner, "2026-08-07T00:04:00.000Z", 1);
    await upsertPatch(canary, owner);
    const rolledBack = recordHarnessPatchCanaryEvaluation(canary, {
      passed: false,
      basePolicyHash: hash,
      evidenceRefs: ["evidence-canary-regression" as never],
      regressions: ["Review evidence regressed"],
      evaluatedBy: daemon,
      evaluatedAt: "2026-08-07T00:05:00.000Z",
      eventId: "event-canary-regression" as never,
      controlPlaneSequence: 2,
    });
    await upsertPatch(rolledBack, daemon);

    const retained = state.harnessPatches.find((patch) => patch.id === proposed.id)!;
    assert.equal(retained.createdBy.kind, "seat");
    assert.deepEqual(retained.observationEvidenceRefs, ["evidence-supervisor-friction"]);
    assert.equal(retained.status, "rolled_back");
    assert.equal(retained.rollback?.rolledBackBy.kind, "daemon");
    assert.equal(retained.basePolicyHash, SUPERVISED_BASE_POLICY_HASH);
    assert.deepEqual(supervisorGovernance.authorityReceipts[0]!.rootLeaseIds, []);
    assert.deepEqual(structuredClone(authorityView()), authorityBefore);
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
      authorityReceiptId: `receipt-${run.ownerSeatId}`,
      aggregateId: claim.id,
      expectedRevision: 0,
      claim,
    } as SupervisedCommand;
    const state = { ...emptySupervisedRuntimeSnapshot(now), rooms: [room], runs: [run] };
    const governance = governanceForSeat(run.ownerSeatId, ["supervised.claim.acquire"]);
    const accepted = await Effect.runPromise(
      decideSupervisedCommand({ command, state, governance }),
    );
    assert.equal(accepted.type, "supervised.claim-acquired");

    const revoked = await Effect.runPromiseExit(
      decideSupervisedCommand({
        command,
        state,
        governance: {
          ...governance,
          authorityReceipts: governance.authorityReceipts.map((receipt) => ({
            ...receipt,
            revokedAt: now,
          })),
        },
      }),
    );
    assert.equal(revoked._tag, "Failure");
    const outOfScope = await Effect.runPromiseExit(
      decideSupervisedCommand({
        command,
        state,
        governance: {
          ...governance,
          authorityReceipts: governance.authorityReceipts.map((receipt) => ({
            ...receipt,
            roomScopes: [],
          })),
        },
      }),
    );
    assert.equal(outOfScope._tag, "Failure");

    const denied = await Effect.runPromiseExit(
      decideSupervisedCommand({
        command: { ...command, aggregateId: "claim-2", claim: { ...claim, id: "claim-2" } },
        state: { ...state, workClaims: [claim] },
        governance,
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
      authorityReceiptId: "receipt-lead-architecture",
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
        governance: governanceForSeat("lead-architecture", ["supervised.intervention.propose"]),
      }),
    );
    assert.equal(accepted.type, "supervised.intervention-proposed");
    assert.equal(accepted.payload.leadNotification?.leadSeatId, room.leadSeatId);
    assert.equal(accepted.payload.reconciliation?.status, "open");
  });

  it("publishes Peer evidence, notifies the Lead, and preserves ownership", async () => {
    const supervisorGovernance = governanceForSeat("supervisor-thread-1", [
      "supervised.work.assign",
    ]);
    const peerGovernance = governanceForSeat("peer-thread-1", ["supervised.work.complete"]);
    const leadGovernance = governanceForSeat("lead-1", []);
    const governance = {
      ...supervisorGovernance,
      authorityReceipts: [
        ...supervisorGovernance.authorityReceipts,
        ...peerGovernance.authorityReceipts,
        ...leadGovernance.authorityReceipts,
      ],
      agentSeats: [
        ...supervisorGovernance.agentSeats,
        ...peerGovernance.agentSeats,
        ...leadGovernance.agentSeats.map((seat) => ({
          ...seat,
          threadId: "lead-thread-1" as never,
        })),
      ],
    };
    const requester = {
      kind: "seat" as const,
      actorId: "supervisor-thread-1",
      seatId: "supervisor-thread-1",
    };
    const intervention = {
      id: "intervention-peer-work-1",
      roomId: room.id,
      requestedBy: requester,
      specialistThreadId: "peer-thread-1",
      reason: "Locate the Supervisor protocol file without editing it.",
      material: false,
      evidenceRefs: [],
      status: "open" as const,
      createdAt: now,
      updatedAt: now,
      revision: 0,
    };
    const leadNotification = {
      id: "notification-peer-work-1",
      interventionId: intervention.id,
      roomId: room.id,
      leadSeatId: room.leadSeatId,
      status: "queued" as const,
      createdAt: now,
      deliveredAt: null,
      acknowledgedAt: null,
    };
    const reconciliation = {
      id: "reconciliation-peer-work-1",
      interventionId: intervention.id,
      roomId: room.id,
      leadSeatId: room.leadSeatId!,
      status: "open" as const,
      taskNodeRevisionId: null,
      reason: null,
      createdAt: now,
      resolvedAt: null,
      revision: 0,
    };
    const assigned = await Effect.runPromise(
      decideSupervisedCommand({
        command: {
          ...baseCommand,
          type: "supervised.work.assign",
          commandId: "command-peer-work-assign",
          aggregateId: intervention.id,
          actor: requester,
          authorityReceiptId: "receipt-supervisor-thread-1" as never,
          expectedRevision: 0,
          idempotencyKey: "peer-work-assign",
          roomId: room.id,
          projectId: room.projectId,
          leadSeatId: room.leadSeatId!,
          leadThreadId: "lead-thread-1" as never,
          peerThreadId: "peer-thread-1" as never,
          intervention,
          leadNotification,
          reconciliation,
        },
        state: { ...emptySupervisedRuntimeSnapshot(now), rooms: [room] },
        governance,
      }),
    );
    assert.equal(assigned.type, "supervised.intervention-proposed");

    const completionState = {
      ...emptySupervisedRuntimeSnapshot(now),
      rooms: [room],
      interventions: [assigned.payload.intervention!],
      leadNotifications: [assigned.payload.leadNotification!],
      reconciliations: [assigned.payload.reconciliation!],
    };
    const completed = await Effect.runPromise(
      decideSupervisedCommand({
        command: {
          ...baseCommand,
          type: "supervised.work.complete",
          commandId: "command-peer-work-complete",
          aggregateId: intervention.id,
          actor: {
            kind: "seat",
            actorId: "peer-thread-1",
            seatId: "peer-thread-1",
          },
          authorityReceiptId: "receipt-peer-thread-1" as never,
          expectedRevision: 0,
          idempotencyKey: "peer-work-complete",
          roomId: room.id,
          interventionId: intervention.id as never,
          evidence: {
            id: "evidence-peer-work-1" as never,
            scope: { kind: "room", roomId: room.id },
            kind: "observation",
            summary: "The protocol is apps/server/src/orchestration/supervised/protocolV1.ts.",
            blob: null,
            sourceEventIds: [],
            modelSessionId: null,
            createdBy: {
              kind: "seat",
              actorId: "peer-thread-1",
              seatId: "peer-thread-1",
            },
            createdAt: now,
          },
        },
        state: completionState,
        governance,
      }),
    );
    assert.equal(completed.type, "supervised.evidence-published");
    assert.equal(completed.payload.intervention?.status, "reconciled");
    assert.equal(completed.payload.leadNotification?.status, "delivered");
    assert.equal(completed.payload.reconciliation?.status, "accepted");
    assert.equal(completionState.workClaims.length, 0);
  });

  it("keeps material Peer evidence open until the current Root Lead reconciles it", async () => {
    const peerGovernance = governanceForSeat("peer-material-1", ["supervised.work.complete"]);
    const leadGovernance = governanceForSeat("lead-1", ["supervised.intervention.reconcile"]);
    const governance = {
      ...leadGovernance,
      authorityReceipts: [...leadGovernance.authorityReceipts, ...peerGovernance.authorityReceipts],
      agentSeats: [...leadGovernance.agentSeats, ...peerGovernance.agentSeats],
    };
    const intervention = {
      id: "intervention-material-1",
      roomId: room.id,
      requestedBy: {
        kind: "seat" as const,
        actorId: "supervisor-material-1",
        seatId: "supervisor-material-1",
      },
      specialistThreadId: "peer-material-1",
      reason: "Investigate a potentially material boundary.",
      material: true,
      evidenceRefs: [],
      status: "open" as const,
      createdAt: now,
      updatedAt: now,
      revision: 0,
    };
    const notification = {
      id: "notification-material-1",
      interventionId: intervention.id,
      roomId: room.id,
      leadSeatId: room.leadSeatId,
      status: "queued" as const,
      createdAt: now,
      deliveredAt: null,
      acknowledgedAt: null,
    };
    const reconciliation = {
      id: "reconciliation-material-1",
      interventionId: intervention.id,
      roomId: room.id,
      leadSeatId: room.leadSeatId!,
      status: "open" as const,
      taskNodeRevisionId: null,
      reason: null,
      createdAt: now,
      resolvedAt: null,
      revision: 0,
    };
    const state = {
      ...emptySupervisedRuntimeSnapshot(now),
      rooms: [room],
      interventions: [intervention],
      leadNotifications: [notification],
      reconciliations: [reconciliation],
    };
    const completed = await Effect.runPromise(
      decideSupervisedCommand({
        command: {
          ...baseCommand,
          type: "supervised.work.complete",
          commandId: "command-material-complete",
          aggregateId: intervention.id,
          actor: { kind: "seat", actorId: "peer-material-1", seatId: "peer-material-1" },
          authorityReceiptId: "receipt-peer-material-1" as never,
          expectedRevision: 0,
          idempotencyKey: "material-complete",
          roomId: room.id,
          interventionId: intervention.id as never,
          evidence: {
            id: "evidence-material-1" as never,
            scope: { kind: "room", roomId: room.id },
            kind: "observation",
            summary: "Material evidence requires Root review.",
            blob: null,
            sourceEventIds: [],
            modelSessionId: null,
            createdBy: {
              kind: "seat",
              actorId: "peer-material-1",
              seatId: "peer-material-1",
            },
            createdAt: now,
          },
        },
        state,
        governance,
      }),
    );
    assert.equal(completed.payload.intervention?.status, "open");
    assert.equal(completed.payload.leadNotification?.status, "delivered");
    assert.equal(completed.payload.reconciliation?.status, "open");

    const reconciled = await Effect.runPromise(
      decideSupervisedCommand({
        command: {
          ...baseCommand,
          type: "supervised.intervention.reconcile",
          commandId: "command-material-reconcile",
          aggregateId: intervention.id,
          actor: { kind: "seat", actorId: "lead-1", seatId: "lead-1" },
          authorityReceiptId: "receipt-lead-1" as never,
          expectedRevision: 1,
          idempotencyKey: "material-reconcile",
          reconciliation: {
            ...reconciliation,
            status: "accepted",
            reason: "Root reviewed the material evidence.",
          },
        },
        state: {
          ...state,
          evidence: [completed.payload.evidence!],
          interventions: [completed.payload.intervention!],
          leadNotifications: [completed.payload.leadNotification!],
          reconciliations: [completed.payload.reconciliation!],
        },
        governance,
      }),
    );
    assert.equal(reconciled.payload.intervention?.status, "reconciled");
    assert.equal(reconciled.payload.leadNotification?.status, "acknowledged");
    assert.equal(reconciled.payload.reconciliation?.status, "accepted");
  });

  it("limits daemon Run transitions to RLM-owned Runs and advances the episode revision", async () => {
    const task = {
      id: "task-rlm",
      roomId: room.id,
      title: "RLM task",
      intent: "Synthesize evidence",
      acceptanceCriteria: [],
      lifecycle: "active",
      activeGraphRevision: room.graphRevision,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    } as const;
    const run = {
      id: "run-rlm",
      roomId: room.id,
      taskId: task.id,
      taskNodeId: null,
      taskNodeRevisionId: null,
      ownerSeatId: room.leadSeatId,
      policyId: "policy-rlm",
      status: "running",
      attempt: 1,
      daemonEpoch: 1,
      startedAt: now,
      lastProgressAt: now,
      finishedAt: null,
      revision: 3,
      createdAt: now,
      updatedAt: now,
    } as const;
    const episode = {
      id: "episode-rlm",
      runId: run.id,
      admission: {
        episodeId: "episode-rlm",
        requestedMode: "recursive",
        selectedMode: "recursive",
        estimatedContextPercent: 10,
        estimatedInputTokens: 100,
        independentEvidenceBranches: 2,
        reasons: ["test"],
        admittedByPolicyId: run.policyId,
        createdAt: now,
      },
      status: "branches_running",
      rootModelSessionId: "session-rlm-root",
      branchModelSessionIds: ["session-rlm-a", "session-rlm-b"],
      branchCount: 2,
      completedBranchCount: 0,
      staleBranchCount: 0,
      coveragePercent: 0,
      contradictionCount: 0,
      evidenceRefs: [],
      failureSummaries: [],
      revision: 4,
      createdAt: now,
      updatedAt: now,
    } as never;
    const state = {
      ...emptySupervisedRuntimeSnapshot(now),
      rooms: [room],
      tasks: [task],
      runs: [run],
      runPolicies: [{ id: run.policyId, maxFanOut: 4 } as never],
      rlmEpisodes: [episode],
    };
    const transition = {
      ...baseCommand,
      type: "supervised.run.transition",
      actor: { kind: "daemon", actorId: "daemon-stage-5" },
      aggregateId: run.id,
      expectedRevision: run.revision,
      runId: run.id,
      status: "reviewing",
      reason: "RLM synthesis completed.",
    } as SupervisedCommand;

    const accepted = await Effect.runPromise(
      decideSupervisedCommand({ command: transition, state }),
    );
    assert.equal(accepted.type, "supervised.run-transitioned");

    const unrelated = await Effect.runPromiseExit(
      decideSupervisedCommand({
        command: transition,
        state: { ...state, rlmEpisodes: [] },
      }),
    );
    assert.equal(unrelated._tag, "Failure");

    const episodeEvent = await Effect.runPromise(
      decideSupervisedCommand({
        command: {
          ...baseCommand,
          type: "supervised.rlm.upsert",
          actor: { kind: "daemon", actorId: "daemon-stage-5" },
          aggregateId: episode.id,
          expectedRevision: 4,
          episode: { ...episode, status: "synthesizing" },
        } as SupervisedCommand,
        state,
      }),
    );
    assert.equal(episodeEvent.payload.acceptedRevision, 5);
    assert.equal(episodeEvent.payload.rlmEpisode?.revision, 5);
  });

  it("keeps retained model-session authority lineage immutable", async () => {
    const run = {
      id: "run-model-lineage",
      roomId: room.id,
      taskId: "task-model-lineage",
      taskNodeId: null,
      taskNodeRevisionId: null,
      ownerSeatId: "lead-1",
      policyId: "policy-model-lineage",
      status: "running",
      attempt: 1,
      daemonEpoch: 1,
      startedAt: now,
      lastProgressAt: now,
      finishedAt: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    } as never;
    const episode = {
      id: "episode-model-lineage",
      runId: run.id,
      rootModelSessionId: "session-model-lineage",
      branchModelSessionIds: ["session-model-a", "session-model-b"],
      branchCount: 2,
    } as never;
    const current = {
      id: "session-model-lineage",
      roomId: room.id,
      runId: run.id,
      taskId: run.taskId,
      taskNodeId: null,
      actorSeatId: "lead-1",
      authorityReceiptId: "receipt-lead-1",
      effectiveRole: "lead",
      rootLeaseIds: ["root-lease-1"],
      rlmEpisodeId: episode.id,
      parentSessionId: null,
      threadId: "thread-model-lineage",
      role: "rlm_root",
      revision: 0,
    } as never;
    const exit = await Effect.runPromise(
      Effect.exit(
        decideSupervisedCommand({
          state: {
            ...emptySupervisedRuntimeSnapshot(now),
            rooms: [room],
            runs: [run],
            rlmEpisodes: [episode],
            modelSessions: [current],
          },
          command: {
            ...baseCommand,
            type: "supervised.model-session.upsert",
            commandId: "command-model-lineage",
            actor: { kind: "daemon", actorId: "supervised-runtime" },
            aggregateId: current.id,
            expectedRevision: current.revision,
            idempotencyKey: "model-lineage-mutation",
            modelSession: {
              ...current,
              authorityReceiptId: "receipt-other",
            },
          } as never,
        }),
      ),
    );

    assert.equal(exit._tag, "Failure");
    if (exit._tag === "Failure") {
      assert.match(String(exit.cause), /authority lineage cannot change/i);
    }
  });

  it("bounds epoch-scoped daemon restart commands to the ordinary Run recovery corridor", async () => {
    const run = {
      id: "run-restart",
      roomId: room.id,
      taskId: "task-restart",
      taskNodeId: null,
      taskNodeRevisionId: null,
      ownerSeatId: "peer-restart",
      policyId: "policy-restart",
      status: "running",
      attempt: 1,
      daemonEpoch: 1,
      startedAt: now,
      lastProgressAt: now,
      finishedAt: null,
      revision: 3,
      createdAt: now,
      updatedAt: now,
    } as const;
    const state = {
      ...emptySupervisedRuntimeSnapshot(now),
      rooms: [room],
      runs: [run],
    };
    const restartCommand = {
      ...baseCommand,
      type: "supervised.run.transition",
      actor: { kind: "daemon", actorId: "daemon-restart" },
      aggregateId: run.id,
      expectedRevision: run.revision,
      runId: run.id,
      status: "interrupted",
      reason: "Daemon restart recovery: running -> interrupted.",
      daemonEpoch: 2,
    } as SupervisedCommand;

    const interrupted = await Effect.runPromise(
      decideSupervisedCommand({ command: restartCommand, state }),
    );
    assert.equal(interrupted.payload.run?.status, "interrupted");
    assert.equal(interrupted.payload.run?.daemonEpoch, 2);

    const userEpoch = await Effect.runPromiseExit(
      decideSupervisedCommand({
        command: {
          ...restartCommand,
          actor: { kind: "user", actorId: "owner" },
        },
        state,
      }),
    );
    assert.equal(userEpoch._tag, "Failure");

    const outsideCorridor = await Effect.runPromiseExit(
      decideSupervisedCommand({
        command: { ...restartCommand, status: "reviewing" },
        state,
      }),
    );
    assert.equal(outsideCorridor._tag, "Failure");
  });

  it("publishes evidence only for an existing durable model session", async () => {
    const evidence = {
      id: "evidence-rlm",
      scope: { kind: "room", roomId: room.id },
      kind: "provider_receipt",
      summary: "Visible provider response.",
      blob: null,
      sourceEventIds: [],
      modelSessionId: "session-rlm",
      createdBy: { kind: "daemon", actorId: "daemon-stage-5" },
      createdAt: now,
    } as never;
    const command = {
      ...baseCommand,
      type: "supervised.evidence.publish",
      actor: { kind: "daemon", actorId: "daemon-stage-5" },
      aggregateId: evidence.id,
      expectedRevision: 0,
      evidence,
    } as SupervisedCommand;
    const emptyState = { ...emptySupervisedRuntimeSnapshot(now), rooms: [room] };

    const missing = await Effect.runPromiseExit(
      decideSupervisedCommand({ command, state: emptyState }),
    );
    assert.equal(missing._tag, "Failure");

    const accepted = await Effect.runPromise(
      decideSupervisedCommand({
        command,
        state: {
          ...emptyState,
          modelSessions: [{ id: evidence.modelSessionId, roomId: room.id } as never],
        },
      }),
    );
    assert.equal(accepted.type, "supervised.evidence-published");
    assert.equal(accepted.payload.evidence?.id, evidence.id);
  });

  it("advances the accepted revision when a retained Peer specialty is updated", async () => {
    const specialty: PeerSpecialty = {
      id: "peer-specialty-review" as PeerSpecialty["id"],
      profilePresetId: "profile-peer-reviewer" as PeerSpecialty["profilePresetId"],
      concern: "review",
      status: "retained",
      allowedScopes: [{ kind: "room", roomId: room.id }],
      latestSnapshotId: null,
      expiresAt: "2027-08-09T00:00:00.000Z",
      revision: 3,
      createdAt: now,
      updatedAt: now,
    };
    const event = await Effect.runPromise(
      decideSupervisedCommand({
        command: {
          ...baseCommand,
          type: "supervised.peer.upsert",
          actor: { kind: "user", actorId: "owner" },
          aggregateId: specialty.id,
          expectedRevision: specialty.revision,
          peerSpecialty: specialty,
        },
        state: {
          ...emptySupervisedRuntimeSnapshot(now),
          peerSpecialties: [specialty],
        },
      }),
    );

    assert.equal(event.type, "supervised.peer-upserted");
    assert.equal(event.payload.acceptedRevision, specialty.revision + 1);
    assert.equal(event.payload.peerSpecialty?.revision, specialty.revision + 1);
  });
});
