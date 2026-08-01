import {
  ArtifactId,
  AssignmentId,
  CommandId,
  ContextBundleId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  ProjectTaskId,
  MonitorId,
  OrchestratorMessageId,
  TaskProcessId,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestratorCapability,
  type OrchestratorCommand,
  type OrchestratorDomainEvent,
} from "@synara/contracts";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestratorCommand } from "./decider.ts";
import {
  createEmptyOrchestratorState,
  projectOrchestratorEvent,
  type OrchestratorAggregateState,
} from "./projector.ts";

const now = "2026-08-01T00:00:00.000Z";
const projectId = ProjectId.makeUnsafe("project-a");
const rootThreadId = ThreadId.makeUnsafe("root-a");
const childB = ThreadId.makeUnsafe("child-b");
const childC = ThreadId.makeUnsafe("child-c");

const firstEventType = (
  decision: { readonly type: string } | ReadonlyArray<{ readonly type: string }>,
): string | undefined => {
  const first = Array.isArray(decision) ? decision[0] : (decision as { readonly type: string });
  return first?.type;
};

const makeThread = (
  id: ThreadId,
  subagentAgentId: string | null = null,
): OrchestrationReadModel["threads"][number] => ({
  id,
  projectId,
  title: id,
  modelSelection: { provider: "codex", model: "gpt-5.6" },
  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
  runtimeMode: "full-access",
  envMode: "local",
  branch: null,
  worktreePath: null,
  workingDirectory: null,
  associatedWorktreePath: null,
  associatedWorktreeBranch: null,
  associatedWorktreeRef: null,
  createBranchFlowCompleted: false,
  isPinned: false,
  parentThreadId: null,
  creationSource: null,
  sourceThreadId: null,
  sourceTurnId: null,
  gatewayOperationId: null,
  gatewayOperationIndex: null,
  subagentAgentId,
  subagentNickname: null,
  subagentRole: null,
  forkSourceThreadId: null,
  sidechatSourceThreadId: null,
  lastKnownPr: null,
  latestTurn: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  deletedAt: null,
  handoff: null,
  messages: [],
  activities: [],
  proposedPlans: [],
  checkpoints: [],
  session: null,
});

