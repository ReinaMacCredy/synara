import type {
  OrchestrationCommand,
  ProjectId,
  SupervisedDomainEvent,
  SupervisedGovernanceSnapshot,
  SupervisedRuntimeSnapshot,
} from "@synara/contracts";
import { LeadSeatId } from "@synara/contracts";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "../Errors.ts";
import { decideSupervisedCommand } from "./decider.ts";

type ThreadLifecycleCommand = Extract<
  OrchestrationCommand,
  { readonly type: "thread.turn.start" | "thread.session.set" }
>;
type UnsequencedSupervisedEvent = Omit<SupervisedDomainEvent, "sequence">;

const reject = (command: ThreadLifecycleCommand, detail: string) =>
  Effect.fail(
    new OrchestrationCommandInvariantError({
      commandType: command.type,
      detail,
    }),
  );

export const decideSupervisedRoomLifecycleForThreadCommand = Effect.fn(
  "decideSupervisedRoomLifecycleForThreadCommand",
)(function* (input: {
  readonly command: ThreadLifecycleCommand;
  readonly projectId: ProjectId | null;
  readonly governance: SupervisedGovernanceSnapshot;
  readonly runtime: SupervisedRuntimeSnapshot;
}): Effect.fn.Return<
  ReadonlyArray<UnsequencedSupervisedEvent>,
  OrchestrationCommandInvariantError
> {
  const { command } = input;
  let runtime = input.runtime;
  let room = runtime.rooms.find((candidate) => candidate.id === String(command.threadId));
  if (!room) return [];

  if (input.projectId === null || room.projectId !== input.projectId) {
    return yield* reject(command, "The Lead Room does not belong to the command Thread Project.");
  }
  const lead = input.governance.agentSeats.find(
    (candidate) =>
      candidate.identityRole === "lead" &&
      candidate.threadId === command.threadId &&
      candidate.projectId === input.projectId &&
      candidate.lifecycleState === "active",
  );
  if (!lead) return yield* reject(command, "The Lead Room has no active Lead seat.");
  const leadSeatId = LeadSeatId.makeUnsafe(lead.id);
  if (room.leadSeatId !== null && room.leadSeatId !== leadSeatId) {
    return yield* reject(
      command,
      "The Lead Room is bound to a different Root holder; use the Root transfer saga.",
    );
  }

  const events: UnsequencedSupervisedEvent[] = [];
  const advance = (status: SupervisedRuntimeSnapshot["rooms"][number]["status"]) =>
    Effect.gen(function* () {
      const currentRoom = room;
      if (!currentRoom) {
        return yield* reject(command, "The Lead Room is unavailable.");
      }
      const nextEvent = yield* decideSupervisedCommand({
        state: runtime,
        command: {
          type: "supervised.room.update",
          commandId: command.commandId,
          actor: { kind: "user", actorId: "owner" },
          aggregateId: currentRoom.id,
          expectedRevision: currentRoom.revision,
          idempotencyKey: `thread-room-lifecycle:${command.commandId}:${status}:${currentRoom.revision}`,
          createdAt: command.createdAt,
          room: {
            ...currentRoom,
            leadSeatId,
            status,
            updatedAt: command.createdAt,
          },
        },
      });
      const nextRoom = nextEvent.payload.room;
      if (!nextRoom) return yield* reject(command, "Room lifecycle decision produced no Room.");
      runtime = {
        ...runtime,
        rooms: runtime.rooms.map((candidate) =>
          candidate.id === nextRoom.id ? nextRoom : candidate,
        ),
      };
      room = nextRoom;
      events.push(nextEvent);
    });

  if (command.type === "thread.turn.start") {
    if (room.status === "draft") yield* advance("provisioning");
    else if (room.status === "degraded") yield* advance("recovering");
    else if (
      room.status !== "provisioning" &&
      room.status !== "recovering" &&
      room.status !== "active"
    ) {
      return yield* reject(command, `The Lead Room cannot accept a turn while '${room.status}'.`);
    }
    return events;
  }

  if (command.session.status === "ready" || command.session.status === "running") {
    if (room.status === "provisioning") {
      yield* advance("ready");
      yield* advance("active");
    } else if (room.status === "recovering") {
      yield* advance("active");
    }
    return events;
  }

  if (
    command.session.status === "error" ||
    command.session.status === "interrupted" ||
    command.session.status === "stopped"
  ) {
    if (room.status === "provisioning" || room.status === "recovering") {
      yield* advance("failed");
    } else if (room.status === "active") {
      yield* advance("degraded");
    }
  }
  return events;
});
