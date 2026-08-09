import { randomUUID } from "node:crypto";

import {
  CommandId,
  LeadRotationId,
  LeadSeatId,
  MessageId,
  MissionEndCondition,
  MissionGrant,
  MissionScopeList,
  ProfileSnapshotId,
  SpecialistId,
  SupervisionAdviceId,
  SupervisionAggregateId,
  SupervisionMissionId,
  SupervisorSeatId,
  ThreadId,
  WorkflowDirectiveId,
  type OrchestrationReadModel,
  type SupervisionMission,
} from "@synara/contracts";
import { Effect, Option, Schema } from "effect";

import type { SupervisedGovernanceRepositoryShape } from "../../persistence/Services/SupervisedGovernanceRepository.ts";
import {
  HostToolError,
  hostToolFailure as hostToolFailure,
  hostToolSuccess as hostToolSuccess,
  type HostToolEntry,
} from "../hostTools/runtime.ts";
import type { OrchestrationEngineShape } from "../Services/OrchestrationEngine.ts";
import type { ProjectionSnapshotQueryShape } from "../Services/ProjectionSnapshotQuery.ts";
import { missionScopeContainsLead } from "./missionScope.ts";
import { profileLaunchIssue, resolveProfilePreset } from "./profileResolver.ts";
import { currentTurnHasHumanOrigin, resolveSupervisionCallerAuthority } from "./toolPolicy.ts";

const AGGREGATE_ID = SupervisionAggregateId.makeUnsafe("supervision");
const objectSchema = (
  properties: Readonly<Record<string, unknown>>,
  required: ReadonlyArray<string> = [],
) => ({ type: "object", properties, required, additionalProperties: false });

const stringArg = (args: Record<string, unknown>, key: string): string => {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HostToolError("supervision_tool_input_invalid", `${key} is required.`);
  }
  return value.trim();
};

const intArg = (args: Record<string, unknown>, key: string): number => {
  const value = args[key];
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new HostToolError(
      "supervision_tool_input_invalid",
      `${key} must be a non-negative integer.`,
    );
  }
  return value as number;
};

const decode = <S extends Schema.Top>(schema: S, value: unknown, label: string): S["Type"] => {
  try {
    return Schema.decodeUnknownSync(schema)(value);
  } catch (error) {
    throw new HostToolError(
      "supervision_tool_input_invalid",
      `${label} is invalid.`,
      error instanceof Error ? error.message : String(error),
    );
  }
};

export interface SupervisionToolsInput {
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly snapshotQuery: ProjectionSnapshotQueryShape;
  readonly governanceRepository: SupervisedGovernanceRepositoryShape;
}

