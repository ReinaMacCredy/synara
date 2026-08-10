import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  LeadRotationId,
  LeadSeatId,
  MessageId,
  ProfileSnapshotId,
  ProjectId,
  RoomId,
  SupervisedGovernanceAggregateId,
  SupervisionMissionId,
  SupervisorSeatId,
  ThreadId,
  type LeadRotation,
  type OrchestrationEvent,
} from "@synara/contracts";
import { Effect, Exit, Layer, ManagedRuntime, Scope, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServerConfig } from "../../config.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { SupervisedGovernanceRepository } from "../../persistence/Services/SupervisedGovernanceRepository.ts";
import { LeadRotationReactor } from "../Services/LeadRotationReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { DEFAULT_SUPERVISED_PROFILES } from "../supervised/profileSeeds.ts";
import {
  resolveEffectiveCanonicalAuthority,
  resolveProjectedSupervisedCaller,
} from "../supervised/canonicalCaller.ts";
import { resolveProfilePreset } from "../supervised/profileResolver.ts";
import { LeadRotationReactorLive } from "./LeadRotationReactor.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";

const AGGREGATE_ID = SupervisedGovernanceAggregateId.makeUnsafe("supervised");
const createdAt = "2026-08-10T02:00:00.000Z";

interface FixtureIds {
  readonly projectId: ProjectId;
  readonly supervisorThreadId: ThreadId;
  readonly supervisorSeatId: SupervisorSeatId;
  readonly missionId: SupervisionMissionId;
  readonly leadThreadId: ThreadId;
  readonly leadSeatId: LeadSeatId;
  readonly roomId: RoomId;
}

const ids: FixtureIds = {
  projectId: ProjectId.makeUnsafe("project-lead-rotation"),
  supervisorThreadId: ThreadId.makeUnsafe("thread-primary-supervisor-rotation"),
  supervisorSeatId: SupervisorSeatId.makeUnsafe("seat-primary-supervisor-rotation"),
  missionId: SupervisionMissionId.makeUnsafe("mission-lead-rotation"),
  leadThreadId: ThreadId.makeUnsafe("lead:rotation-predecessor"),
  leadSeatId: LeadSeatId.makeUnsafe("seat-lead-rotation"),
  roomId: RoomId.makeUnsafe("lead:rotation-predecessor"),
};

const makeRotation = (replacementThreadId: ThreadId): LeadRotation => ({
  id: LeadRotationId.makeUnsafe(`rotation:${replacementThreadId}`),
  leadSeatId: ids.leadSeatId,
  missionId: ids.missionId,
  predecessorThreadId: ids.leadThreadId,
  replacementThreadId,
  replacementProfileSnapshotId: ProfileSnapshotId.makeUnsafe(`snapshot:${replacementThreadId}`),
  state: "requested",
  error: null,
  createdAt,
  updatedAt: createdAt,
  revision: 0,
});

