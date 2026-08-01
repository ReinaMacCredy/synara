import { createHash, randomUUID } from "node:crypto";

import {
  ArtifactId,
  AssignmentCompletionEvidence,
  AssignmentContract,
  AssignmentId,
  ChildContinuity,
  CommandId,
  ContextBundleId,
  MessageId,
  ModelSelection,
  MonitorId,
  OrchestrationCommand,
  OrchestratorArtifact,
  OrchestratorLinkId,
  OrchestratorMessageId,
  OrchestratorDecisionReason,
  OrchestratorModelTarget,
  OrchestratorRun,
  OrchestratorRunId,
  ProjectTaskId,
  TaskDependencyEdgeId,
  TaskProcessId,
  TaskProgressEntryId,
  TaskThreadBindingId,
  ThreadId,
  TurnId,
  RuntimeMode,
  type ContextBundle as ContextBundleValue,
  type OrchestratorCommunicationLink,
  type OrchestratorRole,
  type OrchestratorToolName,
  type ProjectTaskPriority,
  type TaskProcessGraphProjection,
  type TaskThreadRole,
} from "@synara/contracts";
import { Effect, Option, Schema } from "effect";
import { runtimeModeEscalatesPrivilege } from "@synara/shared/runtimeMode";

import type { OrchestrationEngineShape } from "../orchestration/Services/OrchestrationEngine.ts";
import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { OrchestratorArtifactRepositoryShape } from "../persistence/Services/OrchestratorArtifacts.ts";
import type { ProjectionOrchestratorRepositoryShape } from "../persistence/Services/ProjectionOrchestrator.ts";
import type { ProjectionTaskProcessRepositoryShape } from "../persistence/Services/ProjectionTaskProcess.ts";
import type { ProviderDiscoveryServiceShape } from "../provider/Services/ProviderDiscoveryService.ts";
import { sealContextBundle } from "../orchestration/orchestrator/contextBundles.ts";
import { mcpToolResultError, mcpToolResultJson, type McpToolCallResult } from "./protocol.ts";
import { summarizeThreadDetail } from "./threadSummary.ts";
import {
  errorText,
  readNumberArg,
  readRecordArg,
  readStringArg,
  ToolInputError,
} from "./toolInput.ts";
import {
  gatewayToolErrorResult,
  GatewayToolError,
  READ_ONLY_TOOL_ANNOTATIONS,
  WRITE_TOOL_ANNOTATIONS,
  type ToolContext,
  type ToolEntry,
} from "./toolRuntime.ts";
import {
  canReadOrchestratorThread,
  filterOrchestratorCoreForCaller,
  isOrchestratorToolVisible,
  resolveOrchestratorCallerAuthority,
  type OrchestratorCallerAuthority,
} from "./orchestratorToolPolicy.ts";

const MAX_READY_TASKS = 32;
const MAX_CHILD_READ_ROWS = 200;

type JsonSchema = Readonly<Record<string, unknown>>;

export interface OrchestratorToolsInput {
  readonly orchestratorRepository: ProjectionOrchestratorRepositoryShape;
  readonly taskProcessRepository: ProjectionTaskProcessRepositoryShape;
  readonly artifactRepository: OrchestratorArtifactRepositoryShape;
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly snapshotQuery: ProjectionSnapshotQueryShape;
  readonly providerDiscovery: ProviderDiscoveryServiceShape;
}

const objectSchema = (
  properties: Readonly<Record<string, unknown>>,
  required: ReadonlyArray<string> = [],
): JsonSchema => ({ type: "object", properties, required, additionalProperties: false });

const integer = { type: "integer", minimum: 0 } as const;
const stringArray = (maxItems = 128) => ({
  type: "array",
  maxItems,
  items: { type: "string" },
});

const expectedRevisionSchema = {
  expectedRevision: integer,
};

const allowedCapabilitiesInputSchema = {
  type: "array",
  maxItems: 32,
  uniqueItems: true,
  items: {
    type: "string",
    enum: [
      "state.read",
      "subtree.read",
      "child.assign",
      "child.retire",
      "link.request",
      "link.manage",
      "message.send",
      "artifact.publish",
      "artifact.release",
      "run.manage",
      "monitor.manage",
      "assignment.report",
      "assignment.verify",
      "assignment.accept",
      "task.manage",
      "writer-claim.manage",
    ],
  },
} as const;

const contextBundleInputSchema = objectSchema(
  {
    id: { type: "string" },
    version: { type: "integer", minimum: 1 },
    originalBrief: { type: "string", maxLength: 64_000 },
    acceptedDecisions: stringArray(256),
    rejectedAlternatives: stringArray(128),
    sourceRefs: stringArray(256),
    threadMessageRefs: stringArray(256),
    artifactRefs: stringArray(256),
  },
  [
    "id",
    "version",
    "originalBrief",
    "acceptedDecisions",
    "rejectedAlternatives",
    "sourceRefs",
    "threadMessageRefs",
    "artifactRefs",
  ],
);

const assignmentContinuityInputSchema = {
  oneOf: [
    objectSchema(
      {
        kind: { type: "string", const: "reuse" },
        threadId: { type: "string" },
      },
      ["kind", "threadId"],
    ),
    objectSchema(
      {
        kind: { type: "string", const: "rotate" },
        sourceThreadId: { type: "string" },
        contextBundle: contextBundleInputSchema,
      },
      ["kind", "sourceThreadId", "contextBundle"],
    ),
    objectSchema(
      {
        kind: { type: "string", const: "clean" },
        contextBundle: contextBundleInputSchema,
      },
      ["kind", "contextBundle"],
    ),
  ],
  description:
    "Root chooses reuse, rotate with a curated immutable ContextBundle, or clean creation. Synara never chooses or substitutes continuity.",
} as const;

const modelTargetInputSchema = objectSchema(
  {
    provider: { type: "string" },
    model: { type: "string" },
    runtimeMode: { type: "string" },
    workspaceRoot: {
      type: "string",
      description: "The standalone child thread working directory.",
    },
    providerOptions: {
      type: "object",
      additionalProperties: { type: ["string", "number", "boolean"] },
    },
  },
  ["provider", "model", "runtimeMode", "workspaceRoot"],
);

const decisionReasonInputSchema = objectSchema(
  {
    summary: { type: "string", maxLength: 4_000 },
    taskFit: stringArray(32),
    contextHealth: {
      type: "string",
      enum: ["healthy", "anchored", "saturated", "stale", "unknown"],
    },
    cacheEconomics: {
      type: "string",
      enum: ["reuse", "expiring", "expired", "unavailable", "unknown"],
    },
    selectedAt: { type: "string", format: "date-time" },
  },
  ["summary", "taskFit", "contextHealth", "cacheEconomics", "selectedAt"],
);

const assignmentStateInputSchema = {
  type: "string",
  enum: [
    "queued",
    "running",
    "waiting_on_thread",
    "waiting_on_user",
    "needs_permission",
    "blocked",
    "reported_complete",
    "verified",
    "accepted",
    "reopened",
    "failed",
    "cancelled",
  ],
} as const;

const decode = <S extends Schema.Top>(
  schema: S,
  value: unknown,
  label: string,
): Schema.Schema.Type<S> => {
  try {
    return Schema.decodeUnknownSync(schema as never)(value) as Schema.Schema.Type<S>;
  } catch (error) {
    throw new ToolInputError(`${label} is invalid: ${errorText(error)}`);
  }
};

const readInteger = (
  args: Record<string, unknown>,
  key: string,
  options: { readonly required?: boolean; readonly max?: number } = {},
): number | undefined => {
  const value = readNumberArg(args, key);
  if (value === undefined) {
    if (options.required) throw new ToolInputError(`Missing required argument "${key}".`);
    return undefined;
  }
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    (options.max !== undefined && value > options.max)
  ) {
    throw new ToolInputError(`Argument "${key}" is outside its allowed integer range.`);
  }
  return value;
};

const readStrings = (
  args: Record<string, unknown>,
  key: string,
  options: { readonly required?: boolean; readonly max?: number } = {},
): ReadonlyArray<string> | undefined => {
  const value = args[key];
  if (value === undefined) {
    if (options.required) throw new ToolInputError(`Missing required argument "${key}".`);
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.trim().length === 0) ||
    value.length > (options.max ?? 128)
  ) {
    throw new ToolInputError(`Argument "${key}" must be a bounded array of non-empty strings.`);
  }
  return value;
};

