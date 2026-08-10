import {
  AssignmentId,
  CheckpointRef,
  CommandId,
  ContextBundleId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_SUPERVISED_RUN_POLICY,
  EvidenceId,
  InterventionId,
  LeadNotificationId,
  LeadRotationId,
  LeadSeatId,
  MessageId,
  ProfileSnapshotId,
  PeerSpecialtyId,
  ProjectId,
  ProjectTaskId,
  RoomId,
  ReconciliationId,
  RunId,
  RunPolicyId,
  SupervisorSeatId,
  SupervisionMissionId,
  TaskId,
  TaskNodeId,
  TaskNodeRevisionId,
  TaskProcessId,
  TaskProgressEntryId,
  TaskThreadBindingId,
  ThreadId,
  TurnId,
  WorkClaimId,
  type OrchestrationCommand,
  type OrchestrationEvent,
} from "@synara/contracts";
import { Effect, Layer, ManagedRuntime, Option, Queue, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import { PersistenceSqlError } from "../../persistence/Errors.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import {
  OrchestrationEventStore,
  type OrchestrationEventStoreShape,
} from "../../persistence/Services/OrchestrationEventStore.ts";
import { ManagedAttachmentRepository } from "../../persistence/Services/ManagedAttachments.ts";
import { SupervisedGovernanceRepository } from "../../persistence/Services/SupervisedGovernanceRepository.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  OrchestrationProjectionPipeline,
  type OrchestrationProjectionPipelineShape,
} from "../Services/ProjectionPipeline.ts";
import { ServerConfig } from "../../config.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { DEFAULT_SUPERVISED_PROFILES } from "../supervised/profileSeeds.ts";
import { resolveProfilePreset } from "../supervised/profileResolver.ts";

/**
 * Command ids whose fingerprinting throws synchronously, standing in for any
 * synchronous defect raised while the worker builds a command's pipeline.
 */
const fingerprintPoison = vi.hoisted(() => new Set<string>());

vi.mock("../commandFingerprint.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../commandFingerprint.ts")>();
  return {
    ...actual,
    fingerprintOrchestrationCommand: (command: OrchestrationCommand) => {
      if (fingerprintPoison.has(command.commandId)) {
        throw new TypeError("poisoned command fingerprint");
      }
      return actual.fingerprintOrchestrationCommand(command);
    },
  };
});

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);
const asMessageId = (value: string): MessageId => MessageId.makeUnsafe(value);

const makeThreadEventReadMethods = (
  events: ReadonlyArray<OrchestrationEvent>,
): Pick<
  OrchestrationEventStoreShape,
  | "getThreadHighWaterSequence"
  | "readThreadEvents"
  | "getAggregateHighWaterSequence"
  | "readAggregateEvents"
  | "readAggregateEventPage"
> => ({
  getThreadHighWaterSequence: (threadId) =>
    Effect.succeed(
      events
        .filter((event) => event.aggregateKind === "thread" && event.aggregateId === threadId)
        .at(-1)?.sequence ?? 0,
    ),
  readThreadEvents: (input) =>
    Effect.succeed(
      events
        .filter(
          (event) =>
            event.aggregateKind === "thread" &&
            event.aggregateId === input.threadId &&
            event.sequence <= input.throughSequenceInclusive &&
            event.sequence < (input.beforeSequenceExclusive ?? Number.MAX_SAFE_INTEGER) &&
            (input.eventTypes === undefined || input.eventTypes.includes(event.type)),
        )
        .toSorted((left, right) => right.sequence - left.sequence)
        .slice(0, input.limit),
    ),
  getAggregateHighWaterSequence: (input) =>
    Effect.succeed(
      events
        .filter(
          (event) =>
            event.aggregateKind === input.aggregateKind && event.aggregateId === input.aggregateId,
        )
        .at(-1)?.sequence ?? 0,
    ),
  readAggregateEvents: (input) =>
    Effect.succeed(
      events.filter(
        (event) =>
          event.aggregateKind === input.aggregateKind && event.aggregateId === input.aggregateId,
      ),
    ),
  readAggregateEventPage: (input) =>
    Effect.succeed(
      events
        .filter(
          (event) =>
            event.aggregateKind === input.aggregateKind &&
            event.aggregateId === input.aggregateId &&
            event.sequence < (input.beforeSequenceExclusive ?? Number.MAX_SAFE_INTEGER),
        )
        .toSorted((left, right) => right.sequence - left.sequence)
        .slice(0, input.limit),
    ),
});
const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value);
const asCheckpointRef = (value: string): CheckpointRef => CheckpointRef.makeUnsafe(value);

const TestServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "synara-orchestration-engine-test-",
});

async function createOrchestrationSystem() {
  const ServerConfigLayer = TestServerConfigLayer;
  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(SqlitePersistenceMemory),
    Layer.provideMerge(ServerConfigLayer),
    Layer.provideMerge(NodeServices.layer),
  );
  const runtime = ManagedRuntime.make(orchestrationLayer);
  const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
  const managedAttachmentRepository = await runtime.runPromise(
    Effect.service(ManagedAttachmentRepository),
  );
  const supervisedGovernanceRepository = await runtime.runPromise(
    Effect.service(SupervisedGovernanceRepository),
  );
  return {
    engine,
    managedAttachmentRepository,
    supervisedGovernanceRepository,
    run: <A, E>(effect: Effect.Effect<A, E>) => runtime.runPromise(effect),
    dispose: () => runtime.dispose(),
  };
}

function now() {
  return new Date().toISOString();
}

