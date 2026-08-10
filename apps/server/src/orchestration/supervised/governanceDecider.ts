import type {
  SupervisedGovernanceCommand,
  SupervisedGovernanceDomainEvent,
  WorkflowConflict,
  WorkflowDirective,
} from "@synara/contracts";
import { EventId, WorkflowConflictId } from "@synara/contracts";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "../Errors.ts";
import {
  activeLeadForProject,
  isHumanOrigin,
  missionGrantsExpand,
  missionScopeExpands,
} from "./governanceInvariants.ts";
import { mayAdvanceLeadRotation, switchLeadSeatForRotation } from "./leadRotation.ts";
import type { SupervisedGovernanceDecisionState } from "./governanceState.ts";

type UnsequencedEvent = Omit<SupervisedGovernanceDomainEvent, "sequence">;

const reject = (command: SupervisedGovernanceCommand, detail: string) =>
  Effect.fail(new OrchestrationCommandInvariantError({ commandType: command.type, detail }));

const event = (
  command: SupervisedGovernanceCommand,
  type: SupervisedGovernanceDomainEvent["type"],
  acceptedRevision: number,
  payload: Omit<SupervisedGovernanceDomainEvent["payload"], "acceptedRevision">,
): UnsequencedEvent => ({
  eventId: EventId.makeUnsafe(crypto.randomUUID()),
  aggregateKind: "supervised_governance",
  aggregateId: command.aggregateId,
  type,
  payload: { acceptedRevision, ...payload },
  occurredAt: command.createdAt,
  commandId: command.commandId,
  causationEventId: null,
  correlationId: command.commandId,
  metadata: { schemaVersion: "supervised-governance/v1" },
});

const requireHuman = (command: SupervisedGovernanceCommand) =>
  isHumanOrigin(command.actor)
    ? Effect.void
    : reject(command, "This operation requires an authenticated human-origin command.");

const requireServer = (command: SupervisedGovernanceCommand) =>
  command.actor.kind === "server"
    ? Effect.void
    : reject(command, "This lifecycle transition is owned by the Supervised runtime.");

const requireRevision = (
  command: SupervisedGovernanceCommand,
  currentRevision: number,
): Effect.Effect<void, OrchestrationCommandInvariantError> =>
  command.expectedRevision === currentRevision
    ? Effect.void
    : reject(
        command,
        `Revision conflict: expected ${command.expectedRevision}, current ${currentRevision}.`,
      );

const requireMissionSupervisorActor = (
  command: SupervisedGovernanceCommand,
  state: SupervisedGovernanceDecisionState,
  supervisorSeatId: string,
) => {
  if (isHumanOrigin(command.actor) || command.actor.kind === "server") return Effect.void;
  const seat = state.supervisors.find(
    (candidate) =>
      candidate.id === supervisorSeatId &&
      candidate.status !== "archived" &&
      command.actor.kind === "thread" &&
      command.actor.threadId === candidate.activeThreadId,
  );
  return seat
    ? Effect.void
    : reject(command, "The active mission Supervisor thread is required for this operation.");
};

const requireLeadEnrollmentActor = (
  command: Extract<SupervisedGovernanceCommand, { readonly type: "supervised.lead.enroll" }>,
  state: SupervisedGovernanceDecisionState,
) => {
  if (isHumanOrigin(command.actor)) return Effect.void;
  if (command.actor.kind !== "thread" || command.actor.threadId === undefined) {
    return reject(command, "The active Primary Supervisor thread is required to enroll a Lead.");
  }
  const supervisor = state.supervisors.find(
    (candidate) =>
      candidate.status === "active" && candidate.activeThreadId === command.actor.threadId,
  );
  const mission = supervisor
    ? state.missions.find(
        (candidate) =>
          candidate.supervisorSeatId === supervisor.id &&
          candidate.status === "active" &&
          candidate.scope.some(
            (scope) =>
              scope.kind === "all_projects" ||
              (scope.kind === "project" && scope.projectId === command.lead.projectId),
          ),
      )
    : undefined;
  return mission
    ? Effect.void
    : reject(command, "An active Primary Supervisor mission for the Lead Project is required.");
};

