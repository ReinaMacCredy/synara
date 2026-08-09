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
  type Room,
} from "@synara/contracts";

import { builtInRunPolicy } from "../signal/BuiltInSubscriptions.ts";
import { decideSupervisedCommand } from "../../orchestration/supervised/decider.ts";
import { projectSupervisedEvent } from "../../orchestration/supervised/projector.ts";
import { startRlm } from "./RlmStart.ts";

const now = "2026-08-09T00:00:00.000Z";

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
      if (command.modelSession.role === "rlm_branch") {
        assert.equal(command.modelSession.parentSessionId, result.rootModelSessionId);
        assert.equal(command.modelSession.contextView?.actorSeatId, command.modelSession.id);
        assert.notEqual(command.modelSession.promptHash, null);
      }
    }
    assert.deepEqual(
      dispatched
        .filter((command) => command.type === "supervised.rlm.upsert")
        .map((command) => (command.type === "supervised.rlm.upsert" ? command.episode.status : null)),
      ["requested", "admitted", "branching", "branches_running"],
    );
  });
});
