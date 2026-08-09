import { randomUUID } from "node:crypto";

import {
  CommandId,
  ContextWorkspace,
  ContextWorkspaceId,
  MessageId,
  ModelSessionId,
  ModelSessionTrace,
  RlmEpisode,
  RlmEpisodeId,
  Run,
  RunId,
  Task,
  TaskId,
  ThreadId,
  type AgentSeat,
  type EffectiveAuthorityReceipt,
  type ModelSelection,
  type OrchestrationProject,
  type OrchestrationThread,
  type Room,
  type SupervisedRuntimeSnapshot,
} from "@synara/contracts";
import { Effect, Schema } from "effect";

import type { OrchestrationEngineShape } from "../../orchestration/Services/OrchestrationEngine.ts";
import type { SupervisedRuntimeDaemonShape } from "../../orchestration/Services/SupervisedRuntimeDaemon.ts";
import { buildContextView, renderContextView } from "./ContextViews.ts";
import { decideRlmAdmission } from "./RlmAdmission.ts";
import { promptReceiptHash } from "./RlmExecution.ts";

export class RlmStartError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface RlmBranchRequest {
  readonly title: string;
  readonly prompt: string;
}

export interface StartRlmInput {
  readonly engine: OrchestrationEngineShape;
  readonly daemon: SupervisedRuntimeDaemonShape;
  readonly runtime: SupervisedRuntimeSnapshot;
  readonly callerThread: OrchestrationThread;
  readonly project: OrchestrationProject;
  readonly room: Room;
  readonly seat: AgentSeat;
  readonly authorityReceipt: EffectiveAuthorityReceipt;
  readonly objective: string;
  readonly branches: ReadonlyArray<RlmBranchRequest>;
  readonly existingRunId: string | null;
  readonly providerLimitTokens: number | null;
  readonly createdAt: string;
}

