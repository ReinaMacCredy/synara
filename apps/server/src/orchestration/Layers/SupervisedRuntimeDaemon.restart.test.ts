import assert from "node:assert/strict";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  SupervisedCommand,
  SupervisedGovernanceSnapshot,
  emptySupervisedGovernanceSnapshot,
  type OrchestrationCommand,
} from "@veylen/contracts";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe, it } from "vitest";

import { ServerConfig } from "../../config.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { SupervisedGovernanceRepository } from "../../persistence/Services/SupervisedGovernanceRepository.ts";
import { SupervisedRuntimeRepository } from "../../persistence/Services/SupervisedRuntimeRepository.ts";
import { builtInRunPolicy } from "../../supervised/signal/BuiltInSubscriptions.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { SupervisedRuntimeDaemon } from "../Services/SupervisedRuntimeDaemon.ts";
import { OrchestrationLayerLive } from "../runtimeLayer.ts";

const now = "2026-08-10T00:00:00.000Z";

const serverConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "veylen-scenario-f-restart-test-",
});

async function createSystem() {
  const layer = OrchestrationLayerLive.pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(serverConfigLayer),
    Layer.provideMerge(NodeServices.layer),
  );
  const runtime = ManagedRuntime.make(layer);
  return {
    run: runtime.runPromise,
    dispose: () => runtime.dispose(),
  };
}

const command = (value: unknown): OrchestrationCommand =>
  Schema.decodeUnknownSync(SupervisedCommand)(value);

const commandBase = (id: string, aggregateId: string, expectedRevision: number) => ({
  commandId: CommandId.makeUnsafe(`command:scenario-f:${id}`),
  actor: { kind: "user" as const, actorId: "owner:scenario-f" },
  aggregateId,
  expectedRevision,
  idempotencyKey: `scenario-f:${id}`,
  createdAt: now,
});

const authorityReceipt = (input: {
  readonly id: string;
  readonly seatId: string;
  readonly identityRole: "lead" | "supervisor" | "peer";
  readonly effectiveRole: "lead" | "supervisor" | "peer" | "acting_root";
  readonly rootLeaseIds?: ReadonlyArray<string>;
}) => ({
  id: input.id,
  actorSeatId: input.seatId,
  identityRole: input.identityRole,
  effectiveRole: input.effectiveRole,
  workspaceScopes: ["workspace:scenario-f"],
  roomScopes: ["room:scenario-f"],
  taskNodeScopes: [],
  allowedCommands: [],
  allowedTools: [],
  rootLeaseIds: input.rootLeaseIds ?? [],
  mandateIds: [],
  runPolicyRevision: 0,
  issuedAt: now,
  expiresAt: null,
  revokedAt: null,
});

const seat = (input: {
  readonly id: string;
  readonly identityRole: "lead" | "supervisor" | "peer";
  readonly effectiveRole: "lead" | "supervisor" | "peer" | "acting_root";
  readonly authorityReceiptId: string;
}) => ({
  id: input.id,
  workspaceId: "workspace:scenario-f",
  roomIds: ["room:scenario-f"],
  identityRole: input.identityRole,
  effectiveRole: input.effectiveRole,
  profileId: `profile:${input.id}`,
  providerSessionId: null,
  lifecycleState: "active",
  workState: "idle",
  authorityReceiptId: input.authorityReceiptId,
  threadId: `thread:${input.id}`,
  projectId: "project:scenario-f",
  profileSnapshotId: null,
  predecessorThreadIds: [],
  displayName: input.id,
  createdAt: now,
  retainedAt: null,
  retiredAt: null,
  revision: 0,
  updatedAt: now,
});