const readRequiredRecord = (
  args: Record<string, unknown>,
  key: string,
): Record<string, unknown> => {
  const value = readRecordArg(args, key);
  if (value === undefined) throw new ToolInputError(`Missing required argument "${key}".`);
  return value;
};

const asToolError = (error: unknown): McpToolCallResult =>
  error instanceof GatewayToolError
    ? gatewayToolErrorResult(error)
    : mcpToolResultError(errorText(error));

const actorFor = (authority: OrchestratorCallerAuthority) => ({
  kind: "thread" as const,
  threadId: authority.callerThreadId,
});

const now = () => new Date().toISOString();

const orchestratorChildThreadId = (input: {
  readonly rootThreadId: ThreadId;
  readonly assignmentId: string;
  readonly contractVersion: number;
  readonly contextHash: string;
}): ThreadId =>
  ThreadId.makeUnsafe(
    `orchestrator-child:${createHash("sha256")
      .update(
        JSON.stringify({
          rootThreadId: input.rootThreadId,
          assignmentId: input.assignmentId,
          contractVersion: input.contractVersion,
          contextHash: input.contextHash,
        }),
      )
      .digest("hex")
      .slice(0, 32)}`,
  );

const renderAssignmentPrompt = (input: {
  readonly assignmentId: string;
  readonly taskId: string;
  readonly goal: string;
  readonly acceptanceCriteria: ReadonlyArray<string>;
  readonly immutableUserConstraints: ReadonlyArray<string>;
  readonly workingAssumptions: ReadonlyArray<string>;
  readonly contextBundle: ContextBundleValue | null;
}): string =>
  [
    `Synara Assignment ${input.assignmentId} for task ${input.taskId}`,
    "",
    "Goal:",
    input.goal,
    "",
    "Acceptance criteria:",
    JSON.stringify(input.acceptanceCriteria),
    "",
    "Immutable user constraints:",
    JSON.stringify(input.immutableUserConstraints),
    "",
    "Working assumptions:",
    JSON.stringify(input.workingAssumptions),
    ...(input.contextBundle
      ? [
          "",
          `Immutable ContextBundle ${input.contextBundle.id} v${input.contextBundle.version} (${input.contextBundle.contentHash}):`,
          "<synara_context_bundle>",
          JSON.stringify(input.contextBundle),
          "</synara_context_bundle>",
        ]
      : []),
    "",
    "Work independently. You may reframe, propose alternatives, ask for clarification, or report a blocker through ORCHESTRATOR_PROTOCOL_V1.",
  ].join("\n");

const rootCommandBase = (authority: OrchestratorCallerAuthority, expectedRevision: number) => ({
  commandId: CommandId.makeUnsafe(`orchestrator-tool:${randomUUID()}`),
  rootThreadId: authority.rootThreadId,
  projectId: authority.core.root.root.projectId,
  actor: actorFor(authority),
  protocolVersion: authority.core.root.root.protocolVersion,
  expectedRevision,
  createdAt: now(),
});

const taskCommandBase = (authority: OrchestratorCallerAuthority, expectedRevision: number) => {
  const processId = authority.core.root.root.activeProcessId;
  if (processId === null) throw new ToolInputError("This Root has no active TaskProcess.");
  return {
    commandId: CommandId.makeUnsafe(`orchestrator-tool:${randomUUID()}`),
    processId,
    projectId: authority.core.root.root.projectId,
    actor: actorFor(authority),
    expectedRevision,
    createdAt: now(),
  };
};

const summarizeGraph = (
  authority: OrchestratorCallerAuthority,
  graph: TaskProcessGraphProjection,
  readyLimit: number,
  selectedTaskId?: string,
) => {
  const visibleTaskIds =
    authority.role === "root"
      ? new Set(graph.tasks.map(({ task }) => task.id))
      : new Set(
          filterOrchestratorCoreForCaller(authority).assignments.map(
            (assignment) => assignment.taskId,
          ),
        );
  const visibleTasks = graph.tasks.filter(({ task }) => visibleTaskIds.has(task.id));
  const readyTasks = visibleTasks
    .filter((task) => task.readiness === "ready" && task.task.lifecycle === "planned")
    .toSorted((left, right) => left.task.orderKey.localeCompare(right.task.orderKey));
  const selectedTask = selectedTaskId
    ? (visibleTasks.find(({ task }) => task.id === selectedTaskId) ?? null)
    : null;
  return {
    process: graph.process,
    graphRevision: graph.graphRevision,
    counts: {
      total: visibleTasks.length,
      done: visibleTasks.filter(({ task }) => task.lifecycle === "done").length,
      ready: readyTasks.length,
      blocked: visibleTasks.filter((task) => task.readiness === "blocked").length,
      running: visibleTasks.filter((task) => task.executionHealth === "running").length,
      review: visibleTasks.filter(({ task }) => task.lifecycle === "review").length,
      failed: visibleTasks.filter(({ task }) => task.lifecycle === "failed").length,
    },
    readyTasks: readyTasks.slice(0, readyLimit),
    readyTasksHasMore: readyTasks.length > readyLimit,
    selectedTask,
  };
};

