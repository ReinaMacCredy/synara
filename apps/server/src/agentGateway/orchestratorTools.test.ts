import {
  AssignmentId,
  ContextBundleId,
  ProjectId,
  ProjectTaskId,
  TaskProcessId,
  ThreadId,
  type OrchestrationCommand,
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
import { sealContextBundle } from "../orchestration/orchestrator/contextBundles.ts";
import type { ToolContext } from "./toolRuntime.ts";
import { makeOrchestratorTools } from "./orchestratorTools.ts";

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
      authenticatedMcp: true,
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

const context = (threadId: string): ToolContext => ({
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
  const orchestratorRepository = {
    findRootForThread: () => Effect.succeed(Option.some(rootThreadId)),
    getCore: () => Effect.succeed(Option.some(options.projectedCore ?? core)),
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
      "synara_task_process_create",
      "synara_task_process_get",
      "synara_orchestrator_get_state",
      "synara_task_create",
      "synara_task_update",
      "synara_task_set_dependencies",
      "synara_task_transition",
      "synara_orchestrator_assign_task",
      "synara_orchestrator_send_message",
      "synara_orchestrator_request_link",
      "synara_orchestrator_set_link",
      "synara_orchestrator_publish_artifact",
      "synara_orchestrator_update_run",
      "synara_orchestrator_read_child",
      "synara_orchestrator_report_status",
      "synara_orchestrator_request_change",
      "synara_orchestrator_wait",
      "synara_orchestrator_retire_child",
    ]);
  });

  it("publishes a complete non-duplicative standalone-child assignment wire contract", () => {
    const { tools } = makeTools();
    const assignment = tools.find(
      (tool) => tool.definition.name === "synara_orchestrator_assign_task",
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
      (tool) => tool.definition.name === "synara_orchestrator_assign_task",
    )!;

    await Effect.runPromise(
      assignment.handler(
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
    const { tools, dispatched } = makeTools();
    const assignment = tools.find(
      (tool) => tool.definition.name === "synara_orchestrator_assign_task",
    )!;

    await Effect.runPromise(
      assignment.handler(
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
        context(rootThreadId),
      ),
    );

    expect(dispatched.map((command) => command.type)).toEqual([
      "thread.create",
      "orchestrator.child.attach",
      "orchestrator.assignment.create",
      "thread.turn.start",
    ]);
    const createCommand = dispatched[0];
    if (createCommand?.type !== "thread.create") throw new Error("Expected thread.create.");
    const childThreadId = createCommand.threadId;
    expect(dispatched[0]).toMatchObject({
      type: "thread.create",
      parentThreadId: null,
      creationSource: "synara_mcp",
      sourceThreadId: rootThreadId,
      modelSelection: { provider: "codex", model: "gpt-5.4-mini" },
    });
    expect(dispatched[1]).toMatchObject({
      type: "orchestrator.child.attach",
      childThreadId,
      continuity: { kind: "clean", contextBundle: { contentHash: bundle.contentHash } },
    });
    expect(dispatched[2]).toMatchObject({
      type: "orchestrator.assignment.create",
      contract: { assignmentId, assigneeThreadId: childThreadId },
    });
    expect(dispatched[3]).toMatchObject({
      type: "thread.turn.start",
      threadId: childThreadId,
      message: { role: "thread" },
      dispatchOrigin: "orchestrator",
      threadOrigin: { senderThreadId: rootThreadId, assignmentId },
    });
  });

  it("derives actor, Root, project, and process instead of trusting spoofed arguments", async () => {
    const { tools, dispatched } = makeTools();
    const create = tools.find((tool) => tool.definition.name === "synara_task_create")!;
    await Effect.runPromise(
      create.handler(
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
    const create = tools.find((tool) => tool.definition.name === "synara_task_create")!;
    await expect(Effect.runPromise(create.isVisible!(context(participantThreadId)))).resolves.toBe(
      false,
    );
    const result = await Effect.runPromise(
      create.handler(
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
    expect(result.isError).toBe(true);
    expect(dispatched).toHaveLength(0);
  });
});