const requirePeerBindingActor = (
  command: Extract<SupervisedGovernanceCommand, { readonly type: "supervised.peer.bind" }>,
  state: SupervisedGovernanceDecisionState,
) => {
  if (isHumanOrigin(command.actor)) return Effect.void;
  if (command.actor.kind !== "thread" || command.actor.threadId === undefined) {
    return reject(
      command,
      "The Room Lead or a scoped Primary Supervisor thread is required to bind a Peer.",
    );
  }
  const lead = state.leads.find(
    (candidate) =>
      candidate.id === command.peer.leadSeatId &&
      candidate.projectId === command.peer.projectId &&
      candidate.activeThreadId === command.peer.rootThreadId &&
      candidate.status === "active",
  );
  if (lead?.activeThreadId === command.actor.threadId) return Effect.void;
  const supervisor = state.supervisors.find(
    (candidate) =>
      candidate.status === "active" && candidate.activeThreadId === command.actor.threadId,
  );
  const mission = supervisor
    ? state.missions.find(
        (candidate) =>
          candidate.supervisorSeatId === supervisor.id &&
          candidate.status === "active" &&
          candidate.scope.some(
            (scope) =>
              scope.kind === "all_projects" ||
              (scope.kind === "project" && scope.projectId === command.peer.projectId) ||
              (scope.kind === "lead" && scope.leadSeatId === command.peer.leadSeatId),
          ),
      )
    : undefined;
  return mission
    ? Effect.void
    : reject(
        command,
        "The Room Lead or a scoped Primary Supervisor thread is required to bind a Peer.",
      );
};

