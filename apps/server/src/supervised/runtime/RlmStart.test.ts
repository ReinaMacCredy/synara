import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Effect } from "effect";

import {
  emptySupervisedGovernanceSnapshot,
  emptySupervisedRuntimeSnapshot,
  type AgentSeat,
  type EffectiveAuthorityReceipt,
  type OrchestrationCommand,
  type OrchestrationProject,
  type OrchestrationThread,
  type Run,
  type Room,
  type SupervisedGovernanceSnapshot,
  type SupervisedRuntimeSnapshot,
  type Task,
} from "@synara/contracts";

import { builtInRunPolicy } from "../signal/BuiltInSubscriptions.ts";
import { decideSupervisedCommand } from "../../orchestration/supervised/decider.ts";
import { projectSupervisedEvent } from "../../orchestration/supervised/projector.ts";
import { startRlm } from "./RlmStart.ts";

const now = "2026-08-09T00:00:00.000Z";

function supervisorExistingRunFixture() {
  const policy = builtInRunPolicy(now);
  const room = {
    id: "room:supervisor-rlm",
    projectId: "project:supervisor-rlm",
    title: "Supervisor RLM",
    leadSeatId: "seat:lead-root",
    status: "active",
    graphRevision: 1,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  } as Room;
  const task = {
    id: "task:supervisor-rlm",
    roomId: room.id,
    title: "Supervisor-owned bounded investigation",
    intent: "Run an RLM investigation without transferring Room Root authority.",
    acceptanceCriteria: ["Retained branch and synthesis evidence exists."],
    lifecycle: "active",
    activeGraphRevision: room.graphRevision,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  } as Task;
  const run = {
    id: "run:supervisor-owned",
    roomId: room.id,
    taskId: task.id,
    taskNodeId: null,
    taskNodeRevisionId: null,
    ownerSeatId: "seat:supervisor",
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
  } as Run;
  const supervisor = {
    id: run.ownerSeatId,
    workspaceId: "workspace:default",
    roomIds: [room.id],
    identityRole: "supervisor",
    effectiveRole: "supervisor",
    profileId: "profile:supervisor",
    providerSessionId: null,
    lifecycleState: "active",
    workState: "idle",
    authorityReceiptId: "receipt:supervisor",
    threadId: "thread:supervisor",
    projectId: null,
    profileSnapshotId: null,
    predecessorThreadIds: [],
    displayName: "Primary Supervisor",
    createdAt: now,
    retainedAt: null,
    retiredAt: null,
    revision: 0,
    updatedAt: now,
  } as AgentSeat;
  const lead = {
    ...supervisor,
    id: room.leadSeatId,
    identityRole: "lead",
    effectiveRole: "lead",
    profileId: "profile:lead",
    authorityReceiptId: "receipt:lead-root",
    threadId: "thread:lead-root",
    projectId: room.projectId,
    displayName: "Room Lead",
  } as AgentSeat;
  const authorityReceipt = {
    id: supervisor.authorityReceiptId,
    actorSeatId: supervisor.id,
    identityRole: "supervisor",
    effectiveRole: "supervisor",
    workspaceScopes: [supervisor.workspaceId],
    roomScopes: [room.id],
    taskNodeScopes: [],
    allowedCommands: [
      "supervised.run.transition",
      "supervised.context.workspace-upsert",
      "supervised.rlm.upsert",
      "supervised.model-session.upsert",
    ],
    allowedTools: ["supervised.rlm.start"],
    rootLeaseIds: [],
    mandateIds: ["mandate:supervisor-rlm"],
    runPolicyRevision: policy.revision,
    issuedAt: now,
    expiresAt: null,
    revokedAt: null,
  } as EffectiveAuthorityReceipt;
  const runtime = {
    ...emptySupervisedRuntimeSnapshot(now),
    rooms: [room],
    tasks: [task],
    runs: [run],
    runPolicies: [policy],
    contextWorkspaces: [
      {
        id: `context-workspace:${room.id}`,
        projectId: room.projectId,
        roomId: room.id,
        revision: 0,
        highWaterSequence: 0,
        retention: {
          maxAgeMs: 30 * 24 * 60 * 60 * 1_000,
          maxInlineBytes: 64_000,
          compactAfterRecords: 200,
        },
        createdAt: now,
        updatedAt: now,
      },
    ],
  } as SupervisedRuntimeSnapshot;
  const governance = {
    ...emptySupervisedGovernanceSnapshot(now),
    agentSeats: [supervisor, lead],
    authorityReceipts: [authorityReceipt],
    rootLeases: [
      {
        id: "root-lease:lead",
        workspaceId: supervisor.workspaceId,
        roomId: room.id,
        holderSeatId: lead.id,
        previousHolderSeatId: null,
        status: "active",
        acquiredAt: now,
        transferRequestedAt: null,
        transferredAt: null,
        releasedAt: null,
        revision: 0,
        updatedAt: now,
      },
    ],
  } as SupervisedGovernanceSnapshot;
  const callerThread = {
    id: supervisor.threadId,
    projectId: room.projectId,
    modelSelection: {
      provider: "codex",
      model: "gpt-5.6-sol",
      options: { reasoningEffort: "high" },
    },
    runtimeMode: "full-access",
    interactionMode: "default",
  } as OrchestrationThread;
  const project = {
    id: room.projectId,
    title: "Supervisor RLM",
    workspaceRoot: "/tmp/supervisor-rlm",
    deletedAt: null,
  } as OrchestrationProject;
  return { authorityReceipt, callerThread, governance, lead, project, room, run, runtime, supervisor };
}