describe("OrchestrationEngine", () => {
  it("serializes TaskProcess graph mutations and rejects stale revisions", async () => {
    const system = await createOrchestrationSystem();
    const createdAt = "2026-08-01T00:00:00.000Z";
    const projectId = asProjectId("project-task-process-engine");
    const processId = TaskProcessId.makeUnsafe("process-engine");
    await system.run(
      system.engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-task-process-project"),
        projectId,
        title: "Task process project",
        workspaceRoot: "/tmp/project-task-process-engine",
        defaultModelSelection: null,
        createdAt,
      }),
    );
    await system.run(
      system.engine.dispatch({
        type: "task-process.create",
        commandId: CommandId.makeUnsafe("cmd-task-process-create"),
        processId,
        projectId,
        actor: { kind: "user", actorId: "owner" },
        expectedRevision: 0,
        createdAt,
        title: "Process",
        owner: { kind: "user" },
      }),
    );
    await expect(
      system.run(
        system.engine.dispatch({
          type: "project-task.create",
          commandId: CommandId.makeUnsafe("cmd-task-process-stale"),
          processId,
          projectId,
          actor: { kind: "user", actorId: "owner" },
          expectedRevision: 0,
          createdAt,
          taskId: ProjectTaskId.makeUnsafe("task-stale"),
          parentTaskId: null,
          title: "Stale",
          description: null,
          acceptanceCriteria: [],
          priority: "normal",
          risk: "medium",
          orderKey: "a",
        }),
      ),
    ).rejects.toMatchObject({ _tag: "OrchestrationCommandInvariantError" });
    const accepted = await system.run(
      system.engine.dispatch({
        type: "project-task.create",
        commandId: CommandId.makeUnsafe("cmd-task-process-task"),
        processId,
        projectId,
        actor: { kind: "user", actorId: "owner" },
        expectedRevision: 1,
        createdAt,
        taskId: ProjectTaskId.makeUnsafe("task-engine"),
        parentTaskId: null,
        title: "Task",
        description: null,
        acceptanceCriteria: [],
        priority: "normal",
        risk: "medium",
        orderKey: "a",
      }),
    );
    expect(accepted.sequence).toBeGreaterThan(0);
    const events = Array.from(await system.run(Stream.runCollect(system.engine.readEvents(0))));
    expect(events.filter((event) => event.aggregateKind === "task_process")).toHaveLength(2);
    await system.dispose();
  });

  it("quiesces normal admission while draining reserved lifecycle commands", async () => {
    const system = await createOrchestrationSystem();
    const createdAt = now();
    const threadId = ThreadId.makeUnsafe("thread-engine-quiesce");

    await system.run(
      system.engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-engine-quiesce-project"),
        projectId: asProjectId("project-engine-quiesce"),
        title: "Engine quiesce",
        workspaceRoot: "/tmp/engine-quiesce",
        defaultModelSelection: null,
        createdAt,
      }),
    );
    await system.run(
      system.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-engine-quiesce-thread"),
        threadId,
        projectId: asProjectId("project-engine-quiesce"),
        title: "Engine quiesce thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );

    await system.run(system.engine.quiesce);
    await expect(
      system.run(
        system.engine.dispatch({
          type: "thread.meta.update",
          commandId: CommandId.makeUnsafe("cmd-engine-quiesce-normal"),
          threadId,
          title: "Rejected after quiesce",
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OrchestrationCommandAdmissionError",
      reason: "stopped",
    });

    // A turn start takes the priority `user` lane, but priority is not
    // admissibility: the WebSocket keeps serving while the engine quiesces, and
    // starting a provider turn here would spawn a session the shutdown fences
    // moments later, orphaning the turn.
    await expect(
      system.run(
        system.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.makeUnsafe("cmd-engine-quiesce-turn-start"),
          threadId,
          message: {
            messageId: MessageId.makeUnsafe("msg-engine-quiesce-turn-start"),
            role: "user",
            text: "Rejected after quiesce",
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt,
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OrchestrationCommandAdmissionError",
      reason: "stopped",
    });

    await expect(
      system.run(
        system.engine.dispatch({
          type: "thread.session.stop",
          commandId: CommandId.makeUnsafe("cmd-engine-quiesce-control"),
          threadId,
          createdAt,
        }),
      ),
    ).resolves.toMatchObject({ sequence: expect.any(Number) });
    await system.run(system.engine.drain);
    await system.run(system.engine.stop);

    await expect(
      system.run(
        system.engine.dispatch({
          type: "thread.turn.interrupt",
          commandId: CommandId.makeUnsafe("cmd-engine-stopped-control"),
          threadId,
          createdAt,
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OrchestrationCommandAdmissionError",
      reason: "stopped",
    });

    await system.dispose();
  });

  it("returns the original result for an equal retry and rejects unequal command-ID reuse", async () => {
    const system = await createOrchestrationSystem();
    const command = {
      type: "project.create" as const,
      commandId: CommandId.makeUnsafe("cmd-fingerprint-retry"),
      projectId: asProjectId("project-fingerprint-retry"),
      title: "Fingerprint project",
      workspaceRoot: "/tmp/project-fingerprint-retry",
      defaultModelSelection: null,
      createdAt: "2026-07-14T00:00:00.000Z",
    };

    const first = await system.run(system.engine.dispatch(command));
    await expect(system.run(system.engine.dispatch({ ...command }))).resolves.toEqual(first);
    await expect(
      system.run(
        system.engine.dispatch({
          ...command,
          title: "Different command content",
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OrchestrationCommandIdentityCollisionError",
      commandId: command.commandId,
    });

    const events = await system.run(Stream.runCollect(system.engine.readEvents(0)));
    expect(
      Array.from(events).filter((event) => event.commandId === command.commandId),
    ).toHaveLength(1);
    await system.dispose();
  });

  it("returns deterministic read models for repeated reads", async () => {
    const createdAt = now();
    const system = await createOrchestrationSystem();
    const { engine } = system;

    await system.run(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-1-create"),
        projectId: asProjectId("project-1"),
        title: "Project 1",
        workspaceRoot: "/tmp/project-1",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        createdAt,
      }),
    );
    await system.run(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-1-create"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        projectId: asProjectId("project-1"),
        title: "Thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );
    await system.run(
      engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-1"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        message: {
          messageId: asMessageId("msg-1"),
          role: "user",
          text: "hello",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt,
      }),
    );

    const readModelA = await system.run(engine.getReadModel());
    const readModelB = await system.run(engine.getReadModel());
    expect(readModelB).toEqual(readModelA);
    await system.dispose();
  });

  it("returns the original sequence for equal retries and rejects unequal command-id reuse", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;
    const command = {
      type: "project.create" as const,
      commandId: CommandId.makeUnsafe("cmd-project-command-identity"),
      projectId: asProjectId("project-command-identity"),
      title: "Original identity",
      workspaceRoot: "/tmp/project-command-identity",
      defaultModelSelection: null,
      createdAt: now(),
    };

    const accepted = await system.run(engine.dispatch(command));
    await expect(system.run(engine.dispatch(command))).resolves.toEqual(accepted);
    await expect(
      system.run(engine.dispatch({ ...command, title: "Different identity" })),
    ).rejects.toThrow("Command identity collision");

    const events = await system.run(
      Stream.runCollect(engine.readEvents(0)).pipe(Effect.map((chunk) => Array.from(chunk))),
    );
    expect(events).toHaveLength(1);
    expect((await system.run(engine.getReadModel())).projects[0]?.title).toBe("Original identity");
    await system.dispose();
  });

  it("claims managed attachments atomically and rejects attachment changes on an accepted retry", async () => {
    const createdAt = now();
    const system = await createOrchestrationSystem();
    const { engine } = system;
    const threadId = ThreadId.makeUnsafe("thread-managed-attachment");
    const commandId = CommandId.makeUnsafe("cmd-managed-attachment-turn");
    const messageId = asMessageId("msg-managed-attachment");
    const principal = { ownerKind: "session" as const, ownerId: "session-a" };

    await system.run(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-managed-attachment-project"),
        projectId: asProjectId("project-managed-attachment"),
        title: "Managed attachment project",
        workspaceRoot: "/tmp/project-managed-attachment",
        defaultModelSelection: { provider: "codex", model: "gpt-5-codex" },
        createdAt,
      }),
    );
    await system.run(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-managed-attachment-thread"),
        threadId,
        projectId: asProjectId("project-managed-attachment"),
        title: "Managed attachment thread",
        modelSelection: { provider: "codex", model: "gpt-5-codex" },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );

    const repository = system.managedAttachmentRepository;
    const stage = async (attachmentId: string) => {
      const reserved = await system.run(
        repository.reserve({
          attachmentId,
          ownerThreadId: threadId,
          ownerKind: principal.ownerKind,
          ownerId: principal.ownerId,
          kind: "image",
          originalName: `${attachmentId}.png`,
          mimeType: "image/png",
          reservedBytes: 1,
          relativePath: `objects/aa/${attachmentId}.png`,
          now: createdAt,
        }),
      );
      expect(reserved.status).toBe("reserved");
      await system.run(
        repository.finalizeStaged({
          attachmentId,
          ownerThreadId: threadId,
          ownerKind: principal.ownerKind,
          ownerId: principal.ownerId,
          sizeBytes: 1,
          sha256: "a".repeat(64),
          stagingExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          now: createdAt,
        }),
      );
    };
    const firstAttachmentId = "att_v2_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const secondAttachmentId = "att_v2_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    await stage(firstAttachmentId);
    await stage(secondAttachmentId);

    const command = {
      type: "thread.turn.start" as const,
      commandId,
      threadId,
      message: {
        messageId,
        role: "user" as const,
        text: "inspect",
        attachments: [
          {
            type: "image" as const,
            id: firstAttachmentId,
            name: "client-value-is-not-authoritative.png",
            mimeType: "image/png",
            sizeBytes: 1,
          },
        ],
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required" as const,
      createdAt,
    };
    const accepted = await system.run(engine.dispatch(command, { attachmentPrincipal: principal }));
    await expect(
      system.run(engine.dispatch(command, { attachmentPrincipal: principal })),
    ).resolves.toEqual(accepted);

    const editResendClaim = await system.run(
      repository.claimForAcceptedTurn({
        attachmentIds: [firstAttachmentId],
        ownerThreadId: threadId,
        ownerKind: principal.ownerKind,
        ownerId: principal.ownerId,
        commandId: "cmd-attachment-edit-resend",
        messageId,
        now: new Date().toISOString(),
      }),
    );
    expect(editResendClaim.status).toBe("claimed");
    await expect(
      system.run(engine.dispatch(command, { attachmentPrincipal: principal })),
    ).resolves.toEqual(accepted);

    await expect(
      system.run(
        engine.dispatch(
          {
            ...command,
            message: {
              ...command.message,
              attachments: [{ ...command.message.attachments[0]!, id: secondAttachmentId }],
            },
          },
          { attachmentPrincipal: principal },
        ),
      ),
    ).rejects.toThrow("Command identity collision");

    const claimed = await system.run(repository.findClaimedForCommand({ commandId }));
    expect(claimed.map((attachment) => attachment.attachmentId)).toEqual([firstAttachmentId]);
    await system.dispose();
  });

  it("replays append-only events from sequence", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;
    const createdAt = now();

    await system.run(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-replay-create"),
        projectId: asProjectId("project-replay"),
        title: "Replay Project",
        workspaceRoot: "/tmp/project-replay",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        createdAt,
      }),
    );
    await system.run(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-replay-create"),
        threadId: ThreadId.makeUnsafe("thread-replay"),
        projectId: asProjectId("project-replay"),
        title: "replay",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );
    await system.run(
      engine.dispatch({
        type: "thread.delete",
        commandId: CommandId.makeUnsafe("cmd-thread-replay-delete"),
        threadId: ThreadId.makeUnsafe("thread-replay"),
      }),
    );

    const events = await system.run(
      Stream.runCollect(engine.readEvents(0)).pipe(
        Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)),
      ),
    );
    expect(events.map((event) => event.type)).toEqual([
      "project.created",
      "thread.created",
      "thread.deleted",
    ]);
    await system.dispose();
  });

  it("streams persisted domain events in order", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;
    const createdAt = now();

    await system.run(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-stream-create"),
        projectId: asProjectId("project-stream"),
        title: "Stream Project",
        workspaceRoot: "/tmp/project-stream",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        createdAt,
      }),
    );

    const eventTypes: string[] = [];
    await system.run(
      Effect.gen(function* () {
        const eventQueue = yield* Queue.unbounded<OrchestrationEvent>();
        yield* Effect.forkScoped(
          Stream.take(engine.streamDomainEvents, 2).pipe(
            Stream.runForEach((event) => Queue.offer(eventQueue, event).pipe(Effect.asVoid)),
          ),
        );
        yield* Effect.sleep("10 millis");
        yield* engine.dispatch({
          type: "thread.create",
          commandId: CommandId.makeUnsafe("cmd-stream-thread-create"),
          threadId: ThreadId.makeUnsafe("thread-stream"),
          projectId: asProjectId("project-stream"),
          title: "domain-stream",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt,
        });
        yield* engine.dispatch({
          type: "thread.meta.update",
          commandId: CommandId.makeUnsafe("cmd-stream-thread-update"),
          threadId: ThreadId.makeUnsafe("thread-stream"),
          title: "domain-stream-updated",
        });
        eventTypes.push((yield* Queue.take(eventQueue)).type);
        eventTypes.push((yield* Queue.take(eventQueue)).type);
      }).pipe(Effect.scoped),
    );

    expect(eventTypes).toEqual(["thread.created", "thread.meta-updated"]);
    await system.dispose();
  });

  it("stores completed checkpoint summaries even when no files changed", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;
    const createdAt = now();

    await system.run(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-turn-diff-create"),
        projectId: asProjectId("project-turn-diff"),
        title: "Turn Diff Project",
        workspaceRoot: "/tmp/project-turn-diff",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        createdAt,
      }),
    );
    await system.run(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-turn-diff-create"),
        threadId: ThreadId.makeUnsafe("thread-turn-diff"),
        projectId: asProjectId("project-turn-diff"),
        title: "Turn diff thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );
    await system.run(
      engine.dispatch({
        type: "thread.turn.diff.complete",
        commandId: CommandId.makeUnsafe("cmd-turn-diff-complete"),
        threadId: ThreadId.makeUnsafe("thread-turn-diff"),
        turnId: asTurnId("turn-1"),
        completedAt: createdAt,
        checkpointRef: asCheckpointRef("refs/synara/checkpoints/thread-turn-diff/turn/1"),
        status: "ready",
        files: [],
        checkpointTurnCount: 1,
        createdAt,
      }),
    );

    const thread = (await system.run(engine.getReadModel())).threads.find(
      (entry) => entry.id === "thread-turn-diff",
    );
    expect(thread?.checkpoints).toEqual([
      {
        turnId: asTurnId("turn-1"),
        checkpointTurnCount: 1,
        checkpointRef: asCheckpointRef("refs/synara/checkpoints/thread-turn-diff/turn/1"),
        status: "ready",
        files: [],
        assistantMessageId: null,
        completedAt: createdAt,
      },
    ]);
    await system.dispose();
  });

  it("keeps processing queued commands after a storage failure", async () => {
    type StoredEvent =
      ReturnType<OrchestrationEventStoreShape["append"]> extends Effect.Effect<infer A, any, any>
        ? A
        : never;
    const events: StoredEvent[] = [];
    let nextSequence = 1;
    let shouldFailFirstAppend = true;

    const flakyStore: OrchestrationEventStoreShape = {
      append(event) {
        if (shouldFailFirstAppend && event.commandId === CommandId.makeUnsafe("cmd-flaky-1")) {
          shouldFailFirstAppend = false;
          return Effect.fail(
            new PersistenceSqlError({
              operation: "test.append",
              detail: "append failed",
            }),
          );
        }
        const savedEvent = {
          ...event,
          sequence: nextSequence,
        } as StoredEvent;
        nextSequence += 1;
        events.push(savedEvent);
        return Effect.succeed(savedEvent);
      },
      getHighWaterSequence() {
        return Effect.succeed(events.at(-1)?.sequence ?? 0);
      },
      ...makeThreadEventReadMethods(events),
      readFromSequence(sequenceExclusive) {
        return Stream.fromIterable(events.filter((event) => event.sequence > sequenceExclusive));
      },
      readAll() {
        return Stream.fromIterable(events);
      },
    };

    const runtime = ManagedRuntime.make(
      OrchestrationEngineLive.pipe(
        Layer.provide(OrchestrationProjectionPipelineLive),
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(Layer.succeed(OrchestrationEventStore, flakyStore)),
        Layer.provide(OrchestrationCommandReceiptRepositoryLive),
        Layer.provide(SqlitePersistenceMemory),
        Layer.provideMerge(TestServerConfigLayer),
        Layer.provideMerge(NodeServices.layer),
      ),
    );
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const createdAt = now();

    await runtime.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-flaky-create"),
        projectId: asProjectId("project-flaky"),
        title: "Flaky Project",
        workspaceRoot: "/tmp/project-flaky",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        createdAt,
      }),
    );

    await expect(
      runtime.runPromise(
        engine.dispatch({
          type: "thread.create",
          commandId: CommandId.makeUnsafe("cmd-flaky-1"),
          threadId: ThreadId.makeUnsafe("thread-flaky-fail"),
          projectId: asProjectId("project-flaky"),
          title: "flaky-fail",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt,
        }),
      ),
    ).rejects.toThrow("failed unexpectedly");

    const result = await runtime.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-flaky-2"),
        threadId: ThreadId.makeUnsafe("thread-flaky-ok"),
        projectId: asProjectId("project-flaky"),
        title: "flaky-ok",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );

    expect(result.sequence).toBe(2);
    expect((await runtime.runPromise(engine.getReadModel())).snapshotSequence).toBe(2);
    await runtime.dispose();
  });

  it("rolls back all events for a multi-event command when projection fails mid-dispatch", async () => {
    let shouldFailRequestedProjection = true;
    const flakyProjectionPipeline: OrchestrationProjectionPipelineShape = {
      bootstrap: Effect.void,
      projectMetadataEvent: () => Effect.void,
      projectEvent: () => Effect.void,
      projectHotEventInCurrentTransaction: (event) => {
        if (
          shouldFailRequestedProjection &&
          event.commandId === CommandId.makeUnsafe("cmd-turn-start-atomic") &&
          event.type === "thread.turn-start-requested"
        ) {
          shouldFailRequestedProjection = false;
          return Effect.fail(
            new PersistenceSqlError({
              operation: "test.projection",
              detail: "projection failed",
            }),
          );
        }
        return Effect.void;
      },
      projectDeferredEvent: () => Effect.void,
    };

    const runtime = ManagedRuntime.make(
      OrchestrationEngineLive.pipe(
        Layer.provide(Layer.succeed(OrchestrationProjectionPipeline, flakyProjectionPipeline)),
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(OrchestrationEventStoreLive),
        Layer.provide(OrchestrationCommandReceiptRepositoryLive),
        Layer.provide(SqlitePersistenceMemory),
        Layer.provideMerge(TestServerConfigLayer),
        Layer.provideMerge(NodeServices.layer),
      ),
    );
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const createdAt = now();

    await runtime.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-atomic-create"),
        projectId: asProjectId("project-atomic"),
        title: "Atomic Project",
        workspaceRoot: "/tmp/project-atomic",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        createdAt,
      }),
    );
    await runtime.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-atomic-create"),
        threadId: ThreadId.makeUnsafe("thread-atomic"),
        projectId: asProjectId("project-atomic"),
        title: "atomic",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );

    const turnStartCommand = {
      type: "thread.turn.start" as const,
      commandId: CommandId.makeUnsafe("cmd-turn-start-atomic"),
      threadId: ThreadId.makeUnsafe("thread-atomic"),
      message: {
        messageId: asMessageId("msg-atomic-1"),
        role: "user" as const,
        text: "hello",
        attachments: [],
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required" as const,
      createdAt,
    };

    await expect(runtime.runPromise(engine.dispatch(turnStartCommand))).rejects.toThrow(
      "failed unexpectedly",
    );

    const eventsAfterFailure = await runtime.runPromise(
      Stream.runCollect(engine.readEvents(0)).pipe(
        Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)),
      ),
    );
    expect(eventsAfterFailure.map((event) => event.type)).toEqual([
      "project.created",
      "thread.created",
    ]);
    expect((await runtime.runPromise(engine.getReadModel())).snapshotSequence).toBe(2);

    const retryResult = await runtime.runPromise(engine.dispatch(turnStartCommand));
    expect(retryResult.sequence).toBe(4);

    const eventsAfterRetry = await runtime.runPromise(
      Stream.runCollect(engine.readEvents(0)).pipe(
        Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)),
      ),
    );
    expect(eventsAfterRetry.map((event) => event.type)).toEqual([
      "project.created",
      "thread.created",
      "thread.message-sent",
      "thread.turn-start-requested",
    ]);
    expect(
      eventsAfterRetry.filter((event) => event.commandId === turnStartCommand.commandId),
    ).toHaveLength(2);

    await runtime.dispose();
  });

  it("keeps processing later commands after an unexpected worker defect", async () => {
    type StoredEvent =
      ReturnType<OrchestrationEventStoreShape["append"]> extends Effect.Effect<infer A, any, any>
        ? A
        : never;
    const events: StoredEvent[] = [];
    let nextSequence = 1;

    const nonTransactionalStore: OrchestrationEventStoreShape = {
      append(event) {
        const savedEvent = {
          ...event,
          sequence: nextSequence,
        } as StoredEvent;
        nextSequence += 1;
        events.push(savedEvent);
        return Effect.succeed(savedEvent);
      },
      getHighWaterSequence() {
        return Effect.succeed(events.at(-1)?.sequence ?? 0);
      },
      ...makeThreadEventReadMethods(events),
      readFromSequence(sequenceExclusive) {
        return Stream.fromIterable(events.filter((event) => event.sequence > sequenceExclusive));
      },
      readAll() {
        return Stream.fromIterable(events);
      },
    };

    let shouldDieProjection = true;
    const defectiveProjectionPipeline: OrchestrationProjectionPipelineShape = {
      bootstrap: Effect.void,
      projectMetadataEvent: (event) => {
        if (
          shouldDieProjection &&
          event.commandId === CommandId.makeUnsafe("cmd-project-defect-1")
        ) {
          shouldDieProjection = false;
          return Effect.die("projection defect");
        }
        return Effect.void;
      },
      projectEvent: () => Effect.void,
      projectHotEventInCurrentTransaction: () => Effect.void,
      projectDeferredEvent: () => Effect.void,
    };

    const runtime = ManagedRuntime.make(
      OrchestrationEngineLive.pipe(
        Layer.provide(Layer.succeed(OrchestrationProjectionPipeline, defectiveProjectionPipeline)),
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(Layer.succeed(OrchestrationEventStore, nonTransactionalStore)),
        Layer.provide(OrchestrationCommandReceiptRepositoryLive),
        Layer.provide(SqlitePersistenceMemory),
        Layer.provideMerge(TestServerConfigLayer),
        Layer.provideMerge(NodeServices.layer),
      ),
    );
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const createdAt = now();

    await expect(
      runtime.runPromise(
        engine.dispatch({
          type: "project.create",
          commandId: CommandId.makeUnsafe("cmd-project-defect-1"),
          projectId: asProjectId("project-defect-1"),
          title: "Defective Project",
          workspaceRoot: "/tmp/project-defect-1",
          defaultModelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          createdAt,
        }),
      ),
    ).rejects.toThrow("failed unexpectedly");

    await expect(
      runtime.runPromise(
        engine.dispatch({
          type: "project.create",
          commandId: CommandId.makeUnsafe("cmd-project-defect-2"),
          projectId: asProjectId("project-defect-2"),
          title: "Recovered Project",
          workspaceRoot: "/tmp/project-defect-2",
          defaultModelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          createdAt,
        }),
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        sequence: expect.any(Number),
      }),
    );

    const eventsAfterRecovery = await runtime.runPromise(
      Stream.runCollect(engine.readEvents(0)).pipe(
        Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)),
      ),
    );
    expect(eventsAfterRecovery.map((event) => event.commandId)).toEqual([
      CommandId.makeUnsafe("cmd-project-defect-1"),
      CommandId.makeUnsafe("cmd-project-defect-2"),
    ]);
    expect(eventsAfterRecovery.every((event) => event.type === "project.created")).toBe(true);

    await runtime.dispose();
  });

  it("reconciles in-memory state when append persists but projection fails", async () => {
    type StoredEvent =
      ReturnType<OrchestrationEventStoreShape["append"]> extends Effect.Effect<infer A, any, any>
        ? A
        : never;
    const events: StoredEvent[] = [];
    let nextSequence = 1;

    const nonTransactionalStore: OrchestrationEventStoreShape = {
      append(event) {
        const savedEvent = {
          ...event,
          sequence: nextSequence,
        } as StoredEvent;
        nextSequence += 1;
        events.push(savedEvent);
        return Effect.succeed(savedEvent);
      },
      getHighWaterSequence() {
        return Effect.succeed(events.at(-1)?.sequence ?? 0);
      },
      ...makeThreadEventReadMethods(events),
      readFromSequence(sequenceExclusive) {
        return Stream.fromIterable(events.filter((event) => event.sequence > sequenceExclusive));
      },
      readAll() {
        return Stream.fromIterable(events);
      },
    };

    let shouldFailProjection = true;
    const flakyProjectionPipeline: OrchestrationProjectionPipelineShape = {
      bootstrap: Effect.void,
      projectMetadataEvent: () => Effect.void,
      projectEvent: () => Effect.void,
      projectHotEventInCurrentTransaction: (event) => {
        if (
          shouldFailProjection &&
          event.commandId === CommandId.makeUnsafe("cmd-thread-meta-sync-fail")
        ) {
          shouldFailProjection = false;
          return Effect.fail(
            new PersistenceSqlError({
              operation: "test.projection",
              detail: "projection failed",
            }),
          );
        }
        return Effect.void;
      },
      projectDeferredEvent: () => Effect.void,
    };

    const runtime = ManagedRuntime.make(
      OrchestrationEngineLive.pipe(
        Layer.provide(Layer.succeed(OrchestrationProjectionPipeline, flakyProjectionPipeline)),
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(Layer.succeed(OrchestrationEventStore, nonTransactionalStore)),
        Layer.provide(OrchestrationCommandReceiptRepositoryLive),
        Layer.provide(SqlitePersistenceMemory),
        Layer.provideMerge(TestServerConfigLayer),
        Layer.provideMerge(NodeServices.layer),
      ),
    );
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const createdAt = now();

    await runtime.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-sync-create"),
        projectId: asProjectId("project-sync"),
        title: "Sync Project",
        workspaceRoot: "/tmp/project-sync",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        createdAt,
      }),
    );
    await runtime.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-sync-create"),
        threadId: ThreadId.makeUnsafe("thread-sync"),
        projectId: asProjectId("project-sync"),
        title: "sync-before",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );

    await expect(
      runtime.runPromise(
        engine.dispatch({
          type: "thread.meta.update",
          commandId: CommandId.makeUnsafe("cmd-thread-meta-sync-fail"),
          threadId: ThreadId.makeUnsafe("thread-sync"),
          title: "sync-after-failed-projection",
        }),
      ),
    ).rejects.toThrow("failed unexpectedly");

    const readModelAfterFailure = await runtime.runPromise(engine.getReadModel());
    const updatedThread = readModelAfterFailure.threads.find(
      (thread) => thread.id === "thread-sync",
    );
    expect(readModelAfterFailure.snapshotSequence).toBe(3);
    expect(updatedThread?.title).toBe("sync-after-failed-projection");

    await runtime.dispose();
  });

  it("fails command dispatch when command invariants are violated", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;

    await expect(
      system.run(
        engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.makeUnsafe("cmd-invariant-missing-thread"),
          threadId: ThreadId.makeUnsafe("thread-missing"),
          message: {
            messageId: asMessageId("msg-missing"),
            role: "user",
            text: "hello",
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt: now(),
        }),
      ),
    ).rejects.toThrow("Thread 'thread-missing' does not exist");

    await system.dispose();
  });

  it("owns Lead Room activation in the turn and provider-session transactions", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;
    const createdAt = "2026-08-09T00:00:00.000Z";
    const projectId = asProjectId("project-supervised-activation");
    const threadId = ThreadId.makeUnsafe("thread-supervised-activation");
    const leadSeatId = LeadSeatId.makeUnsafe("lead-supervised-activation");
    const preset = DEFAULT_SUPERVISED_PROFILES.find(
      (candidate) => candidate.id === "profile-lead-default",
    )!;
    const profileSnapshotId = ProfileSnapshotId.makeUnsafe("profile-snapshot-activation");
    const profileSnapshot = resolveProfilePreset({
      preset,
      snapshotId: profileSnapshotId,
      createdAt,
    });
    await system.run(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("command-project-supervised-activation"),
        projectId,
        title: "Supervised activation",
        workspaceRoot: "/tmp/project-supervised-activation",
        defaultModelSelection: { provider: "codex", model: "gpt-5.6-sol" },
        createdAt,
      }),
    );
    await system.run(
      engine.dispatch({
        type: "supervised.room.create",
        commandId: CommandId.makeUnsafe("command-room-supervised-activation"),
        actor: { kind: "user", actorId: "owner" },
        aggregateId: threadId,
        expectedRevision: 0,
        idempotencyKey: "room-supervised-activation",
        createdAt,
        room: {
          id: threadId,
          projectId,
          title: "Lead Room",
          leadSeatId: null,
          status: "draft",
          graphRevision: 0,
          revision: 0,
          createdAt,
          updatedAt: createdAt,
        },
      }),
    );
    await system.run(
      engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("command-turn-supervised-activation"),
        threadId,
        message: {
          messageId: asMessageId("message-supervised-activation"),
          role: "user",
          text: "Start the Room.",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        threadBootstrap: {
          projectId,
          title: "Lead Room",
          modelSelection: { provider: "codex", model: "gpt-5.6-sol" },
          runtimeMode: "full-access",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: null,
          worktreePath: null,
          createdAt,
        },
        supervisedBootstrap: {
          kind: "lead",
          profilePresetId: preset.id,
          profileSnapshot,
          lead: {
            id: leadSeatId,
            projectId,
            activeThreadId: threadId,
            predecessorThreadIds: [],
            profileSnapshotId,
            status: "active",
            createdAt,
            updatedAt: createdAt,
            archivedAt: null,
            revision: 0,
          },
        },
        createdAt,
      }),
    );
    let runtime = await system.run(engine.getReadModel());
    expect(runtime.supervised.rooms.find((room) => room.id === threadId)?.status).toBe(
      "provisioning",
    );

    await system.run(
      engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.makeUnsafe("command-session-supervised-activation"),
        threadId,
        session: {
          threadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: "2026-08-09T00:00:01.000Z",
        },
        createdAt: "2026-08-09T00:00:01.000Z",
      }),
    );
    runtime = await system.run(engine.getReadModel());
    expect(runtime.supervised.rooms.find((room) => room.id === threadId)?.status).toBe("active");

    const events = await system.run(
      Stream.runCollect(engine.readEvents(0)).pipe(
        Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)),
      ),
    );
    expect(
      events.some(
        (event) =>
          event.commandId === "command-turn-supervised-activation" &&
          event.aggregateKind === "supervised_governance" &&
          event.type === "supervised.lead-enrolled",
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.commandId === "command-turn-supervised-activation" &&
          event.aggregateKind === "supervision",
      ),
    ).toBe(false);
    const sessionIndex = events.findIndex(
      (event) =>
        event.commandId === "command-session-supervised-activation" &&
        event.type === "thread.session-set",
    );
    const readyIndex = events.findIndex(
      (event) =>
        event.commandId === "command-session-supervised-activation" &&
        event.type === "supervised.room-updated" &&
        event.payload.room?.status === "ready",
    );
    expect(sessionIndex).toBeGreaterThanOrEqual(0);
    expect(readyIndex).toBeGreaterThan(sessionIndex);
    await system.dispose();
  });

  it("atomically lets Primary Supervisor create a Lead Room and its Lead create the first Task Graph", async () => {
    const system = await createOrchestrationSystem();
    const { engine, supervisedGovernanceRepository } = system;
    const createdAt = "2026-08-10T01:00:00.000Z";
    const projectId = ProjectId.makeUnsafe("project-supervisor-first-saga");
    const supervisorThreadId = ThreadId.makeUnsafe("thread-primary-supervisor");
    const supervisorSeatId = SupervisorSeatId.makeUnsafe("seat-primary-supervisor");
    const supervisorPreset = DEFAULT_SUPERVISED_PROFILES.find((candidate) =>
      candidate.roleHints.includes("supervisor"),
    )!;
    const supervisorProfileSnapshot = resolveProfilePreset({
      preset: supervisorPreset,
      snapshotId: ProfileSnapshotId.makeUnsafe("snapshot-primary-supervisor"),
      createdAt,
    });
    await system.run(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("command-project-supervisor-first-saga"),
        projectId,
        title: "Supervisor-first saga",
        workspaceRoot: "/tmp/project-supervisor-first-saga",
        defaultModelSelection: { provider: "codex", model: "gpt-5.6-luna" },
        createdAt,
      }),
    );
    await system.run(
      engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("command-bootstrap-primary-supervisor"),
        threadId: supervisorThreadId,
        message: {
          messageId: MessageId.makeUnsafe("message-bootstrap-primary-supervisor"),
          role: "user",
          text: "Create the project Room and Task Graph.",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        threadBootstrap: {
          projectId,
          title: "Primary Supervisor",
          modelSelection: { provider: "codex", model: "gpt-5.6-luna" },
          runtimeMode: "full-access",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          envMode: "local",
          branch: null,
          worktreePath: null,
          workingDirectory: "/tmp/project-supervisor-first-saga",
          createdAt,
        },
        supervisedBootstrap: {
          kind: "supervisor",
          profilePresetId: supervisorPreset.id,
          profileSnapshot: supervisorProfileSnapshot,
          supervisor: {
            id: supervisorSeatId,
            name: "Primary Supervisor",
            activeThreadId: supervisorThreadId,
            predecessorThreadIds: [],
            profileSnapshotId: supervisorProfileSnapshot.id,
            status: "active",
            createdAt,
            updatedAt: createdAt,
            archivedAt: null,
            revision: 0,
          },
          initialMission: {
            id: SupervisionMissionId.makeUnsafe("mission-supervisor-first-saga"),
            supervisorSeatId,
            brief: "Create the project Room and Task Graph.",
            focus: "Project bootstrap",
            scope: [{ kind: "project", projectId }],
            grants: ["lead.observe", "lead.advise"],
            endCondition: { kind: "manual" },
            status: "active",
            sourceMessageId: MessageId.makeUnsafe("message-bootstrap-primary-supervisor"),
            createdAt,
            updatedAt: createdAt,
            completedAt: null,
            revision: 0,
          },
        },
        createdAt,
      }),
    );

    const governanceAfterSupervisor = await system.run(
      supervisedGovernanceRepository.getSnapshot(),
    );
    const supervisorSeat = governanceAfterSupervisor.agentSeats.find(
      (candidate) => candidate.id === supervisorSeatId,
    )!;
    expect(supervisorSeat.identityRole).toBe("supervisor");
    expect(supervisorSeat.concern).toBe("primary");
    expect(
      governanceAfterSupervisor.authorityReceipts
        .find((candidate) => candidate.id === supervisorSeat.authorityReceiptId)
        ?.allowedCommands.includes("supervised.room.create"),
    ).toBe(true);

    const leadPreset = DEFAULT_SUPERVISED_PROFILES.find((candidate) =>
      candidate.roleHints.includes("lead"),
    )!;
    const leadProfileSnapshot = resolveProfilePreset({
      preset: leadPreset,
      snapshotId: ProfileSnapshotId.makeUnsafe("snapshot-supervisor-created-lead"),
      createdAt,
    });
    const leadSeatId = LeadSeatId.makeUnsafe("seat-supervisor-created-lead");
    const leadThreadId = ThreadId.makeUnsafe("lead:supervisor-created");
    const roomId = RoomId.makeUnsafe(leadThreadId);
    await system.run(
      engine.dispatch({
        type: "supervised.lead.create",
        commandId: CommandId.makeUnsafe("command-supervisor-create-lead-room"),
        aggregateId: roomId,
        actor: {
          kind: "seat",
          actorId: supervisorThreadId,
          seatId: supervisorSeatId,
        },
        authorityReceiptId: supervisorSeat.authorityReceiptId,
        expectedRevision: 0,
        idempotencyKey: "supervisor-create-lead-room",
        createdAt,
        supervisorSeatId,
        leadSeatId,
        threadId: leadThreadId,
        workingDirectory: "/tmp/project-supervisor-first-saga",
        room: {
          id: roomId,
          projectId,
          title: "Project Lead Room",
          leadSeatId,
          status: "active",
          graphRevision: 0,
          revision: 0,
          createdAt,
          updatedAt: createdAt,
        },
        profilePresetId: leadPreset.id,
        profileSnapshot: leadProfileSnapshot,
        initialPrompt: "Create the first durable Task Graph.",
      }),
    );

    let readModel = await system.run(engine.getReadModel());
    expect(readModel.threads.find((thread) => thread.id === leadThreadId)?.parentThreadId).toBe(
      supervisorThreadId,
    );
    expect(readModel.supervised.rooms.find((room) => room.id === roomId)).toMatchObject({
      projectId,
      leadSeatId,
      status: "active",
      graphRevision: 0,
    });
    const governanceAfterLead = await system.run(
      supervisedGovernanceRepository.getSnapshot(),
    );
    const leadSeat = governanceAfterLead.agentSeats.find(
      (candidate) => candidate.id === leadSeatId,
    )!;
    const leadReceipt = governanceAfterLead.authorityReceipts.find(
      (candidate) => candidate.id === leadSeat.authorityReceiptId,
    )!;
    expect(leadSeat.roomIds).toEqual([roomId]);
    expect(leadReceipt.rootLeaseIds).toHaveLength(1);

    const taskId = TaskId.makeUnsafe("task-supervisor-first");
    const firstNodeId = TaskNodeId.makeUnsafe("node-supervisor-first-plan");
    const secondNodeId = TaskNodeId.makeUnsafe("node-supervisor-first-verify");
    const taskGraphActor = {
      kind: "seat" as const,
      actorId: leadThreadId,
      seatId: leadSeatId,
    };
    await system.run(
      engine.dispatch({
        type: "supervised.task-graph.create",
        commandId: CommandId.makeUnsafe("command-lead-create-task-graph"),
        aggregateId: taskId,
        actor: taskGraphActor,
        authorityReceiptId: leadReceipt.id,
        expectedRevision: 0,
        idempotencyKey: "lead-create-task-graph",
        createdAt,
        task: {
          id: taskId,
          roomId,
          title: "Deliver the outcome",
          intent: "Implement and verify the requested outcome.",
          acceptanceCriteria: ["The requested behavior is verified."],
          lifecycle: "active",
          activeGraphRevision: 1,
          revision: 0,
          createdAt,
          updatedAt: createdAt,
        },
        nodes: [
          {
            taskNode: {
              id: firstNodeId,
              taskId,
              roomId,
              parentNodeId: null,
              title: "Implement",
              description: "Implement the bounded change.",
              lifecycle: "ready",
              activeRevisionId: TaskNodeRevisionId.makeUnsafe(
                "revision-supervisor-first-plan",
              ),
              graphRevision: 1,
              revision: 0,
              createdAt,
              updatedAt: createdAt,
            },
            taskNodeRevision: {
              id: TaskNodeRevisionId.makeUnsafe("revision-supervisor-first-plan"),
              taskNodeId: firstNodeId,
              graphRevision: 1,
              scope: "Implement the bounded change.",
              acceptanceCriteria: ["Implementation is complete."],
              dependencyNodeIds: [],
              evidenceRefs: [],
              createdBy: taskGraphActor,
              createdAt,
            },
          },
          {
            taskNode: {
              id: secondNodeId,
              taskId,
              roomId,
              parentNodeId: null,
              title: "Verify",
              description: "Verify the observable behavior.",
              lifecycle: "planned",
              activeRevisionId: TaskNodeRevisionId.makeUnsafe(
                "revision-supervisor-first-verify",
              ),
              graphRevision: 1,
              revision: 0,
              createdAt,
              updatedAt: createdAt,
            },
            taskNodeRevision: {
              id: TaskNodeRevisionId.makeUnsafe("revision-supervisor-first-verify"),
              taskNodeId: secondNodeId,
              graphRevision: 1,
              scope: "Verify the observable behavior.",
              acceptanceCriteria: ["Evidence is retained."],
              dependencyNodeIds: [firstNodeId],
              evidenceRefs: [],
              createdBy: taskGraphActor,
              createdAt,
            },
          },
        ],
      }),
    );

    readModel = await system.run(engine.getReadModel());
    expect(readModel.supervised.rooms.find((room) => room.id === roomId)?.graphRevision).toBe(1);
    expect(readModel.supervised.tasks.find((task) => task.id === taskId)).toMatchObject({
      roomId,
      activeGraphRevision: 1,
    });
    expect(
      readModel.supervised.taskNodes.filter((node) => node.taskId === taskId),
    ).toHaveLength(2);
    const governanceForPeerWork = await system.run(
      supervisedGovernanceRepository.getSnapshot(),
    );
    const currentSupervisorSeat = governanceForPeerWork.agentSeats.find(
      (candidate) => candidate.id === supervisorSeatId,
    )!;
    const currentSupervisorReceipt = governanceForPeerWork.authorityReceipts.find(
      (candidate) => candidate.id === currentSupervisorSeat.authorityReceiptId,
    )!;
    expect(currentSupervisorReceipt.roomScopes).toContain(roomId);
    expect(currentSupervisorReceipt.allowedCommands).toContain("supervised.peer.create");
    expect(currentSupervisorReceipt.allowedCommands).toContain("supervised.work.assign");

    const peerPreset = DEFAULT_SUPERVISED_PROFILES.find((candidate) =>
      candidate.roleHints.includes("peer"),
    )!;
    const peerProfileSnapshot = resolveProfilePreset({
      preset: peerPreset,
      snapshotId: ProfileSnapshotId.makeUnsafe("snapshot-supervisor-created-peer"),
      createdAt,
    });
    const peerThreadId = ThreadId.makeUnsafe("peer:supervisor-assigned");
    const peerSpecialtyId = PeerSpecialtyId.makeUnsafe("peer-specialty-supervisor-assigned");
    await system.run(
      engine.dispatch({
        type: "supervised.peer.create",
        commandId: CommandId.makeUnsafe("command-supervisor-create-peer"),
        aggregateId: peerSpecialtyId,
        actor: {
          kind: "seat",
          actorId: supervisorThreadId,
          seatId: supervisorSeatId,
        },
        authorityReceiptId: currentSupervisorReceipt.id,
        expectedRevision: 0,
        idempotencyKey: "supervisor-create-peer",
        createdAt,
        roomId,
        projectId,
        leadSeatId,
        leadThreadId,
        threadId: peerThreadId,
        title: "Protocol investigator",
        workingDirectory: "/tmp/project-supervisor-first-saga",
        profilePresetId: peerPreset.id,
        profileSnapshot: peerProfileSnapshot,
        peerSpecialty: {
          id: peerSpecialtyId,
          profilePresetId: peerPreset.id,
          concern: "Locate the Supervisor protocol implementation.",
          status: "active",
          allowedScopes: [
            { kind: "project", projectId },
            { kind: "room", roomId },
            { kind: "seat", role: "peer", seatId: peerThreadId },
          ],
          latestSnapshotId: null,
          expiresAt: "2026-08-11T01:00:00.000Z",
          revision: 0,
          createdAt,
          updatedAt: createdAt,
        },
      }),
    );

    const governanceAfterPeer = await system.run(
      supervisedGovernanceRepository.getSnapshot(),
    );
    const peerSeat = governanceAfterPeer.agentSeats.find(
      (candidate) => candidate.threadId === peerThreadId,
    )!;
    const peerReceipt = governanceAfterPeer.authorityReceipts.find(
      (candidate) => candidate.id === peerSeat.authorityReceiptId,
    )!;
    expect(peerSeat.identityRole).toBe("peer");
    expect(peerSeat.roomIds).toContain(roomId);
    expect(peerReceipt.allowedCommands).toContain("supervised.work.complete");
    expect(peerReceipt.allowedCommands).toContain("supervised.run.start");
    expect(peerReceipt.allowedCommands).toContain("supervised.run.submit");

    const currentLeadSeat = governanceAfterPeer.agentSeats.find(
      (candidate) => candidate.id === leadSeatId,
    )!;
    const currentLeadReceipt = governanceAfterPeer.authorityReceipts.find(
      (candidate) => candidate.id === currentLeadSeat.authorityReceiptId,
    )!;
    expect(currentLeadReceipt.allowedCommands).toContain("supervised.task.delegate");
    expect(currentLeadReceipt.allowedCommands).toContain("supervised.review.accept");
    expect(currentSupervisorReceipt.allowedCommands).not.toContain(
      "supervised.task.delegate",
    );
    expect(currentSupervisorReceipt.allowedCommands).not.toContain(
      "supervised.review.accept",
    );

    const runPolicyId = RunPolicyId.makeUnsafe("policy-supervisor-first-task-node");
    await system.run(
      engine.dispatch({
        type: "supervised.run-policy.upsert",
        commandId: CommandId.makeUnsafe("command-create-task-node-run-policy"),
        aggregateId: runPolicyId,
        actor: { kind: "user", actorId: "owner" },
        expectedRevision: 0,
        idempotencyKey: "create-task-node-run-policy",
        createdAt,
        runPolicy: {
          id: runPolicyId,
          name: "Supervisor-first test policy",
          ...DEFAULT_SUPERVISED_RUN_POLICY,
          maxCostUsd: null,
          allowedCapabilities: [],
          allowedPluginActions: [],
          revision: 0,
          createdAt,
          updatedAt: createdAt,
        },
      }),
    );
    readModel = await system.run(engine.getReadModel());
    const runPolicy = readModel.supervised.runPolicies[0]!;
    const taskNodeRunId = RunId.makeUnsafe("run-supervisor-first-task-node");
    const taskNodeRun = {
      id: taskNodeRunId,
      roomId,
      taskId,
      taskNodeId: firstNodeId,
      taskNodeRevisionId: TaskNodeRevisionId.makeUnsafe(
        "revision-supervisor-first-plan",
      ),
      ownerSeatId: peerSeat.id,
      policyId: runPolicy.id,
      status: "queued" as const,
      attempt: 1,
      daemonEpoch: readModel.supervised.health.daemonEpoch,
      startedAt: null,
      lastProgressAt: null,
      finishedAt: null,
      revision: 0,
      createdAt,
      updatedAt: createdAt,
    };
    await expect(
      system.run(
        engine.dispatch({
          type: "supervised.task.delegate",
          commandId: CommandId.makeUnsafe("command-supervisor-cannot-delegate-task-node"),
          aggregateId: taskNodeRunId,
          actor: {
            kind: "seat",
            actorId: supervisorThreadId,
            seatId: supervisorSeatId,
          },
          authorityReceiptId: currentSupervisorReceipt.id,
          expectedRevision: 0,
          idempotencyKey: "supervisor-cannot-delegate-task-node",
          createdAt,
          roomId,
          projectId,
          leadSeatId,
          leadThreadId,
          peerThreadId,
          workRequest: "Inspect the requested file without editing it.",
          run: taskNodeRun,
        }),
      ),
    ).rejects.toThrow("does not grant 'supervised.task.delegate'");

    await system.run(
      engine.dispatch({
        type: "supervised.task.delegate",
        commandId: CommandId.makeUnsafe("command-lead-delegate-task-node"),
        aggregateId: taskNodeRunId,
        actor: taskGraphActor,
        authorityReceiptId: currentLeadReceipt.id,
        expectedRevision: 0,
        idempotencyKey: "lead-delegate-task-node",
        createdAt,
        roomId,
        projectId,
        leadSeatId,
        leadThreadId,
        peerThreadId,
        workRequest: "Inspect the requested file without editing it.",
        run: taskNodeRun,
      }),
    );

    const workClaimId = WorkClaimId.makeUnsafe("claim-supervisor-first-task-node");
    await system.run(
      engine.dispatch({
        type: "supervised.run.start",
        commandId: CommandId.makeUnsafe("command-peer-start-task-node-run"),
        aggregateId: taskNodeRunId,
        actor: {
          kind: "seat",
          actorId: peerThreadId,
          seatId: peerSeat.id,
        },
        authorityReceiptId: peerReceipt.id,
        expectedRevision: 0,
        idempotencyKey: "peer-start-task-node-run",
        createdAt: "2026-08-10T01:01:00.000Z",
        runId: taskNodeRunId,
        claim: {
          id: workClaimId,
          taskNodeId: firstNodeId,
          taskNodeRevisionId: taskNodeRun.taskNodeRevisionId,
          runId: taskNodeRunId,
          ownerSeatId: peerSeat.id,
          status: "active",
          acquiredAt: "2026-08-10T01:01:00.000Z",
          expiresAt: "2026-08-10T01:31:00.000Z",
          releasedAt: null,
          revision: 0,
        },
      }),
    );

    const taskNodeEvidenceId = EvidenceId.makeUnsafe(
      "evidence-supervisor-first-task-node",
    );
    await system.run(
      engine.dispatch({
        type: "supervised.run.submit",
        commandId: CommandId.makeUnsafe("command-peer-submit-task-node-run"),
        aggregateId: taskNodeRunId,
        actor: {
          kind: "seat",
          actorId: peerThreadId,
          seatId: peerSeat.id,
        },
        authorityReceiptId: peerReceipt.id,
        expectedRevision: 3,
        idempotencyKey: "peer-submit-task-node-run",
        createdAt: "2026-08-10T01:02:00.000Z",
        runId: taskNodeRunId,
        claimId: workClaimId,
        evidence: {
          id: taskNodeEvidenceId,
          scope: { kind: "room", roomId },
          kind: "provider_receipt",
          summary: "The requested file was inspected and the acceptance condition is present.",
          blob: null,
          sourceEventIds: [],
          modelSessionId: null,
          createdBy: {
            kind: "seat",
            actorId: peerThreadId,
            seatId: peerSeat.id,
          },
          createdAt: "2026-08-10T01:02:00.000Z",
        },
      }),
    );

    await system.run(
      engine.dispatch({
        type: "supervised.review.accept",
        commandId: CommandId.makeUnsafe("command-lead-accept-task-node-run"),
        aggregateId: taskNodeRunId,
        actor: taskGraphActor,
        authorityReceiptId: currentLeadReceipt.id,
        expectedRevision: 4,
        idempotencyKey: "lead-accept-task-node-run",
        createdAt: "2026-08-10T01:03:00.000Z",
        runId: taskNodeRunId,
        evidenceId: taskNodeEvidenceId,
      }),
    );

    readModel = await system.run(engine.getReadModel());
    expect(
      readModel.supervised.runs.find((candidate) => candidate.id === taskNodeRunId),
    ).toMatchObject({ status: "succeeded", ownerSeatId: peerSeat.id });
    expect(
      readModel.supervised.workClaims.find((candidate) => candidate.id === workClaimId),
    ).toMatchObject({ status: "released" });
    expect(
      readModel.supervised.taskNodes.find((candidate) => candidate.id === firstNodeId),
    ).toMatchObject({ lifecycle: "accepted" });
    expect(
      readModel.supervised.taskNodes.find((candidate) => candidate.id === secondNodeId),
    ).toMatchObject({ lifecycle: "ready" });
    expect(
      readModel.supervised.taskNodeRevisions.find(
        (candidate) =>
          candidate.taskNodeId === firstNodeId &&
          candidate.evidenceRefs.includes(taskNodeEvidenceId),
      ),
    ).toBeDefined();

    const interventionId = InterventionId.makeUnsafe("intervention-supervisor-peer-work");
    const notificationId = LeadNotificationId.makeUnsafe(
      "notification-supervisor-peer-work",
    );
    const reconciliationId = ReconciliationId.makeUnsafe(
      "reconciliation-supervisor-peer-work",
    );
    const peerWorkActor = {
      kind: "seat" as const,
      actorId: supervisorThreadId,
      seatId: supervisorSeatId,
    };
    await system.run(
      engine.dispatch({
        type: "supervised.work.assign",
        commandId: CommandId.makeUnsafe("command-supervisor-assign-peer-work"),
        aggregateId: interventionId,
        actor: peerWorkActor,
        authorityReceiptId: currentSupervisorReceipt.id,
        expectedRevision: 0,
        idempotencyKey: "supervisor-assign-peer-work",
        createdAt,
        roomId,
        projectId,
        leadSeatId,
        leadThreadId,
        peerThreadId,
        intervention: {
          id: interventionId,
          roomId,
          requestedBy: peerWorkActor,
          specialistThreadId: peerThreadId,
          reason: "Locate the Supervisor protocol file without editing it.",
          material: false,
          evidenceRefs: [],
          status: "open",
          createdAt,
          updatedAt: createdAt,
          revision: 0,
        },
        leadNotification: {
          id: notificationId,
          interventionId,
          roomId,
          leadSeatId,
          status: "queued",
          createdAt,
          deliveredAt: null,
          acknowledgedAt: null,
        },
        reconciliation: {
          id: reconciliationId,
          interventionId,
          roomId,
          leadSeatId,
          status: "open",
          taskNodeRevisionId: null,
          reason: null,
          createdAt,
          resolvedAt: null,
          revision: 0,
        },
      }),
    );

    readModel = await system.run(engine.getReadModel());
    expect(
      readModel.supervised.interventions.find((item) => item.id === interventionId),
    ).toMatchObject({ status: "open", material: false, specialistThreadId: peerThreadId });

    const evidenceId = EvidenceId.makeUnsafe("evidence-supervisor-peer-work");
    await system.run(
      engine.dispatch({
        type: "supervised.work.complete",
        commandId: CommandId.makeUnsafe("command-peer-complete-supervisor-work"),
        aggregateId: interventionId,
        actor: {
          kind: "seat",
          actorId: peerThreadId,
          seatId: peerSeat.id,
        },
        authorityReceiptId: peerReceipt.id,
        expectedRevision: 0,
        idempotencyKey: "peer-complete-supervisor-work",
        createdAt: "2026-08-10T01:01:00.000Z",
        roomId,
        interventionId,
        evidence: {
          id: evidenceId,
          scope: { kind: "room", roomId },
          kind: "observation",
          summary:
            "The Supervisor protocol is apps/server/src/orchestration/supervised/protocolV1.ts.",
          blob: null,
          sourceEventIds: [],
          modelSessionId: null,
          createdBy: {
            kind: "seat",
            actorId: peerThreadId,
            seatId: peerSeat.id,
          },
          createdAt: "2026-08-10T01:01:00.000Z",
        },
      }),
    );

    readModel = await system.run(engine.getReadModel());
    expect(readModel.supervised.evidence.find((item) => item.id === evidenceId)).toBeDefined();
    expect(
      readModel.supervised.interventions.find((item) => item.id === interventionId),
    ).toMatchObject({ status: "reconciled", evidenceRefs: [evidenceId] });
    expect(
      readModel.supervised.leadNotifications.find(
        (item) => item.interventionId === interventionId,
      ),
    ).toMatchObject({ status: "delivered" });
    expect(
      readModel.supervised.reconciliations.find(
        (item) => item.interventionId === interventionId,
      ),
    ).toMatchObject({ status: "accepted", taskNodeRevisionId: null });
    expect(
      readModel.supervised.workClaims.filter((claim) => claim.status === "active"),
    ).toHaveLength(0);
    const events = await system.run(
      Stream.runCollect(engine.readEvents(0)).pipe(
        Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)),
      ),
    );
    expect(
      events
        .filter((event) => event.commandId === "command-supervisor-create-lead-room")
        .map((event) => event.type),
    ).toEqual([
      "thread.created",
      "supervised.lead-enrolled",
      "supervised.room-created",
      "thread.message-sent",
      "thread.turn-start-requested",
    ]);
    expect(
      events
        .filter((event) => event.commandId === "command-lead-create-task-graph")
        .map((event) => event.type),
    ).toEqual([
      "supervised.room-updated",
      "supervised.task-created",
      "supervised.task-node-committed",
      "supervised.task-node-committed",
    ]);
    expect(
      events
        .filter((event) => event.commandId === "command-supervisor-assign-peer-work")
        .map((event) => event.type),
    ).toEqual([
      "supervised.intervention-proposed",
      "thread.message-sent",
      "thread.turn-start-requested",
    ]);
    expect(
      events
        .filter((event) => event.commandId === "command-peer-complete-supervisor-work")
        .map((event) => event.type),
    ).toEqual([
      "supervised.evidence-published",
      "thread.message-sent",
      "thread.turn-start-requested",
    ]);
    expect(
      events
        .filter((event) => event.commandId === "command-lead-delegate-task-node")
        .map((event) => event.type),
    ).toEqual([
      "supervised.run-requested",
      "thread.message-sent",
      "thread.turn-start-requested",
    ]);
    expect(
      events
        .filter((event) => event.commandId === "command-peer-start-task-node-run")
        .map((event) => event.type),
    ).toEqual([
      "supervised.claim-acquired",
      "supervised.run-transitioned",
      "supervised.run-transitioned",
      "supervised.run-transitioned",
      "supervised.task-node-committed",
    ]);
    expect(
      events
        .filter((event) => event.commandId === "command-peer-submit-task-node-run")
        .map((event) => event.type),
    ).toEqual([
      "supervised.evidence-published",
      "supervised.run-transitioned",
      "supervised.task-node-committed",
      "supervised.claim-state-changed",
      "thread.message-sent",
      "thread.turn-start-requested",
    ]);
    expect(
      events
        .filter((event) => event.commandId === "command-lead-accept-task-node-run")
        .map((event) => event.type),
    ).toEqual([
      "supervised.run-transitioned",
      "supervised.task-node-committed",
      "supervised.task-node-committed",
    ]);
    const assignmentOrigin = events.find(
      (event) =>
        event.commandId === "command-supervisor-assign-peer-work" &&
        event.type === "thread.turn-start-requested",
    )?.payload.threadOrigin;
    expect(assignmentOrigin).toMatchObject({
      rootThreadId: leadThreadId,
      senderThreadId: supervisorThreadId,
      targetThreadId: peerThreadId,
      assignmentId: interventionId,
    });
    const notificationOrigin = events.find(
      (event) =>
        event.commandId === "command-peer-complete-supervisor-work" &&
        event.type === "thread.turn-start-requested",
    )?.payload.threadOrigin;
    expect(notificationOrigin).toMatchObject({
      rootThreadId: leadThreadId,
      senderThreadId: peerThreadId,
      targetThreadId: leadThreadId,
      assignmentId: interventionId,
    });

    const roomBeforeAssumption = readModel.supervised.rooms.find(
      (candidate) => candidate.id === roomId,
    )!;
    await system.run(
      engine.dispatch({
        type: "supervised.role.assume",
        commandId: CommandId.makeUnsafe("command-owner-authorize-supervisor-root"),
        aggregateId: roomId,
        actor: { kind: "user", actorId: "owner" },
        expectedRevision: roomBeforeAssumption.revision,
        idempotencyKey: "owner-authorize-supervisor-root",
        createdAt: "2026-08-10T01:04:00.000Z",
        roomId,
        supervisorSeatId,
        supervisorThreadId,
        previousRootSeatId: leadSeatId,
        previousRootThreadId: leadThreadId,
        reason: "The owner asked the Primary Supervisor to take over this Room.",
      }),
    );

    readModel = await system.run(engine.getReadModel());
    expect(readModel.supervised.rooms.find((candidate) => candidate.id === roomId)).toMatchObject({
      leadSeatId: supervisorSeatId,
      status: "active",
    });
    const governanceAfterAssumption = await system.run(
      supervisedGovernanceRepository.getSnapshot(),
    );
    const actingSupervisor = governanceAfterAssumption.agentSeats.find(
      (candidate) => candidate.id === supervisorSeatId,
    )!;
    const actingSupervisorReceipt = governanceAfterAssumption.authorityReceipts.find(
      (candidate) => candidate.id === actingSupervisor.authorityReceiptId,
    )!;
    const formerRoot = governanceAfterAssumption.agentSeats.find(
      (candidate) => candidate.id === leadSeatId,
    )!;
    const formerRootReceipt = governanceAfterAssumption.authorityReceipts.find(
      (candidate) => candidate.id === formerRoot.authorityReceiptId,
    )!;
    expect(actingSupervisor).toMatchObject({
      identityRole: "supervisor",
      effectiveRole: "acting_root",
    });
    expect(actingSupervisorReceipt.rootLeaseIds).toHaveLength(1);
    expect(actingSupervisorReceipt.allowedCommands).toContain("supervised.task.delegate");
    expect(formerRoot.effectiveRole).toBe("lead");
    expect(formerRootReceipt.rootLeaseIds).toEqual([]);
    expect(
      governanceAfterAssumption.rootLeases.filter(
        (lease) => lease.roomId === roomId && lease.status === "active",
      ),
    ).toEqual([
      expect.objectContaining({ holderSeatId: supervisorSeatId }),
    ]);
    expect(governanceAfterAssumption.roleAssumptions).toEqual([
      expect.objectContaining({
        roomId,
        actorSeatId: supervisorSeatId,
        previousRootSeatId: leadSeatId,
        lifecycleState: "active",
      }),
    ]);
    expect(governanceAfterAssumption.handoffs).toEqual([
      expect.objectContaining({
        roomId,
        fromSeatId: leadSeatId,
        toSeatId: supervisorSeatId,
        lifecycleState: "reconciled",
      }),
    ]);

    const roomAfterAssumption = readModel.supervised.rooms.find(
      (candidate) => candidate.id === roomId,
    )!;
    await expect(
      system.run(
        engine.dispatch({
          type: "supervised.room.update",
          commandId: CommandId.makeUnsafe("command-former-root-cannot-mutate-room"),
          aggregateId: roomId,
          actor: { kind: "seat", actorId: leadThreadId, seatId: leadSeatId },
          authorityReceiptId: formerRootReceipt.id,
          expectedRevision: roomAfterAssumption.revision,
          idempotencyKey: "former-root-cannot-mutate-room",
          createdAt: "2026-08-10T01:04:01.000Z",
          room: { ...roomAfterAssumption, title: "Unauthorized former Root mutation" },
        }),
      ),
    ).rejects.toThrow("does not cover the command Room");

    const actingRootRunId = RunId.makeUnsafe("run-acting-supervisor-task-node");
    await system.run(
      engine.dispatch({
        type: "supervised.task.delegate",
        commandId: CommandId.makeUnsafe("command-acting-supervisor-delegate-task-node"),
        aggregateId: actingRootRunId,
        actor: {
          kind: "seat",
          actorId: supervisorThreadId,
          seatId: supervisorSeatId,
        },
        authorityReceiptId: actingSupervisorReceipt.id,
        expectedRevision: 0,
        idempotencyKey: "acting-supervisor-delegate-task-node",
        createdAt: "2026-08-10T01:05:00.000Z",
        roomId,
        projectId,
        leadSeatId: supervisorSeatId,
        leadThreadId: supervisorThreadId,
        peerThreadId,
        workRequest: "Verify the accepted implementation without changing Root ownership.",
        run: {
          id: actingRootRunId,
          roomId,
          taskId,
          taskNodeId: secondNodeId,
          taskNodeRevisionId: TaskNodeRevisionId.makeUnsafe(
            "revision-supervisor-first-verify",
          ),
          ownerSeatId: peerSeat.id,
          policyId: runPolicy.id,
          status: "queued",
          attempt: 1,
          daemonEpoch: readModel.supervised.health.daemonEpoch,
          startedAt: null,
          lastProgressAt: null,
          finishedAt: null,
          revision: 0,
          createdAt: "2026-08-10T01:05:00.000Z",
          updatedAt: "2026-08-10T01:05:00.000Z",
        },
      }),
    );
    readModel = await system.run(engine.getReadModel());
    expect(
      readModel.supervised.runs.find((candidate) => candidate.id === actingRootRunId),
    ).toMatchObject({ status: "queued", taskNodeId: secondNodeId });
    const assumptionEvents = await system.run(
      Stream.runCollect(engine.readEvents(0)).pipe(
        Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)),
      ),
    );
    expect(
      assumptionEvents
        .filter((event) => event.commandId === "command-owner-authorize-supervisor-root")
        .map((event) => event.type),
    ).toEqual([
      "supervised.room-updated",
      "thread.message-sent",
      "thread.turn-start-requested",
    ]);
    await system.dispose();
  });

  it("retries deferred projection catch-up while idle until it recovers", async () => {
    let bootstrapCalls = 0;
    let deferredCalls = 0;
    let resolveRecoveryBootstrap: (() => void) | null = null;
    const recoveryBootstrap = new Promise<void>((resolve) => {
      resolveRecoveryBootstrap = resolve;
    });

    const flakyProjectionPipeline: OrchestrationProjectionPipelineShape = {
      bootstrap: Effect.suspend(() => {
        bootstrapCalls += 1;
        if (bootstrapCalls === 2 || bootstrapCalls === 3) {
          return Effect.fail(
            new PersistenceSqlError({
              operation: "test.deferredProjectionBootstrap",
              detail: "deferred projection bootstrap failed transiently",
            }),
          );
        }
        if (bootstrapCalls === 4) {
          resolveRecoveryBootstrap?.();
        }
        return Effect.void;
      }),
      projectMetadataEvent: () => Effect.void,
      projectEvent: () => Effect.void,
      projectHotEventInCurrentTransaction: () => Effect.void,
      projectDeferredEvent: () => {
        deferredCalls += 1;
        if (deferredCalls === 1) {
          return Effect.fail(
            new PersistenceSqlError({
              operation: "test.deferredProjection",
              detail: "deferred projection failed",
            }),
          );
        }
        return Effect.void;
      },
    };

    const runtime = ManagedRuntime.make(
      OrchestrationEngineLive.pipe(
        Layer.provide(Layer.succeed(OrchestrationProjectionPipeline, flakyProjectionPipeline)),
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(OrchestrationEventStoreLive),
        Layer.provide(OrchestrationCommandReceiptRepositoryLive),
        Layer.provide(SqlitePersistenceMemory),
        Layer.provideMerge(TestServerConfigLayer),
        Layer.provideMerge(NodeServices.layer),
      ),
    );
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const createdAt = now();

    await runtime.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-deferred-recovery"),
        projectId: asProjectId("project-deferred-recovery"),
        title: "Deferred Recovery Project",
        workspaceRoot: "/tmp/project-deferred-recovery",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        createdAt,
      }),
    );
    await runtime.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-deferred-recovery"),
        threadId: ThreadId.makeUnsafe("thread-deferred-recovery"),
        projectId: asProjectId("project-deferred-recovery"),
        title: "deferred-recovery",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );

    const result = await runtime.runPromise(
      engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-turn-start-deferred-recovery"),
        threadId: ThreadId.makeUnsafe("thread-deferred-recovery"),
        message: {
          messageId: asMessageId("msg-deferred-recovery"),
          role: "user",
          text: "hello",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt,
      }),
    );

    await recoveryBootstrap;

    expect(result.sequence).toBe(4);
    expect(deferredCalls).toBeGreaterThanOrEqual(1);
    expect(bootstrapCalls).toBe(4);
    await vi.waitFor(async () => {
      expect(await runtime.runPromise(engine.getProjectionCatchUpStatus)).toEqual({
        state: "healthy",
        inFlight: false,
        retryAttempts: 0,
        lastFailure: null,
      });
    });

    await runtime.dispose();
  });

  it("restores the repair backup when rebuilt projectors do not reach the captured fence", async () => {
    const nonAdvancingProjectionPipeline: OrchestrationProjectionPipelineShape = {
      bootstrap: Effect.void,
      projectMetadataEvent: () => Effect.void,
      projectEvent: () => Effect.void,
      projectHotEventInCurrentTransaction: () => Effect.void,
      projectDeferredEvent: () => Effect.void,
    };
    const runtime = ManagedRuntime.make(
      OrchestrationEngineLive.pipe(
        Layer.provide(
          Layer.succeed(OrchestrationProjectionPipeline, nonAdvancingProjectionPipeline),
        ),
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(OrchestrationEventStoreLive),
        Layer.provide(OrchestrationCommandReceiptRepositoryLive),
        Layer.provide(SqlitePersistenceMemory),
        Layer.provideMerge(TestServerConfigLayer),
        Layer.provideMerge(NodeServices.layer),
      ),
    );
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const createdAt = now();

    await runtime.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-repair-fence"),
        projectId: asProjectId("project-repair-fence"),
        title: "Repair Fence Project",
        workspaceRoot: "/tmp/project-repair-fence",
        defaultModelSelection: null,
        createdAt,
      }),
    );
    const beforeRepair = await runtime.runPromise(engine.getReadModel());

    await expect(runtime.runPromise(engine.repairState())).rejects.toThrow(
      "did not reach captured event fence 1",
    );
    await expect(runtime.runPromise(engine.getReadModel())).resolves.toEqual(beforeRepair);

    await runtime.dispose();
  });

  it("retires an empty existing project when re-adding the same workspace root", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;
    const createdAt = now();

    await system.run(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-stale-create"),
        projectId: asProjectId("project-stale"),
        title: "Stale Project",
        workspaceRoot: "/tmp/readd-project",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        createdAt,
      }),
    );

    await expect(
      system.run(
        engine.dispatch({
          type: "project.create",
          commandId: CommandId.makeUnsafe("cmd-project-readd-create"),
          projectId: asProjectId("project-readd"),
          title: "Readded Project",
          workspaceRoot: "/tmp/readd-project",
          defaultModelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          createdAt,
        }),
      ),
    ).resolves.toEqual({ sequence: 3 });

    const readModel = await system.run(engine.getReadModel());
    expect(
      readModel.projects.find((project) => project.id === asProjectId("project-stale"))?.deletedAt,
    ).toBe(createdAt);
    expect(
      readModel.projects.find((project) => project.id === asProjectId("project-readd"))?.deletedAt,
    ).toBeNull();

    await system.dispose();
  });

  it("keeps rejecting a duplicate workspace root when the existing project has threads", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;
    const createdAt = now();

    await system.run(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-active-create"),
        projectId: asProjectId("project-active"),
        title: "Active Project",
        workspaceRoot: "/tmp/active-project",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        createdAt,
      }),
    );
    await system.run(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-project-active-thread-create"),
        threadId: ThreadId.makeUnsafe("thread-active"),
        projectId: asProjectId("project-active"),
        title: "active",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );

    await expect(
      system.run(
        engine.dispatch({
          type: "project.create",
          commandId: CommandId.makeUnsafe("cmd-project-active-duplicate-create"),
          projectId: asProjectId("project-active-duplicate"),
          title: "Active Duplicate",
          workspaceRoot: "/tmp/active-project",
          defaultModelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          createdAt,
        }),
      ),
    ).rejects.toThrow("already uses workspace root");

    await system.dispose();
  });

  it("rejects duplicate thread creation", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;
    const createdAt = now();

    await system.run(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-duplicate-create"),
        projectId: asProjectId("project-duplicate"),
        title: "Duplicate Project",
        workspaceRoot: "/tmp/project-duplicate",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        createdAt,
      }),
    );

    await system.run(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-duplicate-1"),
        threadId: ThreadId.makeUnsafe("thread-duplicate"),
        projectId: asProjectId("project-duplicate"),
        title: "duplicate",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt,
      }),
    );

    await expect(
      system.run(
        engine.dispatch({
          type: "thread.create",
          commandId: CommandId.makeUnsafe("cmd-thread-duplicate-2"),
          threadId: ThreadId.makeUnsafe("thread-duplicate"),
          projectId: asProjectId("project-duplicate"),
          title: "duplicate",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt,
        }),
      ),
    ).rejects.toThrow("already exists");

    await system.dispose();
  });

  it("keeps the worker alive when a command throws while its pipeline is built", async () => {
    const system = await createOrchestrationSystem();
    const createdAt = now();
    const poisonedCommandId = CommandId.makeUnsafe("cmd-engine-poison");
    fingerprintPoison.add(poisonedCommandId);

    try {
      const poisonedOutcome = await system.run(
        Effect.result(
          system.engine.dispatch({
            type: "project.create",
            commandId: poisonedCommandId,
            projectId: asProjectId("project-engine-poison"),
            title: "Poisoned",
            workspaceRoot: "/tmp/engine-poison",
            defaultModelSelection: null,
            createdAt,
          }),
        ).pipe(Effect.timeoutOption("5 seconds")),
      );

      // The defect fails this command immediately instead of leaving the caller to
      // wait out the dispatch timeout.
      expect(Option.isSome(poisonedOutcome)).toBe(true);
      const outcome = Option.getOrThrow(poisonedOutcome);
      expect(outcome._tag).toBe("Failure");
      if (outcome._tag === "Failure") {
        expect(outcome.failure).toMatchObject({ _tag: "OrchestrationCommandInternalError" });
      }

      // The worker survived: the next command still runs.
      await expect(
        system.run(
          system.engine.dispatch({
            type: "project.create",
            commandId: CommandId.makeUnsafe("cmd-engine-poison-next"),
            projectId: asProjectId("project-engine-poison-next"),
            title: "After poison",
            workspaceRoot: "/tmp/engine-poison-next",
            defaultModelSelection: null,
            createdAt,
          }),
        ),
      ).resolves.toMatchObject({ sequence: expect.any(Number) });

      // The poisoned envelope was still finished, so `outstanding` did not leak.
      const drained = await system.run(
        Effect.timeoutOption(system.engine.drain, "5 seconds").pipe(Effect.map(Option.isSome)),
      );
      expect(drained).toBe(true);
    } finally {
      fingerprintPoison.delete(poisonedCommandId);
      await system.dispose();
    }
  });
});
