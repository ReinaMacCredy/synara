import {
  AssignmentId,
  ContextBundleId,
  ProjectId,
  ProjectTaskId,
  TaskProcessId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestratorProviderCapability,
  type TaskProcessGraphProjection,
} from "@synara/contracts";
import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";

import type { OrchestrationEngineShape } from "../orchestration/Services/OrchestrationEngine.ts";
import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { OrchestratorArtifactRepositoryShape } from "../persistence/Services/OrchestratorArtifacts.ts";
import type {
  ProjectionOrchestratorCore,
  ProjectionOrchestratorRepositoryShape,
} from "../persistence/Services/ProjectionOrchestrator.ts";
import type { ProjectionTaskProcessRepositoryShape } from "../persistence/Services/ProjectionTaskProcess.ts";
import {
  sealContextBundle,
  verifyContextBundle,
} from "../orchestration/orchestrator/contextBundles.ts";
import {
  OrchestratorToolError,
  type OrchestratorToolInvocationContext as ToolContext,
} from "../orchestration/orchestrator/toolRuntime.ts";
import { makeOrchestratorTools } from "../orchestration/orchestrator/toolRegistry.ts";

const createdAt = "2026-08-01T00:00:00.000Z";
const rootThreadId = ThreadId.makeUnsafe("root");
const participantThreadId = ThreadId.makeUnsafe("participant");
const projectId = ProjectId.makeUnsafe("project");
const processId = TaskProcessId.makeUnsafe("process");

const core: ProjectionOrchestratorCore = {
  root: {
    root: {
      rootThreadId,
      projectId,
      protocolVersion: 1,
      state: "active",
      activeProcessId: processId,
      resourcePolicyVersion: 1,
      createdAt,
      archivedAt: null,
      revision: 7,
    },
    highWaterCursor: "7",
  },
  ownershipEdges: [
    {
      rootThreadId,
      parentThreadId: rootThreadId,
      childThreadId: participantThreadId,
      role: "participant",
      capabilities: [
        "state.read",
        "link.request",
        "message.send",
        "artifact.publish",
        "assignment.report",
      ],
      contractVersion: 1,
      sourceThreadId: rootThreadId,
      sourceTurnId: null,
      sourceOperationId: null,
      activeFrom: createdAt,
      retiredAt: null,
      decisionReason: {
        summary: "Independent participant",
        taskFit: ["design"],
        contextHealth: "healthy",
        cacheEconomics: "unknown",
        selectedAt: createdAt,
      },
    },
  ],
  communicationLinks: [],
  assignments: [],
  runs: [],
  providerCapabilities: [
    {
      provider: "codex",
      model: "gpt-5.4-mini",
      orchestratorCapable: true,
      authoritativeRoleInstruction: true,
      nativeTools: true,
      independentSession: true,
      contextWindow: { kind: "unknown", reason: "test", at: createdAt },
      inputTokens: { kind: "unknown", reason: "test", at: createdAt },
      outputTokens: { kind: "unknown", reason: "test", at: createdAt },
      cacheReadTokens: { kind: "unknown", reason: "test", at: createdAt },
      cacheWriteTokens: { kind: "unknown", reason: "test", at: createdAt },
      cacheTtlSeconds: { kind: "unknown", reason: "test", at: createdAt },
      estimatedCost: { kind: "unknown", reason: "test", at: createdAt },
      observedAt: createdAt,
    },
  ],
  capacity: null,
};

const graph: TaskProcessGraphProjection = {
  process: {
    id: processId,
    projectId,
    title: "Process",
    owner: { kind: "orchestrator", rootThreadId },
    state: "active",
    revision: 3,
    createdAt,
    updatedAt: createdAt,
  },
  tasks: [],
  dependencies: [],
  bindings: [],
  blockers: [],
  graphRevision: 3,
  highWaterCursor: "3",
};

const context = (
  threadId: string,
  options: {
    readonly requests?: Array<{ provider: string; model: string }>;
    readonly capability?: OrchestratorProviderCapability;
    readonly failure?: boolean;
  } = {},
): ToolContext => ({
  principal: {
    kind: "provider-session",
    sessionKey: `session:${threadId}`,
    threadId,
    provider: "codex",
    turnId: "turn",
  },
  callerThreadId: threadId,
  callerSessionKey: `session:${threadId}`,
  callerProvider: "codex",
  callerCapabilities: new Set(["thread:read", "thread:write"]),
  callerTurnId: "turn",
  resolveOrchestratorCapability: (input) =>
    Effect.suspend(() => {
      options.requests?.push(input);
      return options.failure
        ? Effect.fail(new OrchestratorToolError("provider_model_unavailable", "model missing"))
        : Effect.succeed(options.capability ?? core.providerCapabilities[0]!);
    }),
  assertCallerTurnActive: () => Effect.void,
  jsonRpcRequestId: 1,
});