const readModel: OrchestrationReadModel = {
  snapshotSequence: 1,
  spaces: [],
  projects: [
    {
      id: projectId,
      kind: "project",
      title: "Project A",
      workspaceRoot: "/workspace/a",
      defaultModelSelection: null,
      scripts: [],
      isPinned: false,
      spaceId: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  ],
  threads: [makeThread(rootThreadId), makeThread(childB), makeThread(childC)],
  updatedAt: now,
};

const persist = (
  state: OrchestratorAggregateState,
  events: ReadonlyArray<Omit<OrchestratorDomainEvent, "sequence">>,
) => {
  let sequence = state.highWaterSequence;
  return events.reduce((current, next) => {
    sequence += 1;
    return projectOrchestratorEvent(current, { ...next, sequence });
  }, state);
};

const createRoot = async () => {
  const command: OrchestratorCommand = {
    type: "orchestrator.root.create",
    commandId: CommandId.makeUnsafe("create-root"),
    rootThreadId,
    projectId,
    actor: { kind: "user", actorId: "owner" },
    protocolVersion: 1,
    expectedRevision: 0,
    createdAt: now,
    modelTarget: {
      provider: "codex",
      model: "gpt-5.6",
      runtimeMode: "full-access",
      workspaceRoot: "/workspace/a",
    },
    title: "Root A",
    activeProcessId: null,
  };
  const result = await Effect.runPromise(
    decideOrchestratorCommand({ command, state: createEmptyOrchestratorState(), readModel }),
  );
  const events = (Array.isArray(result) ? result : [result]) as ReadonlyArray<
    Omit<OrchestratorDomainEvent, "sequence">
  >;
  return persist(createEmptyOrchestratorState(), events);
};

const attachCommand = (
  state: OrchestratorAggregateState,
  childThreadId: ThreadId,
  parentThreadId: ThreadId,
  role: "child_owner" | "participant" | "compiler" = "child_owner",
  capabilities: Array<OrchestratorCapability> | undefined = undefined,
): OrchestratorCommand => ({
  type: "orchestrator.child.attach",
  commandId: CommandId.makeUnsafe(`attach-${childThreadId}-${state.revision}`),
  rootThreadId,
  projectId,
  actor: { kind: "thread", threadId: rootThreadId },
  protocolVersion: 1,
  expectedRevision: state.revision,
  createdAt: now,
  parentThreadId,
  childThreadId,
  role,
  capabilities:
    capabilities === undefined
      ? ["state.read", "message.send", ...(role === "child_owner" ? ["child.assign" as const] : [])]
      : capabilities,
  continuity: {
    kind: "clean",
    contextBundle: {
      id: ContextBundleId.makeUnsafe(`context-${childThreadId}`),
      version: 1,
      assignmentId: null,
      originalBrief: "Explore independently",
      immutableUserConstraints: [],
      acceptedDecisions: [],
      rejectedAlternatives: [],
      ownershipClaims: [],
      dependencyRefs: [],
      sourceRefs: [],
      threadMessageRefs: [],
      artifactRefs: [],
      capabilityCeiling: ["state.read", "message.send"],
      createdBy: { kind: "thread", threadId: rootThreadId },
      createdAt: now,
      contentHash: "sha256:context",
    },
  },
  modelTarget: {
    provider: "claudeAgent",
    model: "opus-4.8",
    runtimeMode: "full-access",
    workspaceRoot: "/workspace/a",
  },
  decisionReason: {
    summary: "Independent architecture",
    taskFit: ["architecture"],
    contextHealth: "healthy",
    cacheEconomics: "reuse",
    selectedAt: now,
  },
});

describe("Orchestrator decider", () => {
  it("requires a new Root to attach its active process after Root creation", async () => {
    const command: OrchestratorCommand = {
      type: "orchestrator.root.create",
      commandId: CommandId.makeUnsafe("create-root-with-process"),
      rootThreadId,
      projectId,
      actor: { kind: "user", actorId: "owner" },
      protocolVersion: 1,
      expectedRevision: 0,
      createdAt: now,
      modelTarget: {
        provider: "codex",
        model: "gpt-5.6",
        runtimeMode: "full-access",
        workspaceRoot: "/workspace/a",
      },
      title: "Root A",
      activeProcessId: TaskProcessId.makeUnsafe("unowned-process"),
    };
    const result = await Effect.runPromise(
      decideOrchestratorCommand({
        command,
        state: createEmptyOrchestratorState(),
        readModel,
      }).pipe(Effect.exit),
    );
    expect(Exit.isFailure(result)).toBe(true);
  });

  it("lets only the user restore an archived Root and advances its revision", async () => {
    let state = await createRoot();
    const archived = await Effect.runPromise(
      decideOrchestratorCommand({
        command: {
          type: "orchestrator.root.archive",
          commandId: CommandId.makeUnsafe("archive-root"),
          rootThreadId,
          projectId,
          actor: { kind: "user", actorId: "owner" },
          protocolVersion: 1,
          expectedRevision: state.revision,
          reason: null,
          createdAt: now,
        },
        state,
        readModel,
      }),
    );
    state = persist(
      state,
      (Array.isArray(archived) ? archived : [archived]) as ReadonlyArray<
        Omit<OrchestratorDomainEvent, "sequence">
      >,
    );

    const restored = await Effect.runPromise(
      decideOrchestratorCommand({
        command: {
          type: "orchestrator.root.restore",
          commandId: CommandId.makeUnsafe("restore-root"),
          rootThreadId,
          projectId,
          actor: { kind: "user", actorId: "owner" },
          protocolVersion: 1,
          expectedRevision: state.revision,
          createdAt: now,
        },
        state,
        readModel,
      }),
    );
    const restoredEvent = Array.isArray(restored) ? restored[0] : restored;

    expect(restoredEvent.type).toBe("orchestrator.root.restored");
    expect(restoredEvent.payload.root).toMatchObject({
      state: "active",
      archivedAt: null,
      revision: state.revision + 1,
    });

    const nonUserRestore = await Effect.runPromise(
      decideOrchestratorCommand({
        command: {
          type: "orchestrator.root.restore",
          commandId: CommandId.makeUnsafe("restore-root-by-thread"),
          rootThreadId,
          projectId,
          actor: { kind: "thread", threadId: rootThreadId },
          protocolVersion: 1,
          expectedRevision: state.revision,
          createdAt: now,
        },
        state,
        readModel,
      }).pipe(Effect.exit),
    );
    expect(Exit.isFailure(nonUserRestore)).toBe(true);
  });

  it("keeps ownership acyclic and parent-child communication separate", async () => {
    let state = await createRoot();
    const attachB = await Effect.runPromise(
      decideOrchestratorCommand({
        command: attachCommand(state, childB, rootThreadId),
        state,
        readModel,
      }),
    );
    const attachBEvents = (Array.isArray(attachB) ? attachB : [attachB]) as ReadonlyArray<
      Omit<OrchestratorDomainEvent, "sequence">
    >;
    expect(attachBEvents.map((event) => event.type)).toEqual([
      "orchestrator.child.attached",
      "orchestrator.link.set",
    ]);
    state = persist(state, attachBEvents);

    const attachC = await Effect.runPromise(
      decideOrchestratorCommand({
        command: attachCommand(state, childC, childB),
        state,
        readModel,
      }),
    );
    state = persist(
      state,
      (Array.isArray(attachC) ? attachC : [attachC]) as ReadonlyArray<
        Omit<OrchestratorDomainEvent, "sequence">
      >,
    );

    const cycle = await Effect.runPromise(
      decideOrchestratorCommand({
        command: {
          type: "orchestrator.child.reparent",
          commandId: CommandId.makeUnsafe("cycle"),
          rootThreadId,
          projectId,
          actor: { kind: "thread", threadId: rootThreadId },
          protocolVersion: 1,
          expectedRevision: state.revision,
          createdAt: now,
          childThreadId: childB,
          parentThreadId: childC,
        },
        state,
        readModel,
      }).pipe(Effect.exit),
    );
    expect(Exit.isFailure(cycle)).toBe(true);
  });

  it("rejects role-capability escalation and provider-native subagents", async () => {
    const state = await createRoot();
    const escalation = await Effect.runPromise(
      decideOrchestratorCommand({
        command: attachCommand(state, childB, rootThreadId, "compiler", ["link.manage"]),
        state,
        readModel,
      }).pipe(Effect.exit),
    );
    expect(Exit.isFailure(escalation)).toBe(true);

    const nativeReadModel = {
      ...readModel,
      threads: [...readModel.threads, makeThread(ThreadId.makeUnsafe("native-child"), "agent-1")],
    };
    const native = await Effect.runPromise(
      decideOrchestratorCommand({
        command: attachCommand(state, ThreadId.makeUnsafe("native-child"), rootThreadId),
        state,
        readModel: nativeReadModel,
      }).pipe(Effect.exit),
    );
    expect(Exit.isFailure(native)).toBe(true);
  });

  it("rejects compiler winner artifacts at the aggregate boundary", async () => {
    let state = await createRoot();
    const attached = await Effect.runPromise(
      decideOrchestratorCommand({
        command: attachCommand(state, childB, rootThreadId, "compiler", ["artifact.publish"]),
        state,
        readModel,
      }),
    );
    state = persist(
      state,
      (Array.isArray(attached) ? attached : [attached]) as ReadonlyArray<
        Omit<OrchestratorDomainEvent, "sequence">
      >,
    );
    const publish = (kind: "decision_packet" | "claim_ledger", content: string) =>
      decideOrchestratorCommand({
        state,
        readModel,
        command: {
          type: "orchestrator.artifact.publish",
          commandId: CommandId.makeUnsafe(`publish-${kind}`),
          rootThreadId,
          projectId,
          actor: { kind: "thread", threadId: childB },
          protocolVersion: 1,
          expectedRevision: state.revision,
          createdAt: now,
          artifact: {
            id: ArtifactId.makeUnsafe(`artifact-${kind}`),
            rootThreadId,
            runId: null,
            round: null,
            kind,
            contentHash: `sha256:${kind}`,
            content,
            producerThreadId: childB,
            visibility: "sealed",
            sourceRefs: [],
            supersedesArtifactId: null,
            schemaVersion: 1,
            createdAt: now,
          },
        },
      }).pipe(Effect.exit);
    expect(Exit.isFailure(await Effect.runPromise(publish("decision_packet", "{}")))).toBe(true);
    expect(
      Exit.isFailure(
        await Effect.runPromise(
          publish(
            "claim_ledger",
            JSON.stringify({
              proposalLabel: "Alpha",
              artifactHash: "sha256:proposal",
              claims: [],
              winner: "Alpha",
            }),
          ),
        ),
      ),
    ).toBe(true);
  });

  it("allows a participant to register only its own bounded event wait", async () => {
    let state = await createRoot();
    const attached = await Effect.runPromise(
      decideOrchestratorCommand({
        command: attachCommand(state, childB, rootThreadId, "participant", ["state.read"]),
        state,
        readModel,
      }),
    );
    state = persist(
      state,
      (Array.isArray(attached) ? attached : [attached]) as ReadonlyArray<
        Omit<OrchestratorDomainEvent, "sequence">
      >,
    );
    const registered = await Effect.runPromise(
      decideOrchestratorCommand({
        state,
        readModel,
        command: {
          type: "orchestrator.monitor.register",
          commandId: CommandId.makeUnsafe("participant-wait"),
          rootThreadId,
          projectId,
          actor: { kind: "thread", threadId: childB },
          protocolVersion: 1,
          expectedRevision: state.revision,
          createdAt: now,
          monitor: {
            id: MonitorId.makeUnsafe("participant-wait"),
            rootThreadId,
            targetThreadId: null,
            kind: "wait",
            condition: "assignment changed",
            cadenceMs: null,
            nextWakeAt: null,
            maxRuns: 1,
            runCount: 0,
            expiresAt: "2026-08-01T01:00:00.000Z",
            ownerThreadId: childB,
            state: "active",
          },
        },
      }),
    );
    expect(firstEventType(registered)).toBe("orchestrator.monitor.registered");
  });

  it("advances repeating monitors only when due and stops at maxRuns", async () => {
    let state = await createRoot();
    const registered = await Effect.runPromise(
      decideOrchestratorCommand({
        state,
        readModel,
        command: {
          type: "orchestrator.monitor.register",
          commandId: CommandId.makeUnsafe("schedule-register"),
          rootThreadId,
          projectId,
          actor: { kind: "thread", threadId: rootThreadId },
          protocolVersion: 1,
          expectedRevision: state.revision,
          createdAt: now,
          monitor: {
            id: MonitorId.makeUnsafe("schedule"),
            rootThreadId,
            targetThreadId: null,
            kind: "schedule",
            condition: "scheduled review",
            cadenceMs: 1_000,
            nextWakeAt: "2026-08-01T00:00:01.000Z",
            maxRuns: 2,
            runCount: 0,
            expiresAt: "2026-08-01T00:01:00.000Z",
            ownerThreadId: rootThreadId,
            state: "active",
          },
        },
      }),
    );
    state = persist(
      state,
      (Array.isArray(registered) ? registered : [registered]) as ReadonlyArray<
        Omit<OrchestratorDomainEvent, "sequence">
      >,
    );
    const first = await Effect.runPromise(
      decideOrchestratorCommand({
        state,
        readModel,
        command: {
          type: "orchestrator.monitor.fire",
          commandId: CommandId.makeUnsafe("schedule-fire-1"),
          rootThreadId,
          projectId,
          actor: { kind: "server", actorId: "monitor" },
          protocolVersion: 1,
          expectedRevision: state.revision,
          createdAt: "2026-08-01T00:00:01.000Z",
          monitorId: MonitorId.makeUnsafe("schedule"),
          reasonCode: "schedule_due",
        },
      }),
    );
    state = persist(
      state,
      (Array.isArray(first) ? first : [first]) as ReadonlyArray<
        Omit<OrchestratorDomainEvent, "sequence">
      >,
    );
    expect(state.monitors[0]).toMatchObject({
      state: "active",
      runCount: 1,
      nextWakeAt: "2026-08-01T00:00:02.000Z",
    });
    const early = await Effect.runPromise(
      decideOrchestratorCommand({
        state,
        readModel,
        command: {
          type: "orchestrator.monitor.fire",
          commandId: CommandId.makeUnsafe("schedule-fire-early"),
          rootThreadId,
          projectId,
          actor: { kind: "server", actorId: "monitor" },
          protocolVersion: 1,
          expectedRevision: state.revision,
          createdAt: "2026-08-01T00:00:01.500Z",
          monitorId: MonitorId.makeUnsafe("schedule"),
          reasonCode: "schedule_due",
        },
      }).pipe(Effect.exit),
    );
    expect(Exit.isFailure(early)).toBe(true);
    const final = await Effect.runPromise(
      decideOrchestratorCommand({
        state,
        readModel,
        command: {
          type: "orchestrator.monitor.fire",
          commandId: CommandId.makeUnsafe("schedule-fire-2"),
          rootThreadId,
          projectId,
          actor: { kind: "server", actorId: "monitor" },
          protocolVersion: 1,
          expectedRevision: state.revision,
          createdAt: "2026-08-01T00:00:02.000Z",
          monitorId: MonitorId.makeUnsafe("schedule"),
          reasonCode: "schedule_due",
        },
      }),
    );
    state = persist(
      state,
      (Array.isArray(final) ? final : [final]) as ReadonlyArray<
        Omit<OrchestratorDomainEvent, "sequence">
      >,
    );
    expect(state.monitors[0]).toMatchObject({ state: "fired", runCount: 2 });
  });

  it("requires durable reported artifacts before verification and keeps acceptance separate", async () => {
    const assignmentId = AssignmentId.makeUnsafe("assignment-evidence");
    const taskId = ProjectTaskId.makeUnsafe("task-evidence");
    const artifactId = ArtifactId.makeUnsafe("artifact-evidence");
    let state: OrchestratorAggregateState = {
      ...(await createRoot()),
      assignments: [
        {
          assignmentId,
          version: 1,
          taskId,
          ownerThreadId: rootThreadId,
          assigneeThreadId: childB,
          goal: "Implement",
          acceptanceCriteria: [],
          immutableUserConstraints: [],
          workingAssumptions: [],
          contextBundleId: ContextBundleId.makeUnsafe("context-evidence"),
          continuity: { kind: "reuse", threadId: childB },
          modelTarget: {
            provider: "codex",
            model: "gpt-5.6",
            runtimeMode: "full-access",
            workspaceRoot: "/workspace/a",
          },
          decisionReason: {
            summary: "fit",
            taskFit: [],
            contextHealth: "healthy",
            cacheEconomics: "unknown",
            selectedAt: now,
          },
          pathOwnershipClaims: [],
          dependencyRefs: [],
          expectedApis: [],
          allowedCapabilities: ["assignment.report"],
          evidenceRequirements: [],
          verifierClass: "root",
          state: "reported_complete",
          supersedesVersion: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      artifacts: [
        {
          id: artifactId,
          rootThreadId,
          runId: null,
          round: null,
          kind: "evidence",
          contentHash: "sha256:evidence",
          content: "proof",
          producerThreadId: childB,
          visibility: "root_released",
          sourceRefs: [],
          supersedesArtifactId: null,
          schemaVersion: 1,
          createdAt: now,
        },
      ],
      assignmentEvidence: [
        {
          assignmentId,
          taskId,
          summary: "done",
          changedPaths: [],
          diffRef: null,
          checks: [],
          consumerEvidenceRefs: [],
          artifactRefs: [artifactId],
          risks: [],
          deviations: [],
          reportedAt: now,
        },
      ],
    };
    const verify = (evidenceArtifactIds: ArtifactId[]) =>
      decideOrchestratorCommand({
        state,
        readModel,
        command: {
          type: "orchestrator.assignment.verify",
          commandId: CommandId.makeUnsafe(`verify-${evidenceArtifactIds.length}`),
          rootThreadId,
          projectId,
          actor: { kind: "thread", threadId: rootThreadId },
          protocolVersion: 1,
          expectedRevision: state.revision,
          createdAt: now,
          assignmentId,
          taskId,
          evidenceArtifactIds,
        },
      });
    expect(Exit.isFailure(await Effect.runPromise(verify([]).pipe(Effect.exit)))).toBe(true);
    const verified = await Effect.runPromise(verify([artifactId]));
    state = persist(
      state,
      (Array.isArray(verified) ? verified : [verified]) as ReadonlyArray<
        Omit<OrchestratorDomainEvent, "sequence">
      >,
    );
    expect(state.assignments[0]?.state).toBe("verified");
    expect(state.assignments[0]?.state).not.toBe("accepted");
  });

  it("binds mailbox sender identity and enforces correlated reply semantics", async () => {
    let state = await createRoot();
    const attached = await Effect.runPromise(
      decideOrchestratorCommand({
        command: attachCommand(state, childB, rootThreadId),
        state,
        readModel,
      }),
    );
    state = persist(
      state,
      (Array.isArray(attached) ? attached : [attached]) as ReadonlyArray<
        Omit<OrchestratorDomainEvent, "sequence">
      >,
    );

    const enqueue = (input: {
      readonly id: string;
      readonly sender: ThreadId;
      readonly target: ThreadId;
      readonly actor: ThreadId;
      readonly replyTo?: string;
      readonly correlation?: string;
      readonly hopCount?: number;
    }): OrchestratorCommand => ({
      type: "orchestrator.message.enqueue",
      commandId: CommandId.makeUnsafe(`enqueue-${input.id}`),
      rootThreadId,
      projectId,
      actor: { kind: "thread", threadId: input.actor },
      protocolVersion: 1,
      expectedRevision: state.revision,
      createdAt: now,
      message: {
        messageId: OrchestratorMessageId.makeUnsafe(input.id),
        rootThreadId,
        senderThreadId: input.sender,
        targetThreadId: input.target,
        assignmentId: null,
        runId: null,
        correlationId:
          input.correlation === undefined
            ? null
            : OrchestratorMessageId.makeUnsafe(input.correlation),
        replyToMessageId:
          input.replyTo === undefined ? null : OrchestratorMessageId.makeUnsafe(input.replyTo),
        hopCount: input.hopCount ?? 0,
        expiresAt: "2026-08-01T01:00:00.000Z",
        body: "Independent message",
        artifactRefs: [],
        deliveryState: "queued",
        deliveryAttemptId: null,
        createdAt: now,
        updatedAt: now,
      },
    });

    const spoofed = await Effect.runPromise(
      decideOrchestratorCommand({
        command: enqueue({
          id: "spoofed",
          sender: rootThreadId,
          target: childB,
          actor: childB,
        }),
        state,
        readModel,
      }).pipe(Effect.exit),
    );
    expect(Exit.isFailure(spoofed)).toBe(true);

    const first = await Effect.runPromise(
      decideOrchestratorCommand({
        command: enqueue({
          id: "message-1",
          sender: rootThreadId,
          target: childB,
          actor: rootThreadId,
        }),
        state,
        readModel,
      }),
    );
    state = persist(
      state,
      (Array.isArray(first) ? first : [first]) as ReadonlyArray<
        Omit<OrchestratorDomainEvent, "sequence">
      >,
    );

    const wrongCorrelation = await Effect.runPromise(
      decideOrchestratorCommand({
        command: enqueue({
          id: "message-2",
          sender: childB,
          target: rootThreadId,
          actor: childB,
          replyTo: "message-1",
          correlation: "unrelated",
          hopCount: 1,
        }),
        state,
        readModel,
      }).pipe(Effect.exit),
    );
    expect(Exit.isFailure(wrongCorrelation)).toBe(true);

    const validReply = await Effect.runPromise(
      decideOrchestratorCommand({
        command: enqueue({
          id: "message-2",
          sender: childB,
          target: rootThreadId,
          actor: childB,
          replyTo: "message-1",
          correlation: "message-1",
          hopCount: 1,
        }),
        state,
        readModel,
      }),
    );
    expect(firstEventType(validReply)).toBe("orchestrator.message.enqueued");
  });

  it("requires persist-before-deliver mailbox transitions", async () => {
    let state = await createRoot();
    const attached = await Effect.runPromise(
      decideOrchestratorCommand({
        command: attachCommand(state, childB, rootThreadId),
        state,
        readModel,
      }),
    );
    state = persist(
      state,
      (Array.isArray(attached) ? attached : [attached]) as ReadonlyArray<
        Omit<OrchestratorDomainEvent, "sequence">
      >,
    );
    const messageId = OrchestratorMessageId.makeUnsafe("delivery-message");
    const enqueued = await Effect.runPromise(
      decideOrchestratorCommand({
        state,
        readModel,
        command: {
          type: "orchestrator.message.enqueue",
          commandId: CommandId.makeUnsafe("enqueue-delivery-message"),
          rootThreadId,
          projectId,
          actor: { kind: "thread", threadId: rootThreadId },
          protocolVersion: 1,
          expectedRevision: state.revision,
          createdAt: now,
          message: {
            messageId,
            rootThreadId,
            senderThreadId: rootThreadId,
            targetThreadId: childB,
            assignmentId: null,
            runId: null,
            correlationId: null,
            replyToMessageId: null,
            hopCount: 0,
            expiresAt: "2026-08-01T01:00:00.000Z",
            body: "Delivery ordering",
            artifactRefs: [],
            deliveryState: "queued",
            deliveryAttemptId: null,
            createdAt: now,
            updatedAt: now,
          },
        },
      }),
    );
    state = persist(
      state,
      (Array.isArray(enqueued) ? enqueued : [enqueued]) as ReadonlyArray<
        Omit<OrchestratorDomainEvent, "sequence">
      >,
    );

    const mark = (deliveryState: "processing" | "delivered") =>
      decideOrchestratorCommand({
        state,
        readModel,
        command: {
          type: "orchestrator.message.delivery.mark",
          commandId: CommandId.makeUnsafe(`mark-${deliveryState}`),
          rootThreadId,
          projectId,
          actor: { kind: "server", actorId: "orchestrator-mailbox" },
          protocolVersion: 1,
          expectedRevision: state.revision,
          createdAt: now,
          messageId,
          deliveryState,
          deliveryAttemptId: "attempt-1",
        },
      });
    expect(Exit.isFailure(await Effect.runPromise(mark("delivered").pipe(Effect.exit)))).toBe(true);
    const processing = await Effect.runPromise(mark("processing"));
    state = persist(
      state,
      (Array.isArray(processing) ? processing : [processing]) as ReadonlyArray<
        Omit<OrchestratorDomainEvent, "sequence">
      >,
    );
    expect(Array.isArray(await Effect.runPromise(mark("delivered")))).toBe(false);
  });
});