function projectionHarness(
  initialRuntime: SupervisedRuntimeSnapshot,
  governance: SupervisedGovernanceSnapshot,
) {
  const dispatched: OrchestrationCommand[] = [];
  let projectedRuntime = initialRuntime;
  let sequence = 0;
  const engine = {
    dispatch: (command: OrchestrationCommand) =>
      Effect.gen(function* () {
        dispatched.push(command);
        if (command.type.startsWith("supervised.")) {
          const event = yield* decideSupervisedCommand({
            command: command as never,
            state: projectedRuntime,
            governance,
          });
          sequence += 1;
          projectedRuntime = projectSupervisedEvent(projectedRuntime, { ...event, sequence });
          return { sequence };
        }
        sequence += 1;
        return { sequence };
      }),
  } as never;
  return { dispatched, engine, runtime: () => projectedRuntime };
}

describe("RLM start planning", () => {
  it("dispatches real root and branch threads with durable model-session lineage", async () => {
    const dispatched: OrchestrationCommand[] = [];
    let wakeCount = 0;
    const runtime = {
      ...emptySupervisedRuntimeSnapshot(now),
      rooms: [
        {
          id: "room:stage-5",
          projectId: "project:stage-5",
          title: "Stage 5",
          leadSeatId: "seat:lead",
          status: "active",
          graphRevision: 1,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        } as Room,
      ],
      runPolicies: [builtInRunPolicy(now)],
    };
    const callerThread = {
      id: "thread:lead",
      projectId: "project:stage-5",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.6-sol",
        options: { reasoningEffort: "high" },
      },
      runtimeMode: "full-access",
      interactionMode: "default",
    } as OrchestrationThread;
    const project = {
      id: "project:stage-5",
      title: "Stage 5",
      workspaceRoot: "/tmp/stage-5",
      deletedAt: null,
    } as OrchestrationProject;
    const seat = {
      id: "seat:lead",
      workspaceId: "workspace:default",
      roomIds: ["room:stage-5"],
      identityRole: "lead",
      effectiveRole: "lead",
      profileId: "profile:lead",
      providerSessionId: null,
      lifecycleState: "active",
      workState: "idle",
      authorityReceiptId: "receipt:lead",
      createdAt: now,
      retainedAt: null,
      retiredAt: null,
      revision: 0,
      updatedAt: now,
    } as AgentSeat;
    const authorityReceipt = {
      id: "receipt:lead",
      actorSeatId: seat.id,
      identityRole: "lead",
      effectiveRole: "lead",
      workspaceScopes: [seat.workspaceId],
      roomScopes: ["room:stage-5"],
      taskNodeScopes: [],
      allowedCommands: [
        "supervised.task.create",
        "supervised.run.request",
        "supervised.run.transition",
        "supervised.context.workspace-upsert",
        "supervised.rlm.upsert",
        "supervised.model-session.upsert",
      ],
      allowedTools: ["supervised.rlm.start"],
      rootLeaseIds: ["root-lease:stage-5"],
      mandateIds: [],
      runPolicyRevision: 0,
      issuedAt: now,
      expiresAt: null,
      revokedAt: null,
    } as EffectiveAuthorityReceipt;
    const governance = {
      ...emptySupervisedGovernanceSnapshot(now),
      workspaces: [
        {
          id: seat.workspaceId,
          ownerNamespace: "owner",
          title: "Workspace",
          lifecycleState: "active",
          revision: 0,
          createdAt: now,
          updatedAt: now,
        },
      ],
      agentSeats: [seat],
      authorityReceipts: [authorityReceipt],
      rootLeases: [
        {
          id: "root-lease:stage-5",
          workspaceId: seat.workspaceId,
          roomId: runtime.rooms[0]!.id,
          holderSeatId: seat.id,
          previousHolderSeatId: null,
          status: "active",
          acquiredAt: now,
          transferRequestedAt: null,
          transferredAt: null,
          releasedAt: null,
          revision: 0,
          updatedAt: now,
        },
      ],
    } as never;
    let projectedRuntime = runtime;
    let sequence = 0;

    const result = await Effect.runPromise(
      startRlm({
        engine: {
          dispatch: (command: OrchestrationCommand) =>
            Effect.gen(function* () {
              dispatched.push(command);
              if (command.type.startsWith("supervised.")) {
                const event = yield* decideSupervisedCommand({
                  command: command as never,
                  state: projectedRuntime,
                  governance,
                });
                sequence += 1;
                projectedRuntime = projectSupervisedEvent(projectedRuntime, {
                  ...event,
                  sequence,
                });
                return { sequence };
              }
              sequence += 1;
              return { sequence };
            }),
        } as never,
        daemon: {
          wake: Effect.sync(() => {
            wakeCount += 1;
          }),
        } as never,
        runtime,
        callerThread,
        project,
        room: runtime.rooms[0]!,
        seat,
        authorityReceipt,
        objective: "Synthesize two independent facts.",
        branches: [
          { title: "First fact", prompt: "Find the first fact." },
          { title: "Second fact", prompt: "Find the second fact." },
        ],
        existingRunId: null,
        providerLimitTokens: 128_000,
        requestId: "thread:lead:turn:stage-5:rlm-request",
        createdAt: now,
      }),
    );

    const threadCreates = dispatched.filter((command) => command.type === "thread.create");
    const branchTurns = dispatched.filter((command) => command.type === "thread.turn.start");
    const sessionCommands = dispatched.filter(
      (command) => command.type === "supervised.model-session.upsert",
    );
    assert.equal(threadCreates.length, 3);
    assert.equal(branchTurns.length, 2);
    assert.ok(
      branchTurns.every(
        (command) => command.type !== "thread.turn.start" || command.message.text.length <= 32_768,
      ),
    );
    for (const command of branchTurns) {
      if (command.type !== "thread.turn.start") continue;
      assert.equal(command.message.role, "thread");
      assert.equal(command.dispatchOrigin, "agent");
      assert.equal(command.threadOrigin?.rootThreadId, callerThread.id);
      assert.equal(command.threadOrigin?.senderThreadId, result.rootThreadId);
      assert.equal(command.threadOrigin?.targetThreadId, command.threadId);
      assert.equal(command.threadOrigin?.runId, result.run.id);
      assert.equal(command.threadOrigin?.correlationId, result.episode.id);
    }
    assert.equal(sessionCommands.length, 3);
    assert.equal(wakeCount, 1);
    assert.equal(result.branchThreads.length, 2);
    assert.equal(projectedRuntime.tasks.length, 1);
    assert.equal(projectedRuntime.runs[0]?.status, "running");
    assert.equal(projectedRuntime.rlmEpisodes[0]?.status, "branches_running");
    assert.equal(projectedRuntime.modelSessions.length, 3);
    for (const command of sessionCommands) {
      if (command.type !== "supervised.model-session.upsert") continue;
      assert.equal(command.modelSession.actorSeatId, authorityReceipt.actorSeatId);
      assert.equal(command.modelSession.authorityReceiptId, authorityReceipt.id);
      assert.equal(command.modelSession.effectiveRole, authorityReceipt.effectiveRole);
      assert.deepEqual(command.modelSession.rootLeaseIds, authorityReceipt.rootLeaseIds);
      assert.equal(command.modelSession.providerSessionId, null);
      assert.deepEqual(command.modelSession.usage, {
        inputTokens: 0,
        outputTokens: 0,
        contextTokens: 0,
        providerLimitTokens: null,
        contextUsagePercent: null,
      });
      assert.deepEqual(command.modelSession.usageProvenance, {
        inputOutputTokens: "unavailable",
        contextWindow: "unavailable",
      });
      if (command.modelSession.role === "rlm_branch") {
        assert.equal(command.modelSession.parentSessionId, result.rootModelSessionId);
        assert.equal(command.modelSession.contextView?.actorSeatId, seat.id);
        assert.notEqual(command.modelSession.promptHash, null);
      }
    }
    assert.deepEqual(
      dispatched
        .filter((command) => command.type === "supervised.rlm.upsert")
        .map((command) => (command.type === "supervised.rlm.upsert" ? command.episode.status : null)),
      ["requested", "admitted", "branching", "branches_running"],
    );

    const dispatchedBeforeReplay = dispatched.length;
    const replayed = await Effect.runPromise(
      startRlm({
        engine: {
          dispatch: (command: OrchestrationCommand) =>
            Effect.gen(function* () {
              dispatched.push(command);
              if (command.type.startsWith("supervised.")) {
                const event = yield* decideSupervisedCommand({
                  command: command as never,
                  state: projectedRuntime,
                  governance,
                });
                sequence += 1;
                projectedRuntime = projectSupervisedEvent(projectedRuntime, {
                  ...event,
                  sequence,
                });
                return { sequence };
              }
              sequence += 1;
              return { sequence };
            }),
        } as never,
        daemon: { wake: Effect.void } as never,
        runtime: projectedRuntime,
        callerThread,
        project,
        room: runtime.rooms[0]!,
        seat,
        authorityReceipt,
        objective: "Synthesize two independent facts.",
        branches: [
          { title: "First fact", prompt: "Find the first fact." },
          { title: "Second fact", prompt: "Find the second fact." },
        ],
        existingRunId: null,
        providerLimitTokens: 128_000,
        requestId: "thread:lead:turn:stage-5:rlm-request",
        createdAt: now,
      }),
    );
    assert.equal(replayed.episode.id, result.episode.id);
    assert.equal(replayed.run.id, result.run.id);
    assert.equal(dispatched.length, dispatchedBeforeReplay);

    const rotatedSeat = {
      ...seat,
      authorityReceiptId: "receipt:lead-rotated",
    } as AgentSeat;
    const rotatedReceipt = {
      ...authorityReceipt,
      id: rotatedSeat.authorityReceiptId,
      rootLeaseIds: ["root-lease:stage-5-rotated"],
    } as EffectiveAuthorityReceipt;
    const conflict = await Effect.runPromise(
      startRlm({
        engine: { dispatch: () => Effect.die("authority lineage conflict dispatched") } as never,
        daemon: { wake: Effect.die("authority lineage conflict woke daemon") } as never,
        runtime: projectedRuntime,
        callerThread,
        project,
        room: runtime.rooms[0]!,
        seat: rotatedSeat,
        authorityReceipt: rotatedReceipt,
        objective: "Synthesize two independent facts.",
        branches: [
          { title: "First fact", prompt: "Find the first fact." },
          { title: "Second fact", prompt: "Find the second fact." },
        ],
        existingRunId: null,
        providerLimitTokens: 128_000,
        requestId: "thread:lead:turn:stage-5:rlm-request",
        createdAt: now,
      }).pipe(Effect.flip),
    );
    assert.equal(conflict.code, "supervised_rlm_request_conflict");
  });

  it("uses a Supervisor-owned existing Run without taking the Lead Root lease", async () => {
    const fixture = supervisorExistingRunFixture();
    const harness = projectionHarness(fixture.runtime, fixture.governance);

    const result = await Effect.runPromise(
      startRlm({
        engine: harness.engine,
        daemon: { wake: Effect.void } as never,
        runtime: fixture.runtime,
        callerThread: fixture.callerThread,
        project: fixture.project,
        room: fixture.room,
        seat: fixture.supervisor,
        authorityReceipt: fixture.authorityReceipt,
        objective: "Compare two independent read-only findings.",
        branches: [
          { title: "Runtime path", prompt: "Inspect the provider runtime path read-only." },
          { title: "Receipt path", prompt: "Inspect the durable receipt path read-only." },
        ],
        existingRunId: fixture.run.id,
        providerLimitTokens: 128_000,
        requestId: "thread:supervisor:turn:rlm-existing-run",
        createdAt: now,
      }),
    );

    assert.equal(result.run.id, fixture.run.id);
    assert.equal(result.run.ownerSeatId, fixture.supervisor.id);
    assert.equal(result.run.status, "running");
    assert.equal(fixture.room.leadSeatId, fixture.lead.id);
    assert.equal(fixture.governance.rootLeases[0]?.holderSeatId, fixture.lead.id);
    assert.deepEqual(fixture.authorityReceipt.rootLeaseIds, []);
    assert.equal(harness.dispatched.some((command) => command.type === "supervised.task.create"), false);
    assert.equal(harness.dispatched.some((command) => command.type === "supervised.run.request"), false);
    assert.equal(harness.dispatched.some((command) => command.type === "supervised.room.update"), false);
    assert.equal(
      harness.dispatched
        .filter((command) => command.type.startsWith("supervised."))
        .every(
          (command) =>
            command.actor.kind !== "seat" ||
            (command.actor.seatId === fixture.supervisor.id &&
              command.authorityReceiptId === fixture.authorityReceipt.id),
        ),
      true,
    );
    assert.equal(harness.runtime().rlmEpisodes[0]?.status, "branches_running");
    assert.equal(harness.runtime().modelSessions.length, 3);
    for (const session of harness.runtime().modelSessions) {
      assert.equal(session.actorSeatId, fixture.supervisor.id);
      assert.equal(session.authorityReceiptId, fixture.authorityReceipt.id);
      assert.equal(session.effectiveRole, "supervisor");
      assert.deepEqual(session.rootLeaseIds, []);
      assert.equal(session.providerSessionId, null);
    }
  });

  it("denies a Supervisor new RLM Run without changing durable state", async () => {
    const fixture = supervisorExistingRunFixture();
    const harness = projectionHarness(fixture.runtime, fixture.governance);

    const error = await Effect.runPromise(
      startRlm({
        engine: harness.engine,
        daemon: { wake: Effect.void } as never,
        runtime: fixture.runtime,
        callerThread: fixture.callerThread,
        project: fixture.project,
        room: fixture.room,
        seat: fixture.supervisor,
        authorityReceipt: fixture.authorityReceipt,
        objective: "Attempt to create an unowned RLM Run.",
        branches: [
          { title: "First", prompt: "Inspect the first bounded question." },
          { title: "Second", prompt: "Inspect the second bounded question." },
        ],
        existingRunId: null,
        providerLimitTokens: 128_000,
        requestId: "thread:supervisor:turn:rlm-no-run",
        createdAt: now,
      }).pipe(Effect.flip),
    );

    assert.equal(error.code, "supervised_rlm_root_required");
    assert.deepEqual(harness.dispatched, []);
    assert.equal(harness.runtime(), fixture.runtime);
    assert.equal(fixture.governance.rootLeases[0]?.holderSeatId, fixture.lead.id);
  });
});