const makeTools = (
  options: {
    readonly projectedCore?: ProjectionOrchestratorCore;
    readonly standaloneThread?: Readonly<Record<string, unknown>>;
  } = {},
) => {
  const dispatched: OrchestrationCommand[] = [];
  const providerCapabilityRequests: Array<{ provider: string; model: string }> = [];
  const persistedProviderCapabilities: OrchestratorProviderCapability[] = [];
  const orchestratorRepository = {
    findRootForThread: () => Effect.succeed(Option.some(rootThreadId)),
    getCore: () => Effect.succeed(Option.some(options.projectedCore ?? core)),
    upsertProviderCapability: (capability: OrchestratorProviderCapability) =>
      Effect.sync(() => {
        persistedProviderCapabilities.push(capability);
      }),
  } as unknown as ProjectionOrchestratorRepositoryShape;
  const taskProcessRepository = {
    getGraph: () => Effect.succeed(Option.some(graph)),
  } as unknown as ProjectionTaskProcessRepositoryShape;
  const artifactRepository = {
    list: () => Effect.succeed([]),
  } as unknown as OrchestratorArtifactRepositoryShape;
  const orchestrationEngine = {
    dispatch: (command: OrchestrationCommand) =>
      Effect.sync(() => {
        dispatched.push(command);
        return { sequence: dispatched.length };
      }),
  } as unknown as OrchestrationEngineShape;
  const snapshotQuery = {
    getThreadShellById: (threadId: ThreadId) =>
      Effect.succeed(
        threadId === rootThreadId
          ? Option.some({
              id: rootThreadId,
              projectId,
              parentThreadId: null,
              sourceThreadId: null,
              creationSource: "user",
              subagentAgentId: null,
              modelSelection: { provider: "codex", model: "gpt-5.5" },
              runtimeMode: "approval-required",
            })
          : Option.fromNullishOr(options.standaloneThread),
      ),
    getProjectShellById: () =>
      Effect.succeed(
        Option.some({
          id: projectId,
          workspaceRoot: "/tmp/project",
        }),
      ),
  } as unknown as ProjectionSnapshotQueryShape;
  return {
    dispatched,
    providerCapabilityRequests,
    persistedProviderCapabilities,
    tools: makeOrchestratorTools({
      orchestratorRepository,
      taskProcessRepository,
      artifactRepository,
      orchestrationEngine,
      snapshotQuery,
    }),
  };
};