describe("LeadRotationReactor", () => {
  const disposers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const dispose of disposers.splice(0).reverse()) await dispose();
  });

  async function createFixture(startReactor: boolean) {
    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    );
    const layer = LeadRotationReactorLive.pipe(
      Layer.provideMerge(orchestrationLayer),
      Layer.provideMerge(
        ServerConfig.layerTest(process.cwd(), { prefix: "synara-lead-rotation-test-" }),
      ),
      Layer.provideMerge(NodeServices.layer),
      Layer.provideMerge(SqlitePersistenceMemory),
    );
    const runtime = ManagedRuntime.make(layer);
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const reactor = await runtime.runPromise(Effect.service(LeadRotationReactor));
    const governanceRepository = await runtime.runPromise(
      Effect.service(SupervisedGovernanceRepository),
    );
    const scope = await Effect.runPromise(Scope.make("sequential"));
    if (startReactor) {
      await Effect.runPromise(reactor.start.pipe(Scope.provide(scope)));
    }
    disposers.push(async () => {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      await runtime.dispose();
    });

    await runtime.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("command-create-lead-rotation-project"),
        projectId: ids.projectId,
        title: "Lead rotation project",
        workspaceRoot: "/tmp/project-lead-rotation",
        defaultModelSelection: { provider: "codex", model: "gpt-5.6-luna" },
        createdAt,
      }),
    );

    const supervisorPreset = DEFAULT_SUPERVISED_PROFILES.find((preset) =>
      preset.roleHints.includes("supervisor"),
    )!;
    const supervisorProfileSnapshot = resolveProfilePreset({
      preset: supervisorPreset,
      snapshotId: ProfileSnapshotId.makeUnsafe("snapshot-primary-supervisor-rotation"),
      createdAt,
    });
    await runtime.runPromise(
      engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("command-bootstrap-primary-supervisor-rotation"),
        threadId: ids.supervisorThreadId,
        message: {
          messageId: MessageId.makeUnsafe("message-bootstrap-primary-supervisor-rotation"),
          role: "user",
          text: "Supervise the bounded Lead replacement.",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        threadBootstrap: {
          projectId: ids.projectId,
          title: "Primary Supervisor",
          modelSelection: { provider: "codex", model: "gpt-5.6-luna" },
          runtimeMode: "full-access",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          envMode: "local",
          branch: null,
          worktreePath: null,
          workingDirectory: "/tmp/project-lead-rotation",
          createdAt,
        },
        supervisedBootstrap: {
          kind: "supervisor",
          profilePresetId: supervisorPreset.id,
          profileSnapshot: supervisorProfileSnapshot,
          supervisor: {
            id: ids.supervisorSeatId,
            name: "Primary Supervisor",
            activeThreadId: ids.supervisorThreadId,
            predecessorThreadIds: [],
            profileSnapshotId: supervisorProfileSnapshot.id,
            status: "active",
            createdAt,
            updatedAt: createdAt,
            archivedAt: null,
            revision: 0,
          },
          initialMission: {
            id: ids.missionId,
            supervisorSeatId: ids.supervisorSeatId,
            brief: "Replace the Project Lead without losing Root authority.",
            focus: "Lead replacement",
            scope: [{ kind: "project", projectId: ids.projectId }],
            grants: ["lead.replace"],
            endCondition: { kind: "manual" },
            status: "active",
            sourceMessageId: MessageId.makeUnsafe("message-bootstrap-primary-supervisor-rotation"),
            createdAt,
            updatedAt: createdAt,
            completedAt: null,
            revision: 0,
          },
        },
        createdAt,
      }),
    );

    const governanceAfterSupervisor = await runtime.runPromise(governanceRepository.getSnapshot());
    const supervisorSeat = governanceAfterSupervisor.agentSeats.find(
      (seat) => seat.id === ids.supervisorSeatId,
    )!;
    const leadPreset = DEFAULT_SUPERVISED_PROFILES.find((preset) =>
      preset.roleHints.includes("lead"),
    )!;
    const leadProfileSnapshot = resolveProfilePreset({
      preset: leadPreset,
      snapshotId: ProfileSnapshotId.makeUnsafe("snapshot-initial-lead-rotation"),
      createdAt,
    });
    await runtime.runPromise(
      engine.dispatch({
        type: "supervised.lead.create",
        commandId: CommandId.makeUnsafe("command-create-initial-lead-rotation"),
        aggregateId: ids.roomId,
        actor: {
          kind: "seat",
          actorId: ids.supervisorThreadId,
          seatId: ids.supervisorSeatId,
        },
        authorityReceiptId: supervisorSeat.authorityReceiptId,
        expectedRevision: 0,
        idempotencyKey: "create-initial-lead-rotation",
        createdAt,
        supervisorSeatId: ids.supervisorSeatId,
        leadSeatId: ids.leadSeatId,
        threadId: ids.leadThreadId,
        workingDirectory: "/tmp/project-lead-rotation",
        room: {
          id: ids.roomId,
          projectId: ids.projectId,
          title: "Project Lead Room",
          leadSeatId: ids.leadSeatId,
          status: "active",
          graphRevision: 0,
          revision: 0,
          createdAt,
          updatedAt: createdAt,
        },
        profilePresetId: leadPreset.id,
        profileSnapshot: leadProfileSnapshot,
      }),
    );

    return { runtime, engine, reactor, governanceRepository, leadPreset };
  }

  async function requestRotation(
    fixture: Awaited<ReturnType<typeof createFixture>>,
    rotation: LeadRotation,
    actorThreadId: ThreadId,
    commandIdValue: string,
  ) {
    const governance = await fixture.runtime.runPromise(fixture.governanceRepository.getSnapshot());
    const leadRevision = governance.agentSeats.find((seat) => seat.id === ids.leadSeatId)?.revision;
    if (leadRevision === undefined) throw new Error("Lead decision state is unavailable.");
    const replacementProfileSnapshot = resolveProfilePreset({
      preset: fixture.leadPreset,
      snapshotId: rotation.replacementProfileSnapshotId,
      createdAt,
    });
    return fixture.runtime.runPromise(
      fixture.engine.dispatch({
        type: "supervised.lead.replace",
        commandId: CommandId.makeUnsafe(commandIdValue),
        aggregateId: AGGREGATE_ID,
        actor: {
          kind: "thread",
          actorId: actorThreadId,
          threadId: actorThreadId,
        },
        expectedRevision: leadRevision,
        createdAt,
        rotation,
        profilePresetId: fixture.leadPreset.id,
        replacementProfileSnapshot,
      }),
    );
  }

  it("admits replacement only from the active Primary Supervisor mission", async () => {
    const fixture = await createFixture(false);
    const rotation = makeRotation(ThreadId.makeUnsafe("lead:replacement-authority"));
    const before = await fixture.runtime.runPromise(fixture.governanceRepository.getSnapshot());
    const beforeRoom = (
      await fixture.runtime.runPromise(fixture.engine.getReadModel())
    ).supervised.rooms.find((room) => room.id === ids.roomId);
    const beforeLease = before.rootLeases.find((lease) => lease.roomId === ids.roomId);

    await expect(
      requestRotation(fixture, rotation, ids.leadThreadId, "command-lead-cannot-replace-itself"),
    ).rejects.toThrow("active lead.replace mission grant is required");

    const afterRejected = await fixture.runtime.runPromise(
      fixture.governanceRepository.getSnapshot(),
    );
    const rejectedReadModel = await fixture.runtime.runPromise(fixture.engine.getReadModel());
    expect(afterRejected.orchestration.rotations).toEqual([]);
    expect(afterRejected.rootLeases.find((lease) => lease.roomId === ids.roomId)).toEqual(
      beforeLease,
    );
    expect(rejectedReadModel.supervised.rooms.find((room) => room.id === ids.roomId)).toEqual(
      beforeRoom,
    );
    expect(afterRejected.agentSeats.find((seat) => seat.id === ids.leadSeatId)?.threadId).toBe(
      ids.leadThreadId,
    );

    await requestRotation(
      fixture,
      rotation,
      ids.supervisorThreadId,
      "command-supervisor-requests-lead-replacement",
    );
    const afterSupervisor = await fixture.runtime.runPromise(
      fixture.governanceRepository.getSnapshot(),
    );
    expect(afterSupervisor.orchestration.rotations).toMatchObject([
      { id: rotation.id, state: "requested" },
    ]);
    expect(afterSupervisor.rootLeases.find((lease) => lease.roomId === ids.roomId)).toEqual(
      beforeLease,
    );
  });

  it("keeps old Root active across provider failure and completes one recovery", async () => {
    const fixture = await createFixture(true);
    const rotation = makeRotation(ThreadId.makeUnsafe("lead:replacement-failure-recovery"));
    const before = await fixture.runtime.runPromise(fixture.governanceRepository.getSnapshot());
    const initialLease = before.rootLeases.find((lease) => lease.roomId === ids.roomId)!;
    const initialRoom = (
      await fixture.runtime.runPromise(fixture.engine.getReadModel())
    ).supervised.rooms.find((room) => room.id === ids.roomId)!;

    await requestRotation(
      fixture,
      rotation,
      ids.supervisorThreadId,
      "command-supervisor-requests-failing-replacement",
    );
    await vi.waitFor(async () => {
      const readModel = await fixture.runtime.runPromise(fixture.engine.getReadModel());
      expect(
        readModel.supervisedOrchestration.rotations.find(
          (candidate) => candidate.id === rotation.id,
        )?.state,
      ).toBe("replacement_created");
      expect(
        readModel.threads.find((thread) => thread.id === rotation.replacementThreadId)?.session
          ?.status,
      ).toBe("starting");
    });
    const provisioningGovernance = await fixture.runtime.runPromise(
      fixture.governanceRepository.getSnapshot(),
    );
    expect(
      resolveProjectedSupervisedCaller({
        governance: provisioningGovernance,
        threadId: rotation.replacementThreadId,
      }),
    ).toBeUndefined();
    expect(
      resolveProjectedSupervisedCaller({
        governance: provisioningGovernance,
        threadId: ids.leadThreadId,
      })?.seatId,
    ).toBe(ids.leadSeatId);
    expect(
      resolveEffectiveCanonicalAuthority({
        governance: provisioningGovernance,
        seatId: ids.leadSeatId,
        at: createdAt,
      })?.seat.threadId,
    ).toBe(ids.leadThreadId);

    await fixture.runtime.runPromise(fixture.reactor.reconcileRotation(rotation.id));
    await fixture.runtime.runPromise(fixture.reactor.reconcileRotation(rotation.id));
    let events = await fixture.runtime.runPromise(
      Stream.runCollect(fixture.engine.readEvents(0)).pipe(
        Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)),
      ),
    );
    expect(
      events.filter(
        (event) =>
          event.aggregateId === rotation.replacementThreadId && event.type === "thread.created",
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.aggregateId === rotation.replacementThreadId &&
          event.type === "thread.message-sent" &&
          event.payload.messageId?.startsWith(`lead-rotation:${rotation.id}:bootstrap:`),
      ),
    ).toHaveLength(1);

    const failureAt = "2026-08-10T02:01:00.000Z";
    await fixture.runtime.runPromise(
      fixture.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("command-force-replacement-provider-failure"),
        threadId: rotation.replacementThreadId,
        session: {
          threadId: rotation.replacementThreadId,
          status: "error",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: "forced replacement provisioning failure",
          updatedAt: failureAt,
        },
        createdAt: failureAt,
      }),
    );
    await vi.waitFor(async () => {
      const readModel = await fixture.runtime.runPromise(fixture.engine.getReadModel());
      expect(
        readModel.supervisedOrchestration.rotations.find(
          (candidate) => candidate.id === rotation.id,
        ),
      ).toMatchObject({
        state: "failed",
        error: "forced replacement provisioning failure",
      });
    });

    const failedGovernance = await fixture.runtime.runPromise(
      fixture.governanceRepository.getSnapshot(),
    );
    const failedReadModel = await fixture.runtime.runPromise(fixture.engine.getReadModel());
    expect(failedReadModel.supervised.rooms.find((room) => room.id === ids.roomId)).toEqual(
      initialRoom,
    );
    expect(
      failedReadModel.threads.find((thread) => thread.id === ids.leadThreadId)?.deletedAt,
    ).toBeNull();
    expect(
      failedReadModel.threads
        .find((thread) => thread.id === ids.leadThreadId)
        ?.activities.some(
          (activity) =>
            activity.kind === "supervised.lead-replacement.failed" &&
            activity.payload.detail === "forced replacement provisioning failure",
        ),
    ).toBe(true);
    expect(failedGovernance.agentSeats.find((seat) => seat.id === ids.leadSeatId)).toMatchObject({
      threadId: ids.leadThreadId,
      lifecycleState: "active",
    });
    expect(
      resolveProjectedSupervisedCaller({
        governance: failedGovernance,
        threadId: rotation.replacementThreadId,
      }),
    ).toBeUndefined();
    expect(
      resolveProjectedSupervisedCaller({
        governance: failedGovernance,
        threadId: ids.leadThreadId,
      })?.seatId,
    ).toBe(ids.leadSeatId);
    expect(failedGovernance.rootLeases.find((lease) => lease.id === initialLease.id)).toEqual(
      initialLease,
    );
    const supervisor = failedGovernance.agentSeats.find(
      (seat) => seat.id === ids.supervisorSeatId,
    )!;
    expect(supervisor.threadId).toBe(ids.supervisorThreadId);
    expect(
      failedGovernance.authorityReceipts.find(
        (receipt) => receipt.id === supervisor.authorityReceiptId,
      )?.rootLeaseIds,
    ).toEqual([]);

    await fixture.runtime.runPromise(fixture.reactor.reconcileRotation(rotation.id));
    await fixture.runtime.runPromise(fixture.reactor.reconcileRotation(rotation.id));
    events = await fixture.runtime.runPromise(
      Stream.runCollect(fixture.engine.readEvents(0)).pipe(
        Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)),
      ),
    );
    expect(
      events.filter(
        (event) =>
          event.aggregateId === rotation.replacementThreadId && event.type === "thread.created",
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.aggregateId === rotation.replacementThreadId &&
          event.type === "thread.message-sent" &&
          event.payload.messageId?.startsWith(`lead-rotation:${rotation.id}:bootstrap:`),
      ),
    ).toHaveLength(1);
    expect(
      events.some(
        (event) =>
          event.type === "supervised.lead-replacement-failed" &&
          event.payload.rotation?.id === rotation.id,
      ),
    ).toBe(true);

    const readyAt = "2026-08-10T02:02:00.000Z";
    await fixture.runtime.runPromise(
      fixture.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("command-replacement-provider-recovers"),
        threadId: rotation.replacementThreadId,
        session: {
          threadId: rotation.replacementThreadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: readyAt,
        },
        createdAt: readyAt,
      }),
    );
    await vi.waitFor(async () => {
      const readModel = await fixture.runtime.runPromise(fixture.engine.getReadModel());
      expect(
        readModel.threads
          .filter((thread) => thread.id === rotation.replacementThreadId)[0]
          ?.messages.filter((message) =>
            message.id.startsWith(`lead-rotation:${rotation.id}:bootstrap:`),
          ),
      ).toHaveLength(2);
    });

    await fixture.runtime.runPromise(fixture.reactor.reconcileRotation(rotation.id));
    await fixture.runtime.runPromise(fixture.reactor.reconcileRotation(rotation.id));
    let recoveringReadModel = await fixture.runtime.runPromise(fixture.engine.getReadModel());
    expect(
      recoveringReadModel.threads
        .find((thread) => thread.id === rotation.replacementThreadId)
        ?.messages.filter((message) =>
          message.id.startsWith(`lead-rotation:${rotation.id}:bootstrap:`),
        ),
    ).toHaveLength(2);

    const replacementThread = recoveringReadModel.threads.find(
      (thread) => thread.id === rotation.replacementThreadId,
    )!;
    await fixture.runtime.runPromise(
      fixture.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.makeUnsafe("command-accept-replacement-handoff"),
        threadId: rotation.replacementThreadId,
        handoff: {
          ...replacementThread.handoff!,
          bootstrapStatus: "completed",
        },
      }),
    );
    const acceptedAt = "2026-08-10T02:03:00.000Z";
    await fixture.runtime.runPromise(
      fixture.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("command-replacement-ready-after-handoff"),
        threadId: rotation.replacementThreadId,
        session: {
          threadId: rotation.replacementThreadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: acceptedAt,
        },
        createdAt: acceptedAt,
      }),
    );
    await vi.waitFor(async () => {
      const readModel = await fixture.runtime.runPromise(fixture.engine.getReadModel());
      expect(
        readModel.supervisedOrchestration.rotations.find(
          (candidate) => candidate.id === rotation.id,
        )?.state,
      ).toBe("completed");
    });

    recoveringReadModel = await fixture.runtime.runPromise(fixture.engine.getReadModel());
    const completedGovernance = await fixture.runtime.runPromise(
      fixture.governanceRepository.getSnapshot(),
    );
    expect(completedGovernance.agentSeats.find((seat) => seat.id === ids.leadSeatId)).toMatchObject(
      {
        threadId: rotation.replacementThreadId,
        predecessorThreadIds: [ids.leadThreadId],
        lifecycleState: "active",
      },
    );
    expect(
      resolveProjectedSupervisedCaller({
        governance: completedGovernance,
        threadId: rotation.replacementThreadId,
      })?.seatId,
    ).toBe(ids.leadSeatId);
    expect(
      completedGovernance.rootLeases.find((lease) => lease.id === initialLease.id),
    ).toMatchObject({
      holderSeatId: ids.leadSeatId,
      roomId: ids.roomId,
      status: "active",
    });
    expect(
      recoveringReadModel.supervised.rooms.find((room) => room.id === ids.roomId)?.leadSeatId,
    ).toBe(ids.leadSeatId);
    expect(
      completedGovernance.agentSeats.find((seat) => seat.id === ids.supervisorSeatId)?.threadId,
    ).toBe(ids.supervisorThreadId);
  });
});