export const decideSupervisedGovernanceCommand = Effect.fn("decideSupervisedGovernanceCommand")(
  function* (input: {
    readonly command: SupervisedGovernanceCommand;
    readonly state: SupervisedGovernanceDecisionState;
  }): Effect.fn.Return<
    UnsequencedEvent | ReadonlyArray<UnsequencedEvent>,
    OrchestrationCommandInvariantError
  > {
    const { command, state } = input;

    switch (command.type) {
      case "supervised.profile.create": {
        yield* requireHuman(command);
        if (state.profiles.some((profile) => profile.id === command.profile.id)) {
          return yield* reject(command, "Profile preset already exists.");
        }
        yield* requireRevision(command, 0);
        return event(command, "supervised.profile-created", 1, {
          profile: { ...command.profile, revision: 1 },
        });
      }
      case "supervised.profile.update": {
        yield* requireHuman(command);
        const current = state.profiles.find((profile) => profile.id === command.profile.id);
        if (!current) return yield* reject(command, "Profile preset does not exist.");
        yield* requireRevision(command, current.revision);
        return event(command, "supervised.profile-updated", current.revision + 1, {
          profile: {
            ...command.profile,
            createdAt: current.createdAt,
            updatedAt: command.createdAt,
            revision: current.revision + 1,
          },
        });
      }
      case "supervised.profile.archive":
      case "supervised.profile.restore":
      case "supervised.profile.clear": {
        yield* requireHuman(command);
        const current = state.profiles.find((profile) => profile.id === command.profileId);
        if (!current) return yield* reject(command, "Profile preset does not exist.");
        yield* requireRevision(command, current.revision);
        if (command.type === "supervised.profile.clear") {
          if (current.archivedAt === null) {
            return yield* reject(command, "Only archived profile presets can be cleared.");
          }
          return event(command, "supervised.profile-cleared", current.revision + 1, {
            profile: {
              ...current,
              clearedAt: command.createdAt,
              updatedAt: command.createdAt,
              revision: current.revision + 1,
            },
          });
        }
        const restoring = command.type === "supervised.profile.restore";
        return event(
          command,
          restoring ? "supervised.profile-restored" : "supervised.profile-archived",
          current.revision + 1,
          {
            profile: {
              ...current,
              archivedAt: restoring ? null : command.createdAt,
              clearedAt: null,
              updatedAt: command.createdAt,
              revision: current.revision + 1,
            },
          },
        );
      }
      case "supervised.supervisor.create": {
        yield* requireHuman(command);
        if (state.supervisors.some((seat) => seat.id === command.supervisor.id)) {
          return yield* reject(command, "Supervisor seat already exists.");
        }
        yield* requireRevision(command, 0);
        if (command.profileSnapshot === undefined) {
          return yield* reject(command, "Server-resolved profile snapshot is required.");
        }
        const hasActivePrimary = state.supervisors.some(
          (seat) => seat.isPrimary === true && seat.status !== "archived",
        );
        const supervisor = {
          ...command.supervisor,
          ...(hasActivePrimary ? { isPrimary: false } : { concern: "primary", isPrimary: true }),
          revision: 1,
        };
        const created = event(command, "supervised.supervisor-created", 1, {
          supervisor,
          profileSnapshot: command.profileSnapshot,
        });
        if (command.initialMission === undefined) return created;
        return [
          created,
          event(command, "supervised.mission-created", 1, {
            mission: { ...command.initialMission, revision: 1 },
          }),
        ];
      }
      case "supervised.supervisor.update": {
        yield* requireHuman(command);
        const current = state.supervisors.find((seat) => seat.id === command.supervisor.id);
        if (!current) return yield* reject(command, "Supervisor seat does not exist.");
        yield* requireRevision(command, current.revision);
        return event(command, "supervised.supervisor-updated", current.revision + 1, {
          supervisor: {
            ...command.supervisor,
            createdAt: current.createdAt,
            updatedAt: command.createdAt,
            revision: current.revision + 1,
          },
        });
      }
      case "supervised.supervisor.archive":
      case "supervised.supervisor.restore": {
        yield* requireHuman(command);
        const current = state.supervisors.find((seat) => seat.id === command.supervisorSeatId);
        if (!current) return yield* reject(command, "Supervisor seat does not exist.");
        yield* requireRevision(command, current.revision);
        const restoring = command.type === "supervised.supervisor.restore";
        return event(
          command,
          restoring ? "supervised.supervisor-restored" : "supervised.supervisor-archived",
          current.revision + 1,
          {
            supervisor: {
              ...current,
              status: restoring ? "active" : "archived",
              archivedAt: restoring ? null : command.createdAt,
              updatedAt: command.createdAt,
              revision: current.revision + 1,
            },
          },
        );
      }
      case "supervised.lead.enroll": {
        yield* requireLeadEnrollmentActor(command, state);
        if (activeLeadForProject(state, command.lead.projectId) !== null) {
          return yield* reject(command, "Project already has an active Lead seat.");
        }
        yield* requireRevision(command, 0);
        if (command.profileSnapshot === undefined) {
          return yield* reject(command, "Server-resolved profile snapshot is required.");
        }
        return event(command, "supervised.lead-enrolled", 1, {
          lead: { ...command.lead, status: "active", revision: 1 },
          profileSnapshot: command.profileSnapshot,
        });
      }
      case "supervised.peer.bind": {
        yield* requirePeerBindingActor(command, state);
        if (state.peers.some((peer) => peer.threadId === command.peer.threadId)) {
          return yield* reject(command, "Peer thread already has a Supervised profile binding.");
        }
        const lead = state.leads.find(
          (candidate) =>
            candidate.id === command.peer.leadSeatId &&
            candidate.projectId === command.peer.projectId &&
            candidate.activeThreadId === command.peer.rootThreadId &&
            candidate.status === "active",
        );
        if (!lead)
          return yield* reject(command, "Active Lead authority is required to bind a Peer.");
        yield* requireRevision(command, 0);
        if (command.profileSnapshot === undefined) {
          return yield* reject(command, "Server-resolved Peer profile snapshot is required.");
        }
        return event(command, "supervised.peer-bound", 1, {
          peer: { ...command.peer, status: "active", revision: 1 },
          profileSnapshot: command.profileSnapshot,
        });
      }
      case "supervised.mission.create": {
        yield* requireHuman(command);
        if (!state.supervisors.some((seat) => seat.id === command.mission.supervisorSeatId)) {
          return yield* reject(command, "Mission Supervisor seat does not exist.");
        }
        if (state.missions.some((mission) => mission.id === command.mission.id)) {
          return yield* reject(command, "Mission already exists.");
        }
        yield* requireRevision(command, 0);
        return event(command, "supervised.mission-created", 1, {
          mission: { ...command.mission, revision: 1 },
        });
      }
      case "supervised.mission.update":
      case "supervised.mission.complete":
      case "supervised.mission.cancel": {
        const current = state.missions.find((mission) => mission.id === command.mission.id);
        if (!current) return yield* reject(command, "Mission does not exist.");
        yield* requireRevision(command, current.revision);
        yield* requireMissionSupervisorActor(command, state, current.supervisorSeatId);
        if (
          command.type === "supervised.mission.update" &&
          (missionScopeExpands(current.scope, command.mission.scope) ||
            missionGrantsExpand(current.grants, command.mission.grants))
        ) {
          yield* requireHuman(command);
        }
        const status =
          command.type === "supervised.mission.complete"
            ? "completed"
            : command.type === "supervised.mission.cancel"
              ? "cancelled"
              : command.mission.status;
        const type =
          status === "completed"
            ? "supervised.mission-completed"
            : status === "cancelled"
              ? "supervised.mission-cancelled"
              : "supervised.mission-updated";
        return event(command, type, current.revision + 1, {
          mission: {
            ...command.mission,
            status,
            createdAt: current.createdAt,
            updatedAt: command.createdAt,
            completedAt:
              status === "completed" || status === "cancelled" ? command.createdAt : null,
            revision: current.revision + 1,
          },
        });
      }
      case "supervised.workflow.apply": {
        const mission = state.missions.find(
          (candidate) =>
            candidate.id === command.directive.missionId &&
            candidate.supervisorSeatId === command.directive.supervisorSeatId &&
            candidate.status === "active" &&
            candidate.grants.includes("workflow.apply"),
        );
        if (!mission && !isHumanOrigin(command.actor)) {
          return yield* reject(command, "Active workflow.apply mission grant required.");
        }
        if (mission) yield* requireMissionSupervisorActor(command, state, mission.supervisorSeatId);
        yield* requireRevision(command, 0);
        const conflictWith = state.workflowDirectives.filter(
          (directive) =>
            directive.leadSeatId === command.directive.leadSeatId &&
            directive.slot === command.directive.slot &&
            directive.status === "active" &&
            directive.instruction !== command.directive.instruction,
        );
        if (conflictWith.length === 0) {
          return event(command, "supervised.workflow-applied", 1, {
            workflowDirective: { ...command.directive, status: "active", revision: 1 },
          });
        }
        const conflicted: WorkflowDirective = {
          ...command.directive,
          status: "conflicted",
          revision: 1,
        };
        const conflict: WorkflowConflict = {
          id: WorkflowConflictId.makeUnsafe(crypto.randomUUID()),
          leadSeatId: command.directive.leadSeatId,
          slot: command.directive.slot,
          directiveIds: [...conflictWith.map((directive) => directive.id), conflicted.id],
          status: "open",
          resolvedDirectiveId: null,
          createdAt: command.createdAt,
          resolvedAt: null,
        };
        return event(command, "supervised.workflow-conflicted", 1, {
          workflowDirective: conflicted,
          workflowConflict: conflict,
        });
      }
      case "supervised.workflow.resolve": {
        yield* requireHuman(command);
        const current = state.workflowConflicts.find(
          (conflict) => conflict.id === command.conflictId,
        );
        if (!current || current.status !== "open") {
          return yield* reject(command, "Open workflow conflict does not exist.");
        }
        if (!current.directiveIds.includes(command.resolvedDirectiveId)) {
          return yield* reject(command, "Resolved directive is not part of this conflict.");
        }
        yield* requireRevision(command, 0);
        return event(command, "supervised.workflow-resolved", 1, {
          workflowConflict: {
            ...current,
            status: "resolved",
            resolvedDirectiveId: command.resolvedDirectiveId,
            resolvedAt: command.createdAt,
          },
        });
      }
      case "supervised.workflow.revoke": {
        const current = state.workflowDirectives.find(
          (directive) => directive.id === command.directiveId,
        );
        if (!current || current.status === "reverted") {
          return yield* reject(command, "Active workflow directive does not exist.");
        }
        const mission = state.missions.find(
          (candidate) =>
            candidate.id === current.missionId &&
            candidate.supervisorSeatId === current.supervisorSeatId &&
            candidate.status === "active" &&
            candidate.grants.includes("workflow.revoke"),
        );
        if (!isHumanOrigin(command.actor)) {
          if (!mission)
            return yield* reject(command, "Active workflow.revoke mission grant required.");
          yield* requireMissionSupervisorActor(command, state, current.supervisorSeatId);
        }
        yield* requireRevision(command, current.revision);
        return event(command, "supervised.workflow-reverted", current.revision + 1, {
          workflowDirective: {
            ...current,
            status: "reverted",
            updatedAt: command.createdAt,
            revision: current.revision + 1,
          },
        });
      }
      case "supervised.advice.send": {
        const mission = state.missions.find(
          (candidate) =>
            candidate.id === command.advice.missionId &&
            candidate.supervisorSeatId === command.advice.supervisorSeatId &&
            candidate.status === "active" &&
            candidate.grants.includes("lead.advise"),
        );
        if (!mission) return yield* reject(command, "Active lead.advise mission grant required.");
        yield* requireMissionSupervisorActor(command, state, mission.supervisorSeatId);
        yield* requireRevision(command, 0);
        return event(command, "supervised.advice-sent", 1, { advice: command.advice });
      }
      case "supervised.observation.advance": {
        if (command.actor.kind === "thread") {
          return yield* reject(
            command,
            "Thread-origin messages cannot advance observation authority.",
          );
        }
        const current = state.observationCursors.find((cursor) => cursor.id === command.cursor.id);
        yield* requireRevision(command, current?.lastSequence ?? 0);
        if (current && command.cursor.lastSequence <= current.lastSequence) {
          return yield* reject(command, "Observation cursor must advance monotonically.");
        }
        return event(command, "supervised.observation-advanced", command.cursor.lastSequence, {
          observationCursor: command.cursor,
        });
      }
      case "supervised.wake.enqueue": {
        yield* requireServer(command);
        const existing = state.wakeQueue.find((wake) => wake.id === command.wake.id);
        if (existing) return yield* reject(command, "Supervised wake already exists.");
        yield* requireRevision(command, 0);
        return event(command, "supervised.wake-enqueued", 1, {
          wake: { ...command.wake, status: "queued", attemptCount: 0, error: null },
        });
      }
      case "supervised.wake.update": {
        yield* requireServer(command);
        const current = state.wakeQueue.find((wake) => wake.id === command.wake.id);
        if (!current) return yield* reject(command, "Supervised wake does not exist.");
        yield* requireRevision(command, current.attemptCount);
        if (current.status === "delivered") {
          return yield* reject(command, "Delivered Supervised wakes are immutable.");
        }
        return event(command, "supervised.wake-updated", command.wake.attemptCount, {
          wake: { ...command.wake, createdAt: current.createdAt },
        });
      }
      case "supervised.lead.replace": {
        const lead = state.leads.find((candidate) => candidate.id === command.rotation.leadSeatId);
        if (!lead || lead.status === "archived")
          return yield* reject(command, "Active Lead required.");
        const mission =
          command.rotation.missionId === null
            ? null
            : (state.missions.find((candidate) => candidate.id === command.rotation.missionId) ??
              null);
        const authorizedMission =
          mission !== null &&
          mission.status === "active" &&
          mission.grants.includes("lead.replace") &&
          state.supervisors.some(
            (seat) =>
              seat.id === mission.supervisorSeatId &&
              seat.status !== "archived" &&
              command.actor.kind === "thread" &&
              command.actor.threadId === seat.activeThreadId,
          );
        if (!isHumanOrigin(command.actor) && !authorizedMission) {
          return yield* reject(
            command,
            "Authenticated owner origin or an active lead.replace mission grant is required.",
          );
        }
        yield* requireRevision(command, lead.revision);
        if (lead.status === "rotating") {
          return yield* reject(command, "Lead replacement is already in progress.");
        }
        if (state.rotations.some((rotation) => rotation.id === command.rotation.id)) {
          return yield* reject(command, "Lead rotation already exists.");
        }
        if (command.replacementProfileSnapshot === undefined) {
          return yield* reject(
            command,
            "Server-resolved replacement profile snapshot is required.",
          );
        }
        const nextLead = {
          ...lead,
          status: "rotating" as const,
          updatedAt: command.createdAt,
          revision: lead.revision + 1,
        };
        return event(command, "supervised.lead-replacement-requested", lead.revision + 1, {
          lead: nextLead,
          profileSnapshot: command.replacementProfileSnapshot,
          rotation: {
            ...command.rotation,
            state: "requested",
            updatedAt: command.createdAt,
            revision: 1,
          },
        });
      }
      case "supervised.lead.rotation.advance": {
        yield* requireServer(command);
        const current = state.rotations.find((rotation) => rotation.id === command.rotation.id);
        if (!current) return yield* reject(command, "Lead rotation does not exist.");
        const lead = state.leads.find((candidate) => candidate.id === current.leadSeatId);
        if (!lead) return yield* reject(command, "Lead seat does not exist.");
        yield* requireRevision(command, current.revision);
        if (!mayAdvanceLeadRotation(current.state, command.rotation.state)) {
          return yield* reject(
            command,
            `Lead rotation cannot advance from ${current.state} to ${command.rotation.state}.`,
          );
        }
        const rotation = {
          ...current,
          ...command.rotation,
          createdAt: current.createdAt,
          updatedAt: command.createdAt,
          revision: current.revision + 1,
        };
        if (rotation.state === "switched") {
          return event(command, "supervised.lead-replaced", lead.revision + 1, {
            rotation,
            lead: switchLeadSeatForRotation({ lead, rotation, occurredAt: command.createdAt }),
            peers: state.peers
              .filter(
                (peer) =>
                  peer.leadSeatId === lead.id &&
                  peer.rootThreadId === rotation.predecessorThreadId &&
                  peer.status === "active",
              )
              .map((peer) => ({
                ...peer,
                rootThreadId: rotation.replacementThreadId,
                updatedAt: command.createdAt,
                revision: peer.revision + 1,
              })),
          });
        }
        if (rotation.state === "failed") {
          return event(command, "supervised.lead-replacement-failed", lead.revision + 1, {
            rotation,
            lead: {
              ...lead,
              status: "active",
              updatedAt: command.createdAt,
              revision: lead.revision + 1,
            },
          });
        }
        return event(command, "supervised.lead-rotation-advanced", current.revision + 1, {
          rotation,
        });
      }
    }
  },
);