describe("Orchestrator tools", () => {
  it("registers exactly the V1 names and no detach alias", () => {
    const { tools } = makeTools();
    expect(tools.map((tool) => tool.definition.name)).toEqual([
      "create_task_process",
      "read_task_process",
      "read_orchestrator_state",
      "create_task",
      "update_task",
      "set_task_dependencies",
      "transition_task",
      "create_child_thread",
      "assign_task",
      "send_message",
      "create_communication_link",
      "set_communication_link",
      "publish_artifact",
      "update_run",
      "read_thread",
      "report_status",
      "request_change",
      "wait_for_event",
      "retire_child_thread",
      "read_last_message",
      "read_transcript",
    ]);
  });

  it("advertises the canonical report-status and artifact schemas to providers", () => {
    const { tools } = makeTools();
    const report = tools.find((tool) => tool.definition.name === "report_status")!;
    const publish = tools.find((tool) => tool.definition.name === "publish_artifact")!;
    const reportSchema = report.definition.inputSchema as {
      readonly required: ReadonlyArray<string>;
      readonly properties: {
        readonly state: { readonly anyOf: ReadonlyArray<{ readonly enum: ReadonlyArray<string> }> };
        readonly evidence: {
          readonly anyOf: ReadonlyArray<{
            readonly type: string;
            readonly required?: ReadonlyArray<string>;
          }>;
        };
      };
    };
    const publishSchema = publish.definition.inputSchema as {
      readonly properties: {
        readonly artifact: {
          readonly properties: Readonly<Record<string, unknown>>;
          readonly required: ReadonlyArray<string>;
        };
      };
    };

    expect(reportSchema.required).toContain("evidence");
    expect(reportSchema.properties.state.anyOf.flatMap((branch) => branch.enum)).toContain(
      "reported_complete",
    );
    expect(
      reportSchema.properties.evidence.anyOf.find((branch) => branch.type === "object")?.required,
    ).toEqual(
      expect.arrayContaining([
        "assignmentId",
        "taskId",
        "summary",
        "checks",
        "artifactRefs",
        "reportedAt",
      ]),
    );
    expect(publishSchema.properties.artifact.required).toEqual(
      expect.arrayContaining(["id", "kind", "contentHash", "content", "sourceRefs", "createdAt"]),
    );
    expect(publishSchema.properties.artifact.properties).not.toHaveProperty("rootThreadId");
    expect(publishSchema.properties.artifact.properties).not.toHaveProperty("producerThreadId");
  });

  it.each([
    {
      name: "missing report task identity",
      toolName: "report_status" as const,
      args: {
        expectedRevision: 7,
        expectedProcessRevision: 3,
        progressId: "progress-missing-task",
        progressKind: "completion_evidence",
        progressEvidenceRefs: [],
        assignmentId: "assignment",
        state: "reported_complete",
        summary: "Completed",
        evidence: null,
      },
    },
    {
      name: "malformed nested completion evidence",
      toolName: "report_status" as const,
      args: {
        expectedRevision: 7,
        expectedProcessRevision: 3,
        progressId: "progress-bad-evidence",
        progressKind: "completion_evidence",
        progressEvidenceRefs: [],
        assignmentId: "assignment",
        taskId: "task",
        state: "reported_complete",
        summary: "Completed",
        evidence: { ackCode: "DEMO-LIVE-ACK" },
      },
    },
    {
      name: "malformed artifact",
      toolName: "publish_artifact" as const,
      args: { expectedRevision: 7, artifact: {} },
    },
  ])("returns a recoverable native tool failure for $name", async ({ toolName, args }) => {
    const { tools } = makeTools();
    const tool = tools.find((candidate) => candidate.definition.name === toolName)!;

    await expect(Effect.runPromise(tool.execute(args, context(rootThreadId)))).resolves.toMatchObject(
      {
        ok: false,
        error: { code: "orchestrator_tool_input_invalid" },
      },
    );
  });

  it("lets Root grant a scoped sibling link without making Root an endpoint", async () => {
    const peerTwoThreadId = ThreadId.makeUnsafe("participant-two");
    const { tools, dispatched } = makeTools({
      projectedCore: {
        ...core,
        ownershipEdges: [
          ...core.ownershipEdges,
          {
            ...core.ownershipEdges[0]!,
            childThreadId: peerTwoThreadId,
            decisionReason: {
              ...core.ownershipEdges[0]!.decisionReason,
              summary: "Second independent participant",
            },
          },
        ],
      },
    });
    const createLink = tools.find(
      (tool) => tool.definition.name === "create_communication_link",
    )!;

    const result = await Effect.runPromise(
      createLink.execute(
        {
          expectedRevision: 7,
          linkId: "link-siblings",
          sourceThreadId: participantThreadId,
          targetThreadId: peerTwoThreadId,
          direction: "bidirectional",
          taskId: "task-link",
          runId: null,
          capabilities: ["message.send"],
          reason: "Let the two peers challenge each other directly.",
          expiresAt: "2026-08-02T00:00:00.000Z",
        },
        context(rootThreadId),
      ),
    );

    expect(result).toMatchObject({ ok: true, value: { state: "granted" } });
    expect(dispatched).toEqual([
      expect.objectContaining({
        type: "orchestrator.link.request",
        expectedRevision: 7,
        actor: { kind: "thread", threadId: rootThreadId },
        sourceThreadId: participantThreadId,
        targetThreadId: peerTwoThreadId,
      }),
      expect.objectContaining({
        type: "orchestrator.link.set",
        expectedRevision: 8,
        linkId: "link-siblings",
        state: "granted",
      }),
    ]);
  });

  it("validates an exact native-capable model before atomically creating a child", async () => {
    const { tools, dispatched, providerCapabilityRequests } = makeTools();
    const createChild = tools.find((tool) => tool.definition.name === "create_child_thread")!;

    const result = await Effect.runPromise(
      createChild.execute(
        {
          expectedRevision: 7,
          title: "Independent child",
          role: "participant",
          allowedCapabilities: ["state.read", "message.send"],
          modelTarget: {
            provider: "codex",
            model: "gpt-5.4-mini",
            runtimeMode: "approval-required",
            workspaceRoot: "/tmp/project",
          },
          decisionReason: {
            summary: "Independent framing",
            taskFit: ["analysis"],
            contextHealth: "healthy",
            cacheEconomics: "unknown",
            selectedAt: createdAt,
          },
        },
        context(rootThreadId, { requests: providerCapabilityRequests }),
      ),
    );

    expect(result).toMatchObject({ ok: true, value: { model: "gpt-5.4-mini" } });
    expect(providerCapabilityRequests).toEqual([
      { provider: "codex", model: "gpt-5.4-mini" },
    ]);
    expect(dispatched).toEqual([
      expect.objectContaining({
        type: "orchestrator.child.create",
        parentThreadId: rootThreadId,
        modelTarget: expect.objectContaining({ model: "gpt-5.4-mini" }),
      }),
    ]);
  });

  it("rejects a display model alias before creating any child state", async () => {
    const { tools, dispatched } = makeTools();
    const createChild = tools.find((tool) => tool.definition.name === "create_child_thread")!;

    const result = await Effect.runPromise(
      createChild.execute(
        {
          expectedRevision: 7,
          title: "Invalid child",
          role: "participant",
          allowedCapabilities: ["state.read"],
          modelTarget: {
            provider: "codex",
            model: "Luna",
            runtimeMode: "approval-required",
            workspaceRoot: "/tmp/project",
          },
          decisionReason: {
            summary: "Independent framing",
            taskFit: ["analysis"],
            contextHealth: "healthy",
            cacheEconomics: "unknown",
            selectedAt: createdAt,
          },
        },
        context(rootThreadId, { failure: true }),
      ),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "provider_model_unavailable" },
    });
    expect(dispatched).toHaveLength(0);
  });

  it("publishes a complete non-duplicative standalone-child assignment wire contract", () => {
    const { tools } = makeTools();
    const assignment = tools.find(
      (tool) => tool.definition.name === "assign_task",
    )!;

    expect(assignment.definition.inputSchema).toMatchObject({
      properties: {
        continuity: {
          oneOf: expect.arrayContaining([
            expect.objectContaining({ required: ["kind", "threadId"] }),
            expect.objectContaining({ required: ["kind", "sourceThreadId", "contextBundle"] }),
            expect.objectContaining({ required: ["kind", "contextBundle"] }),
          ]),
        },
        modelTarget: {
          required: ["provider", "model", "runtimeMode", "workspaceRoot"],
        },
        decisionReason: {
          required: ["summary", "taskFit", "contextHealth", "cacheEconomics", "selectedAt"],
        },
        contextBundleId: { type: "string" },
        allowedCapabilities: { maxItems: 32 },
        assignmentState: { type: "string" },
        startInitialTurn: { type: "boolean" },
      },
      required: expect.arrayContaining([
        "taskId",
        "assignmentId",
        "continuity",
        "modelTarget",
        "decisionReason",
        "contextBundleId",
        "allowedCapabilities",
        "assignmentState",
        "startInitialTurn",
      ]),
    });
    expect(assignment.definition.inputSchema.properties).not.toHaveProperty("contract");
  });

  it("attaches a caller-created standalone thread before creating its assignment", async () => {
    const standaloneThreadId = ThreadId.makeUnsafe("standalone");
    const { tools, dispatched } = makeTools({
      standaloneThread: {
        id: standaloneThreadId,
        projectId,
        sourceThreadId: rootThreadId,
        parentThreadId: null,
        creationSource: "synara_mcp",
        subagentAgentId: null,
        modelSelection: { provider: "codex", model: "gpt-5.4-mini" },
        runtimeMode: "approval-required",
      },
    });
    const assignment = tools.find(
      (tool) => tool.definition.name === "assign_task",
    )!;

    await Effect.runPromise(
      assignment.execute(
        {
          expectedRevision: 7,
          expectedProcessRevision: 3,
          processId,
          bindingId: "binding-standalone",
          bindingRole: "owner",
          taskId: "task-standalone",
          assignmentId: "assignment-standalone",
          continuity: { kind: "reuse", threadId: standaloneThreadId },
          modelTarget: {
            provider: "codex",
            model: "gpt-5.4-mini",
            runtimeMode: "approval-required",
            workspaceRoot: "/tmp/project",
          },
          decisionReason: {
            summary: "Use an independent Codex child.",
            taskFit: ["analysis"],
            contextHealth: "healthy",
            cacheEconomics: "unknown",
            selectedAt: createdAt,
          },
          contractVersion: 1,
          goal: "Analyze independently.",
          acceptanceCriteria: ["Return one neutral sentence."],
          immutableUserConstraints: ["Do not modify the workspace."],
          workingAssumptions: [],
          contextBundleId: "context-standalone",
          pathOwnershipClaims: [],
          dependencyRefs: [],
          expectedApis: [],
          allowedCapabilities: ["state.read", "assignment.report"],
          evidenceRequirements: ["Final response"],
          verifierClass: "root",
          assignmentState: "running",
          supersedesVersion: null,
          startInitialTurn: false,
        },
        context(rootThreadId),
      ),
    );

    expect(dispatched).toHaveLength(2);
    expect(dispatched[0]).toMatchObject({
      type: "orchestrator.child.attach",
      expectedRevision: 7,
      parentThreadId: rootThreadId,
      childThreadId: standaloneThreadId,
      role: "participant",
      capabilities: ["state.read", "assignment.report"],
    });
    expect(dispatched[1]).toMatchObject({
      type: "orchestrator.assignment.create",
      expectedRevision: 8,
      expectedProcessRevision: 3,
      processId,
      contract: {
        assignmentId: "assignment-standalone",
        taskId: "task-standalone",
        ownerThreadId: rootThreadId,
        assigneeThreadId: standaloneThreadId,
      },
    });
  });

  it("creates and attaches a clean standalone child before starting its first assignment turn", async () => {
    const assignmentId = AssignmentId.makeUnsafe("assignment-clean");
    const bundleInput = {
      id: "context-clean",
      version: 1,
      originalBrief: "Investigate independently.",
      acceptedDecisions: [],
      rejectedAlternatives: [],
      sourceRefs: [],
      threadMessageRefs: [],
      artifactRefs: [],
    };
    const bundle = sealContextBundle({
      id: ContextBundleId.makeUnsafe(bundleInput.id),
      version: bundleInput.version,
      assignmentId,
      originalBrief: bundleInput.originalBrief,
      immutableUserConstraints: ["Do not modify the workspace."],
      acceptedDecisions: bundleInput.acceptedDecisions,
      rejectedAlternatives: bundleInput.rejectedAlternatives,
      ownershipClaims: [],
      dependencyRefs: [],
      sourceRefs: bundleInput.sourceRefs,
      threadMessageRefs: bundleInput.threadMessageRefs,
      artifactRefs: bundleInput.artifactRefs,
      capabilityCeiling: ["state.read", "assignment.report"],
      createdBy: { kind: "thread", threadId: rootThreadId },
      createdAt,
    });
    const liveProviderCapability = {
      ...core.providerCapabilities[0]!,
      observedAt: "2026-08-01T00:00:01.000Z",
    };
    const { tools, dispatched, providerCapabilityRequests, persistedProviderCapabilities } =
      makeTools({
        projectedCore: {
          ...core,
          providerCapabilities: [
            {
              ...liveProviderCapability,
              orchestratorCapable: false,
              observedAt: createdAt,
            },
          ],
        },
      });
    const assignment = tools.find(
      (tool) => tool.definition.name === "assign_task",
    )!;

    await Effect.runPromise(
      assignment.execute(
        {
          expectedRevision: 7,
          expectedProcessRevision: 3,
          processId,
          bindingId: "binding-clean",
          bindingRole: "owner",
          taskId: "task-clean",
          assignmentId,
          continuity: { kind: "clean", contextBundle: bundleInput },
          modelTarget: {
            provider: "codex",
            model: "gpt-5.4-mini",
            runtimeMode: "approval-required",
            workspaceRoot: "/tmp/project",
          },
          decisionReason: {
            summary: "Use fresh context for independent discovery.",
            taskFit: ["discovery"],
            contextHealth: "stale",
            cacheEconomics: "expired",
            selectedAt: createdAt,
          },
          contractVersion: 1,
          goal: "Investigate independently.",
          acceptanceCriteria: ["Report evidence."],
          immutableUserConstraints: ["Do not modify the workspace."],
          workingAssumptions: [],
          contextBundleId: bundle.id,
          pathOwnershipClaims: [],
          dependencyRefs: [],
          expectedApis: [],
          allowedCapabilities: ["state.read", "assignment.report"],
          evidenceRequirements: ["Final response"],
          verifierClass: "root",
          assignmentState: "running",
          supersedesVersion: null,
          startInitialTurn: true,
        },
        context(rootThreadId, {
          requests: providerCapabilityRequests,
          capability: liveProviderCapability,
        }),
      ),
    );

    expect(dispatched.map((command) => command.type)).toEqual([
      "thread.create",
      "orchestrator.child.attach",
      "orchestrator.assignment.create",
      "orchestrator.message.enqueue",
    ]);
    expect(providerCapabilityRequests).toEqual([
      { provider: "codex", model: "gpt-5.4-mini" },
    ]);
    expect(persistedProviderCapabilities).toEqual([liveProviderCapability]);
    const createCommand = dispatched[0];
    if (createCommand?.type !== "thread.create") throw new Error("Expected thread.create.");
    const childThreadId = createCommand.threadId;
    expect(dispatched[0]).toMatchObject({
      type: "thread.create",
      parentThreadId: null,
      creationSource: "orchestrator_native",
      sourceThreadId: rootThreadId,
      modelSelection: { provider: "codex", model: "gpt-5.4-mini" },
    });
    const attachCommand = dispatched[1];
    expect(attachCommand).toMatchObject({
      type: "orchestrator.child.attach",
      childThreadId,
      continuity: { kind: "clean", contextBundle: { id: bundle.id } },
    });
    if (
      attachCommand?.type !== "orchestrator.child.attach" ||
      attachCommand.continuity.kind !== "clean"
    ) {
      throw new Error("Expected clean orchestrator.child.attach.");
    }
    expect(verifyContextBundle(attachCommand.continuity.contextBundle)).toBe(true);
    expect(dispatched[2]).toMatchObject({
      type: "orchestrator.assignment.create",
      contract: { assignmentId, assigneeThreadId: childThreadId },
    });
    expect(dispatched[3]).toMatchObject({
      type: "orchestrator.message.enqueue",
      message: {
        messageId: `orchestrator-assignment:${assignmentId}:v1:initial`,
        senderThreadId: rootThreadId,
        targetThreadId: childThreadId,
        assignmentId,
        correlationId: null,
        replyToMessageId: null,
        hopCount: 0,
        deliveryState: "queued",
      },
    });
  });

  it("derives actor, Root, project, and process instead of trusting spoofed arguments", async () => {
    const { tools, dispatched } = makeTools();
    const create = tools.find((tool) => tool.definition.name === "create_task")!;
    await Effect.runPromise(
      create.execute(
        {
          expectedRevision: 3,
          taskId: "task",
          title: "Task",
          acceptanceCriteria: [],
          priority: "normal",
          orderKey: "a",
          actor: { kind: "user", actorId: "forged" },
          rootThreadId: "forged-root",
          projectId: "forged-project",
          processId: "forged-process",
          readiness: "ready",
          executionHealth: "running",
        },
        context(rootThreadId),
      ),
    );
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      type: "project-task.create",
      processId,
      projectId,
      taskId: ProjectTaskId.makeUnsafe("task"),
      actor: { kind: "thread", threadId: rootThreadId },
    });
    expect(dispatched[0]).not.toHaveProperty("readiness");
    expect(dispatched[0]).not.toHaveProperty("executionHealth");
  });

  it("hides and rechecks Root-only tools for a participant", async () => {
    const { tools, dispatched } = makeTools();
    const create = tools.find((tool) => tool.definition.name === "create_task")!;
    await expect(Effect.runPromise(create.isVisible!(context(participantThreadId)))).resolves.toBe(
      false,
    );
    const result = await Effect.runPromise(
      create.execute(
        {
          expectedRevision: 3,
          taskId: "forged-task",
          title: "Forged",
          acceptanceCriteria: [],
          priority: "normal",
          orderKey: "a",
        },
        context(participantThreadId),
      ),
    );
    expect(result.ok).toBe(false);
    expect(dispatched).toHaveLength(0);
  });
});
