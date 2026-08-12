import assert from "node:assert/strict";

import {
  emptySupervisedGovernanceSnapshot,
  type OrchestrationCommand,
  type SupervisionWake,
} from "@veylen/contracts";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";

import { OrchestrationCommandReceiptRepository } from "../../persistence/Services/OrchestrationCommandReceipts.ts";
import { SupervisedGovernanceRepository } from "../../persistence/Services/SupervisedGovernanceRepository.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { makeSupervisedWakeReactor } from "./SupervisedWakeReactor.ts";

const now = "2026-08-09T12:00:00.000Z";
const wake: SupervisionWake = {
  id: "wake:mission-1:lead-1:thread.message-added:9" as never,
  missionId: "mission-1" as never,
  supervisorSeatId: "supervisor-1" as never,
  leadSeatId: "lead-1" as never,
  episodeKind: "thread.message-added",
  pointers: [
    {
      sequence: 9,
      eventType: "thread.message-added",
      aggregateKind: "thread",
      aggregateId: "lead-thread",
    },
  ],
  status: "queued",
  attemptCount: 0,
  error: null,
  createdAt: now,
  updatedAt: now,
};

it.effect("recovers a wake after turn acceptance without resending the external turn", () => {
  const dispatched: OrchestrationCommand[] = [];
  let failCursorOnce = true;
  let turnReceipt = Option.none();
  const governance = {
    ...emptySupervisedGovernanceSnapshot(now),
    agentSeats: [
      {
        id: "supervisor-1",
        identityRole: "supervisor",
        lifecycleState: "active",
        threadId: "supervisor-thread",
        projectId: null,
      },
      {
        id: "lead-1",
        identityRole: "lead",
        lifecycleState: "active",
        threadId: "lead-thread",
        projectId: "project-1",
      },
    ],
    orchestration: {
      ...emptySupervisedGovernanceSnapshot(now).orchestration,
      missions: [
        {
          id: "mission-1",
          supervisorSeatId: "supervisor-1",
          status: "active",
        },
      ],
      wakeQueue: [wake],
    },
  } as never;
  const engine = OrchestrationEngineService.of({
    getReadModel: () =>
      Effect.succeed({
        projects: [],
        threads: [
          {
            id: "supervisor-thread",
            deletedAt: null,
            runtimeMode: "full-access",
            interactionMode: "default",
          },
        ],
      } as never),
    dispatch: (command: OrchestrationCommand) => {
      dispatched.push(command);
      if (command.type === "thread.turn.start") {
        turnReceipt = Option.some({
          commandId: command.commandId,
          aggregateKind: "thread",
          aggregateId: command.threadId,
          acceptedAt: now,
          resultSequence: 10,
          status: "accepted",
          error: null,
          fingerprintVersion: 1,
          commandFingerprint: "a".repeat(64),
        } as never);
      }
      if (command.type === "supervised.observation.advance" && failCursorOnce) {
        failCursorOnce = false;
        return Effect.fail(new Error("simulated crash after turn acceptance")) as never;
      }
      return Effect.succeed({ sequence: dispatched.length });
    },
  } as never);
  const governanceRepository = SupervisedGovernanceRepository.of({
    getSnapshot: () => Effect.succeed(governance),
  } as never);
  const receiptRepository = OrchestrationCommandReceiptRepository.of({
    getByCommandId: () => Effect.succeed(turnReceipt),
  } as never);
  const snapshotQuery = ProjectionSnapshotQuery.of({
    getCommandReadModel: () => engine.getReadModel(),
  } as never);

  return Effect.gen(function* () {
    const reactor = yield* makeSupervisedWakeReactor;
    const first = yield* Effect.exit(reactor.reconcileQueued);
    assert.equal(first._tag, "Failure");

    yield* reactor.reconcileQueued;

    const turns = dispatched.filter((command) => command.type === "thread.turn.start");
    assert.equal(turns.length, 1);
    const turn = turns[0];
    assert.equal(turn?.commandId, `server:supervised-wake:${wake.id}:turn`);
    if (turn?.type !== "thread.turn.start") return;
    assert.equal(turn.message.messageId, `supervised-wake:${wake.id}`);
    assert.equal(turn.createdAt, wake.createdAt);
  }).pipe(
    Effect.provideService(OrchestrationEngineService, engine),
    Effect.provideService(SupervisedGovernanceRepository, governanceRepository),
    Effect.provideService(OrchestrationCommandReceiptRepository, receiptRepository),
    Effect.provideService(ProjectionSnapshotQuery, snapshotQuery),
  );
});