export function makeSupervisionTools(
  input: SupervisionToolsInput,
): ReadonlyArray<HostToolEntry> {
  const load = () =>
    input.snapshotQuery
      .getSnapshot()
      .pipe(
        Effect.mapError(
          (error) =>
            new HostToolError(
              "supervision_state_unavailable",
              error instanceof Error ? error.message : String(error),
            ),
        ),
      );

  const loadAuthority = (callerThreadId: string) =>
    Effect.gen(function* () {
      const state = yield* load();
      const authority = resolveSupervisionCallerAuthority({
        snapshot: state.supervision,
        projects: state.projects,
        callerThreadId: ThreadId.makeUnsafe(callerThreadId),
      });
      if (!authority) {
        return yield* Effect.fail(
          new HostToolError(
            "supervision_role_required",
            "The caller does not own an active Supervisor or Lead seat.",
          ),
        );
      }
      return { state, authority };
    });

  const loadHumanOrigin = (context: Parameters<HostToolEntry["execute"]>[1]) =>
    Effect.gen(function* () {
      if (context.callerDispatchOrigin === "user") {
        return context.callerTurnId;
      }
      if (context.callerDispatchOrigin !== undefined) {
        return yield* Effect.fail(
          new HostToolError(
            "supervision_human_origin_required",
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
                "supervision_state_unavailable",
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
            "supervision_human_origin_required",
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
            "supervision_human_origin_required",
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
              "supervision_command_rejected",
              error instanceof Error ? error.message : String(error),
            ),
        ),
      );

  const entry = (
    definition: HostToolEntry["definition"],
    handlers: {
      readonly visible: (state: OrchestrationReadModel, role: "supervisor" | "lead") => boolean;
      readonly execute: HostToolEntry["execute"];
    },
  ): HostToolEntry => ({
    definition,
    isVisible: (context) =>
      loadAuthority(context.callerThreadId).pipe(
        Effect.map(({ state, authority }) => handlers.visible(state, authority.role)),
        Effect.catch(() => Effect.succeed(false)),
      ),
    execute: (args, context) =>
      handlers
        .execute(args, context)
        .pipe(Effect.catch((error) => Effect.succeed(hostToolFailure(error)))),
  });

  const readState = entry(
    {
      name: "read_supervision_state",
      displayName: "Read supervision state",
      description:
        "Read only the caller's bounded Supervisor missions or Lead-facing supervision state. Peer transcripts are never included.",
      inputSchema: objectSchema({}),
      readOnly: true,
      providerSupport: { codex: "native", claude: "unsupported" },
    },
    {
      visible: () => true,
      execute: (_args, context) =>
        Effect.gen(function* () {
          const { state, authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role === "supervisor") {
            const missionIds = new Set(authority.missions.map((mission) => mission.id));
            const visibleLeads = state.supervision.leads.filter((lead) =>
              authority.missions.some((mission) =>
                missionScopeContainsLead({ scope: mission.scope, lead, projects: state.projects }),
              ),
            );
            return hostToolSuccess({
              role: authority.role,
              supervisorSeatId: authority.supervisorSeatId,
              missions: authority.missions,
              leads: visibleLeads.map((lead) => ({
                id: lead.id,
                projectId: lead.projectId,
                activeThreadId: lead.activeThreadId,
                status: lead.status,
                revision: lead.revision,
              })),
              advice: state.supervision.advice.filter((advice) => missionIds.has(advice.missionId)),
              observationCursors: state.supervision.observationCursors.filter((cursor) =>
                missionIds.has(cursor.missionId),
              ),
            });
          }
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
            advice: state.supervision.advice.filter(
              (advice) => advice.leadSeatId === authority.leadSeatId,
            ),
          });
        }),
    },
  );

  const createMission = entry(
    {
      name: "create_supervision_mission",
      displayName: "Create supervision mission",
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
              new HostToolError("supervision_role_required", "Supervisor role required."),
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
            sourceMessageId: MessageId.makeUnsafe(source.id),
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            revision: 0,
          };
          const receipt = yield* dispatch({
            type: "supervision.mission.create",
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
    name:
      | "update_supervision_mission"
      | "complete_supervision_mission"
      | "cancel_supervision_mission",
    commandType:
      | "supervision.mission.update"
      | "supervision.mission.complete"
      | "supervision.mission.cancel",
  ) =>
    entry(
      {
        name,
        displayName:
          name === "update_supervision_mission"
            ? "Update supervision mission"
            : name === "complete_supervision_mission"
              ? "Complete supervision mission"
              : "Cancel supervision mission",
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
      },
      {
        visible: (_state, role) => role === "supervisor",
        execute: (args, context) =>
          Effect.gen(function* () {
            yield* context.assertCallerTurnActive();
            const { state, authority } = yield* loadAuthority(context.callerThreadId);
            if (authority.role !== "supervisor") {
              return yield* Effect.fail(
                new HostToolError("supervision_role_required", "Supervisor role required."),
              );
            }
            const current = state.supervision.missions.find(
              (mission) =>
                mission.id === stringArg(args, "missionId") &&
                mission.supervisorSeatId === authority.supervisorSeatId,
            );
            if (!current) {
              return yield* Effect.fail(
                new HostToolError("supervision_mission_missing", "Mission not found."),
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
      name: "send_supervision_advice",
      displayName: "Send supervision advice",
      description:
        "Send concise attributed advice to a Lead covered by an active lead.advise mission.",
      inputSchema: objectSchema(
        { missionId: { type: "string" }, leadSeatId: { type: "string" }, text: { type: "string" } },
        ["missionId", "leadSeatId", "text"],
      ),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
    },
    {
      visible: (_state, role) => role === "supervisor",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { state, authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role !== "supervisor") {
            return yield* Effect.fail(
              new HostToolError("supervision_role_required", "Supervisor role required."),
            );
          }
          const mission = authority.missions.find(
            (candidate) =>
              candidate.id === stringArg(args, "missionId") &&
              candidate.grants.includes("lead.advise"),
          );
          const lead = state.supervision.leads.find(
            (candidate) => candidate.id === stringArg(args, "leadSeatId"),
          );
          if (
            !mission ||
            !lead ||
            !missionScopeContainsLead({ scope: mission.scope, lead, projects: state.projects })
          ) {
            return yield* Effect.fail(
              new HostToolError(
                "supervision_scope_denied",
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
            type: "supervision.advice.send",
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
      name: "apply_supervision_workflow",
      displayName: "Apply supervision workflow",
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
    },
    {
      visible: (_state, role) => role === "supervisor",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { state, authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role !== "supervisor")
            return yield* Effect.fail(
              new HostToolError("supervision_role_required", "Supervisor role required."),
            );
          const mission = authority.missions.find(
            (candidate) => candidate.id === stringArg(args, "missionId"),
          );
          const lead = state.supervision.leads.find(
            (candidate) => candidate.id === stringArg(args, "leadSeatId"),
          );
          if (
            !mission ||
            !lead ||
            !missionScopeContainsLead({ scope: mission.scope, lead, projects: state.projects })
          ) {
            return yield* Effect.fail(
              new HostToolError(
                "supervision_scope_denied",
                "Mission does not cover this Lead with workflow.apply authority.",
              ),
            );
          }
          const humanOrigin = yield* Effect.result(loadHumanOrigin(context));
          if (!mission.grants.includes("workflow.apply") && humanOrigin._tag === "Failure") {
            return yield* Effect.fail(
              new HostToolError(
                "supervision_authority_denied",
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
            type: "supervision.workflow.apply",
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
    },
    {
      visible: (_state, role) => role === "supervisor",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { state, authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role !== "supervisor")
            return yield* Effect.fail(
              new HostToolError("supervision_role_required", "Supervisor role required."),
            );
          const lead = state.supervision.leads.find(
            (candidate) => candidate.id === stringArg(args, "leadSeatId"),
          );
          if (!lead)
            return yield* Effect.fail(
              new HostToolError("supervision_lead_missing", "Lead seat not found."),
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
              new HostToolError(
                "supervision_scope_denied",
                "Mission does not cover this Lead.",
              ),
            );
          }
          const now = new Date().toISOString();
          const preset = state.supervision.profiles.find(
            (candidate) => candidate.id === stringArg(args, "profilePresetId"),
          );
          if (!preset) {
            return yield* Effect.fail(
              new HostToolError("supervision_profile_missing", "Profile preset not found."),
            );
          }
          const launchIssue = profileLaunchIssue(preset);
          if (launchIssue !== null) {
            return yield* Effect.fail(
              new HostToolError("supervision_profile_unsupported", launchIssue),
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
            type: "supervision.lead.replace",
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

  const createSpecialist = entry(
    {
      name: "create_specialist",
      displayName: "Create Specialist",
      description:
        "Create and start a bounded Specialist in the current Lead Room using a retained Supervised profile.",
      inputSchema: objectSchema(
        {
          profilePresetId: { type: "string" },
          title: { type: "string", maxLength: 512 },
          concern: { type: "string", maxLength: 512 },
          initialPrompt: { type: "string", maxLength: 32_768 },
        },
        ["profilePresetId", "title", "concern", "initialPrompt"],
      ),
      readOnly: false,
      providerSupport: { codex: "native", claude: "unsupported" },
    },
    {
      visible: (_state, role) => role === "lead",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { state, authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role !== "lead") {
            return yield* Effect.fail(
              new HostToolError(
                "supervised_lead_required",
                "Only an active Lead may create a Specialist.",
              ),
            );
          }
          const lead = state.supervision.leads.find(
            (candidate) =>
              candidate.id === authority.leadSeatId &&
              candidate.activeThreadId === authority.callerThreadId &&
              candidate.status === "active",
          );
          const room = state.supervised.rooms.find(
            (candidate) =>
              candidate.leadSeatId === authority.leadSeatId && candidate.status !== "archived",
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
                "The active Lead Room and Project must exist before creating a Specialist.",
              ),
            );
          }
          const profilePresetId = stringArg(args, "profilePresetId");
          const preset = state.supervision.profiles.find(
            (candidate) => candidate.id === profilePresetId,
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
          const governance = yield* input.governanceRepository.getSnapshot().pipe(
            Effect.mapError(
              (error) =>
                new HostToolError(
                  "supervision_state_unavailable",
                  error instanceof Error ? error.message : String(error),
                ),
            ),
          );
          const leadAgentSeat = governance.agentSeats.find(
            (candidate) => candidate.id === lead.id,
          );
          if (!leadAgentSeat) {
            return yield* Effect.fail(
              new HostToolError(
                "supervision_authority_unavailable",
                "The active Lead has no durable authority receipt.",
              ),
            );
          }
          const specialistId = SpecialistId.makeUnsafe(randomUUID());
          const threadId = ThreadId.makeUnsafe(`specialist:${randomUUID()}`);
          const profileSnapshot = resolveProfilePreset({
            preset,
            snapshotId: ProfileSnapshotId.makeUnsafe(randomUUID()),
            createdAt,
          });
          const receipt = yield* dispatch({
            type: "supervised.specialist.create",
            commandId: CommandId.makeUnsafe(randomUUID()),
            aggregateId: specialistId,
            actor: {
              kind: "seat",
              actorId: context.callerThreadId,
              seatId: lead.id,
            },
            authorityReceiptId: leadAgentSeat.authorityReceiptId,
            expectedRevision: 0,
            idempotencyKey: `specialist-create:${specialistId}`,
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
            specialist: {
              id: specialistId,
              profilePresetId: preset.id,
              concern: stringArg(args, "concern"),
              status: "active",
              allowedScopes: [
                { kind: "project", projectId: project.id },
                { kind: "room", roomId: room.id },
                { kind: "seat", role: "specialist", seatId: threadId },
              ],
              latestSnapshotId: null,
              expiresAt: new Date(Date.parse(createdAt) + 24 * 60 * 60 * 1_000).toISOString(),
              revision: 0,
              createdAt,
              updatedAt: createdAt,
            },
            initialPrompt: stringArg(args, "initialPrompt"),
          });
          return hostToolSuccess({
            sequence: receipt.sequence,
            specialistId,
            threadId,
            roomId: room.id,
          });
        }),
    },
  );

  const revokeWorkflow = entry(
    {
      name: "revoke_supervision_workflow",
      displayName: "Revoke supervision workflow",
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
    },
    {
      visible: (_state, role) => role === "supervisor",
      execute: (args, context) =>
        Effect.gen(function* () {
          yield* context.assertCallerTurnActive();
          const { state, authority } = yield* loadAuthority(context.callerThreadId);
          if (authority.role !== "supervisor") {
            return yield* Effect.fail(
              new HostToolError("supervision_role_required", "Supervisor role required."),
            );
          }
          const directive = state.supervision.workflowDirectives.find(
            (candidate) => candidate.id === stringArg(args, "directiveId"),
          );
          if (!directive || directive.supervisorSeatId !== authority.supervisorSeatId) {
            return yield* Effect.fail(
              new HostToolError(
                "supervision_workflow_missing",
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
                "supervision_authority_denied",
                "Authenticated owner origin or workflow.revoke mission grant required.",
              ),
            );
          }
          const receipt = yield* dispatch({
            type: "supervision.workflow.revoke",
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
    createMission,
    mutateMission("update_supervision_mission", "supervision.mission.update"),
    mutateMission("complete_supervision_mission", "supervision.mission.complete"),
    mutateMission("cancel_supervision_mission", "supervision.mission.cancel"),
    sendAdvice,
    applyWorkflow,
    revokeWorkflow,
    requestReplacement,
    createSpecialist,
  ];
}
