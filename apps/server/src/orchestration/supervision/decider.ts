import type {
  SupervisionCommand,
  SupervisionDomainEvent,
  SupervisionSnapshot,
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
} from "./invariants.ts";
import { mayAdvanceLeadRotation, switchLeadSeatForRotation } from "./leadRotation.ts";

type UnsequencedEvent = Omit<SupervisionDomainEvent, "sequence">;

const reject = (command: SupervisionCommand, detail: string) =>
  Effect.fail(new OrchestrationCommandInvariantError({ commandType: command.type, detail }));

const event = (
  command: SupervisionCommand,
  type: SupervisionDomainEvent["type"],
  acceptedRevision: number,
  payload: Omit<SupervisionDomainEvent["payload"], "acceptedRevision">,
): UnsequencedEvent => ({
  eventId: EventId.makeUnsafe(crypto.randomUUID()),
  aggregateKind: "supervision",
  aggregateId: command.aggregateId,
  type,
  payload: { acceptedRevision, ...payload },
  occurredAt: command.createdAt,
  commandId: command.commandId,
  causationEventId: null,
  correlationId: command.commandId,
  metadata: {},
});

const requireHuman = (command: SupervisionCommand) =>
  isHumanOrigin(command.actor)
    ? Effect.void
    : reject(command, "This operation requires an authenticated human-origin command.");

const requireServer = (command: SupervisionCommand) =>
  command.actor.kind === "server"
    ? Effect.void
    : reject(command, "This lifecycle transition is owned by the supervision runtime.");

const requireRevision = (
  command: SupervisionCommand,
  currentRevision: number,
): Effect.Effect<void, OrchestrationCommandInvariantError> =>
  command.expectedRevision === currentRevision
    ? Effect.void
    : reject(
        command,
        `Revision conflict: expected ${command.expectedRevision}, current ${currentRevision}.`,
      );

