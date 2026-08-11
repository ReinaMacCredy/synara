import { randomUUID } from "node:crypto";

import {
  CommandId,
  EvidenceId,
  InterventionId,
  LeadRotationId,
  LeadNotificationId,
  LeadSeatId,
  ModelSelectionReceiptId,
  MessageId,
  MissionEndCondition,
  MissionGrant,
  MissionScopeList,
  ProfileSnapshotId,
  PeerSpecialtyId,
  ReconciliationId,
  RoomId,
  RunId,
  SupervisorNotebookEntryId,
  SupervisorNotebookEntryKind,
  SupervisionAdviceId,
  SupervisedGovernanceAggregateId,
  SupervisionMissionId,
  SupervisorSeatId,
  TaskId,
  TaskNodeId,
  TaskNodeRevisionId,
  ThreadId,
  WorkClaimId,
  WorkflowDirectiveId,
  type OrchestrationReadModel,
  type SupervisedGovernanceSnapshot,
  type SupervisionMission,
  type SupervisorNotebookEntry,
} from "@veylen/contracts";
import { Effect, Option, Schema } from "effect";

import type { SupervisedGovernanceRepositoryShape } from "../../persistence/Services/SupervisedGovernanceRepository.ts";
import {
  HostToolError,
  hostToolFailure as hostToolFailure,
  hostToolSuccess as hostToolSuccess,
  type HostToolEntry,
  type HostToolExecutionResult,
} from "../hostTools/runtime.ts";
import type { OrchestrationEngineShape } from "../Services/OrchestrationEngine.ts";
import type { ProjectionSnapshotQueryShape } from "../Services/ProjectionSnapshotQuery.ts";
import { missionScopeContainsLead } from "./missionScope.ts";
import { profileLaunchIssue, resolveProfilePreset } from "./profileResolver.ts";
import { currentTurnHasHumanOrigin, resolveSupervisedCallerAuthority } from "./toolPolicy.ts";
import type { SupervisedRuntimeDaemonShape } from "../Services/SupervisedRuntimeDaemon.ts";
import {
  RlmStartError,
  startRlm,
  type RlmBranchRequest,
} from "../../supervised/runtime/RlmStart.ts";
import { buildContextView, planContextCompaction } from "../../supervised/runtime/ContextViews.ts";
import {
  buildSupervisorNotebookView,
  planSupervisorNotebookCompaction,
} from "../../supervised/governance/SharedSupervisorNotebook.ts";
import type { ModelRoutingServiceShape } from "../../supervised/modelRouting/ModelRoutingService.ts";

const AGGREGATE_ID = SupervisedGovernanceAggregateId.makeUnsafe("supervised");
const objectSchema = (
  properties: Readonly<Record<string, unknown>>,
  required: ReadonlyArray<string> = [],
) => ({ type: "object", properties, required, additionalProperties: false });

const stringArg = (args: Record<string, unknown>, key: string): string => {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HostToolError("supervised_tool_input_invalid", `${key} is required.`);
  }
  return value.trim();
};

const intArg = (args: Record<string, unknown>, key: string): number => {
  const value = args[key];
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new HostToolError(
      "supervised_tool_input_invalid",
      `${key} must be a non-negative integer.`,
    );
  }
  return value as number;
};

const optionalIntArg = (args: Record<string, unknown>, key: string): number | undefined => {
  if (args[key] === undefined) return undefined;
  return intArg(args, key);
};

const optionalStringArg = (args: Record<string, unknown>, key: string): string | null => {
  const value = args[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HostToolError("supervised_tool_input_invalid", `${key} must be a non-empty string.`);
  }
  return value.trim();
};

const optionalBooleanArg = (
  args: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean => {
  const value = args[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new HostToolError("supervised_tool_input_invalid", `${key} must be a boolean.`);
  }
  return value;
};

const stringArrayArg = (args: Record<string, unknown>, key: string): ReadonlyArray<string> => {
  const value = args[key];
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)
  ) {
    throw new HostToolError(
      "supervised_tool_input_invalid",
      `${key} must be an array of non-empty strings.`,
    );
  }
  return value.map((entry) => (entry as string).trim());
};

const optionalStringArrayArg = (
  args: Record<string, unknown>,
  key: string,
): ReadonlyArray<string> => {
  if (args[key] === undefined) return [];
  return stringArrayArg(args, key);
};

const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  value: unknown,
  label: string,
): S["Type"] => {
  try {
    return Schema.decodeUnknownSync(schema)(value);
  } catch (error) {
    throw new HostToolError(
      "supervised_tool_input_invalid",
      `${label} is invalid.`,
      error instanceof Error ? error.message : String(error),
    );
  }
};

export interface SupervisedToolsInput {
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly snapshotQuery: ProjectionSnapshotQueryShape;
  readonly governanceRepository: SupervisedGovernanceRepositoryShape;
  readonly runtimeDaemon: SupervisedRuntimeDaemonShape;
  readonly modelRoutingService?: ModelRoutingServiceShape;
  readonly getProviderAvailability?: () => Effect.Effect<
    Readonly<Record<string, boolean>>,
    unknown
  >;
}

const canonicalLeadStatus = (
  lifecycleState: SupervisedGovernanceSnapshot["agentSeats"][number]["lifecycleState"],
) => {
  if (lifecycleState === "ready" || lifecycleState === "active") return "active" as const;
  if (lifecycleState === "draining") return "rotating" as const;
  if (
    lifecycleState === "requested" ||
    lifecycleState === "provisioning" ||
    lifecycleState === "bootstrapping" ||
    lifecycleState === "recovering"
  ) {
    return "vacant" as const;
  }
  return "archived" as const;
};

const canonicalLeadViews = (governance: SupervisedGovernanceSnapshot) =>
  governance.agentSeats.flatMap((seat) =>
    seat.identityRole === "lead" &&
    seat.threadId !== null &&
    seat.threadId !== undefined &&
    seat.projectId !== null &&
    seat.projectId !== undefined
      ? [
          {
            id: LeadSeatId.makeUnsafe(seat.id),
            projectId: seat.projectId,
            activeThreadId: seat.threadId,
            status: canonicalLeadStatus(seat.lifecycleState),
            revision: seat.revision,
          },
        ]
      : [],
  );

const idsEqual = (left: string | null | undefined, right: string | null | undefined): boolean =>
  left === right;

const actorSeatId = (seatId: string): ThreadId => ThreadId.makeUnsafe(seatId);

const activeRootContextForCaller = (
  state: OrchestrationReadModel & { readonly governance: SupervisedGovernanceSnapshot },
  callerThreadId: string,
  requestedRoomId?: string,
) => {
  const seat = state.governance.agentSeats.find(
    (candidate) =>
      candidate.threadId === callerThreadId &&
      (candidate.effectiveRole === "lead" || candidate.effectiveRole === "acting_root") &&
      (candidate.lifecycleState === "ready" || candidate.lifecycleState === "active"),
  );
  if (!seat) return null;
  const room = state.supervised.rooms.find(
    (candidate) =>
      idsEqual(candidate.leadSeatId, seat.id) &&
      candidate.status === "active" &&
      (requestedRoomId === undefined || candidate.id === requestedRoomId),
  );
  if (!room) return null;
  const receipt = state.governance.authorityReceipts.find(
    (candidate) =>
      candidate.id === seat.authorityReceiptId &&
      candidate.actorSeatId === seat.id &&
      candidate.effectiveRole === seat.effectiveRole &&
      candidate.revokedAt === null &&
      (candidate.expiresAt === null || candidate.expiresAt > new Date().toISOString()) &&
      candidate.roomScopes.includes(room.id),
  );
  const lease = state.governance.rootLeases.find(
    (candidate) =>
      candidate.roomId === room.id &&
      candidate.holderSeatId === seat.id &&
      (candidate.status === "active" ||
        candidate.status === "transferring" ||
        candidate.status === "releasing") &&
      receipt?.rootLeaseIds.includes(candidate.id),
  );
  return receipt && lease ? { seat, room, receipt, lease } : null;
};

const rootHolderSeatId = (seat: SupervisedGovernanceSnapshot["agentSeats"][number]) =>
  seat.identityRole === "supervisor"
    ? SupervisorSeatId.makeUnsafe(seat.id)
    : LeadSeatId.makeUnsafe(seat.id);