function interruptedGovernanceSnapshot() {
  const rootReceipt = authorityReceipt({
    id: "receipt:supervisor-root",
    seatId: "seat:supervisor-root",
    identityRole: "supervisor",
    effectiveRole: "acting_root",
    rootLeaseIds: ["lease:supervisor-root"],
  });
  const observerReceipt = authorityReceipt({
    id: "receipt:supervisor-observer",
    seatId: "seat:supervisor-observer",
    identityRole: "supervisor",
    effectiveRole: "supervisor",
  });
  const previousLeadReceipt = authorityReceipt({
    id: "receipt:lead-previous",
    seatId: "seat:lead-previous",
    identityRole: "lead",
    effectiveRole: "lead",
  });
  const peerReceipt = authorityReceipt({
    id: "receipt:peer-worker",
    seatId: "seat:peer-worker",
    identityRole: "peer",
    effectiveRole: "peer",
  });
  return Schema.decodeUnknownSync(SupervisedGovernanceSnapshot)({
    ...emptySupervisedGovernanceSnapshot(now),
    workspaces: [
      {
        id: "workspace:scenario-f",
        ownerNamespace: "owner:scenario-f",
        title: "Scenario F",
        lifecycleState: "active",
        revision: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
    agentSeats: [
      seat({
        id: "seat:supervisor-root",
        identityRole: "supervisor",
        effectiveRole: "acting_root",
        authorityReceiptId: rootReceipt.id,
      }),
      seat({
        id: "seat:supervisor-observer",
        identityRole: "supervisor",
        effectiveRole: "supervisor",
        authorityReceiptId: observerReceipt.id,
      }),
      seat({
        id: "seat:lead-previous",
        identityRole: "lead",
        effectiveRole: "lead",
        authorityReceiptId: previousLeadReceipt.id,
      }),
      seat({
        id: "seat:peer-worker",
        identityRole: "peer",
        effectiveRole: "peer",
        authorityReceiptId: peerReceipt.id,
      }),
    ],
    authorityReceipts: [rootReceipt, observerReceipt, previousLeadReceipt, peerReceipt],
    rootLeases: [
      {
        id: "lease:lead-previous",
        workspaceId: "workspace:scenario-f",
        roomId: "room:scenario-f",
        holderSeatId: "seat:lead-previous",
        status: "released",
        acquiredUnderReceiptId: previousLeadReceipt.id,
        predecessorLeaseId: null,
        acquiredAt: now,
        releasedAt: now,
        expiresAt: null,
        revision: 1,
        updatedAt: now,
      },
      {
        id: "lease:supervisor-root",
        workspaceId: "workspace:scenario-f",
        roomId: "room:scenario-f",
        holderSeatId: "seat:supervisor-root",
        status: "active",
        acquiredUnderReceiptId: rootReceipt.id,
        predecessorLeaseId: "lease:lead-previous",
        acquiredAt: now,
        releasedAt: null,
        expiresAt: null,
        revision: 0,
        updatedAt: now,
      },
    ],
    handoffs: [
      {
        id: "handoff:root-assumption",
        workspaceId: "workspace:scenario-f",
        roomId: "room:scenario-f",
        fromSeatId: "seat:lead-previous",
        toSeatId: "seat:supervisor-root",
        lifecycleState: "ownership_transferred",
        scope: [{ kind: "room", roomId: "room:scenario-f" }],
        summary: "Root authority transferred before the daemon restart.",
        evidenceRefs: [],
        preparedAt: now,
        acceptedAt: now,
        transferredAt: now,
        reconciledAt: null,
        revision: 5,
        updatedAt: now,
      },
    ],
    roleAssumptions: [
      {
        id: "role-assumption:root",
        workspaceId: "workspace:scenario-f",
        roomId: "room:scenario-f",
        actorSeatId: "seat:supervisor-root",
        previousRootSeatId: "seat:lead-previous",
        handoffId: "handoff:root-assumption",
        previousLeaseId: "lease:lead-previous",
        nextLeaseId: "lease:supervisor-root",
        operation: "assume",
        lifecycleState: "lease_transferred",
        requestedUnderReceiptId: rootReceipt.id,
        failureReason: null,
        createdAt: now,
        completedAt: null,
        revision: 4,
        updatedAt: now,
      },
    ],
    directInterventions: [
      {
        id: "intervention:observer",
        workspaceId: "workspace:scenario-f",
        roomId: "room:scenario-f",
        supervisorSeatId: "seat:supervisor-observer",
        targetPeerSeatId: "seat:peer-worker",
        rootHolderSeatId: "seat:supervisor-root",
        taskNodeId: null,
        workRequest: "Observe the running work without changing authority.",
        material: true,
        lifecycleState: "executing",
        evidenceRefs: [],
        openedUnderReceiptId: observerReceipt.id,
        openedAt: now,
        leadNotifiedAt: null,
        reconciledAt: null,
        closedAt: null,
        revision: 3,
        updatedAt: now,
      },
    ],
  });
}

function preTransferGovernanceSnapshot() {
  const leadReceipt = authorityReceipt({
    id: "receipt:lead-pre-transfer",
    seatId: "seat:lead-pre-transfer",
    identityRole: "lead",
    effectiveRole: "lead",
    rootLeaseIds: ["lease:lead-pre-transfer"],
  });
  const supervisorReceipt = authorityReceipt({
    id: "receipt:supervisor-pre-transfer",
    seatId: "seat:supervisor-pre-transfer",
    identityRole: "supervisor",
    effectiveRole: "supervisor",
  });
  return Schema.decodeUnknownSync(SupervisedGovernanceSnapshot)({
    ...emptySupervisedGovernanceSnapshot(now),
    workspaces: [
      {
        id: "workspace:scenario-f",
        ownerNamespace: "owner:scenario-f",
        title: "Scenario F pre-transfer",
        lifecycleState: "active",
        revision: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
    agentSeats: [
      seat({
        id: "seat:lead-pre-transfer",
        identityRole: "lead",
        effectiveRole: "lead",
        authorityReceiptId: leadReceipt.id,
      }),
      seat({
        id: "seat:supervisor-pre-transfer",
        identityRole: "supervisor",
        effectiveRole: "supervisor",
        authorityReceiptId: supervisorReceipt.id,
      }),
    ],
    authorityReceipts: [leadReceipt, supervisorReceipt],
    rootLeases: [
      {
        id: "lease:lead-pre-transfer",
        workspaceId: "workspace:scenario-f",
        roomId: "room:scenario-f",
        holderSeatId: "seat:lead-pre-transfer",
        status: "active",
        acquiredUnderReceiptId: leadReceipt.id,
        predecessorLeaseId: null,
        acquiredAt: now,
        releasedAt: null,
        expiresAt: null,
        revision: 0,
        updatedAt: now,
      },
    ],
    handoffs: [
      {
        id: "handoff:pre-transfer",
        workspaceId: "workspace:scenario-f",
        roomId: "room:scenario-f",
        fromSeatId: "seat:lead-pre-transfer",
        toSeatId: "seat:supervisor-pre-transfer",
        lifecycleState: "delivered",
        scope: [{ kind: "room", roomId: "room:scenario-f" }],
        summary: "Supervisor requested takeover but the Root transfer did not commit.",
        evidenceRefs: [],
        preparedAt: now,
        acceptedAt: null,
        transferredAt: null,
        reconciledAt: null,
        revision: 2,
        updatedAt: now,
      },
    ],
    roleAssumptions: [
      {
        id: "role-assumption:pre-transfer",
        workspaceId: "workspace:scenario-f",
        roomId: "room:scenario-f",
        actorSeatId: "seat:supervisor-pre-transfer",
        previousRootSeatId: "seat:lead-pre-transfer",
        handoffId: "handoff:pre-transfer",
        previousLeaseId: "lease:lead-pre-transfer",
        nextLeaseId: "lease:supervisor-pre-transfer",
        operation: "assume",
        lifecycleState: "previous_root_notified",
        requestedUnderReceiptId: supervisorReceipt.id,
        failureReason: null,
        createdAt: now,
        completedAt: null,
        revision: 3,
        updatedAt: now,
      },
    ],
  });
}

describe("Scenario F daemon restart", () => {
  it("fails a pre-transfer Supervisor assumption closed and preserves the Lead Root", async () => {
    const system = await createSystem();
    try {
      await system.run(
        Effect.gen(function* () {
          const engine = yield* OrchestrationEngineService;
          const daemon = yield* SupervisedRuntimeDaemon;
          const governance = yield* SupervisedGovernanceRepository;
          const repository = yield* SupervisedRuntimeRepository;
          const sql = yield* SqlClient.SqlClient;

          yield* sql`
            INSERT INTO projection_projects (
              project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
            ) VALUES (
              'project:scenario-f', 'project', 'Scenario F', '/tmp/scenario-f', '[]', ${now}, ${now}
            )
          `;
          yield* engine.dispatch(
            command({
              ...commandBase("pre-transfer-room", "room:scenario-f", 0),
              type: "supervised.room.create",
              room: {
                id: "room:scenario-f",
                projectId: "project:scenario-f",
                title: "Scenario F pre-transfer",
                leadSeatId: "seat:lead-pre-transfer",
                status: "active",
                graphRevision: 0,
                revision: 0,
                createdAt: now,
                updatedAt: now,
              },
            }),
          );
          const current = yield* governance.getSnapshot();
          const before = {
            ...preTransferGovernanceSnapshot(),
            revision: current.revision,
          };
          yield* governance.replaceSnapshot(before);

          const health = yield* daemon.restart;
          const after = yield* governance.getSnapshot();
          const runtimeAfter = yield* repository.getSnapshot({ includeDisabled: true });
          const assumption = after.roleAssumptions.find(
            (candidate) => candidate.id === "role-assumption:pre-transfer",
          );
          const supervisor = after.agentSeats.find(
            (candidate) => candidate.id === "seat:supervisor-pre-transfer",
          );
          const supervisorReceipt = after.authorityReceipts.find(
            (candidate) => candidate.id === supervisor?.authorityReceiptId,
          );

          assert.equal(health.status, "healthy");
          assert.equal(assumption?.lifecycleState, "failed");
          assert.match(assumption?.failureReason ?? "", /previous Root remains active/i);
          assert.equal(
            after.rootLeases.find((lease) => lease.status === "active")?.holderSeatId,
            "seat:lead-pre-transfer",
          );
          assert.equal(supervisor?.effectiveRole, "supervisor");
          assert.deepEqual(supervisorReceipt?.rootLeaseIds, []);
          assert.equal(
            runtimeAfter.rooms.find((room) => room.id === "room:scenario-f")?.leadSeatId,
            "seat:lead-pre-transfer",
          );

          const providerStarts = yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count
            FROM orchestration_events
            WHERE event_type = 'thread.turn-start-requested'
          `;
          assert.equal(providerStarts[0]?.count, 0);

          yield* daemon.restart;
          const replayed = yield* governance.getSnapshot();
          assert.equal(
            replayed.roleAssumptions.find(
              (candidate) => candidate.id === "role-assumption:pre-transfer",
            )?.revision,
            assumption?.revision,
          );
          assert.equal(
            replayed.rootLeases.find((lease) => lease.status === "active")?.holderSeatId,
            "seat:lead-pre-transfer",
          );
        }),
      );
    } finally {
      await system.dispose();
    }
  });

  it("recovers a running Run, fails an active intervention, and resumes Root topology once", async () => {
    const system = await createSystem();
    try {
      await system.run(
        Effect.gen(function* () {
          const engine = yield* OrchestrationEngineService;
          const daemon = yield* SupervisedRuntimeDaemon;
          const repository = yield* SupervisedRuntimeRepository;
          const governance = yield* SupervisedGovernanceRepository;
          const sql = yield* SqlClient.SqlClient;
          const policy = builtInRunPolicy(now);

          yield* sql`
            INSERT INTO projection_projects (
              project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
            ) VALUES (
              'project:scenario-f', 'project', 'Scenario F', '/tmp/scenario-f', '[]', ${now}, ${now}
            )
          `;
          yield* engine.dispatch(
            command({
              ...commandBase("policy", policy.id, 0),
              type: "supervised.run-policy.upsert",
              runPolicy: policy,
            }),
          );
          yield* engine.dispatch(
            command({
              ...commandBase("room", "room:scenario-f", 0),
              type: "supervised.room.create",
              room: {
                id: "room:scenario-f",
                projectId: "project:scenario-f",
                title: "Scenario F",
                leadSeatId: "seat:supervisor-root",
                status: "active",
                graphRevision: 1,
                revision: 0,
                createdAt: now,
                updatedAt: now,
              },
            }),
          );
          yield* engine.dispatch(
            command({
              ...commandBase("task", "task:scenario-f", 0),
              type: "supervised.task.create",
              task: {
                id: "task:scenario-f",
                roomId: "room:scenario-f",
                title: "Restart recovery",
                intent: "Resume ordinary work after daemon restart.",
                acceptanceCriteria: ["No duplicate side effects."],
                lifecycle: "active",
                activeGraphRevision: 1,
                revision: 0,
                createdAt: now,
                updatedAt: now,
              },
            }),
          );
          yield* engine.dispatch(
            command({
              ...commandBase("run", "run:scenario-f", 0),
              type: "supervised.run.request",
              run: {
                id: "run:scenario-f",
                roomId: "room:scenario-f",
                taskId: "task:scenario-f",
                taskNodeId: null,
                taskNodeRevisionId: null,
                ownerSeatId: "seat:peer-worker",
                policyId: policy.id,
                status: "queued",
                attempt: 1,
                daemonEpoch: 1,
                startedAt: null,
                lastProgressAt: null,
                finishedAt: null,
                revision: 0,
                createdAt: now,
                updatedAt: now,
              },
            }),
          );
          for (const [index, status] of ["admitted", "starting", "running"].entries()) {
            yield* engine.dispatch(
              command({
                ...commandBase(`run-${status}`, "run:scenario-f", index),
                type: "supervised.run.transition",
                runId: "run:scenario-f",
                status,
                reason: "Prepare the ordinary running Run fixture.",
              }),
            );
          }
          const governanceBeforeCrash = yield* governance.getSnapshot();
          yield* governance.replaceSnapshot({
            ...interruptedGovernanceSnapshot(),
            revision: governanceBeforeCrash.revision,
          });

          yield* sql`CREATE TABLE scenario_f_health_trace (sequence INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT NOT NULL)`;
          yield* sql`
            CREATE TRIGGER scenario_f_health_trace_update
            AFTER UPDATE OF status ON supervised_runtime_state
            BEGIN
              INSERT INTO scenario_f_health_trace (status) VALUES (NEW.status);
            END
          `;
          yield* sql`CREATE TABLE scenario_f_governance_trace (sequence INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, lifecycle_state TEXT NOT NULL)`;
          yield* sql`
            CREATE TRIGGER scenario_f_role_trace_insert
            AFTER INSERT ON projection_supervised_role_assumptions
            BEGIN
              INSERT INTO scenario_f_governance_trace (kind, lifecycle_state)
              VALUES ('role_assumption', NEW.lifecycle_state);
            END
          `;
          yield* sql`
            CREATE TRIGGER scenario_f_intervention_trace_insert
            AFTER INSERT ON projection_supervised_direct_interventions
            BEGIN
              INSERT INTO scenario_f_governance_trace (kind, lifecycle_state)
              VALUES ('intervention', NEW.lifecycle_state);
            END
          `;

          const restarted = yield* daemon.restart;
          const runtimeAfter = yield* repository.getSnapshot({ includeDisabled: true });
          const governanceAfter = yield* governance.getSnapshot();
          const recoveredRun = runtimeAfter.runs.find((run) => run.id === "run:scenario-f");
          const observer = governanceAfter.agentSeats.find(
            (candidate) => candidate.id === "seat:supervisor-observer",
          );
          const observerReceipt = governanceAfter.authorityReceipts.find(
            (candidate) => candidate.id === observer?.authorityReceiptId,
          );

          assert.equal(restarted.status, "healthy");
          assert.equal(restarted.daemonEpoch, 2);
          assert.equal(recoveredRun?.status, "running");
          assert.equal(recoveredRun?.daemonEpoch, 2);
          assert.equal(recoveredRun?.revision, 6);
          assert.equal(governanceAfter.directInterventions[0]?.lifecycleState, "failed");
          assert.equal(governanceAfter.roleAssumptions[0]?.lifecycleState, "topology_reconciled");
          assert.equal(
            governanceAfter.rootLeases.find((lease) => lease.status === "active")?.holderSeatId,
            "seat:supervisor-root",
          );
          assert.equal(observer?.effectiveRole, "supervisor");
          assert.deepEqual(observerReceipt?.rootLeaseIds, []);
          assert.equal(
            runtimeAfter.rooms.find((room) => room.id === "room:scenario-f")?.leadSeatId,
            "seat:supervisor-root",
          );

          const healthTrace = yield* sql<{ readonly status: string }>`
            SELECT status FROM scenario_f_health_trace ORDER BY sequence
          `;
          assert.equal(healthTrace[0]?.status, "degraded");
          assert.ok(healthTrace.some((entry) => entry.status === "recovering"));
          assert.equal(healthTrace.at(-1)?.status, "healthy");
          const governanceTrace = yield* sql<{
            readonly kind: string;
            readonly lifecycleState: string;
          }>`
            SELECT kind, lifecycle_state AS "lifecycleState"
            FROM scenario_f_governance_trace
            ORDER BY sequence
          `;
          assert.ok(
            governanceTrace.some(
              (entry) =>
                entry.kind === "role_assumption" && entry.lifecycleState === "topology_reconciled",
            ),
          );
          assert.ok(
            governanceTrace.some(
              (entry) => entry.kind === "intervention" && entry.lifecycleState === "failed",
            ),
          );

          const recoveryEventsBefore = yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count
            FROM orchestration_events
            WHERE stream_id = 'run:scenario-f'
              AND command_id LIKE 'command:run-restart-recovery:%'
          `;
          const providerStartsBefore = yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count
            FROM orchestration_events
            WHERE event_type = 'thread.turn-start-requested'
          `;
          assert.equal(recoveryEventsBefore[0]?.count, 3);
          assert.equal(providerStartsBefore[0]?.count, 0);

          const persistedRecoveryCommands = yield* sql<{
            readonly commandId: string;
            readonly occurredAt: string;
          }>`
            SELECT command_id AS "commandId", occurred_at AS "occurredAt"
            FROM orchestration_events
            WHERE stream_id = 'run:scenario-f'
              AND command_id LIKE 'command:run-restart-recovery:%'
            ORDER BY stream_version
          `;
          const recoverySteps = [
            { from: "running", to: "interrupted" },
            { from: "interrupted", to: "recovering" },
            { from: "recovering", to: "running" },
          ] as const;
          assert.equal(persistedRecoveryCommands.length, recoverySteps.length);
          for (const [index, step] of recoverySteps.entries()) {
            const persisted = persistedRecoveryCommands[index]!;
            yield* engine.dispatch(
              command({
                commandId: persisted.commandId,
                actor: {
                  kind: "daemon",
                  actorId: `supervised-daemon:${process.pid}`,
                },
                aggregateId: "run:scenario-f",
                expectedRevision: 3 + index,
                idempotencyKey: `run-restart-recovery:run:scenario-f:${3 + index}:2:${step.to}`,
                type: "supervised.run.transition",
                runId: "run:scenario-f",
                status: step.to,
                reason: `Daemon restart recovery: ${step.from} -> ${step.to}.`,
                daemonEpoch: 2,
                createdAt: persisted.occurredAt,
              }),
            );
          }

          yield* daemon.reconcile;
          yield* daemon.reconcile;

          const recoveryEventsAfter = yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count
            FROM orchestration_events
            WHERE stream_id = 'run:scenario-f'
              AND command_id LIKE 'command:run-restart-recovery:%'
          `;
          const providerStartsAfter = yield* sql<{ readonly count: number }>`
            SELECT COUNT(*) AS count
            FROM orchestration_events
            WHERE event_type = 'thread.turn-start-requested'
          `;
          assert.equal(recoveryEventsAfter[0]?.count, recoveryEventsBefore[0]?.count);
          assert.equal(providerStartsAfter[0]?.count, providerStartsBefore[0]?.count);
          const governanceAfterReplay = yield* governance.getSnapshot();
          assert.equal(
            governanceAfterReplay.roleAssumptions[0]?.revision,
            governanceAfter.roleAssumptions[0]?.revision,
          );
          assert.equal(
            governanceAfterReplay.directInterventions[0]?.revision,
            governanceAfter.directInterventions[0]?.revision,
          );
        }),
      );
    } finally {
      await system.dispose();
    }
  });
});