const requireMissionSupervisorActor = (
  command: SupervisionCommand,
  state: SupervisionSnapshot,
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

export const decideSupervisionCommand = Effect.fn("decideSupervisionCommand")(function* (input: {
  readonly command: SupervisionCommand;
  readonly state: SupervisionSnapshot;
}): Effect.fn.Return<
  UnsequencedEvent | ReadonlyArray<UnsequencedEvent>,
  OrchestrationCommandInvariantError
> {
  const { command, state } = input;

  switch (command.type) {
    case "supervision.profile.create": {
      yield* requireHuman(command);
      if (state.profiles.some((profile) => profile.id === command.profile.id)) {
        return yield* reject(command, "Profile preset already exists.");
      }
      yield* requireRevision(command, 0);
      return event(command, "supervision.profile-created", 1, {
        profile: { ...command.profile, revision: 1 },
      });
    }
    case "supervision.profile.update": {
      yield* requireHuman(command);
      const current = state.profiles.find((profile) => profile.id === command.profile.id);
      if (!current) return yield* reject(command, "Profile preset does not exist.");
      yield* requireRevision(command, current.revision);
      return event(command, "supervision.profile-updated", current.revision + 1, {
        profile: {
          ...command.profile,
          createdAt: current.createdAt,
          updatedAt: command.createdAt,
          revision: current.revision + 1,
        },
      });
    }
    case "supervision.profile.archive":
    case "supervision.profile.restore":
    case "supervision.profile.clear": {
      yield* requireHuman(command);
      const current = state.profiles.find((profile) => profile.id === command.profileId);
      if (!current) return yield* reject(command, "Profile preset does not exist.");
      yield* requireRevision(command, current.revision);
      if (command.type === "supervision.profile.clear") {
        if (current.archivedAt === null) {
          return yield* reject(command, "Only archived profile presets can be cleared.");
        }
        return event(command, "supervision.profile-cleared", current.revision + 1, {
          profile: {
            ...current,
            clearedAt: command.createdAt,
            updatedAt: command.createdAt,
            revision: current.revision + 1,
          },
        });
      }
      const restoring = command.type === "supervision.profile.restore";
      return event(
        command,
        restoring ? "supervision.profile-restored" : "supervision.profile-archived",
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
    case "supervision.supervisor.create": {
      yield* requireHuman(command);
      if (state.supervisors.some((seat) => seat.id === command.supervisor.id)) {
        return yield* reject(command, "Supervisor seat already exists.");
      }
      yield* requireRevision(command, 0);
      if (command.profileSnapshot === undefined) {
        return yield* reject(command, "Server-resolved profile snapshot is required.");
      }
      const supervisor = { ...command.supervisor, revision: 1 };
      const created = event(command, "supervision.supervisor-created", 1, {
        supervisor,
        profileSnapshot: command.profileSnapshot,
      });
      if (command.initialMission === undefined) return created;
      return [
        created,
        event(command, "supervision.mission-created", 1, {
          mission: { ...command.initialMission, revision: 1 },
        }),
      ];
    }
    case "supervision.supervisor.update": {
      yield* requireHuman(command);
      const current = state.supervisors.find((seat) => seat.id === command.supervisor.id);
      if (!current) return yield* reject(command, "Supervisor seat does not exist.");
      yield* requireRevision(command, current.revision);
      return event(command, "supervision.supervisor-updated", current.revision + 1, {
        supervisor: {
          ...command.supervisor,
          createdAt: current.createdAt,
          updatedAt: command.createdAt,
          revision: current.revision + 1,
        },
      });
    }
    case "supervision.supervisor.archive":
    case "supervision.supervisor.restore": {
      yield* requireHuman(command);
      const current = state.supervisors.find((seat) => seat.id === command.supervisorSeatId);
      if (!current) return yield* reject(command, "Supervisor seat does not exist.");
      yield* requireRevision(command, current.revision);
      const restoring = command.type === "supervision.supervisor.restore";
      return event(
        command,
        restoring ? "supervision.supervisor-restored" : "supervision.supervisor-archived",
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
    case "supervision.lead.enroll": {
      yield* requireHuman(command);
      if (activeLeadForProject(state, command.lead.projectId) !== null) {
        return yield* reject(command, "Project already has an active Lead seat.");
      }
      yield* requireRevision(command, 0);
      if (command.profileSnapshot === undefined) {
        return yield* reject(command, "Server-resolved profile snapshot is required.");
      }
      return event(command, "supervision.lead-enrolled", 1, {
        lead: { ...command.lead, status: "active", revision: 1 },
        profileSnapshot: command.profileSnapshot,
      });
    }
    case "supervision.peer.bind": {
      yield* requireHuman(command);
      if (state.peers.some((peer) => peer.threadId === command.peer.threadId)) {
        return yield* reject(command, "Peer thread already has a supervision profile binding.");
      }
      const lead = state.leads.find(
        (candidate) =>
          candidate.id === command.peer.leadSeatId &&
          candidate.projectId === command.peer.projectId &&
          candidate.activeThreadId === command.peer.rootThreadId &&
          candidate.status === "active",
      );
      if (!lead) return yield* reject(command, "Active Lead authority is required to bind a Peer.");
      yield* requireRevision(command, 0);
      if (command.profileSnapshot === undefined) {
        return yield* reject(command, "Server-resolved Peer profile snapshot is required.");
      }
      return event(command, "supervision.peer-bound", 1, {
        peer: { ...command.peer, status: "active", revision: 1 },
        profileSnapshot: command.profileSnapshot,
      });
    }
    case "supervision.mission.create": {
      yield* requireHuman(command);
      if (!state.supervisors.some((seat) => seat.id === command.mission.supervisorSeatId)) {
        return yield* reject(command, "Mission Supervisor seat does not exist.");
      }
      if (state.missions.some((mission) => mission.id === command.mission.id)) {
        return yield* reject(command, "Mission already exists.");
      }
      yield* requireRevision(command, 0);
      return event(command, "supervision.mission-created", 1, {
        mission: { ...command.mission, revision: 1 },
      });
    }
    case "supervision.mission.update":
    case "supervision.mission.complete":
    case "supervision.mission.cancel": {
      const current = state.missions.find((mission) => mission.id === command.mission.id);
      if (!current) return yield* reject(command, "Mission does not exist.");
      yield* requireRevision(command, current.revision);
      yield* requireMissionSupervisorActor(command, state, current.supervisorSeatId);
      if (
        command.type === "supervision.mission.update" &&
        (missionScopeExpands(current.scope, command.mission.scope) ||
          missionGrantsExpand(current.grants, command.mission.grants))
      ) {
        yield* requireHuman(command);
      }
      const status =
        command.type === "supervision.mission.complete"
          ? "completed"
          : command.type === "supervision.mission.cancel"
            ? "cancelled"
            : command.mission.status;
      const type =
        status === "completed"
          ? "supervision.mission-completed"
          : status === "cancelled"
            ? "supervision.mission-cancelled"
            : "supervision.mission-updated";
      return event(command, type, current.revision + 1, {
        mission: {
          ...command.mission,
          status,
          createdAt: current.createdAt,
          updatedAt: command.createdAt,
          completedAt: status === "completed" || status === "cancelled" ? command.createdAt : null,
          revision: current.revision + 1,
        },
      });
    }
    case "supervision.workflow.apply": {
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
        return event(command, "supervision.workflow-applied", 1, {
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
      return event(command, "supervision.workflow-conflicted", 1, {
        workflowDirective: conflicted,
        workflowConflict: conflict,
      });
    }
    case "supervision.workflow.resolve": {
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
      return event(command, "supervision.workflow-resolved", 1, {
        workflowConflict: {
          ...current,
          status: "resolved",
          resolvedDirectiveId: command.resolvedDirectiveId,
          resolvedAt: command.createdAt,
        },
      });
    }
    case "supervision.workflow.revoke": {
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
      return event(command, "supervision.workflow-reverted", current.revision + 1, {
        workflowDirective: {
          ...current,
          status: "reverted",
          updatedAt: command.createdAt,
          revision: current.revision + 1,
        },
      });
    }
    case "supervision.advice.send": {
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
      return event(command, "supervision.advice-sent", 1, { advice: command.advice });
    }
    case "supervision.observation.advance": {
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
      return event(command, "supervision.observation-advanced", command.cursor.lastSequence, {
        observationCursor: command.cursor,
      });
    }
    case "supervision.wake.enqueue": {
      yield* requireServer(command);
      const existing = state.wakeQueue.find((wake) => wake.id === command.wake.id);
      if (existing) return yield* reject(command, "Supervision wake already exists.");
      yield* requireRevision(command, 0);
      return event(command, "supervision.wake-enqueued", 1, {
        wake: { ...command.wake, status: "queued", attemptCount: 0, error: null },
      });
    }
    case "supervision.wake.update": {
      yield* requireServer(command);
      const current = state.wakeQueue.find((wake) => wake.id === command.wake.id);
      if (!current) return yield* reject(command, "Supervision wake does not exist.");
      yield* requireRevision(command, current.attemptCount);
      if (current.status === "delivered") {
        return yield* reject(command, "Delivered supervision wakes are immutable.");
      }
      return event(command, "supervision.wake-updated", command.wake.attemptCount, {
        wake: { ...command.wake, createdAt: current.createdAt },
      });
    }
    case "supervision.lead.replace": {
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
        return yield* reject(command, "Server-resolved replacement profile snapshot is required.");
      }
      const nextLead = {
        ...lead,
        status: "rotating" as const,
        updatedAt: command.createdAt,
        revision: lead.revision + 1,
      };
      return event(command, "supervision.lead-replacement-requested", lead.revision + 1, {
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
    case "supervision.lead.rotation.advance": {
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
        return event(command, "supervision.lead-replaced", lead.revision + 1, {
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
        return event(command, "supervision.lead-replacement-failed", lead.revision + 1, {
          rotation,
          lead: {
            ...lead,
            status: "active",
            updatedAt: command.createdAt,
            revision: lead.revision + 1,
          },
        });
      }
      return event(command, "supervision.lead-rotation-advanced", current.revision + 1, {
        rotation,
      });
    }
  }
});