export function makeSupervisedTools(input: SupervisedToolsInput): ReadonlyArray<HostToolEntry> {
  const load = (): Effect.Effect<
    OrchestrationReadModel & {
      readonly governance: SupervisedGovernanceSnapshot;
      readonly orchestration: SupervisedGovernanceSnapshot["orchestration"];
      readonly leads: ReturnType<typeof canonicalLeadViews>;
    },
    HostToolError
  > =>
    Effect.all([input.snapshotQuery.getSnapshot(), input.governanceRepository.getSnapshot()]).pipe(
      Effect.map(([state, governance]) => ({
        ...state,
        governance,
        orchestration: governance.orchestration,
        leads: canonicalLeadViews(governance),
      })),
      Effect.mapError(
        (error) =>
          new HostToolError(
            "supervised_state_unavailable",
            error instanceof Error ? error.message : String(error),
          ),
      ),
    );

  const loadAuthority = (callerThreadId: string) =>
    Effect.gen(function* () {
      const state = yield* load();
      const authority = resolveSupervisedCallerAuthority({
        snapshot: state.governance,
        projects: state.projects,
        callerThreadId: ThreadId.makeUnsafe(callerThreadId),
      });
      if (!authority) {
        return yield* Effect.fail(
          new HostToolError(
            "supervised_role_required",
            "The caller does not own an active Supervisor, Lead, or Peer seat.",
          ),
        );
      }
      return { state, authority };
    });

  const loadHumanOrigin = (context: Parameters<HostToolEntry["execute"]>[1]) =>
    Effect.gen(function* () {
      if (context.callerDispatchOrigin === "user" && context.callerTurnId !== null) {
        return context.callerTurnId;
      }
      if (context.callerDispatchOrigin !== undefined) {
        return yield* Effect.fail(
          new HostToolError(
            "supervised_human_origin_required",
            "This operation requires the current authenticated owner turn.",
          ),
        );
      }
      const detail = yield* input.snapshotQuery
        .getThreadDetailById(ThreadId.makeUnsafe(context.callerThreadId))
        .pipe(
          Effect.mapError(
            (error) =>
              new HostToolError(
                "supervised_state_unavailable",
                error instanceof Error ? error.message : String(error),
              ),
          ),
        );
      if (
        Option.isNone(detail) ||
        !currentTurnHasHumanOrigin({ thread: detail.value, callerTurnId: context.callerTurnId })
      ) {
        return yield* Effect.fail(
          new HostToolError(
            "supervised_human_origin_required",
            "This operation requires the current authenticated owner turn.",
          ),
        );
      }
      const source = detail.value.messages.find(
        (message) =>
          message.turnId === context.callerTurnId &&
          message.role === "user" &&
          (message.dispatchOrigin === undefined || message.dispatchOrigin === "user"),
      );
      if (!source) {
        return yield* Effect.fail(
          new HostToolError(
            "supervised_human_origin_required",
            "The source owner message is unavailable.",
          ),
        );
      }
      return source;
    });

  const dispatch = (command: Parameters<OrchestrationEngineShape["dispatch"]>[0]) =>
    input.orchestrationEngine
      .dispatch(command)
      .pipe(
        Effect.mapError(
          (error) =>
            new HostToolError(
              "supervised_command_rejected",
              error instanceof Error ? error.message : String(error),
            ),
        ),
      );

  const entry = (
    definition: HostToolEntry["definition"],
    handlers: {
      readonly visible: (
        state: OrchestrationReadModel,
        role: "supervisor" | "lead" | "peer",
      ) => boolean;
      readonly execute: (
        args: Parameters<HostToolEntry["execute"]>[0],
        context: Parameters<HostToolEntry["execute"]>[1],
      ) => Effect.Effect<HostToolExecutionResult, HostToolError>;
    },
  ): HostToolEntry => ({
    definition,
    isVisible: (context) =>
      loadAuthority(context.callerThreadId).pipe(
        Effect.map(
          ({ state, authority }) =>
            handlers.visible(state, authority.role) ||
            (activeRootContextForCaller(state, context.callerThreadId) !== null &&
              handlers.visible(state, "lead")),
        ),
        Effect.catch(() => Effect.succeed(false)),
      ),
    execute: (args, context) =>
      handlers
        .execute(args, context)
        .pipe(Effect.catch((error) => Effect.succeed(hostToolFailure(error)))),
  });

  const readState = entry(
    {
      name: "read_supervised_state",
      displayName: "Read Supervised state",
      description:
        "Read only the caller's bounded Supervisor missions or Lead-facing Supervised state. Peer transcripts are never included.",
      inputSchema: objectSchema({}),
      readOnly: true,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.topology.read",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: () => true,
      execute: (_args, context) =>
        Effect.gen(function* () {
          const { state, authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role === "supervisor") {
            const missionIds = new Set(authority.missions.map((mission) => mission.id));
            const visibleLeads = state.leads.filter((lead) =>
              authority.missions.some((mission) =>
                missionScopeContainsLead({ scope: mission.scope, lead, projects: state.projects }),
              ),
            );
            const visibleLeadIds = new Set(visibleLeads.map((lead) => lead.id));
            const supervisorSeat = state.governance.agentSeats.find(
              (seat) =>
                seat.id === authority.supervisorSeatId &&
                seat.threadId === authority.callerThreadId,
            );
            const visibleRooms = state.supervised.rooms.filter(
              (room) =>
                room.leadSeatId !== null &&
                (visibleLeadIds.has(LeadSeatId.makeUnsafe(room.leadSeatId)) ||
                  (supervisorSeat?.effectiveRole === "acting_root" &&
                    idsEqual(room.leadSeatId, supervisorSeat.id))),
            );
            const visibleRoomIds = new Set(visibleRooms.map((room) => room.id));
            const visibleTasks = state.supervised.tasks.filter((task) =>
              visibleRoomIds.has(task.roomId),
            );
            const visibleTaskIds = new Set(visibleTasks.map((task) => task.id));
            return hostToolSuccess({
              role: authority.role,
              effectiveRole: supervisorSeat?.effectiveRole ?? "supervisor",
              supervisorSeatId: authority.supervisorSeatId,
              rootLeases: state.governance.rootLeases.filter(
                (lease) =>
                  lease.holderSeatId === supervisorSeat?.id &&
                  (lease.status === "active" ||
                    lease.status === "transferring" ||
                    lease.status === "releasing"),
              ),
              missions: authority.missions,
              leads: visibleLeads.map((lead) => ({
                id: lead.id,
                projectId: lead.projectId,
                activeThreadId: lead.activeThreadId,
                status: lead.status,
                revision: lead.revision,
              })),
              rooms: visibleRooms.map((room) => ({
                id: room.id,
                projectId: room.projectId,
                leadSeatId: room.leadSeatId,
                status: room.status,
              })),
              tasks: visibleTasks,
              taskNodes: state.supervised.taskNodes.filter((node) =>
                visibleTaskIds.has(node.taskId),
              ),
              runs: state.supervised.runs.filter((run) => visibleRoomIds.has(run.roomId)),
              evidence: state.supervised.evidence.filter(
                (item) => item.scope.kind === "room" && visibleRoomIds.has(item.scope.roomId),
              ),
              peers: state.governance.agentSeats
                .filter(
                  (seat) =>
                    seat.identityRole === "peer" &&
                    seat.threadId !== null &&
                    seat.lifecycleState !== "retired" &&
                    seat.roomIds.some((roomId) => visibleRoomIds.has(roomId)),
                )
                .map((seat) => ({
                  seatId: seat.id,
                  threadId: seat.threadId,
                  projectId: seat.projectId,
                  roomIds: seat.roomIds,
                })),
              advice: state.orchestration.advice.filter((advice) =>
                missionIds.has(advice.missionId),
              ),
              observationCursors: state.orchestration.observationCursors.filter((cursor) =>
                missionIds.has(cursor.missionId),
              ),
            });
          }
          if (authority.role === "lead") {
            const leadRoomIds = new Set(
              state.supervised.rooms
                .filter((room) => room.leadSeatId === authority.leadSeatId)
                .map((room) => room.id),
            );
            const leadTasks = state.supervised.tasks.filter((task) => leadRoomIds.has(task.roomId));
            const leadTaskIds = new Set(leadTasks.map((task) => task.id));
            return hostToolSuccess({
              role: authority.role,
              leadSeatId: authority.leadSeatId,
              missions: authority.missions.map((mission) => ({
                id: mission.id,
                supervisorSeatId: mission.supervisorSeatId,
                focus: mission.focus,
                grants: mission.grants,
                status: mission.status,
              })),
              advice: state.orchestration.advice.filter(
                (advice) => advice.leadSeatId === authority.leadSeatId,
              ),
              interventions: state.supervised.interventions.filter((intervention) =>
                leadRoomIds.has(intervention.roomId),
              ),
              tasks: leadTasks,
              taskNodes: state.supervised.taskNodes.filter((node) => leadTaskIds.has(node.taskId)),
              runs: state.supervised.runs.filter((run) => leadRoomIds.has(run.roomId)),
              workClaims: state.supervised.workClaims.filter((claim) =>
                state.supervised.runs.some(
                  (run) => run.id === claim.runId && leadRoomIds.has(run.roomId),
                ),
              ),
              evidence: state.supervised.evidence.filter(
                (item) => item.scope.kind === "room" && leadRoomIds.has(item.scope.roomId),
              ),
            });
          }
          const interventions = state.supervised.interventions.filter(
            (intervention) =>
              intervention.specialistThreadId === authority.callerThreadId &&
              authority.roomIds.includes(intervention.roomId),
          );
          const evidenceIds = new Set(interventions.flatMap((item) => item.evidenceRefs));
          const ownedRuns = state.supervised.runs.filter(
            (run) => run.ownerSeatId === authority.peerSeatId,
          );
          const ownedRunIds = new Set(ownedRuns.map((run) => run.id));
          const ownedTaskNodeIds = new Set(
            ownedRuns.flatMap((run) => (run.taskNodeId === null ? [] : [run.taskNodeId])),
          );
          return hostToolSuccess({
            role: authority.role,
            peerSeatId: authority.peerSeatId,
            roomIds: authority.roomIds,
            interventions,
            taskNodes: state.supervised.taskNodes.filter((node) => ownedTaskNodeIds.has(node.id)),
            runs: ownedRuns,
            workClaims: state.supervised.workClaims.filter((claim) => ownedRunIds.has(claim.runId)),
            evidence: state.supervised.evidence.filter(
              (item) =>
                evidenceIds.has(item.id) ||
                (item.scope.kind === "room" && authority.roomIds.includes(item.scope.roomId)),
            ),
          });
        }),
    },
  );

  const recommendSupervisedModel = entry(
    {
      name: "recommend_supervised_model",
      displayName: "Recommend Supervised model",
      description:
        "Select and retain an authority-scoped model recommendation using the owner's preferences, hard capabilities, current RunPolicy, and canonical routing revision.",
      inputSchema: objectSchema(
        {
          taskCategory: { type: "string", maxLength: 512 },
          roomId: { type: "string" },
          taskNodeId: { type: "string" },
          minimumContextCapacity: { type: "integer", minimum: 0 },
          minimumCodingScore: { type: "number", minimum: 0, maximum: 10 },
          requiresVision: { type: "boolean", default: false },
          requiresTools: { type: "boolean", default: true },
          requiresReasoning: { type: "boolean", default: false },
          expectedInputTokens: { type: "integer", minimum: 0 },
          expectedOutputTokens: { type: "integer", minimum: 0 },
        },
        ["taskCategory"],
      ),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.models.recommend",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: (_state, role) => role !== "peer",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const routing = input.modelRoutingService;
          if (!routing) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_model_routing_unavailable",
                "The production model-routing service is unavailable.",
              ),
            );
          }
          const { state } = yield* loadAuthority(context.callerThreadId);
          const seat = state.governance.agentSeats.find(
            (candidate) =>
              candidate.threadId === context.callerThreadId &&
              candidate.identityRole !== "peer" &&
              (candidate.lifecycleState === "ready" || candidate.lifecycleState === "active"),
          );
          const roomIdValue = optionalStringArg(args, "roomId");
          const roomId = roomIdValue === null ? null : RoomId.makeUnsafe(roomIdValue);
          const taskNodeIdValue = optionalStringArg(args, "taskNodeId");
          const taskNodeId =
            taskNodeIdValue === null ? null : TaskNodeId.makeUnsafe(taskNodeIdValue);
          const room =
            roomId === null
              ? null
              : (state.supervised.rooms.find((candidate) => candidate.id === roomId) ?? null);
          const taskNode =
            taskNodeId === null
              ? null
              : (state.supervised.taskNodes.find((candidate) => candidate.id === taskNodeId) ??
                null);
          const runPolicy = state.supervised.runPolicies[0];
          const minimumCodingScore = args.minimumCodingScore;
          const minimumContextCapacity = optionalIntArg(args, "minimumContextCapacity");
          const expectedInputTokens = optionalIntArg(args, "expectedInputTokens");
          const expectedOutputTokens = optionalIntArg(args, "expectedOutputTokens");
          if (
            !seat ||
            !runPolicy ||
            (roomId !== null && (!room || !seat.roomIds.includes(roomId))) ||
            (taskNodeId !== null && (!taskNode || taskNode.roomId !== roomId)) ||
            (minimumCodingScore !== undefined &&
              (typeof minimumCodingScore !== "number" ||
                !Number.isFinite(minimumCodingScore) ||
                minimumCodingScore < 0 ||
                minimumCodingScore > 10))
          ) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_model_routing_scope_invalid",
                "Model routing requires a scoped active seat, RunPolicy, and matching Room/TaskNode.",
              ),
            );
          }
          const routingState = yield* routing
            .getState("owner")
            .pipe(
              Effect.mapError(
                (error) =>
                  new HostToolError(
                    "supervised_model_routing_unavailable",
                    error instanceof Error ? error.message : String(error),
                  ),
              ),
            );
          if (routingState.capabilityProfiles.length === 0) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_model_profile_required",
                "No verified model capability profile is available. An owner-curated profile with explicit provenance and confidence is required before recommendation.",
                { status: "needs_owner_curated_profile" },
              ),
            );
          }
          const getProviderAvailability = input.getProviderAvailability;
          if (!getProviderAvailability) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_provider_health_unavailable",
                "Live provider health is unavailable; model recommendation fails closed.",
              ),
            );
          }
          const providerAvailability = yield* getProviderAvailability().pipe(
            Effect.mapError(
              (error) =>
                new HostToolError(
                  "supervised_provider_health_unavailable",
                  error instanceof Error ? error.message : String(error),
                ),
            ),
          );
          const createdAt = new Date().toISOString();
          const receipt = yield* routing
            .select({
              receiptId: ModelSelectionReceiptId.makeUnsafe(`model-selection:${randomUUID()}`),
              request: {
                userId: "owner",
                taskCategory: stringArg(args, "taskCategory"),
                agentRole: seat.identityRole,
                workspaceId: seat.workspaceId,
                roomId,
                taskNodeId,
                actorSeatId: seat.id,
                providerAvailability,
                requirements: {
                  ...(minimumContextCapacity === undefined ? {} : { minimumContextCapacity }),
                  requiresVision: optionalBooleanArg(args, "requiresVision", false),
                  requiresTools: optionalBooleanArg(args, "requiresTools", true),
                  requiresReasoning: optionalBooleanArg(args, "requiresReasoning", false),
                  ...(minimumCodingScore === undefined
                    ? {}
                    : { minimumScores: { coding: minimumCodingScore } }),
                },
                runPolicy,
                ...(expectedInputTokens === undefined ? {} : { expectedInputTokens }),
                ...(expectedOutputTokens === undefined ? {} : { expectedOutputTokens }),
                routingRevision: routingState.routingRevision,
                createdAt,
              },
            })
            .pipe(
              Effect.mapError(
                (error) =>
                  new HostToolError(
                    "supervised_model_selection_rejected",
                    error instanceof Error ? error.message : String(error),
                  ),
              ),
            );
          const selectedProfile = routingState.capabilityProfiles.find(
            (profile) => profile.id === receipt.selectedModelId,
          );
          return hostToolSuccess({
            receipt,
            selected: selectedProfile
              ? {
                  id: selectedProfile.id,
                  provider: selectedProfile.provider,
                  model: selectedProfile.model,
                  version: selectedProfile.version,
                }
              : null,
          });
        }),
    },
  );

  const createMission = entry(
    {
      name: "create_supervised_mission",
      displayName: "Create Supervised mission",
      description:
        "Create a situational mission from the current authenticated owner message. Scope and grants cannot be inferred from an agent-authored wake.",
      inputSchema: objectSchema(
        {
          missionId: { type: "string" },
          brief: { type: "string", maxLength: 64_000 },
          focus: { type: "string", maxLength: 4_000 },
          scope: { type: "array", items: { type: "object" }, minItems: 1 },
          grants: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "lead.observe",
                "lead.advise",
                "lead.pause",
                "lead.resume",
                "workflow.apply",
                "workflow.revoke",
                "lead.replace",
                "lead.close",
              ],
            },
          },
          endCondition: { type: "object" },
        },
        ["brief", "focus", "scope", "grants", "endCondition"],
      ),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.work.assign",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: (_state, role) => role === "supervisor",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const [{ authority }, source] = yield* Effect.all([
            loadAuthority(context.callerThreadId),
            loadHumanOrigin(context),
          ]);
          if (authority.role !== "supervisor") {
            return yield* Effect.fail(
              new HostToolError("supervised_role_required", "Supervisor role required."),
            );
          }
          const now = new Date().toISOString();
          const mission: SupervisionMission = {
            id: SupervisionMissionId.makeUnsafe(
              typeof args.missionId === "string" ? args.missionId : randomUUID(),
            ),
            supervisorSeatId: SupervisorSeatId.makeUnsafe(authority.supervisorSeatId),
            brief: stringArg(args, "brief"),
            focus: stringArg(args, "focus"),
            scope: decode(MissionScopeList, args.scope, "scope"),
            grants: decode(Schema.Array(MissionGrant), args.grants, "grants"),
            endCondition: decode(MissionEndCondition, args.endCondition, "endCondition"),
            status: "active",
            sourceMessageId: MessageId.makeUnsafe(typeof source === "string" ? source : source.id),
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            revision: 0,
          };
          const receipt = yield* dispatch({
            type: "supervised.mission.create",
            commandId: CommandId.makeUnsafe(randomUUID()),
            aggregateId: AGGREGATE_ID,
            actor: {
              kind: "user",
              actorId: "owner",
              threadId: ThreadId.makeUnsafe(context.callerThreadId),
            },
            expectedRevision: 0,
            createdAt: now,
            mission,
          });
          return hostToolSuccess({ sequence: receipt.sequence, mission });
        }),
    },
  );

  const mutateMission = (
    name: "update_supervised_mission" | "complete_supervised_mission" | "cancel_supervised_mission",
    commandType:
      | "supervised.mission.update"
      | "supervised.mission.complete"
      | "supervised.mission.cancel",
  ) =>
    entry(
      {
        name,
        displayName:
          name === "update_supervised_mission"
            ? "Update Supervised mission"
            : name === "complete_supervised_mission"
              ? "Complete Supervised mission"
              : "Cancel Supervised mission",
        description: "Update mission state within the caller's existing Supervisor authority.",
        inputSchema: objectSchema(
          {
            missionId: { type: "string" },
            expectedRevision: { type: "integer", minimum: 0 },
            brief: { type: "string" },
            focus: { type: "string" },
            scope: { type: "array", items: { type: "object" }, minItems: 1 },
            grants: { type: "array", items: { type: "string" } },
            endCondition: { type: "object" },
          },
          ["missionId", "expectedRevision"],
        ),
        readOnly: false,
        providerSupport: { codex: "native", claude: "unsupported" },
        supervised: {
          toolId: "supervised.work.assign",
          schemaVersion: "1.0.0",
        },
      },
      {
        visible: (_state, role) => role === "supervisor",
        execute: (args, context) =>
          Effect.gen(function* () {
            yield* context.assertCallerTurnActive();
            const { state, authority } = yield* loadAuthority(context.callerThreadId);
            if (authority.role !== "supervisor") {
              return yield* Effect.fail(
                new HostToolError("supervised_role_required", "Supervisor role required."),
              );
            }
            const current = state.orchestration.missions.find(
              (mission) =>
                mission.id === stringArg(args, "missionId") &&
                mission.supervisorSeatId === authority.supervisorSeatId,
            );
            if (!current) {
              return yield* Effect.fail(
                new HostToolError("supervised_mission_missing", "Mission not found."),
              );
            }
            const next: SupervisionMission = {
              ...current,
              ...(typeof args.brief === "string" ? { brief: stringArg(args, "brief") } : {}),
              ...(typeof args.focus === "string" ? { focus: stringArg(args, "focus") } : {}),
              ...(args.scope !== undefined
                ? { scope: decode(MissionScopeList, args.scope, "scope") }
                : {}),
              ...(args.grants !== undefined
                ? {
                    grants: decode(Schema.Array(MissionGrant), args.grants, "grants"),
                  }
                : {}),
              ...(args.endCondition !== undefined
                ? { endCondition: decode(MissionEndCondition, args.endCondition, "endCondition") }
                : {}),
              updatedAt: new Date().toISOString(),
            };
            const expands =
              JSON.stringify(next.scope) !== JSON.stringify(current.scope) ||
              next.grants.some((grant) => !current.grants.includes(grant));
            if (expands) yield* loadHumanOrigin(context);
            const receipt = yield* dispatch({
              type: commandType,
              commandId: CommandId.makeUnsafe(randomUUID()),
              aggregateId: AGGREGATE_ID,
              actor: expands
                ? {
                    kind: "user",
                    actorId: "owner",
                    threadId: ThreadId.makeUnsafe(context.callerThreadId),
                  }
                : {
                    kind: "thread",
                    actorId: context.callerThreadId,
                    threadId: ThreadId.makeUnsafe(context.callerThreadId),
                  },
              expectedRevision: intArg(args, "expectedRevision"),
              createdAt: new Date().toISOString(),
              mission: next,
            });
            return hostToolSuccess({ sequence: receipt.sequence, mission: next });
          }),
      },
    );

  const sendAdvice = entry(
    {
      name: "send_supervised_advice",
      displayName: "Send Supervised advice",
      description:
        "Send concise attributed advice to a Lead covered by an active lead.advise mission.",
      inputSchema: objectSchema(
        { missionId: { type: "string" }, leadSeatId: { type: "string" }, text: { type: "string" } },
        ["missionId", "leadSeatId", "text"],
      ),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.message.send",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: (_state, role) => role === "supervisor",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { state, authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role !== "supervisor") {
            return yield* Effect.fail(
              new HostToolError("supervised_role_required", "Supervisor role required."),
            );
          }
          const mission = authority.missions.find(
            (candidate) =>
              candidate.id === stringArg(args, "missionId") &&
              candidate.grants.includes("lead.advise"),
          );
          const lead = state.leads.find(
            (candidate) => candidate.id === stringArg(args, "leadSeatId"),
          );
          if (
            !mission ||
            !lead ||
            !missionScopeContainsLead({ scope: mission.scope, lead, projects: state.projects })
          ) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_scope_denied",
                "Mission does not cover this Lead with lead.advise authority.",
              ),
            );
          }
          const now = new Date().toISOString();
          const advice = {
            id: SupervisionAdviceId.makeUnsafe(randomUUID()),
            supervisorSeatId: mission.supervisorSeatId,
            leadSeatId: lead.id,
            missionId: mission.id,
            text: stringArg(args, "text"),
            createdAt: now,
          };
          const receipt = yield* dispatch({
            type: "supervised.advice.send",
            commandId: CommandId.makeUnsafe(randomUUID()),
            aggregateId: AGGREGATE_ID,
            actor: {
              kind: "thread",
              actorId: context.callerThreadId,
              threadId: ThreadId.makeUnsafe(context.callerThreadId),
            },
            expectedRevision: 0,
            createdAt: now,
            advice,
          });
          return hostToolSuccess({ sequence: receipt.sequence, advice });
        }),
    },
  );

  const applyWorkflow = entry(
    {
      name: "apply_supervised_workflow",
      displayName: "Apply Supervised workflow",
      description:
        "Apply a visible, versioned workflow directive under an active workflow.apply mission grant.",
      inputSchema: objectSchema(
        {
          missionId: { type: "string" },
          leadSeatId: { type: "string" },
          slot: { type: "string" },
          instruction: { type: "string" },
        },
        ["missionId", "leadSeatId", "slot", "instruction"],
      ),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.intervention.open",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: (_state, role) => role === "supervisor",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { state, authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role !== "supervisor")
            return yield* Effect.fail(
              new HostToolError("supervised_role_required", "Supervisor role required."),
            );
          const mission = authority.missions.find(
            (candidate) => candidate.id === stringArg(args, "missionId"),
          );
          const lead = state.leads.find(
            (candidate) => candidate.id === stringArg(args, "leadSeatId"),
          );
          if (
            !mission ||
            !lead ||
            !missionScopeContainsLead({ scope: mission.scope, lead, projects: state.projects })
          ) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_scope_denied",
                "Mission does not cover this Lead with workflow.apply authority.",
              ),
            );
          }
          const humanOrigin = yield* Effect.result(loadHumanOrigin(context));
          if (!mission.grants.includes("workflow.apply") && humanOrigin._tag === "Failure") {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_authority_denied",
                "Authenticated owner origin or workflow.apply mission grant required.",
              ),
            );
          }
          const now = new Date().toISOString();
          const directive = {
            id: WorkflowDirectiveId.makeUnsafe(randomUUID()),
            supervisorSeatId: mission.supervisorSeatId,
            leadSeatId: lead.id,
            missionId: mission.id,
            slot: stringArg(args, "slot"),
            instruction: stringArg(args, "instruction"),
            status: "active" as const,
            createdAt: now,
            updatedAt: now,
            revision: 0,
          };
          const receipt = yield* dispatch({
            type: "supervised.workflow.apply",
            commandId: CommandId.makeUnsafe(randomUUID()),
            aggregateId: AGGREGATE_ID,
            actor:
              humanOrigin._tag === "Success"
                ? {
                    kind: "user",
                    actorId: "owner",
                    threadId: ThreadId.makeUnsafe(context.callerThreadId),
                  }
                : {
                    kind: "thread",
                    actorId: context.callerThreadId,
                    threadId: ThreadId.makeUnsafe(context.callerThreadId),
                  },
            expectedRevision: 0,
            createdAt: now,
            directive,
          });
          return hostToolSuccess({ sequence: receipt.sequence, directive });
        }),
    },
  );

  const requestReplacement = entry(
    {
      name: "request_lead_replacement",
      displayName: "Request Lead replacement",
      description:
        "Request durable Lead rotation under an authenticated owner turn or active lead.replace mission grant.",
      inputSchema: objectSchema(
        {
          missionId: { type: "string" },
          leadSeatId: { type: "string" },
          profilePresetId: { type: "string" },
          expectedRevision: { type: "integer", minimum: 0 },
        },
        ["leadSeatId", "profilePresetId", "expectedRevision"],
      ),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.lead.replace",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: (_state, role) => role === "supervisor",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { state, authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role !== "supervisor")
            return yield* Effect.fail(
              new HostToolError("supervised_role_required", "Supervisor role required."),
            );
          const lead = state.leads.find(
            (candidate) => candidate.id === stringArg(args, "leadSeatId"),
          );
          if (!lead)
            return yield* Effect.fail(
              new HostToolError("supervised_lead_missing", "Lead seat not found."),
            );
          const mission =
            typeof args.missionId === "string"
              ? (authority.missions.find(
                  (candidate) =>
                    candidate.id === args.missionId && candidate.grants.includes("lead.replace"),
                ) ?? null)
              : null;
          if (!mission) yield* loadHumanOrigin(context);
          if (
            mission &&
            !missionScopeContainsLead({ scope: mission.scope, lead, projects: state.projects })
          ) {
            return yield* Effect.fail(
              new HostToolError("supervised_scope_denied", "Mission does not cover this Lead."),
            );
          }
          const now = new Date().toISOString();
          const preset = state.orchestration.profiles.find(
            (candidate) => candidate.id === stringArg(args, "profilePresetId"),
          );
          if (!preset) {
            return yield* Effect.fail(
              new HostToolError("supervised_profile_missing", "Profile preset not found."),
            );
          }
          const launchIssue = profileLaunchIssue(preset);
          if (launchIssue !== null) {
            return yield* Effect.fail(
              new HostToolError("supervised_profile_unsupported", launchIssue),
            );
          }
          const replacementProfileSnapshotId = ProfileSnapshotId.makeUnsafe(randomUUID());
          const replacementThreadId = ThreadId.makeUnsafe(randomUUID());
          const replacementProfileSnapshot = resolveProfilePreset({
            preset,
            snapshotId: replacementProfileSnapshotId,
            createdAt: now,
          });
          const rotation = {
            id: LeadRotationId.makeUnsafe(randomUUID()),
            leadSeatId: LeadSeatId.makeUnsafe(lead.id),
            missionId: mission?.id ?? null,
            predecessorThreadId: lead.activeThreadId,
            replacementThreadId,
            replacementProfileSnapshotId,
            state: "requested" as const,
            error: null,
            createdAt: now,
            updatedAt: now,
            revision: 0,
          };
          const receipt = yield* dispatch({
            type: "supervised.lead.replace",
            commandId: CommandId.makeUnsafe(randomUUID()),
            aggregateId: AGGREGATE_ID,
            actor: mission
              ? {
                  kind: "thread",
                  actorId: context.callerThreadId,
                  threadId: ThreadId.makeUnsafe(context.callerThreadId),
                }
              : {
                  kind: "user",
                  actorId: "owner",
                  threadId: ThreadId.makeUnsafe(context.callerThreadId),
                },
            expectedRevision: intArg(args, "expectedRevision"),
            createdAt: now,
            rotation,
            profilePresetId: preset.id,
            replacementProfileSnapshot,
          });
          return hostToolSuccess({ sequence: receipt.sequence, rotation });
        }),
    },
  );

  const assumeRoomRoot = entry(
    {
      name: "assume_room_root",
      displayName: "Assume Room Root",
      description:
        "Under the current authenticated owner request, transfer one active Room Root lease to this Supervisor and notify the former Root for a durable handoff.",
      inputSchema: objectSchema(
        {
          roomId: { type: "string" },
          reason: { type: "string", maxLength: 32_768 },
          expectedRevision: { type: "integer", minimum: 0 },
        },
        ["roomId", "reason", "expectedRevision"],
      ),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.role.assume",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: (_state, role) => role === "supervisor",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          yield* loadHumanOrigin(context);
          const { state, authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role !== "supervisor") {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_supervisor_required",
                "Only the current Supervisor may request an owner-authorized Root assumption.",
              ),
            );
          }
          const roomId = RoomId.makeUnsafe(stringArg(args, "roomId"));
          const supervisorSeat = state.governance.agentSeats.find(
            (seat) =>
              seat.id === authority.supervisorSeatId &&
              seat.identityRole === "supervisor" &&
              seat.effectiveRole === "supervisor" &&
              seat.threadId === context.callerThreadId &&
              (seat.lifecycleState === "ready" || seat.lifecycleState === "active"),
          );
          const supervisorReceipt = state.governance.authorityReceipts.find(
            (receipt) =>
              receipt.id === supervisorSeat?.authorityReceiptId &&
              receipt.actorSeatId === supervisorSeat?.id &&
              receipt.revokedAt === null &&
              receipt.roomScopes.includes(roomId),
          );
          const room = state.supervised.rooms.find(
            (candidate) =>
              candidate.id === roomId &&
              candidate.status === "active" &&
              candidate.leadSeatId !== null &&
              !idsEqual(candidate.leadSeatId, supervisorSeat?.id),
          );
          const previousRootSeat = state.governance.agentSeats.find(
            (seat) =>
              idsEqual(seat.id, room?.leadSeatId) &&
              seat.threadId !== null &&
              (seat.lifecycleState === "ready" || seat.lifecycleState === "active"),
          );
          const previousRootLease = state.governance.rootLeases.find(
            (lease) =>
              lease.roomId === room?.id &&
              lease.holderSeatId === previousRootSeat?.id &&
              (lease.status === "active" ||
                lease.status === "transferring" ||
                lease.status === "releasing"),
          );
          if (
            !room ||
            !supervisorSeat ||
            !supervisorReceipt ||
            !previousRootSeat?.threadId ||
            !previousRootLease
          ) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_root_assumption_unavailable",
                "The scoped Supervisor, active Room, former Root thread, and live Root lease must all be available.",
              ),
            );
          }
          const createdAt = new Date().toISOString();
          const receipt = yield* dispatch({
            type: "supervised.role.assume",
            commandId: CommandId.makeUnsafe(randomUUID()),
            aggregateId: room.id,
            actor: { kind: "user", actorId: "owner" },
            expectedRevision: intArg(args, "expectedRevision"),
            idempotencyKey: `role-assume:${room.id}:${supervisorSeat.id}:${room.revision}`,
            createdAt,
            roomId: room.id,
            supervisorSeatId: SupervisorSeatId.makeUnsafe(supervisorSeat.id),
            supervisorThreadId: ThreadId.makeUnsafe(context.callerThreadId),
            previousRootSeatId: rootHolderSeatId(previousRootSeat),
            previousRootThreadId: previousRootSeat.threadId,
            reason: stringArg(args, "reason"),
          });
          return hostToolSuccess({
            sequence: receipt.sequence,
            roomId: room.id,
            previousRootSeatId: previousRootSeat.id,
            rootSeatId: supervisorSeat.id,
            effectiveRole: "acting_root",
            ownershipTransferred: true,
          });
        }),
    },
  );

  const createLeadRoom = entry(
    {
      name: "create_lead_room",
      displayName: "Create Lead Room",
      description:
        "Atomically create a Project Lead Room, provision its active Lead, and start the Lead with an explicit bounded prompt.",
      inputSchema: objectSchema(
        {
          projectId: { type: "string" },
          leadProfilePresetId: { type: "string" },
          title: { type: "string", maxLength: 512 },
          initialPrompt: { type: "string", maxLength: 32_768 },
        },
        ["title", "initialPrompt"],
      ),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.agent.create",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: (_state, role) => role === "supervisor",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { state, authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role !== "supervisor") {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_supervisor_required",
                "Only the active Primary Supervisor may create a Lead Room.",
              ),
            );
          }
          const requestedProjectId = optionalStringArg(args, "projectId");
          const eligibleProjects = state.projects.filter(
            (project) =>
              project.kind === "project" &&
              project.deletedAt === null &&
              authority.missions.some(
                (mission) =>
                  mission.status === "active" &&
                  mission.scope.some(
                    (scope) =>
                      scope.kind === "all_projects" ||
                      (scope.kind === "project" && scope.projectId === project.id),
                  ),
              ),
          );
          const project = requestedProjectId
            ? eligibleProjects.find((candidate) => candidate.id === requestedProjectId)
            : eligibleProjects.length === 1
              ? eligibleProjects[0]
              : undefined;
          if (!project) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_project_scope_required",
                requestedProjectId
                  ? "The requested Project is outside the active Supervisor mission scope."
                  : "Specify projectId when the active Supervisor missions cover more than one Project.",
              ),
            );
          }
          if (
            state.leads.some(
              (candidate) => candidate.projectId === project.id && candidate.status !== "archived",
            )
          ) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_lead_exists",
                "The Project already has a live Lead seat.",
              ),
            );
          }
          const requestedPresetId = optionalStringArg(args, "leadProfilePresetId");
          const preset = state.orchestration.profiles.find(
            (candidate) =>
              candidate.archivedAt === null &&
              candidate.roleHints.includes("lead") &&
              (requestedPresetId === null || candidate.id === requestedPresetId),
          );
          if (!preset) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_profile_missing",
                "An active Lead profile preset is required.",
              ),
            );
          }
          const launchIssue = profileLaunchIssue(preset);
          if (launchIssue !== null) {
            return yield* Effect.fail(
              new HostToolError("supervised_profile_unsupported", launchIssue),
            );
          }
          const supervisorSeat = state.governance.agentSeats.find(
            (candidate) =>
              candidate.id === authority.supervisorSeatId &&
              candidate.identityRole === "supervisor" &&
              candidate.threadId === authority.callerThreadId,
          );
          if (!supervisorSeat) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_authority_unavailable",
                "The Primary Supervisor has no durable authority receipt.",
              ),
            );
          }
          const createdAt = new Date().toISOString();
          const leadSeatId = LeadSeatId.makeUnsafe(randomUUID());
          const threadId = ThreadId.makeUnsafe(`lead:${randomUUID()}`);
          const roomId = RoomId.makeUnsafe(threadId);
          const profileSnapshot = resolveProfilePreset({
            preset,
            snapshotId: ProfileSnapshotId.makeUnsafe(randomUUID()),
            createdAt,
          });
          const receipt = yield* dispatch({
            type: "supervised.lead.create",
            commandId: CommandId.makeUnsafe(randomUUID()),
            aggregateId: roomId,
            actor: {
              kind: "seat",
              actorId: context.callerThreadId,
              seatId: SupervisorSeatId.makeUnsafe(supervisorSeat.id),
            },
            authorityReceiptId: supervisorSeat.authorityReceiptId,
            expectedRevision: 0,
            idempotencyKey: `lead-create:${roomId}`,
            createdAt,
            supervisorSeatId: SupervisorSeatId.makeUnsafe(supervisorSeat.id),
            leadSeatId,
            threadId,
            workingDirectory: project.workspaceRoot,
            room: {
              id: roomId,
              projectId: project.id,
              title: stringArg(args, "title"),
              leadSeatId,
              status: "active",
              graphRevision: 0,
              revision: 0,
              createdAt,
              updatedAt: createdAt,
            },
            profilePresetId: preset.id,
            profileSnapshot,
            initialPrompt: stringArg(args, "initialPrompt"),
          });
          return hostToolSuccess({
            sequence: receipt.sequence,
            projectId: project.id,
            roomId,
            leadSeatId,
            threadId,
          });
        }),
    },
  );

  const createTaskGraph = entry(
    {
      name: "create_task_graph",
      displayName: "Create Task Graph",
      description:
        "Atomically create a durable Task Graph for the current Lead Room. Dependencies reference node keys from the same request.",
      inputSchema: objectSchema(
        {
          title: { type: "string", maxLength: 512 },
          intent: { type: "string", maxLength: 32_768 },
          acceptanceCriteria: {
            type: "array",
            items: { type: "string", maxLength: 32_768 },
            maxItems: 128,
          },
          nodes: {
            type: "array",
            minItems: 1,
            maxItems: 256,
            items: objectSchema(
              {
                key: { type: "string", maxLength: 128 },
                title: { type: "string", maxLength: 512 },
                scope: { type: "string", maxLength: 32_768 },
                acceptanceCriteria: {
                  type: "array",
                  items: { type: "string", maxLength: 32_768 },
                  maxItems: 128,
                },
                dependsOn: {
                  type: "array",
                  items: { type: "string", maxLength: 128 },
                  maxItems: 256,
                },
              },
              ["key", "title", "scope", "acceptanceCriteria"],
            ),
          },
        },
        ["title", "intent", "acceptanceCriteria", "nodes"],
      ),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.task.delegate",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: (_state, role) => role === "lead",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { state } = yield* loadAuthority(context.callerThreadId);
          const root = activeRootContextForCaller(state, context.callerThreadId);
          if (!root) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_room_unavailable",
                "The caller must hold the active Room Root lease.",
              ),
            );
          }
          const { room, seat: leadSeat } = root;
          if (!Array.isArray(args.nodes) || args.nodes.length === 0 || args.nodes.length > 256) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_tool_input_invalid",
                "nodes must contain between 1 and 256 TaskNode definitions.",
              ),
            );
          }
          const nodeSpecs = args.nodes.map((value, index) => {
            if (value === null || typeof value !== "object" || Array.isArray(value)) {
              throw new HostToolError(
                "supervised_tool_input_invalid",
                `nodes[${index}] must be an object.`,
              );
            }
            const node = value as Record<string, unknown>;
            return {
              key: stringArg(node, "key"),
              title: stringArg(node, "title"),
              scope: stringArg(node, "scope"),
              acceptanceCriteria: stringArrayArg(node, "acceptanceCriteria"),
              dependsOn: optionalStringArrayArg(node, "dependsOn"),
            };
          });
          const nodeKeys = new Set(nodeSpecs.map((node) => node.key));
          if (nodeKeys.size !== nodeSpecs.length) {
            return yield* Effect.fail(
              new HostToolError("supervised_tool_input_invalid", "TaskNode keys must be unique."),
            );
          }
          for (const node of nodeSpecs) {
            if (node.dependsOn.some((dependency) => !nodeKeys.has(dependency))) {
              return yield* Effect.fail(
                new HostToolError(
                  "supervised_tool_input_invalid",
                  `TaskNode '${node.key}' references an unknown dependency key.`,
                ),
              );
            }
          }
          const createdAt = new Date().toISOString();
          const taskId = TaskId.makeUnsafe(randomUUID());
          const graphRevision = room.graphRevision + 1;
          const actor = {
            kind: "seat" as const,
            actorId: context.callerThreadId,
            seatId: rootHolderSeatId(leadSeat),
          };
          const nodeIdsByKey = new Map(
            nodeSpecs.map((node) => [node.key, TaskNodeId.makeUnsafe(randomUUID())]),
          );
          const nodes = nodeSpecs.map((node) => {
            const taskNodeId = nodeIdsByKey.get(node.key)!;
            const revisionId = TaskNodeRevisionId.makeUnsafe(randomUUID());
            const dependencyNodeIds = node.dependsOn.map(
              (dependency) => nodeIdsByKey.get(dependency)!,
            );
            return {
              taskNode: {
                id: taskNodeId,
                taskId,
                roomId: room.id,
                parentNodeId: null,
                title: node.title,
                description: node.scope,
                lifecycle:
                  dependencyNodeIds.length === 0 ? ("ready" as const) : ("planned" as const),
                activeRevisionId: revisionId,
                graphRevision,
                revision: 0,
                createdAt,
                updatedAt: createdAt,
              },
              taskNodeRevision: {
                id: revisionId,
                taskNodeId,
                graphRevision,
                scope: node.scope,
                acceptanceCriteria: [...node.acceptanceCriteria],
                dependencyNodeIds,
                evidenceRefs: [],
                createdBy: actor,
                createdAt,
              },
            };
          });
          const receipt = yield* dispatch({
            type: "supervised.task-graph.create",
            commandId: CommandId.makeUnsafe(randomUUID()),
            aggregateId: taskId,
            actor,
            authorityReceiptId: leadSeat.authorityReceiptId,
            expectedRevision: 0,
            idempotencyKey: `task-graph-create:${taskId}`,
            createdAt,
            task: {
              id: taskId,
              roomId: room.id,
              title: stringArg(args, "title"),
              intent: stringArg(args, "intent"),
              acceptanceCriteria: [...stringArrayArg(args, "acceptanceCriteria")],
              lifecycle: "active",
              activeGraphRevision: graphRevision,
              revision: 0,
              createdAt,
              updatedAt: createdAt,
            },
            nodes,
          });
          return hostToolSuccess({
            sequence: receipt.sequence,
            roomId: room.id,
            taskId,
            graphRevision,
            nodes: nodeSpecs.map((node) => ({
              key: node.key,
              taskNodeId: nodeIdsByKey.get(node.key)!,
            })),
          });
        }),
    },
  );

  const delegateTaskNode = entry(
    {
      name: "delegate_task_node",
      displayName: "Delegate TaskNode",
      description:
        "As the current Root Lead, delegate one ready durable TaskNode revision to an active Room Peer and queue its provider Run.",
      inputSchema: objectSchema(
        {
          roomId: { type: "string" },
          taskNodeId: { type: "string" },
          peerThreadId: { type: "string" },
          workRequest: { type: "string", maxLength: 32_768 },
        },
        ["roomId", "taskNodeId", "peerThreadId", "workRequest"],
      ),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.task.delegate",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: (_state, role) => role === "lead",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { state } = yield* loadAuthority(context.callerThreadId);
          const roomId = RoomId.makeUnsafe(stringArg(args, "roomId"));
          const taskNodeId = TaskNodeId.makeUnsafe(stringArg(args, "taskNodeId"));
          const peerThreadId = ThreadId.makeUnsafe(stringArg(args, "peerThreadId"));
          const root = activeRootContextForCaller(state, context.callerThreadId, roomId);
          const room = root?.room;
          const taskNode = state.supervised.taskNodes.find(
            (candidate) => candidate.id === taskNodeId && candidate.roomId === room?.id,
          );
          const task = taskNode
            ? state.supervised.tasks.find(
                (candidate) =>
                  candidate.id === taskNode.taskId &&
                  candidate.roomId === room?.id &&
                  candidate.lifecycle === "active",
              )
            : undefined;
          const taskNodeRevision = taskNode
            ? state.supervised.taskNodeRevisions.find(
                (candidate) => candidate.id === taskNode.activeRevisionId,
              )
            : undefined;
          const leadSeat = root?.seat;
          const peerSeat = state.governance.agentSeats.find(
            (candidate) =>
              candidate.identityRole === "peer" &&
              candidate.threadId === peerThreadId &&
              candidate.roomIds.includes(roomId) &&
              (candidate.lifecycleState === "ready" || candidate.lifecycleState === "active"),
          );
          const policy = state.supervised.runPolicies[0];
          if (
            !room ||
            !task ||
            !taskNode ||
            !taskNodeRevision ||
            !leadSeat ||
            !peerSeat ||
            !policy ||
            taskNode.lifecycle !== "ready"
          ) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_task_node_unavailable",
                "Delegation requires the current Root Room, one ready active TaskNode revision, an active scoped Peer, and a RunPolicy.",
              ),
            );
          }
          const runId = RunId.makeUnsafe(
            `task-node-run:${taskNode.id}:${taskNode.activeRevisionId}:${peerSeat.id}`,
          );
          const existingRun = state.supervised.runs.find(
            (candidate) =>
              candidate.taskNodeId === taskNode.id &&
              !["succeeded", "failed", "cancelled"].includes(candidate.status),
          );
          if (existingRun) {
            if (existingRun.id === runId && existingRun.ownerSeatId === peerSeat.id) {
              return hostToolSuccess({
                sequence: state.snapshotSequence,
                roomId,
                taskNodeId,
                taskNodeRevisionId: taskNodeRevision.id,
                runId: existingRun.id,
                peerThreadId,
                status: existingRun.status,
                ownershipTransferred: false,
              });
            }
            return yield* Effect.fail(
              new HostToolError(
                "supervised_task_node_already_delegated",
                "The active TaskNode revision already has a live Run.",
              ),
            );
          }
          const createdAt = new Date().toISOString();
          const receipt = yield* dispatch({
            type: "supervised.task.delegate",
            commandId: CommandId.makeUnsafe(randomUUID()),
            aggregateId: runId,
            actor: {
              kind: "seat",
              actorId: context.callerThreadId,
              seatId: rootHolderSeatId(leadSeat),
            },
            authorityReceiptId: leadSeat.authorityReceiptId,
            expectedRevision: 0,
            idempotencyKey: `task-node-delegate:${runId}`,
            createdAt,
            roomId,
            projectId: room.projectId,
            leadSeatId: rootHolderSeatId(leadSeat),
            leadThreadId: ThreadId.makeUnsafe(context.callerThreadId),
            peerThreadId,
            workRequest: stringArg(args, "workRequest"),
            run: {
              id: runId,
              roomId,
              taskId: task.id,
              taskNodeId: taskNode.id,
              taskNodeRevisionId: taskNodeRevision.id,
              ownerSeatId: peerSeat.id,
              policyId: policy.id,
              status: "queued",
              attempt: 1,
              daemonEpoch: Math.max(1, state.supervised.health.daemonEpoch),
              startedAt: null,
              lastProgressAt: null,
              finishedAt: null,
              revision: 0,
              createdAt,
              updatedAt: createdAt,
            },
          });
          return hostToolSuccess({
            sequence: receipt.sequence,
            roomId,
            taskNodeId,
            taskNodeRevisionId: taskNodeRevision.id,
            runId,
            peerThreadId,
            status: "queued",
            ownershipTransferred: false,
          });
        }),
    },
  );

  const startTaskNodeRun = entry(
    {
      name: "start_task_node_run",
      displayName: "Start TaskNode Run",
      description:
        "As the assigned Peer, atomically acquire the durable WorkClaim and start a queued TaskNode Run.",
      inputSchema: objectSchema({ runId: { type: "string" } }, ["runId"]),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.run.control",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: (_state, role) => role === "peer",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { state, authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role !== "peer") {
            return yield* Effect.fail(
              new HostToolError("supervised_peer_required", "The assigned Peer is required."),
            );
          }
          const runId = RunId.makeUnsafe(stringArg(args, "runId"));
          const run = state.supervised.runs.find(
            (candidate) => candidate.id === runId && candidate.ownerSeatId === authority.peerSeatId,
          );
          const taskNode = run?.taskNodeId
            ? state.supervised.taskNodes.find((candidate) => candidate.id === run.taskNodeId)
            : undefined;
          const policy = run
            ? state.supervised.runPolicies.find((candidate) => candidate.id === run.policyId)
            : undefined;
          const peerSeat = state.governance.agentSeats.find(
            (candidate) =>
              candidate.id === authority.peerSeatId &&
              candidate.threadId === authority.callerThreadId,
          );
          const existingClaim = run
            ? state.supervised.workClaims.find(
                (candidate) => candidate.runId === run.id && candidate.status === "active",
              )
            : undefined;
          if (run?.status === "running" && existingClaim) {
            return hostToolSuccess({
              sequence: state.snapshotSequence,
              runId: run.id,
              workClaimId: existingClaim.id,
              taskNodeId: run.taskNodeId,
              status: run.status,
            });
          }
          if (
            !run ||
            !taskNode ||
            !policy ||
            !peerSeat ||
            run.taskNodeRevisionId === null ||
            run.status !== "queued" ||
            taskNode.lifecycle !== "ready" ||
            existingClaim
          ) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_run_not_startable",
                "The caller must own one queued Run for a ready TaskNode without an active WorkClaim.",
              ),
            );
          }
          const createdAt = new Date().toISOString();
          const workClaimId = WorkClaimId.makeUnsafe(
            `work-claim:${run.id}:${run.taskNodeRevisionId}`,
          );
          const receipt = yield* dispatch({
            type: "supervised.run.start",
            commandId: CommandId.makeUnsafe(randomUUID()),
            aggregateId: run.id,
            actor: {
              kind: "seat",
              actorId: context.callerThreadId,
              seatId: actorSeatId(peerSeat.id),
            },
            authorityReceiptId: peerSeat.authorityReceiptId,
            expectedRevision: run.revision,
            idempotencyKey: `task-node-run-start:${run.id}:${run.attempt}`,
            createdAt,
            runId: run.id,
            claim: {
              id: workClaimId,
              taskNodeId: taskNode.id,
              taskNodeRevisionId: run.taskNodeRevisionId,
              runId: run.id,
              ownerSeatId: peerSeat.id,
              status: "active",
              acquiredAt: createdAt,
              expiresAt: new Date(Date.parse(createdAt) + policy.maxWallTimeMs).toISOString(),
              releasedAt: null,
              revision: 0,
            },
          });
          return hostToolSuccess({
            sequence: receipt.sequence,
            runId: run.id,
            workClaimId,
            taskNodeId: taskNode.id,
            status: "running",
          });
        }),
    },
  );

  const publishTaskNodeEvidence = entry(
    {
      name: "publish_task_node_evidence",
      displayName: "Publish TaskNode evidence",
      description:
        "As the assigned Peer, atomically publish durable evidence, move the Run and TaskNode to review, release the WorkClaim, and notify the Root Lead.",
      inputSchema: objectSchema(
        {
          runId: { type: "string" },
          summary: { type: "string", maxLength: 32_768 },
        },
        ["runId", "summary"],
      ),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.evidence.publish",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: (_state, role) => role === "peer",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { state, authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role !== "peer") {
            return yield* Effect.fail(
              new HostToolError("supervised_peer_required", "The assigned Peer is required."),
            );
          }
          const runId = RunId.makeUnsafe(stringArg(args, "runId"));
          const run = state.supervised.runs.find(
            (candidate) => candidate.id === runId && candidate.ownerSeatId === authority.peerSeatId,
          );
          const taskNode = run?.taskNodeId
            ? state.supervised.taskNodes.find((candidate) => candidate.id === run.taskNodeId)
            : undefined;
          const claim = run
            ? state.supervised.workClaims.find(
                (candidate) => candidate.runId === run.id && candidate.status === "active",
              )
            : undefined;
          const peerSeat = state.governance.agentSeats.find(
            (candidate) =>
              candidate.id === authority.peerSeatId &&
              candidate.threadId === authority.callerThreadId,
          );
          const evidenceId = EvidenceId.makeUnsafe(
            `task-node-evidence:${runId}:attempt:${run?.attempt ?? 1}`,
          );
          if (run?.status === "reviewing" || run?.status === "succeeded") {
            const evidence = state.supervised.evidence.find(
              (candidate) => candidate.id === evidenceId,
            );
            if (evidence) {
              return hostToolSuccess({
                sequence: state.snapshotSequence,
                runId,
                taskNodeId: run.taskNodeId,
                evidenceId,
                status: run.status,
                leadNotified: true,
              });
            }
          }
          if (
            !run ||
            !taskNode ||
            !claim ||
            !peerSeat ||
            run.status !== "running" ||
            taskNode.lifecycle !== "running"
          ) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_run_not_submittable",
                "The caller must own a running TaskNode Run with an active WorkClaim.",
              ),
            );
          }
          const createdAt = new Date().toISOString();
          const receipt = yield* dispatch({
            type: "supervised.run.submit",
            commandId: CommandId.makeUnsafe(randomUUID()),
            aggregateId: run.id,
            actor: {
              kind: "seat",
              actorId: context.callerThreadId,
              seatId: actorSeatId(peerSeat.id),
            },
            authorityReceiptId: peerSeat.authorityReceiptId,
            expectedRevision: run.revision,
            idempotencyKey: `task-node-run-submit:${run.id}:${run.attempt}`,
            createdAt,
            runId: run.id,
            claimId: claim.id,
            evidence: {
              id: evidenceId,
              scope: { kind: "room", roomId: run.roomId },
              kind: "provider_receipt",
              summary: stringArg(args, "summary"),
              blob: null,
              sourceEventIds: [],
              modelSessionId: null,
              createdBy: {
                kind: "seat",
                actorId: context.callerThreadId,
                seatId: actorSeatId(peerSeat.id),
              },
              createdAt,
            },
          });
          return hostToolSuccess({
            sequence: receipt.sequence,
            runId: run.id,
            taskNodeId: taskNode.id,
            evidenceId,
            status: "reviewing",
            leadNotified: true,
          });
        }),
    },
  );

  const acceptTaskNode = entry(
    {
      name: "accept_task_node",
      displayName: "Accept TaskNode",
      description:
        "As the current Root Lead, accept a reviewing TaskNode Run only after validating its attached durable evidence.",
      inputSchema: objectSchema(
        {
          runId: { type: "string" },
          evidenceId: { type: "string" },
        },
        ["runId", "evidenceId"],
      ),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.review.request",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: (_state, role) => role === "lead",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { state } = yield* loadAuthority(context.callerThreadId);
          const runId = RunId.makeUnsafe(stringArg(args, "runId"));
          const evidenceId = EvidenceId.makeUnsafe(stringArg(args, "evidenceId"));
          const run = state.supervised.runs.find((candidate) => candidate.id === runId);
          const taskNode = run?.taskNodeId
            ? state.supervised.taskNodes.find((candidate) => candidate.id === run.taskNodeId)
            : undefined;
          const root = run
            ? activeRootContextForCaller(state, context.callerThreadId, run.roomId)
            : null;
          const room = root?.room;
          const leadSeat = root?.seat;
          if (run?.status === "succeeded" && taskNode?.lifecycle === "accepted" && room) {
            return hostToolSuccess({
              sequence: state.snapshotSequence,
              roomId: room.id,
              runId,
              taskNodeId: taskNode.id,
              evidenceId,
              status: "accepted",
            });
          }
          if (
            !run ||
            !taskNode ||
            !room ||
            !leadSeat ||
            run.status !== "reviewing" ||
            taskNode.lifecycle !== "review"
          ) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_review_unavailable",
                "The current Root Lead requires a reviewing Run and TaskNode in its active Room.",
              ),
            );
          }
          const createdAt = new Date().toISOString();
          const receipt = yield* dispatch({
            type: "supervised.review.accept",
            commandId: CommandId.makeUnsafe(randomUUID()),
            aggregateId: run.id,
            actor: {
              kind: "seat",
              actorId: context.callerThreadId,
              seatId: rootHolderSeatId(leadSeat),
            },
            authorityReceiptId: leadSeat.authorityReceiptId,
            expectedRevision: run.revision,
            idempotencyKey: `task-node-review-accept:${run.id}:${evidenceId}`,
            createdAt,
            runId,
            evidenceId,
          });
          return hostToolSuccess({
            sequence: receipt.sequence,
            roomId: room.id,
            runId,
            taskNodeId: taskNode.id,
            evidenceId,
            status: "accepted",
          });
        }),
    },
  );

  const createPeer = entry(
    {
      name: "create_peer",
      displayName: "Create Peer",
      description:
        "Create a bounded Peer under the current Room Lead. A Supervisor must call assign_peer_work afterward; a Lead may include an initial prompt.",
      inputSchema: objectSchema(
        {
          roomId: { type: "string" },
          leadSeatId: { type: "string" },
          profilePresetId: { type: "string" },
          title: { type: "string", maxLength: 512 },
          concern: { type: "string", maxLength: 512 },
          initialPrompt: { type: "string", maxLength: 32_768 },
        },
        ["roomId", "leadSeatId", "title", "concern"],
      ),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.agent.create",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: (_state, role) => role === "lead" || role === "supervisor",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { state, authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role === "peer") {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_coordinator_required",
                "Only an active Lead or scoped Primary Supervisor may create a Peer.",
              ),
            );
          }
          const requestedRoomId = RoomId.makeUnsafe(stringArg(args, "roomId"));
          const requestedLeadSeatId = stringArg(args, "leadSeatId");
          const actingRoot = activeRootContextForCaller(
            state,
            context.callerThreadId,
            requestedRoomId,
          );
          const eligibleLeads = actingRoot
            ? [
                {
                  id: rootHolderSeatId(actingRoot.seat),
                  projectId: actingRoot.room.projectId,
                  activeThreadId: ThreadId.makeUnsafe(context.callerThreadId),
                  status: "active" as const,
                  revision: actingRoot.seat.revision,
                },
              ]
            : state.leads.filter(
                (candidate) =>
                  candidate.status === "active" &&
                  (authority.role === "lead"
                    ? candidate.id === authority.leadSeatId &&
                      candidate.activeThreadId === authority.callerThreadId
                    : authority.missions.some((mission) =>
                        missionScopeContainsLead({
                          scope: mission.scope,
                          lead: candidate,
                          projects: state.projects,
                        }),
                      )),
              );
          const lead = eligibleLeads.find((candidate) => candidate.id === requestedLeadSeatId);
          const room = state.supervised.rooms.find(
            (candidate) =>
              candidate.id === requestedRoomId &&
              candidate.leadSeatId === lead?.id &&
              candidate.status !== "archived",
          );
          const project = lead
            ? state.projects.find(
                (candidate) => candidate.id === lead.projectId && candidate.deletedAt === null,
              )
            : undefined;
          if (!lead || !room || !project) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_room_unavailable",
                "The requested active Lead Room is outside the caller's scope.",
              ),
            );
          }
          const profilePresetId = optionalStringArg(args, "profilePresetId");
          const preset = state.orchestration.profiles.find(
            (candidate) =>
              candidate.archivedAt === null &&
              candidate.roleHints.includes("peer") &&
              (profilePresetId === null || candidate.id === profilePresetId),
          );
          if (!preset) {
            return yield* Effect.fail(
              new HostToolError("supervised_profile_missing", "Profile preset not found."),
            );
          }
          const launchIssue = profileLaunchIssue(preset);
          if (launchIssue !== null) {
            return yield* Effect.fail(
              new HostToolError("supervised_profile_unsupported", launchIssue),
            );
          }
          const createdAt = new Date().toISOString();
          const governance = yield* input.governanceRepository
            .getSnapshot()
            .pipe(
              Effect.mapError(
                (error) =>
                  new HostToolError(
                    "supervised_state_unavailable",
                    error instanceof Error ? error.message : String(error),
                  ),
              ),
            );
          const coordinatorSeatId =
            authority.role === "lead" ? authority.leadSeatId : authority.supervisorSeatId;
          const coordinatorSeat = governance.agentSeats.find(
            (candidate) =>
              candidate.id === coordinatorSeatId && candidate.threadId === authority.callerThreadId,
          );
          if (!coordinatorSeat) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_authority_unavailable",
                "The active coordinator has no durable authority receipt.",
              ),
            );
          }
          const initialPrompt = optionalStringArg(args, "initialPrompt");
          if (authority.role === "supervisor" && actingRoot === null && initialPrompt !== null) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_work_assignment_required",
                "A Supervisor-created Peer must receive bounded work through assign_peer_work.",
              ),
            );
          }
          const peerSpecialtyId = PeerSpecialtyId.makeUnsafe(randomUUID());
          const threadId = ThreadId.makeUnsafe(`peer:${randomUUID()}`);
          const profileSnapshot = resolveProfilePreset({
            preset,
            snapshotId: ProfileSnapshotId.makeUnsafe(randomUUID()),
            createdAt,
          });
          const receipt = yield* dispatch({
            type: "supervised.peer.create",
            commandId: CommandId.makeUnsafe(randomUUID()),
            aggregateId: peerSpecialtyId,
            actor: {
              kind: "seat",
              actorId: context.callerThreadId,
              seatId: actorSeatId(coordinatorSeat.id),
            },
            authorityReceiptId: coordinatorSeat.authorityReceiptId,
            expectedRevision: 0,
            idempotencyKey: `peer-create:${peerSpecialtyId}`,
            createdAt,
            roomId: room.id,
            projectId: project.id,
            leadSeatId: lead.id,
            leadThreadId: lead.activeThreadId,
            threadId,
            title: stringArg(args, "title"),
            workingDirectory: project.workspaceRoot,
            profilePresetId: preset.id,
            profileSnapshot,
            peerSpecialty: {
              id: peerSpecialtyId,
              profilePresetId: preset.id,
              concern: stringArg(args, "concern"),
              status: "active",
              allowedScopes: [
                { kind: "project", projectId: project.id },
                { kind: "room", roomId: room.id },
                { kind: "seat", role: "peer", seatId: threadId },
              ],
              latestSnapshotId: null,
              expiresAt: new Date(Date.parse(createdAt) + 24 * 60 * 60 * 1_000).toISOString(),
              revision: 0,
              createdAt,
              updatedAt: createdAt,
            },
            ...(initialPrompt === null ? {} : { initialPrompt }),
          });
          return hostToolSuccess({
            sequence: receipt.sequence,
            peerSpecialtyId,
            threadId,
            roomId: room.id,
            requiresWorkAssignment: authority.role === "supervisor" && actingRoot === null,
          });
        }),
    },
  );

  const assignPeerWork = entry(
    {
      name: "assign_peer_work",
      displayName: "Assign Peer work",
      description:
        "Assign bounded non-owning work to an active Room Peer. The request is persisted as an intervention and the current Lead receives durable completion evidence.",
      inputSchema: objectSchema(
        {
          roomId: { type: "string" },
          peerThreadId: { type: "string" },
          workRequest: { type: "string", maxLength: 32_768 },
          material: {
            type: "boolean",
            description:
              "True only when the result may require a canonical Room change by the current Root Lead.",
            default: false,
          },
        },
        ["roomId", "peerThreadId", "workRequest"],
      ),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.work.assign",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: (_state, role) => role === "supervisor" || role === "lead",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { state, authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role === "peer") {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_coordinator_required",
                "Only an active Lead or scoped Primary Supervisor may assign Peer work.",
              ),
            );
          }
          const requestedRoomId = RoomId.makeUnsafe(stringArg(args, "roomId"));
          const peerThreadId = ThreadId.makeUnsafe(stringArg(args, "peerThreadId"));
          const peerSeat = state.governance.agentSeats.find(
            (candidate) =>
              candidate.identityRole === "peer" &&
              candidate.threadId === peerThreadId &&
              candidate.roomIds.includes(requestedRoomId) &&
              candidate.lifecycleState !== "retired",
          );
          const room = peerSeat
            ? state.supervised.rooms.find(
                (candidate) =>
                  candidate.id === requestedRoomId &&
                  candidate.leadSeatId !== null &&
                  candidate.status !== "archived",
              )
            : undefined;
          const actingRoot = room
            ? activeRootContextForCaller(state, context.callerThreadId, room.id)
            : null;
          const lead = actingRoot
            ? {
                id: rootHolderSeatId(actingRoot.seat),
                projectId: actingRoot.room.projectId,
                activeThreadId: ThreadId.makeUnsafe(context.callerThreadId),
                status: "active" as const,
                revision: actingRoot.seat.revision,
              }
            : room?.leadSeatId
              ? state.leads.find(
                  (candidate) => candidate.id === room.leadSeatId && candidate.status === "active",
                )
              : undefined;
          const project = room
            ? state.projects.find(
                (candidate) => candidate.id === room.projectId && candidate.deletedAt === null,
              )
            : undefined;
          const supervisorScopeAllows =
            authority.role === "supervisor" &&
            lead !== undefined &&
            (actingRoot !== null ||
              authority.missions.some((mission) =>
                missionScopeContainsLead({
                  scope: mission.scope,
                  lead,
                  projects: state.projects,
                }),
              ));
          const leadScopeAllows = authority.role === "lead" && lead?.id === authority.leadSeatId;
          if (
            !peerSeat ||
            !room ||
            !lead ||
            !project ||
            (!supervisorScopeAllows && !leadScopeAllows)
          ) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_peer_scope_denied",
                "The active Peer and its current Root Lead must be inside the caller's authority scope.",
              ),
            );
          }
          const coordinatorSeatId =
            authority.role === "lead" ? authority.leadSeatId : authority.supervisorSeatId;
          const coordinatorSeat = state.governance.agentSeats.find(
            (candidate) =>
              candidate.id === coordinatorSeatId && candidate.threadId === authority.callerThreadId,
          );
          if (!coordinatorSeat) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_authority_unavailable",
                "The active coordinator has no durable authority receipt.",
              ),
            );
          }
          const createdAt = new Date().toISOString();
          const interventionId = InterventionId.makeUnsafe(randomUUID());
          const actor = {
            kind: "seat" as const,
            actorId: context.callerThreadId,
            seatId: actorSeatId(coordinatorSeat.id),
          };
          const intervention = {
            id: interventionId,
            roomId: RoomId.makeUnsafe(room.id),
            requestedBy: actor,
            specialistThreadId: peerThreadId,
            reason: stringArg(args, "workRequest"),
            material: optionalBooleanArg(args, "material", false),
            evidenceRefs: [],
            status: "open" as const,
            createdAt,
            updatedAt: createdAt,
            revision: 0,
          };
          const leadNotification = {
            id: LeadNotificationId.makeUnsafe(randomUUID()),
            interventionId,
            roomId: RoomId.makeUnsafe(room.id),
            leadSeatId: LeadSeatId.makeUnsafe(lead.id),
            status: "queued" as const,
            createdAt,
            deliveredAt: null,
            acknowledgedAt: null,
          };
          const reconciliation = {
            id: ReconciliationId.makeUnsafe(randomUUID()),
            interventionId,
            roomId: RoomId.makeUnsafe(room.id),
            leadSeatId: LeadSeatId.makeUnsafe(lead.id),
            status: "open" as const,
            taskNodeRevisionId: null,
            reason: null,
            createdAt,
            resolvedAt: null,
            revision: 0,
          };
          const receipt = yield* dispatch({
            type: "supervised.work.assign",
            commandId: CommandId.makeUnsafe(randomUUID()),
            aggregateId: interventionId,
            actor,
            authorityReceiptId: coordinatorSeat.authorityReceiptId,
            expectedRevision: 0,
            idempotencyKey: `peer-work-assign:${interventionId}`,
            createdAt,
            roomId: RoomId.makeUnsafe(room.id),
            projectId: project.id,
            leadSeatId: LeadSeatId.makeUnsafe(lead.id),
            leadThreadId: lead.activeThreadId,
            peerThreadId,
            intervention,
            leadNotification,
            reconciliation,
          });
          return hostToolSuccess({
            sequence: receipt.sequence,
            interventionId,
            peerThreadId,
            roomId: room.id,
            leadSeatId: lead.id,
            material: intervention.material,
            ownershipTransferred: false,
          });
        }),
    },
  );

  const publishPeerEvidence = entry(
    {
      name: "publish_peer_evidence",
      displayName: "Publish Peer evidence",
      description:
        "Complete assigned bounded work by publishing durable Room evidence and notifying the current Root Lead. This never transfers ownership.",
      inputSchema: objectSchema(
        {
          roomId: { type: "string" },
          interventionId: { type: "string" },
          summary: { type: "string", maxLength: 32_768 },
        },
        ["roomId", "interventionId", "summary"],
      ),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.evidence.publish",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: (_state, role) => role === "peer",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { state, authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role !== "peer") {
            return yield* Effect.fail(
              new HostToolError("supervised_peer_required", "An active Peer seat is required."),
            );
          }
          const requestedRoomId = RoomId.makeUnsafe(stringArg(args, "roomId"));
          const intervention = state.supervised.interventions.find(
            (candidate) =>
              candidate.id === stringArg(args, "interventionId") &&
              candidate.roomId === requestedRoomId &&
              candidate.specialistThreadId === authority.callerThreadId &&
              candidate.status === "open" &&
              authority.roomIds.includes(candidate.roomId),
          );
          const peerSeat = state.governance.agentSeats.find(
            (candidate) =>
              candidate.id === authority.peerSeatId &&
              candidate.threadId === authority.callerThreadId,
          );
          if (!intervention || !peerSeat) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_intervention_unavailable",
                "The caller has no open assigned intervention with current Peer authority.",
              ),
            );
          }
          const createdAt = new Date().toISOString();
          const evidenceId = EvidenceId.makeUnsafe(randomUUID());
          const evidence = {
            id: evidenceId,
            scope: { kind: "room" as const, roomId: RoomId.makeUnsafe(intervention.roomId) },
            kind: "observation" as const,
            summary: stringArg(args, "summary"),
            blob: null,
            sourceEventIds: [],
            modelSessionId: null,
            createdBy: {
              kind: "seat" as const,
              actorId: context.callerThreadId,
              seatId: actorSeatId(peerSeat.id),
            },
            createdAt,
          };
          const receipt = yield* dispatch({
            type: "supervised.work.complete",
            commandId: CommandId.makeUnsafe(randomUUID()),
            aggregateId: intervention.id,
            actor: evidence.createdBy,
            authorityReceiptId: peerSeat.authorityReceiptId,
            expectedRevision: intervention.revision,
            idempotencyKey: `peer-work-complete:${intervention.id}:${evidenceId}`,
            createdAt,
            roomId: RoomId.makeUnsafe(intervention.roomId),
            interventionId: intervention.id,
            evidence,
          });
          return hostToolSuccess({
            sequence: receipt.sequence,
            interventionId: intervention.id,
            evidenceId,
            leadNotified: true,
            requiresLeadReconciliation: intervention.material,
            ownershipTransferred: false,
          });
        }),
    },
  );

  const reconcilePeerIntervention = entry(
    {
      name: "reconcile_peer_intervention",
      displayName: "Reconcile Peer intervention",
      description:
        "As the current Root Lead, acknowledge material Peer evidence and reconcile the intervention without implicit TaskNode ownership changes.",
      inputSchema: objectSchema(
        {
          roomId: { type: "string" },
          interventionId: { type: "string" },
          status: { type: "string", enum: ["accepted", "revised", "rejected"] },
          taskNodeRevisionId: { type: "string" },
          reason: { type: "string", maxLength: 32_768 },
        },
        ["roomId", "interventionId", "status"],
      ),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.intervention.reconcile",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: (_state, role) => role === "lead",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { state, authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role !== "lead") {
            return yield* Effect.fail(
              new HostToolError("supervised_lead_required", "The current Root Lead is required."),
            );
          }
          const requestedRoomId = RoomId.makeUnsafe(stringArg(args, "roomId"));
          const intervention = state.supervised.interventions.find(
            (candidate) =>
              candidate.id === stringArg(args, "interventionId") &&
              candidate.roomId === requestedRoomId &&
              candidate.status === "open",
          );
          const room = intervention
            ? state.supervised.rooms.find(
                (candidate) =>
                  candidate.id === intervention.roomId &&
                  candidate.leadSeatId === authority.leadSeatId,
              )
            : undefined;
          const reconciliation = intervention
            ? state.supervised.reconciliations.find(
                (candidate) => candidate.interventionId === intervention.id,
              )
            : undefined;
          const leadSeat = state.governance.agentSeats.find(
            (candidate) =>
              candidate.id === authority.leadSeatId &&
              candidate.threadId === authority.callerThreadId,
          );
          const status = stringArg(args, "status");
          if (
            !intervention ||
            !room ||
            !reconciliation ||
            !leadSeat ||
            !["accepted", "revised", "rejected"].includes(status)
          ) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_reconciliation_unavailable",
                "The open intervention must belong to the caller's current Root Room.",
              ),
            );
          }
          const createdAt = new Date().toISOString();
          const receipt = yield* dispatch({
            type: "supervised.intervention.reconcile",
            commandId: CommandId.makeUnsafe(randomUUID()),
            aggregateId: intervention.id,
            actor: {
              kind: "seat",
              actorId: context.callerThreadId,
              seatId: actorSeatId(leadSeat.id),
            },
            authorityReceiptId: leadSeat.authorityReceiptId,
            expectedRevision: intervention.revision,
            idempotencyKey: `peer-intervention-reconcile:${intervention.id}:${intervention.revision}`,
            createdAt,
            reconciliation: {
              ...reconciliation,
              status: status as "accepted" | "revised" | "rejected",
              taskNodeRevisionId: optionalStringArg(
                args,
                "taskNodeRevisionId",
              ) as typeof reconciliation.taskNodeRevisionId,
              reason: optionalStringArg(args, "reason"),
            },
          });
          return hostToolSuccess({
            sequence: receipt.sequence,
            interventionId: intervention.id,
            status,
            ownershipTransferred: false,
          });
        }),
    },
  );

  const startRlmExecution = entry(
    {
      name: "start_rlm",
      displayName: "Start RLM",
      description:
        "Start a durable recursive language-model episode with real independent provider threads and a retained root synthesis session.",
      inputSchema: objectSchema(
        {
          objective: { type: "string", maxLength: 32_768 },
          roomId: { type: "string" },
          runId: { type: "string" },
          branches: {
            type: "array",
            minItems: 2,
            maxItems: 16,
            items: {
              type: "object",
              properties: {
                title: { type: "string", maxLength: 512 },
                prompt: { type: "string", maxLength: 32_768 },
              },
              required: ["title", "prompt"],
              additionalProperties: false,
            },
          },
        },
        ["objective", "branches"],
      ),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.rlm.start",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: (_state, role) => role === "lead" || role === "supervisor",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { state, authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role === "peer") {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_root_required",
                "RLM execution requires a Lead or Supervisor Root authority.",
              ),
            );
          }
          const governance = yield* input.governanceRepository
            .getSnapshot()
            .pipe(
              Effect.mapError(
                (error) =>
                  new HostToolError(
                    "supervised_state_unavailable",
                    error instanceof Error ? error.message : String(error),
                  ),
              ),
            );
          const seatId =
            authority.role === "lead" ? authority.leadSeatId : authority.supervisorSeatId;
          const seat = governance.agentSeats.find((candidate) => candidate.id === seatId);
          const authorityReceipt = governance.authorityReceipts.find(
            (candidate) => candidate.id === seat?.authorityReceiptId,
          );
          if (!seat || !authorityReceipt) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_authority_unavailable",
                "The caller has no current durable AgentSeat authority receipt.",
              ),
            );
          }
          const requestedRoomId =
            typeof args.roomId === "string" && args.roomId.trim().length > 0
              ? args.roomId.trim()
              : null;
          const room = state.supervised.rooms.find(
            (candidate) =>
              candidate.status !== "archived" &&
              (requestedRoomId !== null
                ? candidate.id === requestedRoomId
                : authority.role === "lead" && candidate.leadSeatId === authority.leadSeatId),
          );
          const project = room
            ? state.projects.find(
                (candidate) => candidate.id === room.projectId && candidate.deletedAt === null,
              )
            : undefined;
          const callerThread = yield* input.snapshotQuery
            .getThreadDetailById(ThreadId.makeUnsafe(context.callerThreadId))
            .pipe(
              Effect.map(Option.getOrUndefined),
              Effect.mapError(
                (error) =>
                  new HostToolError(
                    "supervised_state_unavailable",
                    error instanceof Error ? error.message : String(error),
                  ),
              ),
            );
          if (!room || !project || !callerThread) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_room_unavailable",
                "An active scoped Room, Project, and caller thread are required to start RLM.",
              ),
            );
          }
          if (!Array.isArray(args.branches)) {
            return yield* Effect.fail(
              new HostToolError("supervised_tool_input_invalid", "branches must be an array."),
            );
          }
          const branches: RlmBranchRequest[] = args.branches.map((value, index) => {
            if (value === null || typeof value !== "object" || Array.isArray(value)) {
              throw new HostToolError(
                "supervised_tool_input_invalid",
                `branches[${index}] must be an object.`,
              );
            }
            const branch = value as Record<string, unknown>;
            return {
              title: stringArg(branch, "title"),
              prompt: stringArg(branch, "prompt"),
            };
          });
          const modelProfile = governance.modelCapabilityProfiles.find(
            (candidate) =>
              candidate.available &&
              candidate.provider === callerThread.modelSelection.provider &&
              candidate.model === callerThread.modelSelection.model,
          );
          const objective = stringArg(args, "objective");
          const existingRunId =
            typeof args.runId === "string" && args.runId.trim().length > 0
              ? args.runId.trim()
              : null;
          const result = yield* startRlm({
            engine: input.orchestrationEngine,
            daemon: input.runtimeDaemon,
            runtime: state.supervised,
            callerThread,
            project,
            room,
            seat,
            authorityReceipt,
            objective,
            branches,
            existingRunId,
            providerLimitTokens: modelProfile?.contextCapacity ?? null,
            requestId: JSON.stringify({
              callerThreadId: context.callerThreadId,
              callerTurnId: context.callerTurnId,
              objective,
              branches,
              existingRunId,
            }),
            createdAt: callerThread.latestTurn?.requestedAt ?? new Date().toISOString(),
          }).pipe(
            Effect.mapError((error) =>
              error instanceof RlmStartError
                ? new HostToolError(error.code, error.message)
                : new HostToolError("supervised_rlm_failed", String(error)),
            ),
          );
          return hostToolSuccess(result);
        }),
    },
  );

  const searchSupervisorNotebook = entry(
    {
      name: "search_supervisor_notebook",
      displayName: "Search supervisor notebook",
      description:
        "Read a bounded, protection-filtered view of the shared workspace Supervisor notebook without mutating durable state. The returned nextCursor is an advisory checkpoint only.",
      inputSchema: objectSchema({
        concern: { type: "string", maxLength: 512 },
        roomId: { type: "string" },
        query: { type: "string", maxLength: 4_000 },
        incremental: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      }),
      readOnly: true,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.notebook.search",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: (_state, role) => role === "supervisor" || role === "lead",
      execute: (args, context) =>
        Effect.gen(function* () {
          const { authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role === "peer") {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_root_required",
                "Notebook access requires a Lead or Supervisor authority.",
              ),
            );
          }
          const governance = yield* input.governanceRepository.getSnapshot();
          const seatId =
            authority.role === "lead" ? authority.leadSeatId : authority.supervisorSeatId;
          const seat = governance.agentSeats.find((candidate) => candidate.id === seatId);
          const receipt = governance.authorityReceipts.find(
            (candidate) => candidate.id === seat?.authorityReceiptId,
          );
          if (!seat || !receipt) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_authority_unavailable",
                "The caller AgentSeat is unavailable.",
              ),
            );
          }
          const requestedRoomIdValue = optionalStringArg(args, "roomId");
          const requestedRoomId =
            requestedRoomIdValue === null ? null : RoomId.makeUnsafe(requestedRoomIdValue);
          const allowedRoomIds = new Set(
            seat.roomIds.filter((roomId) => receipt.roomScopes.includes(roomId)),
          );
          if (requestedRoomId !== null && !allowedRoomIds.has(requestedRoomId)) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_notebook_scope_denied",
                "The caller authority does not cover the requested notebook Room.",
              ),
            );
          }
          const limit =
            args.limit === undefined ? 50 : Math.max(1, Math.min(200, intArg(args, "limit")));
          const incremental = args.incremental === true;
          if (args.incremental !== undefined && typeof args.incremental !== "boolean") {
            return yield* Effect.fail(
              new HostToolError("supervised_tool_input_invalid", "incremental must be a boolean."),
            );
          }
          const concern = optionalStringArg(args, "concern");
          const query = optionalStringArg(args, "query");
          const notebookState = yield* input.governanceRepository.getNotebookState({
            workspaceId: seat.workspaceId,
            seatId: seat.id,
            limit: 512,
            roomIds: requestedRoomId === null ? [...allowedRoomIds] : [requestedRoomId],
            includeWorkspaceEntries: requestedRoomId === null,
            ...(receipt.taskNodeScopes.length === 0
              ? {}
              : { taskNodeIds: receipt.taskNodeScopes, includeUnscopedTaskNodes: true }),
            ...(concern === null ? {} : { concern }),
            ...(query === null ? {} : { query }),
            allowedProtectionClasses: ["workspace", "internal"],
            includeRedacted: false,
          });
          const view = buildSupervisorNotebookView({
            workspaceId: seat.workspaceId,
            viewerSeatId: seat.id,
            entries: notebookState.entries.filter(
              (entry) =>
                (entry.roomId === null || allowedRoomIds.has(entry.roomId)) &&
                (entry.taskNodeId === null ||
                  receipt.taskNodeScopes.length === 0 ||
                  receipt.taskNodeScopes.includes(entry.taskNodeId)),
            ),
            compactionReceipts: notebookState.compactionReceipts,
            cursor: incremental && query === null ? notebookState.cursor : null,
            ...(requestedRoomId === null ? {} : { roomId: requestedRoomId }),
            ...(concern === null ? {} : { concern }),
            allowedProtectionClasses: ["workspace", "internal"],
            limit,
            createdAt: new Date().toISOString(),
          });
          return hostToolSuccess(view);
        }).pipe(
          Effect.mapError((error) =>
            error instanceof HostToolError
              ? error
              : new HostToolError(
                  "supervised_state_unavailable",
                  error instanceof Error ? error.message : String(error),
                ),
          ),
        ),
    },
  );

  const appendSupervisorNotebook = entry(
    {
      name: "append_supervisor_notebook_entry",
      displayName: "Append supervisor notebook entry",
      description:
        "Append one evidence-linked fact to the shared workspace Supervisor notebook without overwriting existing entries.",
      inputSchema: objectSchema(
        {
          concern: { type: "string", maxLength: 512 },
          kind: {
            type: "string",
            enum: ["observation", "decision", "lesson", "hypothesis", "warning"],
          },
          content: { type: "string", maxLength: 32_768 },
          evidenceRefs: { type: "array", items: { type: "string" }, maxItems: 512 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          roomId: { type: "string" },
          taskNodeId: { type: "string" },
          supersedesEntryId: { type: "string" },
        },
        ["concern", "kind", "content", "confidence"],
      ),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.notebook.append",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: (_state, role) => role === "supervisor",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { state, authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role !== "supervisor") {
            return yield* Effect.fail(
              new HostToolError("supervised_role_required", "Supervisor role required."),
            );
          }
          const governance = yield* input.governanceRepository.getSnapshot();
          const seat = governance.agentSeats.find(
            (candidate) => candidate.id === authority.supervisorSeatId,
          );
          const receipt = governance.authorityReceipts.find(
            (candidate) => candidate.id === seat?.authorityReceiptId,
          );
          if (!seat || !receipt) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_authority_unavailable",
                "The Supervisor AgentSeat is unavailable.",
              ),
            );
          }
          const current = yield* input.governanceRepository.getNotebookState({
            workspaceId: seat.workspaceId,
            seatId: seat.id,
            limit: 500,
          });
          const supersedesEntryId = optionalStringArg(args, "supersedesEntryId");
          if (
            supersedesEntryId !== null &&
            !current.entries.some((candidate) => candidate.id === supersedesEntryId)
          ) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_notebook_supersession_missing",
                "The superseded entry is unavailable in this workspace.",
              ),
            );
          }
          const roomIdValue = optionalStringArg(args, "roomId");
          const roomId = roomIdValue === null ? null : RoomId.makeUnsafe(roomIdValue);
          const taskNodeIdValue = optionalStringArg(args, "taskNodeId");
          const taskNodeId =
            taskNodeIdValue === null ? null : TaskNodeId.makeUnsafe(taskNodeIdValue);
          if (
            roomId !== null &&
            (!seat.roomIds.includes(roomId) ||
              !receipt.roomScopes.includes(roomId) ||
              !state.supervised.rooms.some(
                (candidate) => candidate.id === roomId && candidate.status !== "archived",
              ))
          ) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_notebook_scope_denied",
                "Notebook Room is unavailable or outside the caller authority.",
              ),
            );
          }
          if (
            taskNodeId !== null &&
            ((receipt.taskNodeScopes.length > 0 && !receipt.taskNodeScopes.includes(taskNodeId)) ||
              !state.supervised.taskNodes.some(
                (candidate) =>
                  candidate.id === taskNodeId && (roomId === null || candidate.roomId === roomId),
              ))
          ) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_task_node_unavailable",
                "Notebook TaskNode is unavailable or outside the selected Room.",
              ),
            );
          }
          const confidence = args.confidence;
          if (
            typeof confidence !== "number" ||
            !Number.isFinite(confidence) ||
            confidence < 0 ||
            confidence > 1
          ) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_tool_input_invalid",
                "confidence must be between 0 and 1.",
              ),
            );
          }
          const entry: SupervisorNotebookEntry = {
            id: SupervisorNotebookEntryId.makeUnsafe(`notebook:${randomUUID()}`),
            workspaceId: seat.workspaceId,
            roomId,
            taskNodeId,
            concern: stringArg(args, "concern"),
            authorSeatId: seat.id,
            kind: decode(SupervisorNotebookEntryKind, args.kind, "kind"),
            content: stringArg(args, "content"),
            evidenceRefs:
              args.evidenceRefs === undefined ? [] : stringArrayArg(args, "evidenceRefs"),
            confidence,
            supersedesEntryId:
              supersedesEntryId === null
                ? null
                : SupervisorNotebookEntryId.makeUnsafe(supersedesEntryId),
            protectionClass: "internal",
            redactedAt: null,
            createdAt: new Date().toISOString(),
          };
          const inserted = yield* input.governanceRepository.appendNotebookEntry(entry);
          if (!inserted) {
            return yield* Effect.fail(
              new HostToolError("supervised_notebook_duplicate", "Notebook entry already exists."),
            );
          }
          return hostToolSuccess({ entry });
        }).pipe(
          Effect.mapError((error) =>
            error instanceof HostToolError
              ? error
              : new HostToolError(
                  "supervised_state_unavailable",
                  error instanceof Error ? error.message : String(error),
                ),
          ),
        ),
    },
  );

  const compactSupervisorNotebook = entry(
    {
      name: "compact_supervisor_notebook",
      displayName: "Compact supervisor notebook",
      description:
        "Append a rebuildable notebook summary plus an immutable source/evidence receipt without deleting source entries.",
      inputSchema: objectSchema(
        {
          sourceEntryIds: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 512,
          },
          roomId: { type: "string" },
          content: { type: "string", maxLength: 32_768 },
        },
        ["sourceEntryIds", "content"],
      ),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.notebook.compact",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: (_state, role) => role === "supervisor",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role !== "supervisor") {
            return yield* Effect.fail(
              new HostToolError("supervised_role_required", "Supervisor role required."),
            );
          }
          const governance = yield* input.governanceRepository.getSnapshot();
          const seat = governance.agentSeats.find(
            (candidate) => candidate.id === authority.supervisorSeatId,
          );
          const receipt = governance.authorityReceipts.find(
            (candidate) => candidate.id === seat?.authorityReceiptId,
          );
          if (!seat || !receipt) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_authority_unavailable",
                "The Supervisor AgentSeat or authority receipt is unavailable.",
              ),
            );
          }
          const sourceEntryIds = stringArrayArg(args, "sourceEntryIds");
          const requestedRoomId = optionalStringArg(args, "roomId");
          const allowedRoomIds = new Set(
            seat.roomIds.filter((roomId) => receipt.roomScopes.includes(roomId)),
          );
          const current = yield* input.governanceRepository.getNotebookState({
            workspaceId: seat.workspaceId,
            seatId: seat.id,
            limit: 512,
            entryIds: sourceEntryIds,
            roomIds: requestedRoomId === null ? [] : [requestedRoomId],
            includeWorkspaceEntries: requestedRoomId === null,
            ...(receipt.taskNodeScopes.length === 0
              ? {}
              : { taskNodeIds: receipt.taskNodeScopes, includeUnscopedTaskNodes: true }),
            allowedProtectionClasses: ["workspace", "internal"],
            includeRedacted: false,
          });
          const visibleEntries = current.entries.filter(
            (candidate) =>
              (candidate.roomId === null || allowedRoomIds.has(candidate.roomId)) &&
              (candidate.taskNodeId === null ||
                receipt.taskNodeScopes.length === 0 ||
                receipt.taskNodeScopes.includes(candidate.taskNodeId)) &&
              ["workspace", "internal"].includes(candidate.protectionClass) &&
              candidate.redactedAt === null,
          );
          if (
            sourceEntryIds.length === 0 ||
            sourceEntryIds.some(
              (entryId) => !visibleEntries.some((candidate) => candidate.id === entryId),
            ) ||
            sourceEntryIds.some(
              (entryId) =>
                visibleEntries.find((candidate) => candidate.id === entryId)?.roomId !==
                requestedRoomId,
            )
          ) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_notebook_source_denied",
                "Every compaction source must be visible in the selected notebook Room scope.",
              ),
            );
          }
          const createdAt = new Date().toISOString();
          const planned = planSupervisorNotebookCompaction({
            entries: visibleEntries,
            sourceEntryIds: sourceEntryIds as never,
            authorSeatId: seat.id,
            content: stringArg(args, "content"),
            createdAt,
          });
          const inserted = yield* input.governanceRepository.appendNotebookCompaction(planned);
          if (!inserted) {
            const existing = yield* input.governanceRepository.getNotebookState({
              workspaceId: seat.workspaceId,
              seatId: seat.id,
              limit: 1,
              entryIds: [planned.summaryEntry.id],
              allowedProtectionClasses: [planned.summaryEntry.protectionClass],
              includeRedacted: false,
            });
            const summaryEntry = existing.entries.find(
              (candidate) => candidate.id === planned.summaryEntry.id,
            );
            const compactionReceipt = existing.compactionReceipts.find(
              (candidate) => candidate.id === planned.receipt.id,
            );
            if (!summaryEntry || !compactionReceipt) {
              return yield* Effect.fail(
                new HostToolError(
                  "supervised_notebook_duplicate",
                  "Notebook compaction identity conflicts with unavailable durable state.",
                ),
              );
            }
            return hostToolSuccess({
              summaryEntry,
              receipt: compactionReceipt,
              idempotent: true,
            });
          }
          return hostToolSuccess(planned);
        }).pipe(
          Effect.mapError((error) =>
            error instanceof HostToolError
              ? error
              : new HostToolError(
                  "supervised_notebook_compaction_failed",
                  error instanceof Error ? error.message : String(error),
                ),
          ),
        ),
    },
  );

  const requestContextCompaction = entry(
    {
      name: "request_context_compaction",
      displayName: "Request context compaction",
      description:
        "Append a rebuildable summary and immutable compaction receipt for visible ContextRecords; source evidence is never deleted.",
      inputSchema: objectSchema(
        {
          workspaceId: { type: "string" },
          sourceRecordIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 512 },
          title: { type: "string", maxLength: 512 },
          summary: { type: "string", maxLength: 32_768 },
        },
        ["workspaceId", "sourceRecordIds", "title", "summary"],
      ),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.context.requestCompaction",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: (_state, role) => role === "supervisor" || role === "lead",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { state, authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role === "peer") {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_root_required",
                "Context compaction requires a Lead or Supervisor authority.",
              ),
            );
          }
          const governance = yield* input.governanceRepository.getSnapshot();
          const seatId =
            authority.role === "lead" ? authority.leadSeatId : authority.supervisorSeatId;
          const seat = governance.agentSeats.find((candidate) => candidate.id === seatId);
          const receipt = governance.authorityReceipts.find(
            (candidate) => candidate.id === seat?.authorityReceiptId,
          );
          const workspace = state.supervised.contextWorkspaces.find(
            (candidate) => candidate.id === stringArg(args, "workspaceId"),
          );
          const thread = state.threads.find((candidate) => candidate.id === context.callerThreadId);
          if (
            !seat ||
            !receipt ||
            !workspace ||
            !thread ||
            thread.projectId !== workspace.projectId
          ) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_context_unavailable",
                "The scoped Context Workspace or caller authority is unavailable.",
              ),
            );
          }
          if (
            workspace.roomId !== null &&
            (!seat.roomIds.includes(workspace.roomId) ||
              !receipt.roomScopes.includes(workspace.roomId))
          ) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_context_scope_denied",
                "The caller authority does not cover this Context Workspace Room.",
              ),
            );
          }
          const visible = buildContextView({
            workspace,
            records: state.supervised.contextRecords,
            compactionReceipts: state.supervised.contextCompactionReceipts,
            actorSeatId: seat.id,
            allowedScopes: [
              { kind: "project", projectId: workspace.projectId },
              ...(workspace.roomId === null
                ? []
                : [{ kind: "room" as const, roomId: workspace.roomId }]),
            ],
            allowedProtectionClasses: ["workspace", "internal"],
            provider: thread.modelSelection.provider,
            model: thread.modelSelection.model,
            providerLimitTokens: null,
            maxRecords: 512,
            maxEstimatedTokens: Number.MAX_SAFE_INTEGER,
            createdAt: new Date().toISOString(),
          });
          const sourceRecordIds = stringArrayArg(args, "sourceRecordIds");
          if (
            sourceRecordIds.length === 0 ||
            sourceRecordIds.some((recordId) => !visible.view.recordIds.includes(recordId as never))
          ) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_context_source_denied",
                "Every compaction source must be visible in the caller's current ContextView.",
              ),
            );
          }
          const sourceRecords = sourceRecordIds.map(
            (recordId) =>
              state.supervised.contextRecords.find((candidate) => candidate.id === recordId)!,
          );
          const protectionClass = sourceRecords.some(
            (record) => record.protectionClass === "internal",
          )
            ? "internal"
            : "workspace";
          const createdAt = new Date().toISOString();
          const planned = planContextCompaction({
            workspace,
            records: state.supervised.contextRecords,
            sourceRecordIds: sourceRecordIds as never,
            title: stringArg(args, "title"),
            summary: stringArg(args, "summary"),
            createdBy: {
              kind: "seat",
              actorId: context.callerThreadId,
              seatId: actorSeatId(seat.id),
            },
            protectionClass,
            createdAt,
          });
          const commandReceipt = yield* dispatch({
            type: "supervised.context.append",
            commandId: CommandId.makeUnsafe(randomUUID()),
            actor: {
              kind: "seat",
              actorId: context.callerThreadId,
              seatId: actorSeatId(seat.id),
            },
            authorityReceiptId: receipt.id,
            aggregateId: workspace.id,
            expectedRevision: workspace.revision,
            idempotencyKey: `context-compaction:${planned.receipt.id}`,
            createdAt,
            record: planned.summaryRecord,
            compactionReceipt: planned.receipt,
          });
          return hostToolSuccess({
            sequence: commandReceipt.sequence,
            summaryRecord: planned.summaryRecord,
            compactionReceipt: planned.receipt,
          });
        }).pipe(
          Effect.mapError((error) =>
            error instanceof HostToolError
              ? error
              : new HostToolError(
                  "supervised_context_compaction_failed",
                  error instanceof Error ? error.message : String(error),
                ),
          ),
        ),
    },
  );

  const revokeWorkflow = entry(
    {
      name: "revoke_supervised_workflow",
      displayName: "Revoke Supervised workflow",
      description:
        "Revoke one visible workflow directive under an authenticated owner turn or active workflow.revoke grant.",
      inputSchema: objectSchema(
        {
          directiveId: { type: "string" },
          expectedRevision: { type: "integer", minimum: 0 },
        },
        ["directiveId", "expectedRevision"],
      ),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
      supervised: {
        toolId: "supervised.intervention.reconcile",
        schemaVersion: "1.0.0",
      },
    },
    {
      visible: (_state, role) => role === "supervisor",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { state, authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role !== "supervisor") {
            return yield* Effect.fail(
              new HostToolError("supervised_role_required", "Supervisor role required."),
            );
          }
          const directive = state.orchestration.workflowDirectives.find(
            (candidate) => candidate.id === stringArg(args, "directiveId"),
          );
          if (!directive || directive.supervisorSeatId !== authority.supervisorSeatId) {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_workflow_missing",
                "Owned workflow directive not found.",
              ),
            );
          }
          const mission = authority.missions.find(
            (candidate) =>
              candidate.id === directive.missionId && candidate.grants.includes("workflow.revoke"),
          );
          const humanOrigin = yield* Effect.result(loadHumanOrigin(context));
          if (!mission && humanOrigin._tag === "Failure") {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_authority_denied",
                "Authenticated owner origin or workflow.revoke mission grant required.",
              ),
            );
          }
          const receipt = yield* dispatch({
            type: "supervised.workflow.revoke",
            commandId: CommandId.makeUnsafe(randomUUID()),
            aggregateId: AGGREGATE_ID,
            actor:
              humanOrigin._tag === "Success"
                ? {
                    kind: "user",
                    actorId: "owner",
                    threadId: ThreadId.makeUnsafe(context.callerThreadId),
                  }
                : {
                    kind: "thread",
                    actorId: context.callerThreadId,
                    threadId: ThreadId.makeUnsafe(context.callerThreadId),
                  },
            expectedRevision: intArg(args, "expectedRevision"),
            createdAt: new Date().toISOString(),
            directiveId: directive.id,
          });
          return hostToolSuccess({ sequence: receipt.sequence, directiveId: directive.id });
        }),
    },
  );

  return [
    readState,
    recommendSupervisedModel,
    createMission,
    mutateMission("update_supervised_mission", "supervised.mission.update"),
    mutateMission("complete_supervised_mission", "supervised.mission.complete"),
    mutateMission("cancel_supervised_mission", "supervised.mission.cancel"),
    sendAdvice,
    applyWorkflow,
    revokeWorkflow,
    requestReplacement,
    assumeRoomRoot,
    createLeadRoom,
    createTaskGraph,
    delegateTaskNode,
    startTaskNodeRun,
    publishTaskNodeEvidence,
    acceptTaskNode,
    createPeer,
    assignPeerWork,
    publishPeerEvidence,
    reconcilePeerIntervention,
    startRlmExecution,
    searchSupervisorNotebook,
    appendSupervisorNotebook,
    compactSupervisorNotebook,
    requestContextCompaction,
  ];
}