const decode = <S extends Schema.Top>(schema: S, value: unknown, label: string): S["Type"] => {
  try {
    return Schema.decodeUnknownSync(schema)(value);
  } catch (cause) {
    throw new RlmStartError(
      "supervised_rlm_plan_invalid",
      `${label} is invalid: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
};

const reasoningEffort = (selection: ModelSelection): string | null => {
  const options = selection.options as Record<string, unknown> | undefined;
  if (!options) return null;
  for (const key of ["reasoningEffort", "effort", "thinkingLevel", "variant"]) {
    const value = options[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
};

const dispatchFailure = (error: unknown) =>
  new RlmStartError(
    "supervised_rlm_command_rejected",
    error instanceof Error ? error.message : String(error),
  );

const boundedPromptSection = (value: string, limit: number) =>
  value.length <= limit ? value : `${value.slice(0, limit - 16)}\n[truncated]`;

export function startRlm(input: StartRlmInput) {
  return Effect.gen(function* () {
    if (
      input.objective.trim().length === 0 ||
      input.objective.length > 32_768 ||
      input.branches.some(
        (branch) =>
          branch.title.trim().length === 0 ||
          branch.title.length > 512 ||
          branch.prompt.trim().length === 0 ||
          branch.prompt.length > 32_768,
      )
    ) {
      return yield* Effect.fail(
        new RlmStartError(
          "supervised_rlm_plan_invalid",
          "RLM objective, branch titles, and branch prompts must be non-empty.",
        ),
      );
    }
    if (input.branches.length < 2) {
      return yield* Effect.fail(
        new RlmStartError("supervised_rlm_branches_required", "RLM requires at least two independent branches."),
      );
    }
    const distinctBranchPrompts = new Set(
      input.branches.map((branch) => branch.prompt.trim().toLocaleLowerCase()),
    );
    if (distinctBranchPrompts.size !== input.branches.length) {
      return yield* Effect.fail(
        new RlmStartError(
          "supervised_rlm_branches_not_independent",
          "RLM branch prompts must be distinct independent investigations.",
        ),
      );
    }
    const policy = input.runtime.runPolicies[0];
    if (!policy) {
      return yield* Effect.fail(
        new RlmStartError("supervised_rlm_policy_unavailable", "No durable RunPolicy is available."),
      );
    }
    const maxFanOut = Math.min(policy.maxFanOut, 64);
    if (input.branches.length > maxFanOut) {
      return yield* Effect.fail(
        new RlmStartError(
          "supervised_rlm_fanout_denied",
          `Requested ${input.branches.length} branches, but durable policy allows ${maxFanOut}.`,
        ),
      );
    }
    if (
      input.room.projectId !== input.project.id ||
      !input.seat.roomIds.includes(input.room.id) ||
      !input.authorityReceipt.roomScopes.includes(input.room.id)
    ) {
      return yield* Effect.fail(
        new RlmStartError("supervised_rlm_scope_denied", "The caller does not own the selected Room scope."),
      );
    }

    const actor = {
      kind: "seat" as const,
      actorId: input.callerThread.id,
      seatId: input.seat.id,
    };
    const dispatchSupervised = <C extends { readonly type: string }>(command: C) =>
      input.engine.dispatch(command as never).pipe(Effect.mapError(dispatchFailure));
    const commandBase = (aggregateId: string, expectedRevision: number, suffix: string) => ({
      commandId: CommandId.makeUnsafe(`rlm:${randomUUID()}:${suffix}`),
      actor,
      authorityReceiptId: input.authorityReceipt.id,
      aggregateId,
      expectedRevision,
      idempotencyKey: `rlm:${aggregateId}:${expectedRevision}:${suffix}`,
      runPolicyId: policy.id,
      createdAt: input.createdAt,
    });

    let task: Task;
    let run: Run;
    if (input.existingRunId !== null) {
      const existing = input.runtime.runs.find((candidate) => candidate.id === input.existingRunId);
      if (!existing || existing.roomId !== input.room.id || existing.ownerSeatId !== input.seat.id) {
        return yield* Effect.fail(
          new RlmStartError(
            "supervised_rlm_run_unavailable",
            "The requested Run is unavailable or not owned by the caller.",
          ),
        );
      }
      const existingTask = input.runtime.tasks.find((candidate) => candidate.id === existing.taskId);
      if (!existingTask) {
        return yield* Effect.fail(
          new RlmStartError("supervised_rlm_task_unavailable", "The Run's durable Task is unavailable."),
        );
      }
      task = existingTask;
      run = existing;
    } else {
      if (input.room.leadSeatId !== input.seat.id) {
        return yield* Effect.fail(
          new RlmStartError(
            "supervised_rlm_root_required",
            "Creating a new RLM Run requires the Room's current Lead Root authority.",
          ),
        );
      }
      task = decode(Task, {
        id: TaskId.makeUnsafe(`rlm-task:${randomUUID()}`),
        roomId: input.room.id,
        title: input.objective.slice(0, 512),
        intent: input.objective,
        acceptanceCriteria: ["Independent branch transcripts and retained synthesis evidence exist."],
        lifecycle: "active",
        activeGraphRevision: input.room.graphRevision,
        revision: 0,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      }, "RLM Task");
      yield* dispatchSupervised({
        type: "supervised.task.create",
        ...commandBase(task.id, 0, "task-create"),
        task,
      });
      run = decode(Run, {
        id: RunId.makeUnsafe(`rlm-run:${randomUUID()}`),
        roomId: input.room.id,
        taskId: task.id,
        taskNodeId: null,
        taskNodeRevisionId: null,
        ownerSeatId: input.seat.id,
        policyId: policy.id,
        status: "queued",
        attempt: 1,
        daemonEpoch: Math.max(1, input.runtime.health.daemonEpoch),
        startedAt: null,
        lastProgressAt: null,
        finishedAt: null,
        revision: 0,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      }, "RLM Run");
      yield* dispatchSupervised({
        type: "supervised.run.request",
        ...commandBase(run.id, 0, "run-request"),
        run,
      });
    }

    const transitions: ReadonlyArray<Run["status"]> =
      run.status === "queued"
        ? ["admitted", "starting", "running"]
        : run.status === "admitted"
          ? ["starting", "running"]
          : run.status === "starting" || run.status === "recovering" || run.status === "waiting"
            ? ["running"]
            : [];
    for (const status of transitions) {
      yield* dispatchSupervised({
        type: "supervised.run.transition",
        ...commandBase(run.id, run.revision, `run-${status}`),
        runId: run.id,
        status,
        reason: "RLM execution lifecycle.",
      });
      run = {
        ...run,
        status,
        revision: run.revision + 1,
        startedAt: run.startedAt ?? (status === "starting" || status === "running" ? input.createdAt : null),
        lastProgressAt: status === "running" ? input.createdAt : run.lastProgressAt,
        updatedAt: input.createdAt,
      };
    }
    if (run.status !== "running") {
      return yield* Effect.fail(
        new RlmStartError(
          "supervised_rlm_run_not_startable",
          `Run status '${run.status}' cannot start a new RLM episode.`,
        ),
      );
    }

    let contextWorkspace = input.runtime.contextWorkspaces.find(
      (candidate) => candidate.projectId === input.project.id && candidate.roomId === input.room.id,
    );
    if (!contextWorkspace) {
      contextWorkspace = decode(ContextWorkspace, {
        id: ContextWorkspaceId.makeUnsafe(`context-workspace:${input.room.id}`),
        projectId: input.project.id,
        roomId: input.room.id,
        revision: 0,
        highWaterSequence: input.runtime.snapshotSequence,
        retention: { maxAgeMs: 30 * 24 * 60 * 60 * 1_000, maxInlineBytes: 64_000, compactAfterRecords: 200 },
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      }, "Context Workspace");
      yield* dispatchSupervised({
        type: "supervised.context.workspace-upsert",
        ...commandBase(contextWorkspace.id, 0, "context-workspace"),
        workspace: contextWorkspace,
      });
    }

    const episodeId = RlmEpisodeId.makeUnsafe(`rlm-episode:${randomUUID()}`);
    const rootModelSessionId = ModelSessionId.makeUnsafe(`model-session:rlm-root:${randomUUID()}`);
    const rootThreadId = ThreadId.makeUnsafe(`rlm-root:${randomUUID()}`);
    const branchPlans = input.branches.map((branch) => ({
      ...branch,
      modelSessionId: ModelSessionId.makeUnsafe(`model-session:rlm-branch:${randomUUID()}`),
      threadId: ThreadId.makeUnsafe(`rlm-branch:${randomUUID()}`),
    }));
    const contextFor = (sessionId: ModelSessionId) =>
      buildContextView({
        workspace: contextWorkspace,
        records: input.runtime.contextRecords,
        compactionReceipts: input.runtime.contextCompactionReceipts,
        actorSeatId: sessionId,
        allowedScopes: [
          { kind: "project", projectId: input.project.id },
          { kind: "room", roomId: input.room.id },
        ],
        allowedProtectionClasses: ["workspace", "internal"],
        provider: input.callerThread.modelSelection.provider,
        model: input.callerThread.modelSelection.model,
        providerLimitTokens: input.providerLimitTokens,
        maxRecords: 128,
        maxEstimatedTokens: Math.max(
          1,
          Math.min(24_000, Math.floor((input.providerLimitTokens ?? 96_000) * 0.25)),
        ),
        createdAt: input.createdAt,
      });
    const admissionContext = contextFor(rootModelSessionId);
    const estimatedInputTokens = Math.ceil(
      [input.objective, ...input.branches.map((branch) => branch.prompt)].join("\n").length / 4,
    );
    const admission = decideRlmAdmission({
      episodeId,
      requestedMode: "recursive",
      estimatedContextPercent:
        input.providerLimitTokens === null
          ? 0
          : Math.min(100, (admissionContext.view.estimatedTokens / input.providerLimitTokens) * 100),
      estimatedInputTokens,
      independentEvidenceBranches: branchPlans.length,
      policyId: policy.id,
      createdAt: input.createdAt,
    });
    let episode = decode(RlmEpisode, {
      id: episodeId,
      runId: run.id,
      admission,
      status: "requested",
      rootModelSessionId,
      branchModelSessionIds: branchPlans.map((branch) => branch.modelSessionId),
      branchCount: branchPlans.length,
      completedBranchCount: 0,
      staleBranchCount: 0,
      coveragePercent: 0,
      contradictionCount: 0,
      evidenceRefs: [],
      failureSummaries: [],
      revision: 0,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    }, "RLM Episode");
    yield* dispatchSupervised({
      type: "supervised.rlm.upsert",
      ...commandBase(episode.id, 0, "episode-requested"),
      episode,
    });

    const createThread = (threadId: ThreadId, title: string, parentThreadId: ThreadId) =>
      input.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe(`rlm:${randomUUID()}:thread-create`),
        threadId,
        projectId: input.project.id,
        title,
        modelSelection: input.callerThread.modelSelection,
        runtimeMode: input.callerThread.runtimeMode,
        interactionMode: input.callerThread.interactionMode,
        envMode: "local",
        branch: null,
        worktreePath: null,
        workingDirectory: input.project.workspaceRoot,
        parentThreadId,
        creationSource: "supervised_native",
        sourceThreadId: input.callerThread.id,
        createdAt: input.createdAt,
      }).pipe(Effect.mapError(dispatchFailure));
    const makeTrace = (inputTrace: {
      readonly id: ModelSessionId;
      readonly threadId: ThreadId;
      readonly role: "rlm_root" | "rlm_branch";
      readonly title: string;
      readonly parentSessionId: ModelSessionId | null;
      readonly prompt: string;
    }) => {
      const context = contextFor(inputTrace.id);
      return decode(ModelSessionTrace, {
        id: inputTrace.id,
        roomId: input.room.id,
        runId: run.id,
        taskId: task.id,
        taskNodeId: run.taskNodeId,
        rlmEpisodeId: episode.id,
        parentSessionId: inputTrace.parentSessionId,
        specialistId: null,
        threadId: inputTrace.threadId,
        role: inputTrace.role,
        title: inputTrace.title,
        provider: input.callerThread.modelSelection.provider,
        model: input.callerThread.modelSelection.model,
        reasoningEffort: reasoningEffort(input.callerThread.modelSelection),
        providerSessionId: null,
        providerCallId: null,
        contextViewRefs: context.view.recordIds,
        contextView: context.view,
        promptHash: inputTrace.role === "rlm_branch" ? promptReceiptHash(inputTrace.prompt) : null,
        inputSummary: inputTrace.prompt,
        items: [
          {
            id: `${inputTrace.id}:context`,
            type: "context_receipt",
            label: "Scoped durable ContextView",
            contextRecordIds: context.view.recordIds,
            createdAt: input.createdAt,
          },
        ],
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          contextTokens: context.view.estimatedTokens,
          providerLimitTokens: context.view.providerLimitTokens,
          contextUsagePercent:
            context.view.providerLimitTokens === null
              ? null
              : (context.view.estimatedTokens / context.view.providerLimitTokens) * 100,
        },
        status: "queued",
        retryCount: 0,
        durationMs: null,
        costUsd: null,
        synthesisDestination: inputTrace.role === "rlm_branch" ? rootModelSessionId : null,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        revision: 0,
      }, `${inputTrace.role} ModelSessionTrace`);
    };

    yield* createThread(rootThreadId, `RLM synthesis: ${input.objective.slice(0, 160)}`, input.callerThread.id);
    const rootTrace = makeTrace({
      id: rootModelSessionId,
      threadId: rootThreadId,
      role: "rlm_root",
      title: "RLM root synthesis",
      parentSessionId: null,
      prompt: input.objective,
    });
    yield* dispatchSupervised({
      type: "supervised.model-session.upsert",
      ...commandBase(rootTrace.id, 0, "root-session"),
      modelSession: rootTrace,
    });

    for (const [index, branch] of branchPlans.entries()) {
      const branchContext = contextFor(branch.modelSessionId);
      const fixedPrompt = [
        `RLM objective: ${boundedPromptSection(input.objective, 8_192)}`,
        `Independent branch ${index + 1}: ${branch.title}`,
        boundedPromptSection(branch.prompt, 12_288),
        "Work independently. Report visible evidence, uncertainty, and any contradiction. Do not expose hidden chain-of-thought. Do not mutate the workspace unless the branch request explicitly requires it.",
        "Scoped durable context:",
      ].join("\n\n");
      const contextBudget = Math.max(256, 32_768 - fixedPrompt.length - 2);
      const prompt = `${fixedPrompt}\n\n${boundedPromptSection(
        renderContextView(branchContext.records),
        contextBudget,
      )}`;
      yield* createThread(branch.threadId, `RLM branch ${index + 1}: ${branch.title}`, rootThreadId);
      const trace = makeTrace({
        id: branch.modelSessionId,
        threadId: branch.threadId,
        role: "rlm_branch",
        title: branch.title,
        parentSessionId: rootModelSessionId,
        prompt,
      });
      yield* dispatchSupervised({
        type: "supervised.model-session.upsert",
        ...commandBase(trace.id, 0, `branch-session-${index}`),
        modelSession: trace,
      });
      const messageId = MessageId.makeUnsafe(`rlm-message:${randomUUID()}`);
      yield* input.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe(`rlm:${randomUUID()}:branch-turn`),
        threadId: branch.threadId,
        message: {
          messageId,
          role: "thread",
          text: prompt,
          attachments: [],
        },
        modelSelection: input.callerThread.modelSelection,
        dispatchMode: "queue",
        dispatchOrigin: "agent",
        threadOrigin: {
          messageId,
          rootThreadId: input.callerThread.id,
          senderThreadId: rootThreadId,
          targetThreadId: branch.threadId,
          assignmentId: branch.modelSessionId,
          runId: run.id,
          correlationId: episode.id,
          replyToMessageId: null,
          hopCount: 0,
          artifactRefs: [],
        },
        runtimeMode: input.callerThread.runtimeMode,
        interactionMode: input.callerThread.interactionMode,
        createdAt: input.createdAt,
      }).pipe(Effect.mapError(dispatchFailure));
    }

    for (const status of ["admitted", "branching", "branches_running"] as const) {
      episode = { ...episode, status, revision: episode.revision + 1, updatedAt: input.createdAt };
      yield* dispatchSupervised({
        type: "supervised.rlm.upsert",
        ...commandBase(episode.id, episode.revision - 1, `episode-${status}`),
        episode,
      });
    }
    yield* input.daemon.wake;
    return {
      episode,
      run,
      task,
      rootThreadId,
      rootModelSessionId,
      branchThreads: branchPlans.map((branch) => ({
        threadId: branch.threadId,
        modelSessionId: branch.modelSessionId,
        title: branch.title,
      })),
    };
  });
}