export function makeOrchestratorTools(input: OrchestratorToolsInput): ReadonlyArray<ToolEntry> {
  const loadAuthority = (context: Omit<ToolContext, "jsonRpcRequestId">) =>
    Effect.gen(function* () {
      const callerThreadId = ThreadId.makeUnsafe(context.callerThreadId);
      const rootThreadId = yield* input.orchestratorRepository
        .findRootForThread(callerThreadId)
        .pipe(Effect.mapError((error) => new ToolInputError(errorText(error))));
      if (Option.isNone(rootThreadId)) {
        return yield* Effect.fail(
          new GatewayToolError(
            "orchestrator_role_required",
            "This thread is not an active Root or Child in an Orchestrator aggregate.",
          ),
        );
      }
      const core = yield* input.orchestratorRepository
        .getCore(rootThreadId.value)
        .pipe(Effect.mapError((error) => new ToolInputError(errorText(error))));
      if (Option.isNone(core)) {
        return yield* Effect.fail(
          new GatewayToolError(
            "orchestrator_state_unavailable",
            "The durable Orchestrator projection is unavailable.",
          ),
        );
      }
      const authority = resolveOrchestratorCallerAuthority({ core: core.value, callerThreadId });
      if (authority === null) {
        return yield* Effect.fail(
          new GatewayToolError(
            "orchestrator_role_required",
            "The caller no longer has an active Orchestrator role.",
          ),
        );
      }
      return authority;
    });

  const getGraph = (authority: OrchestratorCallerAuthority) => {
    const processId = authority.core.root.root.activeProcessId;
    if (processId === null)
      return Effect.fail(new ToolInputError("This Root has no active TaskProcess."));
    return input.taskProcessRepository.getGraph(processId).pipe(
      Effect.mapError((error) => new ToolInputError(errorText(error))),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(new ToolInputError(`TaskProcess "${processId}" was not found.`)),
          onSome: Effect.succeed,
        }),
      ),
    );
  };

  const dispatch = (command: unknown) =>
    input.orchestrationEngine
      .dispatch(decode(OrchestrationCommand, command, "Orchestrator command"))
      .pipe(Effect.mapError((error) => new ToolInputError(errorText(error))));

  const makeEntry = (definition: {
    readonly name: OrchestratorToolName;
    readonly description: string;
    readonly inputSchema: JsonSchema;
    readonly readOnly?: boolean;
    readonly handle: (
      args: Record<string, unknown>,
      context: ToolContext,
      authority: OrchestratorCallerAuthority,
    ) => Effect.Effect<McpToolCallResult, unknown>;
  }): ToolEntry => ({
    requiredCapability: definition.readOnly ? "thread:read" : "thread:write",
    ...(definition.readOnly ? {} : { requiresActiveTurn: true }),
    isVisible: (context) =>
      loadAuthority(context).pipe(
        Effect.map((authority) => isOrchestratorToolVisible(authority, definition.name)),
        Effect.orElseSucceed(() => false),
      ),
    definition: {
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
      annotations: {
        title: definition.name,
        ...(definition.readOnly ? READ_ONLY_TOOL_ANNOTATIONS : WRITE_TOOL_ANNOTATIONS),
      },
    },
    handler: (args, context) =>
      Effect.gen(function* () {
        const authority = yield* loadAuthority(context);
        if (!isOrchestratorToolVisible(authority, definition.name)) {
          return yield* Effect.fail(
            new GatewayToolError(
              "orchestrator_capability_denied",
              `Role ${authority.role} cannot call ${definition.name}.`,
            ),
          );
        }
        return yield* definition.handle(args, context, authority);
      }).pipe(Effect.catch((error) => Effect.succeed(asToolError(error)))),
  });

  const entries: ToolEntry[] = [];

  entries.push(
    makeEntry({
      name: "synara_task_process_create",
      description:
        "Create and atomically select one Root-owned TaskProcess when this Root has no active process.",
      inputSchema: objectSchema(
        {
          expectedRevision: integer,
          processId: { type: "string" },
          title: { type: "string", maxLength: 512 },
        },
        ["expectedRevision", "processId", "title"],
      ),
      handle: (args, _context, authority) =>
        Effect.gen(function* () {
          if (authority.role !== "root") {
            return yield* Effect.fail(
              new GatewayToolError(
                "orchestrator_capability_denied",
                "Only the Root may create its TaskProcess.",
              ),
            );
          }
          if (authority.core.root.root.activeProcessId !== null) {
            return yield* Effect.fail(
              new ToolInputError(
                "Complete or archive the active TaskProcess before creating another.",
              ),
            );
          }
          const expectedRevision = readInteger(args, "expectedRevision", { required: true })!;
          const processId = TaskProcessId.makeUnsafe(
            readStringArg(args, "processId", { required: true })!,
          );
          const result = yield* dispatch({
            type: "task-process.create",
            commandId: CommandId.makeUnsafe(`orchestrator-tool:${randomUUID()}`),
            processId,
            projectId: authority.core.root.root.projectId,
            actor: actorFor(authority),
            expectedRevision: 0,
            rootExpectedRevision: expectedRevision,
            title: readStringArg(args, "title", { required: true })!,
            owner: { kind: "orchestrator", rootThreadId: authority.rootThreadId },
            createdAt: now(),
          });
          const graph = yield* input.taskProcessRepository.getGraph(processId).pipe(
            Effect.mapError((error) => new ToolInputError(errorText(error))),
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.fail(new ToolInputError(`TaskProcess "${processId}" was not found.`)),
                onSome: Effect.succeed,
              }),
            ),
          );
          return mcpToolResultJson({
            sequence: result.sequence,
            process: graph.process,
            graphRevision: graph.graphRevision,
          });
        }),
    }),
    makeEntry({
      name: "synara_task_process_get",
      readOnly: true,
      description:
        "Read the caller-authorized active TaskProcess summary, bounded ready focus, optional task detail, and graph revision.",
      inputSchema: objectSchema({
        taskId: { type: "string" },
        readyLimit: { type: "integer", minimum: 1, maximum: MAX_READY_TASKS },
      }),
      handle: (args, _context, authority) =>
        Effect.gen(function* () {
          const graph = yield* getGraph(authority);
          const readyLimit = readInteger(args, "readyLimit", { max: MAX_READY_TASKS }) ?? 12;
          return mcpToolResultJson(
            summarizeGraph(
              authority,
              graph,
              Math.max(1, readyLimit),
              readStringArg(args, "taskId"),
            ),
          );
        }),
    }),
    makeEntry({
      name: "synara_orchestrator_get_state",
      readOnly: true,
      description:
        "Read role-filtered Root, ownership, link, assignment, run, capacity, and active-process state.",
      inputSchema: objectSchema({}),
      handle: (_args, _context, authority) =>
        Effect.gen(function* () {
          const filtered = filterOrchestratorCoreForCaller(authority);
          const process = authority.core.root.root.activeProcessId
            ? yield* getGraph(authority).pipe(
                Effect.map((graph) => summarizeGraph(authority, graph, 12)),
                Effect.orElseSucceed(() => null),
              )
            : null;
          return mcpToolResultJson({ role: authority.role, ...filtered, process });
        }),
    }),
  );

  entries.push(
    makeEntry({
      name: "synara_task_create",
      description:
        "Create one ProjectTask in the Root's active process at an exact graph revision.",
      inputSchema: objectSchema(
        {
          ...expectedRevisionSchema,
          taskId: { type: "string" },
          parentTaskId: { type: ["string", "null"] },
          title: { type: "string", maxLength: 512 },
          description: { type: ["string", "null"], maxLength: 32_768 },
          acceptanceCriteria: stringArray(),
          priority: { type: "string", enum: ["low", "normal", "high", "critical"] },
          orderKey: { type: "string" },
        },
        ["expectedRevision", "taskId", "title", "acceptanceCriteria", "priority", "orderKey"],
      ),
      handle: (args, _context, authority) =>
        Effect.gen(function* () {
          const expectedRevision = readInteger(args, "expectedRevision", { required: true })!;
          const result = yield* dispatch({
            type: "project-task.create",
            ...taskCommandBase(authority, expectedRevision),
            taskId: ProjectTaskId.makeUnsafe(readStringArg(args, "taskId", { required: true })!),
            parentTaskId:
              args.parentTaskId === null
                ? null
                : readStringArg(args, "parentTaskId")
                  ? ProjectTaskId.makeUnsafe(readStringArg(args, "parentTaskId")!)
                  : null,
            title: readStringArg(args, "title", { required: true })!,
            description:
              args.description === null ? null : (readStringArg(args, "description") ?? null),
            acceptanceCriteria: readStrings(args, "acceptanceCriteria", { required: true })!,
            priority: readStringArg(args, "priority", { required: true })! as ProjectTaskPriority,
            orderKey: readStringArg(args, "orderKey", { required: true })!,
          });
          const graph = yield* getGraph(authority);
          return mcpToolResultJson({
            sequence: result.sequence,
            graphRevision: graph.graphRevision,
          });
        }),
    }),
    makeEntry({
      name: "synara_task_update",
      description:
        "Update task metadata/hierarchy/priority or stable ordering. Readiness and execution health cannot be supplied.",
      inputSchema: objectSchema(
        {
          ...expectedRevisionSchema,
          taskId: { type: "string" },
          operation: { type: "string", enum: ["meta", "reorder"] },
          parentTaskId: { type: ["string", "null"] },
          title: { type: "string" },
          description: { type: ["string", "null"] },
          acceptanceCriteria: stringArray(),
          priority: { type: "string", enum: ["low", "normal", "high", "critical"] },
          orderKey: { type: "string" },
        },
        ["expectedRevision", "taskId", "operation"],
      ),
      handle: (args, _context, authority) =>
        Effect.gen(function* () {
          const expectedRevision = readInteger(args, "expectedRevision", { required: true })!;
          const taskId = ProjectTaskId.makeUnsafe(
            readStringArg(args, "taskId", { required: true })!,
          );
          const operation = readStringArg(args, "operation", { required: true });
          const base = taskCommandBase(authority, expectedRevision);
          const command: OrchestrationCommand =
            operation === "reorder"
              ? {
                  type: "project-task.reorder",
                  ...base,
                  taskId,
                  orderKey: readStringArg(args, "orderKey", { required: true })!,
                }
              : {
                  type: "project-task.meta.update",
                  ...base,
                  taskId,
                  ...(Object.hasOwn(args, "parentTaskId")
                    ? {
                        parentTaskId:
                          args.parentTaskId === null
                            ? null
                            : ProjectTaskId.makeUnsafe(
                                readStringArg(args, "parentTaskId", { required: true })!,
                              ),
                      }
                    : {}),
                  ...(readStringArg(args, "title") ? { title: readStringArg(args, "title")! } : {}),
                  ...(Object.hasOwn(args, "description")
                    ? {
                        description:
                          args.description === null ? null : readStringArg(args, "description")!,
                      }
                    : {}),
                  ...(args.acceptanceCriteria !== undefined
                    ? {
                        acceptanceCriteria: readStrings(args, "acceptanceCriteria", {
                          required: true,
                        })!,
                      }
                    : {}),
                  ...(readStringArg(args, "priority")
                    ? { priority: readStringArg(args, "priority")! as ProjectTaskPriority }
                    : {}),
                };
          const result = yield* dispatch(command);
          const graph = yield* getGraph(authority);
          return mcpToolResultJson({
            sequence: result.sequence,
            graphRevision: graph.graphRevision,
          });
        }),
    }),
    makeEntry({
      name: "synara_task_set_dependencies",
      description:
        "Atomically replace prerequisites or waive one edge with a reason, exact graph revision, scope validation, and cycle rejection.",
      inputSchema: objectSchema(
        {
          ...expectedRevisionSchema,
          operation: { type: "string", enum: ["replace", "waive"] },
          taskId: { type: "string" },
          prerequisiteTaskIds: stringArray(),
          edgeId: { type: "string" },
          reason: { type: "string" },
        },
        ["expectedRevision", "operation"],
      ),
      handle: (args, _context, authority) =>
        Effect.gen(function* () {
          const expectedRevision = readInteger(args, "expectedRevision", { required: true })!;
          const base = taskCommandBase(authority, expectedRevision);
          const operation = readStringArg(args, "operation", { required: true });
          const command: OrchestrationCommand =
            operation === "waive"
              ? {
                  type: "project-task.dependency.waive",
                  ...base,
                  edgeId: TaskDependencyEdgeId.makeUnsafe(
                    readStringArg(args, "edgeId", { required: true })!,
                  ),
                  reason: readStringArg(args, "reason", { required: true })!,
                }
              : {
                  type: "project-task.dependencies.set",
                  ...base,
                  taskId: ProjectTaskId.makeUnsafe(
                    readStringArg(args, "taskId", { required: true })!,
                  ),
                  prerequisiteTaskIds: readStrings(args, "prerequisiteTaskIds", {
                    required: true,
                  })!.map((taskId) => ProjectTaskId.makeUnsafe(taskId)),
                };
          const result = yield* dispatch(command);
          const graph = yield* getGraph(authority);
          return mcpToolResultJson({
            sequence: result.sequence,
            graphRevision: graph.graphRevision,
          });
        }),
    }),
    makeEntry({
      name: "synara_task_transition",
      description:
        "Perform one explicit lifecycle transition, evidence-bearing completion, or reopen. Assignment acceptance never completes a task implicitly.",
      inputSchema: objectSchema(
        {
          ...expectedRevisionSchema,
          action: { type: "string", enum: ["transition", "complete", "reopen"] },
          taskId: { type: "string" },
          lifecycle: {
            type: "string",
            enum: ["planned", "in_progress", "review", "paused", "failed", "cancelled"],
          },
          reason: { type: ["string", "null"] },
          assignmentIds: stringArray(),
          evidenceRefs: stringArray(),
        },
        ["expectedRevision", "action", "taskId"],
      ),
      handle: (args, _context, authority) =>
        Effect.gen(function* () {
          const expectedRevision = readInteger(args, "expectedRevision", { required: true })!;
          const base = taskCommandBase(authority, expectedRevision);
          const taskId = ProjectTaskId.makeUnsafe(
            readStringArg(args, "taskId", { required: true })!,
          );
          const action = readStringArg(args, "action", { required: true });
          const command: OrchestrationCommand =
            action === "complete"
              ? {
                  type: "project-task.complete",
                  ...base,
                  taskId,
                  assignmentIds: readStrings(args, "assignmentIds", { required: true })!,
                  evidenceRefs: readStrings(args, "evidenceRefs", { required: true })!,
                }
              : action === "reopen"
                ? {
                    type: "project-task.reopen",
                    ...base,
                    taskId,
                    reason: readStringArg(args, "reason", { required: true })!,
                  }
                : {
                    type: "project-task.transition",
                    ...base,
                    taskId,
                    lifecycle: readStringArg(args, "lifecycle", { required: true })! as
                      | "planned"
                      | "in_progress"
                      | "review"
                      | "paused"
                      | "failed"
                      | "cancelled",
                    reason: args.reason === null ? null : (readStringArg(args, "reason") ?? null),
                  };
          const result = yield* dispatch(command);
          const graph = yield* getGraph(authority);
          return mcpToolResultJson({
            sequence: result.sequence,
            graphRevision: graph.graphRevision,
          });
        }),
    }),
  );

  entries.push(
    makeEntry({
      name: "synara_orchestrator_assign_task",
      description:
        "Assign an existing task by reusing, rotating, or cleanly creating a standalone child, then atomically persist the Assignment plus TaskThreadBinding. Root supplies continuity, provider/model/runtime, reason, and whether to start a turn; Synara never substitutes them.",
      inputSchema: objectSchema(
        {
          ...expectedRevisionSchema,
          expectedProcessRevision: integer,
          processId: { type: "string" },
          bindingId: { type: "string" },
          bindingRole: {
            type: "string",
            enum: ["owner", "contributor", "reviewer", "verifier", "observer"],
          },
          taskId: { type: "string" },
          assignmentId: { type: "string" },
          continuity: assignmentContinuityInputSchema,
          modelTarget: modelTargetInputSchema,
          decisionReason: decisionReasonInputSchema,
          contractVersion: { type: "integer", minimum: 1 },
          goal: { type: "string", maxLength: 64_000 },
          acceptanceCriteria: stringArray(128),
          immutableUserConstraints: stringArray(128),
          workingAssumptions: stringArray(128),
          contextBundleId: { type: "string" },
          pathOwnershipClaims: stringArray(256),
          dependencyRefs: stringArray(256),
          expectedApis: stringArray(256),
          allowedCapabilities: allowedCapabilitiesInputSchema,
          evidenceRequirements: stringArray(128),
          verifierClass: {
            type: "string",
            enum: ["root", "existing_child", "fresh_child", "council"],
          },
          assignmentState: assignmentStateInputSchema,
          supersedesVersion: { type: ["integer", "null"], minimum: 1 },
          startInitialTurn: { type: "boolean" },
        },
        [
          "expectedRevision",
          "expectedProcessRevision",
          "processId",
          "bindingId",
          "bindingRole",
          "taskId",
          "assignmentId",
          "continuity",
          "modelTarget",
          "decisionReason",
          "contractVersion",
          "goal",
          "acceptanceCriteria",
          "immutableUserConstraints",
          "workingAssumptions",
          "contextBundleId",
          "pathOwnershipClaims",
          "dependencyRefs",
          "expectedApis",
          "allowedCapabilities",
          "evidenceRequirements",
          "verifierClass",
          "assignmentState",
          "supersedesVersion",
          "startInitialTurn",
        ],
      ),
      handle: (args, context, authority) =>
        Effect.gen(function* () {
          const continuityInput = readRequiredRecord(args, "continuity");
          const continuityKind = readStringArg(continuityInput, "kind", { required: true });
          const modelTarget = decode(OrchestratorModelTarget, args.modelTarget, "modelTarget");
          const decisionReason = decode(
            OrchestratorDecisionReason,
            args.decisionReason,
            "decisionReason",
          );
          const taskId = readStringArg(args, "taskId", { required: true })!;
          const assignmentId = readStringArg(args, "assignmentId", { required: true })!;
          const contractVersion = readInteger(args, "contractVersion", { required: true })!;
          const goal = readStringArg(args, "goal", { required: true })!;
          const acceptanceCriteria = readStrings(args, "acceptanceCriteria", {
            required: true,
            max: 128,
          })!;
          const immutableUserConstraints = readStrings(args, "immutableUserConstraints", {
            required: true,
            max: 128,
          })!;
          const workingAssumptions = readStrings(args, "workingAssumptions", {
            required: true,
            max: 128,
          })!;
          const contextBundleId = readStringArg(args, "contextBundleId", { required: true })!;
          const allowedCapabilities = readStrings(args, "allowedCapabilities", {
            required: true,
            max: 32,
          })!;
          const pathOwnershipClaims = readStrings(args, "pathOwnershipClaims", {
            required: true,
            max: 256,
          })!;
          const dependencyRefs = readStrings(args, "dependencyRefs", {
            required: true,
            max: 256,
          })!;
          const timestamp = now();
          if (typeof args.startInitialTurn !== "boolean") {
            return yield* Effect.fail(
              new ToolInputError('Argument "startInitialTurn" must be a boolean.'),
            );
          }
          const startInitialTurn = args.startInitialTurn;
          const contextBundle =
            continuityKind === "reuse"
              ? null
              : yield* Effect.try({
                  try: () => {
                    const bundleInput = readRequiredRecord(continuityInput, "contextBundle");
                    const bundleId = readStringArg(bundleInput, "id", { required: true })!;
                    if (bundleId !== contextBundleId) {
                      throw new ToolInputError(
                        "continuity.contextBundle.id must match contextBundleId.",
                      );
                    }
                    return sealContextBundle({
                      id: ContextBundleId.makeUnsafe(bundleId),
                      version: readInteger(bundleInput, "version", { required: true })!,
                      assignmentId: AssignmentId.makeUnsafe(assignmentId),
                      originalBrief: readStringArg(bundleInput, "originalBrief", {
                        required: true,
                      })!,
                      immutableUserConstraints,
                      acceptedDecisions: readStrings(bundleInput, "acceptedDecisions", {
                        required: true,
                        max: 256,
                      })!,
                      rejectedAlternatives: readStrings(bundleInput, "rejectedAlternatives", {
                        required: true,
                        max: 128,
                      })!,
                      ownershipClaims: pathOwnershipClaims,
                      dependencyRefs,
                      sourceRefs: readStrings(bundleInput, "sourceRefs", {
                        required: true,
                        max: 256,
                      })!,
                      threadMessageRefs: readStrings(bundleInput, "threadMessageRefs", {
                        required: true,
                        max: 256,
                      })!.map((messageId) => OrchestratorMessageId.makeUnsafe(messageId)),
                      artifactRefs: readStrings(bundleInput, "artifactRefs", {
                        required: true,
                        max: 256,
                      })!.map((artifactId) => ArtifactId.makeUnsafe(artifactId)),
                      capabilityCeiling: allowedCapabilities as never,
                      createdBy: { kind: "thread", threadId: authority.callerThreadId },
                      createdAt: timestamp,
                    });
                  },
                  catch: (error) =>
                    error instanceof ToolInputError
                      ? error
                      : new ToolInputError(`contextBundle is invalid: ${errorText(error)}`),
                });
          const continuity = decode(
            ChildContinuity,
            continuityKind === "reuse"
              ? {
                  kind: "reuse",
                  threadId: readStringArg(continuityInput, "threadId", { required: true }),
                }
              : continuityKind === "rotate"
                ? {
                    kind: "rotate",
                    sourceThreadId: readStringArg(continuityInput, "sourceThreadId", {
                      required: true,
                    }),
                    contextBundle,
                  }
                : continuityKind === "clean"
                  ? { kind: "clean", contextBundle }
                  : continuityInput,
            "continuity",
          );
          if (
            continuity.kind === "rotate" &&
            (continuity.sourceThreadId === authority.rootThreadId ||
              !canReadOrchestratorThread(authority, continuity.sourceThreadId))
          ) {
            return yield* Effect.fail(
              new GatewayToolError(
                "rotation_source_unreachable",
                "A rotate source must be a reachable descendant of this Root; the Root itself cannot be rotated.",
              ),
            );
          }
          if (continuity.kind !== "reuse") {
            const providerCapability = yield* input.providerDiscovery
              .getOrchestratorCapability({
                provider: modelTarget.provider,
                model: modelTarget.model,
              })
              .pipe(
                Effect.mapError(
                  () =>
                    new GatewayToolError(
                      "provider_not_orchestrator_capable",
                      "Clean/rotate creation requires the exact live provider/model capability entry with role instruction, authenticated MCP, and independent-session support.",
                    ),
                ),
              );
            if (
              !providerCapability.orchestratorCapable ||
              !providerCapability.authoritativeRoleInstruction ||
              !providerCapability.authenticatedMcp ||
              !providerCapability.independentSession
            ) {
              return yield* Effect.fail(
                new GatewayToolError(
                  "provider_not_orchestrator_capable",
                  "Clean/rotate creation requires the exact live provider/model capability entry with role instruction, authenticated MCP, and independent-session support.",
                ),
              );
            }
            yield* input.orchestratorRepository
              .upsertProviderCapability(providerCapability)
              .pipe(Effect.mapError((error) => new ToolInputError(errorText(error))));
            const capacity = authority.core.capacity;
            if (capacity && capacity.activeSessions >= capacity.sessionLimit) {
              return yield* Effect.fail(
                new GatewayToolError(
                  "orchestrator_capacity_exceeded",
                  "The Root has reached its mechanically enforced active-session ceiling; Synara will not choose a fallback.",
                ),
              );
            }
          }
          const modelSelection = decode(
            ModelSelection,
            {
              provider: modelTarget.provider,
              model: modelTarget.model,
              ...(modelTarget.providerOptions ? { options: modelTarget.providerOptions } : {}),
            },
            "modelTarget provider/model/options",
          );
          const runtimeMode = decode(
            RuntimeMode,
            modelTarget.runtimeMode,
            "modelTarget.runtimeMode",
          );
          const project = yield* input.snapshotQuery
            .getProjectShellById(authority.core.root.root.projectId)
            .pipe(
              Effect.mapError((error) => new ToolInputError(errorText(error))),
              Effect.flatMap(
                Option.match({
                  onNone: () => Effect.fail(new ToolInputError("The Root project does not exist.")),
                  onSome: Effect.succeed,
                }),
              ),
            );
          if (project.workspaceRoot !== modelTarget.workspaceRoot) {
            return yield* Effect.fail(
              new GatewayToolError(
                "assignment_workspace_mismatch",
                "The selected child workspace must exactly match the live Root project workspace.",
              ),
            );
          }
          const rootThread = yield* input.snapshotQuery
            .getThreadShellById(authority.rootThreadId)
            .pipe(
              Effect.mapError((error) => new ToolInputError(errorText(error))),
              Effect.flatMap(
                Option.match({
                  onNone: () => Effect.fail(new ToolInputError("The Root thread does not exist.")),
                  onSome: Effect.succeed,
                }),
              ),
            );
          if (runtimeModeEscalatesPrivilege(rootThread.runtimeMode, runtimeMode)) {
            return yield* Effect.fail(
              new GatewayToolError(
                "assignment_runtime_escalation",
                `The Root runtime mode "${rootThread.runtimeMode}" cannot create or drive a higher-privileged "${runtimeMode}" child.`,
              ),
            );
          }
          const assigneeThreadId =
            continuity.kind === "reuse"
              ? continuity.threadId
              : orchestratorChildThreadId({
                  rootThreadId: authority.rootThreadId,
                  assignmentId,
                  contractVersion,
                  contextHash: contextBundle!.contentHash,
                });
          const contract = decode(
            AssignmentContract,
            {
              assignmentId,
              version: contractVersion,
              taskId,
              ownerThreadId: authority.callerThreadId,
              assigneeThreadId,
              goal,
              acceptanceCriteria,
              immutableUserConstraints,
              workingAssumptions,
              contextBundleId,
              continuity,
              modelTarget,
              decisionReason,
              pathOwnershipClaims,
              dependencyRefs,
              expectedApis: readStrings(args, "expectedApis", {
                required: true,
                max: 256,
              }),
              allowedCapabilities,
              evidenceRequirements: readStrings(args, "evidenceRequirements", {
                required: true,
                max: 128,
              }),
              verifierClass: readStringArg(args, "verifierClass", { required: true }),
              state: readStringArg(args, "assignmentState", { required: true }),
              supersedesVersion:
                args.supersedesVersion === null
                  ? null
                  : readInteger(args, "supersedesVersion", { required: true }),
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            "assignment",
          );
          const processId = TaskProcessId.makeUnsafe(
            readStringArg(args, "processId", { required: true })!,
          );
          if (
            authority.core.root.root.activeProcessId !== processId ||
            contract.taskId !== taskId ||
            contract.assignmentId !== assignmentId
          ) {
            return yield* Effect.fail(
              new GatewayToolError(
                "assignment_scope_mismatch",
                "Process, owner, and assignee are derived from the active Root lease and continuity target.",
              ),
            );
          }
          const existingChild = Option.getOrNull(
            yield* input.snapshotQuery
              .getThreadShellById(contract.assigneeThreadId)
              .pipe(Effect.mapError((error) => new ToolInputError(errorText(error)))),
          );
          const childMatchesTarget =
            existingChild !== null &&
            existingChild.projectId === authority.core.root.root.projectId &&
            existingChild.parentThreadId === null &&
            existingChild.subagentAgentId === null &&
            existingChild.modelSelection.provider === modelTarget.provider &&
            existingChild.modelSelection.model === modelTarget.model &&
            existingChild.runtimeMode === runtimeMode;
          if (continuity.kind === "reuse" && !childMatchesTarget) {
            return yield* Effect.fail(
              new GatewayToolError(
                "assignment_target_mismatch",
                "The reuse target must be a standalone child with the declared project, provider, model, and runtime mode.",
              ),
            );
          }
          const targetIsReachable = canReadOrchestratorThread(authority, contract.assigneeThreadId);
          const targetIsCallerCreatedStandalone =
            childMatchesTarget &&
            existingChild.sourceThreadId === authority.callerThreadId &&
            existingChild.creationSource === "synara_mcp";
          if (
            continuity.kind === "reuse" &&
            !targetIsReachable &&
            !targetIsCallerCreatedStandalone
          ) {
            return yield* Effect.fail(
              new GatewayToolError(
                "assignment_target_unreachable",
                "The assignee must be a reachable child or a standalone thread created by this Root session.",
              ),
            );
          }
          if (continuity.kind !== "reuse") {
            const operationId = `orchestrator-assignment:${assignmentId}:v${contractVersion}`;
            if (
              existingChild !== null &&
              (!childMatchesTarget ||
                existingChild.sourceThreadId !== authority.callerThreadId ||
                existingChild.creationSource !== "synara_mcp" ||
                existingChild.gatewayOperationId !== operationId)
            ) {
              return yield* Effect.fail(
                new GatewayToolError(
                  "assignment_child_collision",
                  "The deterministic clean/rotate child id already belongs to another creation.",
                ),
              );
            }
            if (existingChild === null) {
              yield* context.assertCallerTurnActive();
              yield* dispatch({
                type: "thread.create",
                commandId: CommandId.makeUnsafe(`${operationId}:thread-create`),
                threadId: contract.assigneeThreadId,
                projectId: authority.core.root.root.projectId,
                title: goal.trim().split("\n", 1)[0]!.trim().slice(0, 120),
                modelSelection,
                runtimeMode,
                interactionMode: "default",
                envMode: "local",
                branch: null,
                worktreePath: null,
                workingDirectory: modelTarget.workspaceRoot,
                creationSource: "synara_mcp",
                sourceThreadId: authority.callerThreadId,
                ...(context.callerTurnId
                  ? { sourceTurnId: TurnId.makeUnsafe(context.callerTurnId) }
                  : {}),
                gatewayOperationId: operationId,
                gatewayOperationIndex: 0,
                createdAt: timestamp,
              });
            }
          }
          const expectedRevision = readInteger(args, "expectedRevision", {
            required: true,
          })!;
          let assignmentExpectedRevision = expectedRevision;
          if (!targetIsReachable) {
            const bindingRole = readStringArg(args, "bindingRole", {
              required: true,
            })! as TaskThreadRole;
            const ownershipRole: OrchestratorRole =
              bindingRole === "reviewer" || bindingRole === "verifier" ? "verifier" : "participant";
            yield* dispatch({
              type: "orchestrator.child.attach",
              ...rootCommandBase(authority, expectedRevision),
              parentThreadId: authority.callerThreadId,
              childThreadId: contract.assigneeThreadId,
              role: ownershipRole,
              capabilities: contract.allowedCapabilities,
              continuity,
              modelTarget,
              decisionReason,
            });
            assignmentExpectedRevision += 1;
          }
          const result = yield* dispatch({
            type: "orchestrator.assignment.create",
            ...rootCommandBase(authority, assignmentExpectedRevision),
            processId,
            expectedProcessRevision: readInteger(args, "expectedProcessRevision", {
              required: true,
            })!,
            bindingId: TaskThreadBindingId.makeUnsafe(
              readStringArg(args, "bindingId", { required: true })!,
            ),
            bindingRole: readStringArg(args, "bindingRole", {
              required: true,
            })! as TaskThreadRole,
            contract,
          });
          if (startInitialTurn) {
            const messageId = MessageId.makeUnsafe(
              `orchestrator-assignment:${assignmentId}:v${contractVersion}:initial`,
            );
            yield* context.assertCallerTurnActive();
            yield* dispatch({
              type: "thread.turn.start",
              commandId: CommandId.makeUnsafe(
                `orchestrator-assignment:${assignmentId}:v${contractVersion}:turn-start`,
              ),
              threadId: contract.assigneeThreadId,
              message: {
                messageId,
                role: "thread",
                text: renderAssignmentPrompt({
                  assignmentId,
                  taskId,
                  goal,
                  acceptanceCriteria,
                  immutableUserConstraints,
                  workingAssumptions,
                  contextBundle,
                }),
                attachments: [],
              },
              modelSelection,
              dispatchMode: "queue",
              dispatchOrigin: "orchestrator",
              threadOrigin: {
                messageId,
                rootThreadId: authority.rootThreadId,
                senderThreadId: authority.callerThreadId,
                targetThreadId: contract.assigneeThreadId,
                assignmentId,
                runId: null,
                correlationId: assignmentId,
                replyToMessageId: null,
                hopCount: 0,
                artifactRefs: [],
              },
              runtimeMode,
              interactionMode: "default",
              createdAt: timestamp,
            });
          }
          const graph = yield* getGraph(authority);
          return mcpToolResultJson({
            sequence: result.sequence,
            assignmentId: contract.assignmentId,
            taskId: contract.taskId,
            threadId: contract.assigneeThreadId,
            graphRevision: graph.graphRevision,
            continuity: continuity.kind,
            initialTurnStarted: startInitialTurn,
          });
        }),
    }),
    makeEntry({
      name: "synara_orchestrator_send_message",
      description:
        "Persist a correlated thread-originated mailbox message or reply on an authorized communication path.",
      inputSchema: objectSchema(
        {
          ...expectedRevisionSchema,
          messageId: { type: "string" },
          targetThreadId: { type: "string" },
          assignmentId: { type: ["string", "null"] },
          runId: { type: ["string", "null"] },
          correlationId: { type: ["string", "null"] },
          replyToMessageId: { type: ["string", "null"] },
          hopCount: { type: "integer", minimum: 0, maximum: 32 },
          expiresAt: { type: "string" },
          body: { type: "string", maxLength: 64_000 },
          artifactRefs: stringArray(64),
        },
        [
          "expectedRevision",
          "messageId",
          "targetThreadId",
          "hopCount",
          "expiresAt",
          "body",
          "artifactRefs",
        ],
      ),
      handle: (args, _context, authority) => {
        const createdAt = now();
        return dispatch({
          type: "orchestrator.message.enqueue",
          ...rootCommandBase(authority, readInteger(args, "expectedRevision", { required: true })!),
          message: {
            messageId: OrchestratorMessageId.makeUnsafe(
              readStringArg(args, "messageId", { required: true })!,
            ),
            rootThreadId: authority.rootThreadId,
            senderThreadId: authority.callerThreadId,
            targetThreadId: ThreadId.makeUnsafe(
              readStringArg(args, "targetThreadId", { required: true })!,
            ),
            assignmentId:
              args.assignmentId === null
                ? null
                : readStringArg(args, "assignmentId")
                  ? AssignmentId.makeUnsafe(readStringArg(args, "assignmentId")!)
                  : null,
            runId:
              args.runId === null
                ? null
                : readStringArg(args, "runId")
                  ? OrchestratorRunId.makeUnsafe(readStringArg(args, "runId")!)
                  : null,
            correlationId:
              args.correlationId === null
                ? null
                : readStringArg(args, "correlationId")
                  ? OrchestratorMessageId.makeUnsafe(readStringArg(args, "correlationId")!)
                  : null,
            replyToMessageId:
              args.replyToMessageId === null
                ? null
                : readStringArg(args, "replyToMessageId")
                  ? OrchestratorMessageId.makeUnsafe(readStringArg(args, "replyToMessageId")!)
                  : null,
            hopCount: readInteger(args, "hopCount", { required: true, max: 32 })!,
            expiresAt: readStringArg(args, "expiresAt", { required: true })!,
            body: readStringArg(args, "body", { required: true })!,
            artifactRefs: readStrings(args, "artifactRefs", {
              required: true,
              max: 64,
            })!.map((artifactId) => ArtifactId.makeUnsafe(artifactId)),
            deliveryState: "queued",
            deliveryAttemptId: null,
            createdAt,
            updatedAt: createdAt,
          },
        }).pipe(Effect.map((result) => mcpToolResultJson(result)));
      },
    }),
    makeEntry({
      name: "synara_orchestrator_request_link",
      description: "Request a scoped communication link without granting authority to the caller.",
      inputSchema: objectSchema(
        {
          ...expectedRevisionSchema,
          linkId: { type: "string" },
          targetThreadId: { type: "string" },
          direction: {
            type: "string",
            enum: ["bidirectional", "source_to_target", "target_to_source"],
          },
          taskId: { type: ["string", "null"] },
          runId: { type: ["string", "null"] },
          capabilities: stringArray(32),
          reason: { type: "string" },
          expiresAt: { type: "string" },
        },
        [
          "expectedRevision",
          "linkId",
          "targetThreadId",
          "direction",
          "capabilities",
          "reason",
          "expiresAt",
        ],
      ),
      handle: (args, _context, authority) =>
        dispatch({
          type: "orchestrator.link.request",
          ...rootCommandBase(authority, readInteger(args, "expectedRevision", { required: true })!),
          linkId: OrchestratorLinkId.makeUnsafe(readStringArg(args, "linkId", { required: true })!),
          sourceThreadId: authority.callerThreadId,
          targetThreadId: ThreadId.makeUnsafe(
            readStringArg(args, "targetThreadId", { required: true })!,
          ),
          direction: readStringArg(args, "direction", {
            required: true,
          })! as OrchestratorCommunicationLink["direction"],
          taskId:
            args.taskId === null
              ? null
              : readStringArg(args, "taskId")
                ? ProjectTaskId.makeUnsafe(readStringArg(args, "taskId")!)
                : null,
          runId:
            args.runId === null
              ? null
              : readStringArg(args, "runId")
                ? OrchestratorRunId.makeUnsafe(readStringArg(args, "runId")!)
                : null,
          capabilities: readStrings(args, "capabilities", { required: true, max: 32 })! as never,
          reason: readStringArg(args, "reason", { required: true })!,
          expiresAt: readStringArg(args, "expiresAt", { required: true })!,
        }).pipe(Effect.map((result) => mcpToolResultJson(result))),
    }),
    makeEntry({
      name: "synara_orchestrator_set_link",
      description:
        "Grant, reject, revoke, or expire an existing link under durable link-manage authority.",
      inputSchema: objectSchema(
        {
          ...expectedRevisionSchema,
          linkId: { type: "string" },
          state: { type: "string", enum: ["granted", "rejected", "revoked", "expired"] },
          reason: { type: "string" },
        },
        ["expectedRevision", "linkId", "state", "reason"],
      ),
      handle: (args, _context, authority) =>
        dispatch({
          type: "orchestrator.link.set",
          ...rootCommandBase(authority, readInteger(args, "expectedRevision", { required: true })!),
          linkId: OrchestratorLinkId.makeUnsafe(readStringArg(args, "linkId", { required: true })!),
          state: readStringArg(args, "state", { required: true })! as
            | "granted"
            | "rejected"
            | "revoked"
            | "expired",
          reason: readStringArg(args, "reason", { required: true })!,
        }).pipe(Effect.map((result) => mcpToolResultJson(result))),
    }),
  );

  entries.push(
    makeEntry({
      name: "synara_orchestrator_publish_artifact",
      description:
        "Publish one immutable bounded artifact with caller-derived Root and producer identity.",
      inputSchema: objectSchema(
        {
          ...expectedRevisionSchema,
          artifact: { type: "object" },
        },
        ["expectedRevision", "artifact"],
      ),
      handle: (args, _context, authority) => {
        const raw = readRequiredRecord(args, "artifact");
        const artifact = decode(
          OrchestratorArtifact,
          {
            ...raw,
            rootThreadId: authority.rootThreadId,
            producerThreadId: authority.callerThreadId,
          },
          "artifact",
        ) as OrchestratorArtifact;
        return dispatch({
          type: "orchestrator.artifact.publish",
          ...rootCommandBase(authority, readInteger(args, "expectedRevision", { required: true })!),
          artifact,
        }).pipe(Effect.map((result) => mcpToolResultJson(result)));
      },
    }),
    makeEntry({
      name: "synara_orchestrator_update_run",
      description: "Create, advance, or set the honest disposition of a Collaboration/Council run.",
      inputSchema: objectSchema(
        {
          ...expectedRevisionSchema,
          action: { type: "string", enum: ["create", "advance", "disposition"] },
          run: { type: "object" },
          runId: { type: "string" },
          state: { type: "string" },
          artifactIds: stringArray(),
          disposition: {
            type: "string",
            enum: ["auto_actionable", "owner_review_required", "blocked"],
          },
          reason: { type: "string" },
        },
        ["expectedRevision", "action"],
      ),
      handle: (args, _context, authority) => {
        const base = rootCommandBase(
          authority,
          readInteger(args, "expectedRevision", { required: true })!,
        );
        const action = readStringArg(args, "action", { required: true });
        let command: OrchestrationCommand;
        if (action === "create") {
          const raw = readRequiredRecord(args, "run");
          const run = decode(
            OrchestratorRun,
            { ...raw, rootThreadId: authority.rootThreadId },
            "run",
          ) as OrchestratorRun;
          command = { type: "orchestrator.run.create", ...base, run };
        } else if (action === "disposition") {
          command = {
            type: "orchestrator.run.disposition.set",
            ...base,
            runId: OrchestratorRunId.makeUnsafe(readStringArg(args, "runId", { required: true })!),
            disposition: readStringArg(args, "disposition", { required: true })! as
              | "auto_actionable"
              | "owner_review_required"
              | "blocked",
            reason: readStringArg(args, "reason", { required: true })!,
          };
        } else {
          command = {
            type: "orchestrator.run.advance",
            ...base,
            runId: OrchestratorRunId.makeUnsafe(readStringArg(args, "runId", { required: true })!),
            state: readStringArg(args, "state", { required: true })! as never,
            artifactIds: readStrings(args, "artifactIds", { required: true })!.map((artifactId) =>
              ArtifactId.makeUnsafe(artifactId),
            ),
          };
        }
        return dispatch(command).pipe(Effect.map((result) => mcpToolResultJson(result)));
      },
    }),
    makeEntry({
      name: "synara_orchestrator_read_child",
      readOnly: true,
      description:
        "Read one authorized descendant view with explicit bounds; provider parentThreadId is not used as Orchestrator ownership.",
      inputSchema: objectSchema(
        {
          childThreadId: { type: "string" },
          view: {
            type: "string",
            enum: [
              "status",
              "last_message",
              "tail_since_cursor",
              "full_transcript",
              "artifacts",
              "activity",
              "tool_calls",
              "pending_interactions",
            ],
          },
          cursor: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: MAX_CHILD_READ_ROWS },
        },
        ["childThreadId", "view"],
      ),
      handle: (args, _context, authority) =>
        Effect.gen(function* () {
          const childThreadId = ThreadId.makeUnsafe(
            readStringArg(args, "childThreadId", { required: true })!,
          );
          if (!canReadOrchestratorThread(authority, childThreadId)) {
            return yield* Effect.fail(
              new GatewayToolError(
                "orchestrator_read_denied",
                "The target thread is outside the caller's readable Root/subtree scope.",
              ),
            );
          }
          const view = readStringArg(args, "view", { required: true })!;
          const limit = Math.max(1, readInteger(args, "limit", { max: MAX_CHILD_READ_ROWS }) ?? 50);
          if (view === "artifacts") {
            const artifacts = yield* input.artifactRepository
              .list({ rootThreadId: authority.rootThreadId, limit: Math.min(limit, 100) })
              .pipe(Effect.mapError((error) => new ToolInputError(errorText(error))));
            return mcpToolResultJson({
              childThreadId,
              view,
              artifacts: artifacts.filter(
                (artifact) =>
                  artifact.producerThreadId === childThreadId &&
                  (authority.role === "root" || artifact.visibility !== "private"),
              ),
            });
          }
          const detail = yield* input.snapshotQuery.getThreadDetailById(childThreadId).pipe(
            Effect.mapError((error) => new ToolInputError(errorText(error))),
            Effect.flatMap(
              Option.match({
                onNone: () =>
                  Effect.fail(new ToolInputError(`Thread "${childThreadId}" was not found.`)),
                onSome: Effect.succeed,
              }),
            ),
          );
          if (view === "status") {
            return mcpToolResultJson({
              childThreadId,
              view,
              latestTurn: detail.latestTurn,
              session: detail.session,
              pendingInteractions: {
                approvals: detail.hasPendingApprovals,
                userInput: detail.hasPendingUserInput,
              },
            });
          }
          if (view === "last_message") {
            return mcpToolResultJson({
              childThreadId,
              view,
              message: detail.messages.at(-1) ?? null,
            });
          }
          if (view === "activity" || view === "tool_calls" || view === "pending_interactions") {
            return mcpToolResultJson({
              childThreadId,
              view,
              activities:
                view === "tool_calls"
                  ? detail.activities
                      .filter((activity) => activity.kind.includes("tool"))
                      .slice(-limit)
                  : view === "activity"
                    ? detail.activities.slice(-limit)
                    : [],
              ...(view === "pending_interactions"
                ? {
                    pendingInteractions: {
                      approvals: detail.hasPendingApprovals,
                      userInput: detail.hasPendingUserInput,
                    },
                  }
                : {}),
            });
          }
          return mcpToolResultJson(
            summarizeThreadDetail({
              thread: detail,
              cursor: readStringArg(args, "cursor"),
              messageLimit: limit,
            }),
          );
        }),
    }),
  );

  entries.push(
    makeEntry({
      name: "synara_orchestrator_report_status",
      description:
        "Record structured assignment status and evidence. This cannot assert task readiness or semantic completion.",
      inputSchema: objectSchema(
        {
          ...expectedRevisionSchema,
          expectedProcessRevision: integer,
          progressId: { type: "string" },
          progressKind: {
            type: "string",
            enum: ["progress", "waiting", "blocker", "failure", "completion_evidence"],
          },
          progressEvidenceRefs: stringArray(),
          assignmentId: { type: "string" },
          taskId: { type: "string" },
          state: { type: "string" },
          summary: { type: "string" },
          evidence: { type: ["object", "null"] },
        },
        [
          "expectedRevision",
          "expectedProcessRevision",
          "progressId",
          "progressKind",
          "progressEvidenceRefs",
          "assignmentId",
          "taskId",
          "state",
          "summary",
        ],
      ),
      handle: (args, _context, authority) => {
        const processId = authority.core.root.root.activeProcessId;
        if (processId === null) {
          return Effect.fail(new ToolInputError("This Root has no active TaskProcess."));
        }
        return dispatch({
          type: "orchestrator.assignment.status.report",
          ...rootCommandBase(authority, readInteger(args, "expectedRevision", { required: true })!),
          processId,
          expectedProcessRevision: readInteger(args, "expectedProcessRevision", {
            required: true,
          })!,
          progressId: TaskProgressEntryId.makeUnsafe(
            readStringArg(args, "progressId", { required: true })!,
          ),
          progressKind: readStringArg(args, "progressKind", { required: true })! as never,
          progressEvidenceRefs: readStrings(args, "progressEvidenceRefs", {
            required: true,
          })!.map((artifactId) => ArtifactId.makeUnsafe(artifactId)),
          assignmentId: AssignmentId.makeUnsafe(
            readStringArg(args, "assignmentId", { required: true })!,
          ),
          taskId: ProjectTaskId.makeUnsafe(readStringArg(args, "taskId", { required: true })!),
          state: readStringArg(args, "state", { required: true })! as never,
          summary: readStringArg(args, "summary", { required: true })!,
          evidence:
            args.evidence === null || args.evidence === undefined
              ? null
              : decode(AssignmentCompletionEvidence, args.evidence, "evidence"),
        }).pipe(Effect.map((result) => mcpToolResultJson(result)));
      },
    }),
    makeEntry({
      name: "synara_orchestrator_request_change",
      description:
        "Send a typed assignment change request to its owner without changing scope, model, dependency, or authority directly.",
      inputSchema: objectSchema(
        {
          ...expectedRevisionSchema,
          messageId: { type: "string" },
          assignmentId: { type: "string" },
          taskId: { type: "string" },
          kind: {
            type: "string",
            enum: [
              "contract",
              "scope",
              "api",
              "dependency",
              "ownership",
              "workspace",
              "model",
              "participant",
              "deferral",
              "clarification",
              "reframing",
            ],
          },
          request: { type: "string" },
          reason: { type: "string" },
          expiresAt: { type: "string" },
        },
        [
          "expectedRevision",
          "messageId",
          "assignmentId",
          "taskId",
          "kind",
          "request",
          "reason",
          "expiresAt",
        ],
      ),
      handle: (args, _context, authority) => {
        const assignmentId = AssignmentId.makeUnsafe(
          readStringArg(args, "assignmentId", { required: true })!,
        );
        const assignment = authority.core.assignments.find(
          (candidate) => candidate.assignmentId === assignmentId,
        );
        if (!assignment || assignment.assigneeThreadId !== authority.callerThreadId) {
          return Effect.fail(
            new GatewayToolError(
              "assignment_scope_mismatch",
              "A child may request changes only for its own durable Assignment.",
            ),
          );
        }
        const createdAt = now();
        return dispatch({
          type: "orchestrator.message.enqueue",
          ...rootCommandBase(authority, readInteger(args, "expectedRevision", { required: true })!),
          message: {
            messageId: OrchestratorMessageId.makeUnsafe(
              readStringArg(args, "messageId", { required: true })!,
            ),
            rootThreadId: authority.rootThreadId,
            senderThreadId: authority.callerThreadId,
            targetThreadId: assignment.ownerThreadId,
            assignmentId,
            runId: null,
            correlationId: null,
            replyToMessageId: null,
            hopCount: 0,
            expiresAt: readStringArg(args, "expiresAt", { required: true })!,
            body: JSON.stringify({
              type: "orchestrator_change_request_v1",
              taskId: readStringArg(args, "taskId", { required: true }),
              kind: readStringArg(args, "kind", { required: true }),
              request: readStringArg(args, "request", { required: true }),
              reason: readStringArg(args, "reason", { required: true }),
            }),
            artifactRefs: [],
            deliveryState: "queued",
            deliveryAttemptId: null,
            createdAt,
            updatedAt: createdAt,
          },
        }).pipe(Effect.map((result) => mcpToolResultJson(result)));
      },
    }),
    makeEntry({
      name: "synara_orchestrator_wait",
      description:
        "Register one bounded durable event wait. Native monitor execution wakes the owner; the agent must not poll.",
      inputSchema: objectSchema(
        {
          ...expectedRevisionSchema,
          monitorId: { type: "string" },
          targetThreadId: { type: ["string", "null"] },
          condition: { type: "string" },
          timeoutMs: { type: "integer", minimum: 1, maximum: 3_600_000 },
        },
        ["expectedRevision", "monitorId", "condition", "timeoutMs"],
      ),
      handle: (args, _context, authority) => {
        const createdAtMs = Date.now();
        const timeoutMs = readInteger(args, "timeoutMs", {
          required: true,
          max: 3_600_000,
        })!;
        return dispatch({
          type: "orchestrator.monitor.register",
          ...rootCommandBase(authority, readInteger(args, "expectedRevision", { required: true })!),
          monitor: {
            id: MonitorId.makeUnsafe(readStringArg(args, "monitorId", { required: true })!),
            rootThreadId: authority.rootThreadId,
            targetThreadId:
              args.targetThreadId === null || args.targetThreadId === undefined
                ? null
                : ThreadId.makeUnsafe(readStringArg(args, "targetThreadId", { required: true })!),
            kind: "wait",
            condition: readStringArg(args, "condition", { required: true })!,
            cadenceMs: null,
            nextWakeAt: null,
            maxRuns: 1,
            runCount: 0,
            expiresAt: new Date(createdAtMs + timeoutMs).toISOString(),
            ownerThreadId: authority.callerThreadId,
            state: "active",
          },
        }).pipe(Effect.map((result) => mcpToolResultJson({ ...result, registered: true })));
      },
    }),
    makeEntry({
      name: "synara_orchestrator_retire_child",
      description:
        "Retire an authorized descendant while preserving its thread and orchestration history.",
      inputSchema: objectSchema(
        {
          ...expectedRevisionSchema,
          childThreadId: { type: "string" },
          reason: { type: "string" },
        },
        ["expectedRevision", "childThreadId", "reason"],
      ),
      handle: (args, _context, authority) =>
        dispatch({
          type: "orchestrator.child.retire",
          ...rootCommandBase(authority, readInteger(args, "expectedRevision", { required: true })!),
          childThreadId: ThreadId.makeUnsafe(
            readStringArg(args, "childThreadId", { required: true })!,
          ),
          reason: readStringArg(args, "reason", { required: true })!,
        }).pipe(Effect.map((result) => mcpToolResultJson(result))),
    }),
  );

  return entries;
}
