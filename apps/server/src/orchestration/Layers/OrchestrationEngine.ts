import type {
  ChatAttachment,
  OrchestrationEvent,
  OrchestrationAggregateKind,
  OrchestrationReadModel,
  ThreadId,
} from "@synara/contracts";
import {
  OrchestrationCommand,
  TaskProcessCommand,
  TaskProcessDomainEvent,
  ORCHESTRATION_WS_METHODS,
  MessageId,
  SupervisedCommand,
  SupervisedGovernanceAggregateId,
  SupervisedGovernanceCommand,
} from "@synara/contracts";
import {
  Cause,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  PubSub,
  Queue,
  Ref,
  Schema,
  Semaphore,
  Scope,
  Stream,
} from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerConfig } from "../../config.ts";
import { toPersistenceSqlError, type PersistenceSqlError } from "../../persistence/Errors.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import {
  OrchestrationCommandReceiptRepository,
  type OrchestrationCommandReceipt,
} from "../../persistence/Services/OrchestrationCommandReceipts.ts";
import { ManagedAttachmentRepository } from "../../persistence/Services/ManagedAttachments.ts";
import { ManagedAttachmentRepositoryLive } from "../../persistence/Layers/ManagedAttachments.ts";
import { SupervisedGovernanceRepository } from "../../persistence/Services/SupervisedGovernanceRepository.ts";
import { SupervisedGovernanceRepositoryLive } from "../../persistence/Layers/SupervisedGovernanceRepository.ts";
import {
  LOCAL_LOOPBACK_ATTACHMENT_PRINCIPAL,
  type ManagedAttachmentPrincipal,
} from "../../managedAttachmentPrincipal.ts";
import {
  OrchestrationCommandAdmissionError,
  OrchestrationCommandIdentityCollisionError,
  OrchestrationCommandInvariantError,
  OrchestrationCommandInternalError,
  OrchestrationCommandPreviouslyRejectedError,
  OrchestrationCommandTimeoutError,
  type OrchestrationDispatchError,
} from "../Errors.ts";
import {
  fingerprintOrchestrationCommand,
  type OrchestrationCommandFingerprint,
} from "../commandFingerprint.ts";
import {
  ORCHESTRATION_COMMAND_CONTROL_RESERVE,
  ORCHESTRATION_COMMAND_QUEUE_CAPACITY,
  ORCHESTRATION_EVENT_PUBSUB_CAPACITY,
  type OrchestrationCommandAdmissionDecision,
  type OrchestrationCommandQueues,
  takeNextOrchestrationCommand,
  tryAdmitOrchestrationCommand,
  usesReservedCommandAdmission,
} from "../orchestrationAdmission.ts";
import { decideOrchestrationCommand } from "../decider.ts";
import { decideTaskProcessCommand } from "../taskProcess/decider.ts";
import { createEmptyTaskProcessState, replayTaskProcessEvents } from "../taskProcess/projector.ts";
import { PROJECT_METADATA_SNAPSHOT_PROJECTORS } from "../projectMetadataProjection.ts";
import { createEmptyReadModel, projectEvent } from "../projector.ts";
import { decideSupervisedCommand } from "../supervised/decider.ts";
import { decideSupervisedGovernanceCommand } from "../supervised/governanceDecider.ts";
import { projectSupervisedGovernanceDecisionEvent } from "../supervised/governanceProjector.ts";
import { decideSupervisedRoomLifecycleForThreadCommand } from "../supervised/roomLifecycle.ts";
import {
  OrchestrationProjectionPipeline,
  type ShellMetadataOrchestrationEvent,
} from "../Services/ProjectionPipeline.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import {
  governanceDecisionStateFromSnapshot,
  reconcileGovernanceProjection,
} from "../../supervised/governance/GovernanceReconciliation.ts";

const ORCHESTRATION_DISPATCH_TIMEOUT_MS = 45_000;
const DEFERRED_PROJECTION_RETRY_DELAYS_MS = [100, 500, 2_000, 10_000, 30_000] as const;
const REQUIRED_REPAIR_PROJECTORS = Object.values(ORCHESTRATION_PROJECTOR_NAMES);

type CommandExecutionState = "queued" | "in-flight" | "abandoned";
type DispatchTimeoutDecision = { kind: "abandon" } | { kind: "wait" };
type OrchestrationEnginePhase = "running" | "quiescing" | "draining" | "stopped";

interface CommandEnvelope {
  command: OrchestrationCommand;
  attachmentPrincipal: ManagedAttachmentPrincipal;
  result: Deferred.Deferred<{ sequence: number }, OrchestrationDispatchError>;
  executionState: Ref.Ref<CommandExecutionState>;
  deadlineAtMs: number;
}

interface EngineAdmissionState {
  readonly phase: OrchestrationEnginePhase;
  readonly outstanding: number;
  readonly idle: Deferred.Deferred<void>;
}

type CommittedCommandResult = {
  readonly committedEvents: OrchestrationEvent[];
  readonly lastSequence: number;
  readonly nextCommandReadModel: OrchestrationReadModel;
};

function commandToAggregateRef(command: OrchestrationCommand): {
  readonly aggregateKind: OrchestrationAggregateKind;
  readonly aggregateId: string;
} {
  if (Schema.is(SupervisedGovernanceCommand)(command)) {
    return { aggregateKind: "supervised_governance", aggregateId: command.aggregateId };
  }
  if (Schema.is(SupervisedCommand)(command)) {
    const aggregateKind = (() => {
      switch (command.type) {
        case "supervised.room.create":
        case "supervised.room.update":
        case "supervised.lead.create":
        case "supervised.compaction.request":
        case "supervised.handoff.request":
          return "supervised_room" as const;
        case "supervised.task.create":
        case "supervised.task-node.commit":
        case "supervised.task-graph.create":
          return "supervised_task" as const;
        case "supervised.run.request":
        case "supervised.run.transition":
          return "supervised_run" as const;
        case "supervised.run-policy.upsert":
          return "run_policy" as const;
        case "supervised.claim.acquire":
        case "supervised.claim.release":
        case "supervised.claim.revoke":
        case "supervised.claim.expire":
          return "work_claim" as const;
        case "supervised.lease.grant":
        case "supervised.lease.revoke":
        case "supervised.lease.expire":
          return "capability_lease" as const;
        case "supervised.context.workspace-upsert":
        case "supervised.context.append":
          return "context_workspace" as const;
        case "supervised.evidence.publish":
          return "evidence" as const;
        case "supervised.rlm.upsert":
          return "rlm_episode" as const;
        case "supervised.model-session.upsert":
          return "model_session" as const;
        case "supervised.patch.upsert":
          return "harness_patch" as const;
        case "supervised.peer.create":
        case "supervised.peer.upsert":
          return "peer" as const;
        case "supervised.kernel.session-upsert":
        case "supervised.kernel.execution-upsert":
          return "kernel_session" as const;
        case "supervised.subscription.upsert":
        case "supervised.subscription.pause":
        case "supervised.subscription.enable":
        case "supervised.subscription.revoke":
        case "supervised.delivery.redrive":
          return "subscription" as const;
        case "supervised.plugin.install":
        case "supervised.plugin.upgrade":
        case "supervised.plugin.enable":
        case "supervised.plugin.disable":
        case "supervised.plugin.revoke":
        case "supervised.plugin.reset-circuit":
          return "plugin" as const;
        case "supervised.signal.acknowledge":
          return "signal" as const;
        case "supervised.intervention.propose":
        case "supervised.intervention.reconcile":
          return "intervention" as const;
      }
    })();
    return { aggregateKind, aggregateId: command.aggregateId };
  }
  switch (command.type) {
    case "space.create":
    case "space.meta.update":
    case "space.reorder":
    case "space.delete":
    case "space.projects.assign":
      return {
        aggregateKind: "space",
        aggregateId: command.spaceId,
      };
    case "project.create":
    case "project.meta.update":
    case "project.delete":
      return {
        aggregateKind: "project",
        aggregateId: command.projectId,
      };
    case "task-process.create":
    case "task-process.pause":
    case "task-process.resume":
    case "task-process.complete":
    case "task-process.archive":
    case "project-task.create":
    case "project-task.meta.update":
    case "project-task.reorder":
    case "project-task.dependencies.set":
    case "project-task.dependency.waive":
    case "project-task.thread.bind":
    case "project-task.thread.unbind":
    case "project-task.progress.report":
    case "project-task.blocker.resolve":
    case "project-task.transition":
    case "project-task.complete":
    case "project-task.reopen":
      return {
        aggregateKind: "task_process",
        aggregateId: command.processId,
      };
    default:
      return {
        aggregateKind: "thread",
        aggregateId: command.threadId,
      };
  }
}

// Space and project metadata events share the synchronous "shell" projection path: they
// are cheap, sidebar-visible rows that must be queryable the moment the command commits.
function isShellMetadataEvent(event: OrchestrationEvent): event is ShellMetadataOrchestrationEvent {
  return (
    event.type === "space.created" ||
    event.type === "space.meta-updated" ||
    event.type === "space.order-updated" ||
    event.type === "space.deleted" ||
    event.type === "project.created" ||
    event.type === "project.meta-updated" ||
    event.type === "project.deleted"
  );
}

const makeOrchestrationEngine = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const eventStore = yield* OrchestrationEventStore;
  const commandReceiptRepository = yield* OrchestrationCommandReceiptRepository;
  const managedAttachments = yield* ManagedAttachmentRepository;
  const supervisedGovernanceRepository = yield* SupervisedGovernanceRepository;
  const projectionPipeline = yield* OrchestrationProjectionPipeline;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const serverConfig = yield* ServerConfig;
  const deciderWorkspacePaths = {
    homeDir: serverConfig.homeDir,
    chatWorkspaceRoot: serverConfig.chatWorkspaceRoot,
  } as const;

  let commandReadModel = createEmptyReadModel(new Date().toISOString());

  const commandQueues = {
    control: yield* Queue.bounded<CommandEnvelope>(ORCHESTRATION_COMMAND_QUEUE_CAPACITY),
    user: yield* Queue.bounded<CommandEnvelope>(ORCHESTRATION_COMMAND_QUEUE_CAPACITY),
    normal: yield* Queue.bounded<CommandEnvelope>(ORCHESTRATION_COMMAND_QUEUE_CAPACITY),
    wake: yield* Queue.unbounded<void>(),
  } satisfies OrchestrationCommandQueues<CommandEnvelope>;
  const eventPubSub = yield* PubSub.bounded<OrchestrationEvent>(
    ORCHESTRATION_EVENT_PUBSUB_CAPACITY,
  );
  const initiallyIdle = yield* Deferred.make<void>();
  yield* Deferred.succeed(initiallyIdle, undefined).pipe(Effect.orDie);
  const engineAdmissionState = yield* Ref.make<EngineAdmissionState>({
    phase: "running",
    outstanding: 0,
    idle: initiallyIdle,
  });
  const maintenanceLock = yield* Semaphore.make(1);
  const deferredProjectionDirty = yield* Ref.make(false);
  const deferredProjectionCatchUpInFlight = yield* Ref.make(false);
  const deferredProjectionRetryAttempts = yield* Ref.make(0);
  const deferredProjectionLastFailure = yield* Ref.make<string | null>(null);
  const deferredProjectionScope = yield* Scope.make("sequential");

  // Committed events are durable before they reach this boundary. Once
  // publication starts, a dispatch deadline must not interrupt it and leave
  // live consumers behind the durable log. Bounded PubSub backpressure is
  // therefore lossless; engine scope close shuts the bus to release it.
  const publishCommittedEvent = (event: OrchestrationEvent) =>
    Effect.uninterruptible(PubSub.publish(eventPubSub, event)).pipe(Effect.asVoid);

  const makeCommandTimeoutError = (command: OrchestrationCommand) =>
    new OrchestrationCommandTimeoutError({
      commandId: command.commandId,
      commandType: command.type,
      timeoutMs: ORCHESTRATION_DISPATCH_TIMEOUT_MS,
    });

  const makeCommandInternalError = (
    command: OrchestrationCommand,
    detail = "The orchestration worker crashed before the command could finish.",
  ) =>
    new OrchestrationCommandInternalError({
      commandId: command.commandId,
      commandType: command.type,
      detail,
    });

  const validateCommandReceiptIdentity = (
    receipt: OrchestrationCommandReceipt,
    fingerprint: OrchestrationCommandFingerprint,
  ): Effect.Effect<void, OrchestrationCommandIdentityCollisionError> => {
    if (
      receipt.fingerprintVersion === fingerprint.version &&
      receipt.commandFingerprint === fingerprint.value
    ) {
      return Effect.void;
    }
    const detail =
      receipt.fingerprintVersion === null || receipt.commandFingerprint === null
        ? "The stored receipt predates verifiable command fingerprints; retry with a new command ID."
        : "The command ID is already bound to different command content.";
    return Effect.fail(
      new OrchestrationCommandIdentityCollisionError({
        commandId: receipt.commandId,
        detail,
      }),
    );
  };

  const validateAcceptedAttachmentRetry = (
    command: OrchestrationCommand,
    principal: ManagedAttachmentPrincipal,
  ): Effect.Effect<void, OrchestrationCommandPreviouslyRejectedError | PersistenceSqlError> =>
    Effect.gen(function* () {
      if (command.type !== "thread.turn.start") return;
      const requestedIds = command.message.attachments
        .filter((attachment) => attachment.type === "image" || attachment.type === "file")
        .map((attachment) => attachment.id)
        .sort();
      const claimed = yield* Effect.forEach(
        requestedIds,
        (attachmentId) => managedAttachments.findClaimedById({ attachmentId }),
        { concurrency: 1 },
      );
      const claimedAttachments = claimed.flatMap((attachment) =>
        Option.isSome(attachment) ? [attachment.value] : [],
      );
      const exactIdentity =
        requestedIds.length === claimedAttachments.length &&
        claimedAttachments.every(
          (attachment) =>
            attachment.ownerThreadId === command.threadId &&
            attachment.ownerKind === principal.ownerKind &&
            attachment.ownerId === principal.ownerId &&
            attachment.claimMessageId === command.message.messageId,
        );
      if (!exactIdentity) {
        return yield* new OrchestrationCommandPreviouslyRejectedError({
          commandId: command.commandId,
          detail:
            "The command ID was already accepted with a different managed attachment set or owner.",
        });
      }
    });

  const resolveStoredCommandOutcome = (
    command: OrchestrationCommand,
    principal: ManagedAttachmentPrincipal,
  ): Effect.Effect<{ sequence: number }, OrchestrationDispatchError, never> =>
    Effect.gen(function* () {
      const receiptExit = yield* Effect.exit(
        commandReceiptRepository.getByCommandId({
          commandId: command.commandId,
        }),
      );
      const existingReceipt = receiptExit._tag === "Success" ? receiptExit.value : Option.none();
      if (Option.isNone(existingReceipt)) {
        return yield* makeCommandTimeoutError(command);
      }
      const fingerprint = fingerprintOrchestrationCommand(command);
      yield* validateCommandReceiptIdentity(existingReceipt.value, fingerprint);
      if (existingReceipt.value.status === "accepted") {
        yield* validateAcceptedAttachmentRetry(command, principal);
        return {
          sequence: existingReceipt.value.resultSequence,
        };
      }
      return yield* new OrchestrationCommandPreviouslyRejectedError({
        commandId: command.commandId,
        detail: existingReceipt.value.error ?? "Previously rejected.",
      });
    });

  // When deferred projection slips, supervise bootstrap retries while idle instead of waiting
  // for unrelated future traffic to rediscover the dirty cursor.
  const scheduleDeferredProjectionCatchUp = Effect.fn(function* (input: {
    readonly eventType: OrchestrationEvent["type"];
    readonly sequence: number;
  }) {
    const shouldStart = yield* Ref.modify(
      deferredProjectionCatchUpInFlight,
      (inFlight): readonly [boolean, boolean] => [!inFlight, true],
    );
    if (!shouldStart) {
      return;
    }

    yield* Effect.logWarning("scheduling deferred orchestration projection catch-up").pipe(
      Effect.annotateLogs({
        eventType: input.eventType,
        sequence: input.sequence,
      }),
    );
    const recoverUntilHealthy = Effect.gen(function* () {
      while (yield* Ref.get(deferredProjectionDirty)) {
        const outcome = yield* Effect.exit(
          maintenanceLock.withPermits(1)(projectionPipeline.bootstrap),
        );
        if (outcome._tag === "Success") {
          yield* Ref.set(deferredProjectionDirty, false);
          yield* Ref.set(deferredProjectionRetryAttempts, 0);
          yield* Ref.set(deferredProjectionLastFailure, null);
          yield* Effect.log("deferred orchestration projection catch-up completed").pipe(
            Effect.annotateLogs({
              eventType: input.eventType,
              sequence: input.sequence,
            }),
          );
          return;
        }

        const retryAttempts = yield* Ref.updateAndGet(
          deferredProjectionRetryAttempts,
          (attempts) => attempts + 1,
        );
        const failure = Cause.pretty(outcome.cause);
        yield* Ref.set(deferredProjectionLastFailure, failure);
        const retryDelayMs =
          DEFERRED_PROJECTION_RETRY_DELAYS_MS[
            Math.min(retryAttempts - 1, DEFERRED_PROJECTION_RETRY_DELAYS_MS.length - 1)
          ] ?? 30_000;
        yield* Effect.logWarning(
          "deferred orchestration projection catch-up failed; retrying",
        ).pipe(
          Effect.annotateLogs({
            eventType: input.eventType,
            sequence: input.sequence,
            retryAttempts,
            retryDelayMs,
            cause: failure,
          }),
        );
        yield* Effect.sleep(`${retryDelayMs} millis`);
      }
    }).pipe(Effect.ensuring(Ref.set(deferredProjectionCatchUpInFlight, false)));

    yield* recoverUntilHealthy.pipe(Effect.forkIn(deferredProjectionScope), Effect.asVoid);
  });

  const getProjectionCatchUpStatus: OrchestrationEngineShape["getProjectionCatchUpStatus"] =
    Effect.gen(function* () {
      const [dirty, inFlight, retryAttempts, lastFailure] = yield* Effect.all([
        Ref.get(deferredProjectionDirty),
        Ref.get(deferredProjectionCatchUpInFlight),
        Ref.get(deferredProjectionRetryAttempts),
        Ref.get(deferredProjectionLastFailure),
      ]);
      return {
        state: dirty ? "degraded" : "healthy",
        inFlight,
        retryAttempts,
        lastFailure,
      };
    });

  const refreshCommandReadModelFromProjectionState = Effect.gen(function* () {
    const nextCommandReadModel = yield* projectionSnapshotQuery.getCommandReadModel();
    commandReadModel = nextCommandReadModel;
    return nextCommandReadModel;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("failed to refresh orchestration command read model").pipe(
        Effect.annotateLogs({
          cause: Cause.pretty(cause),
        }),
        Effect.flatMap(() =>
          Effect.fail(
            new OrchestrationCommandInternalError({
              commandId: "repair-local-state",
              commandType: ORCHESTRATION_WS_METHODS.repairState,
              detail:
                "Projection state changed, but the refreshed command snapshot could not be loaded.",
            }),
          ),
        ),
      ),
    ),
  );

  const overlayThread = (
    model: OrchestrationReadModel,
    thread: OrchestrationReadModel["threads"][number],
  ): OrchestrationReadModel => {
    const existingThread = model.threads.find((entry) => entry.id === thread.id);
    const mergedThread =
      existingThread && existingThread.messages.length > 0
        ? {
            ...thread,
            messages: existingThread.messages,
          }
        : thread;
    const hasThread = existingThread !== undefined;
    return {
      ...model,
      threads: hasThread
        ? model.threads.map((entry) => (entry.id === thread.id ? mergedThread : entry))
        : [...model.threads, mergedThread],
    };
  };

  const loadThreadDetailForDecider = (
    command: OrchestrationCommand,
    model: OrchestrationReadModel,
    threadId: ThreadId,
  ): Effect.Effect<OrchestrationReadModel, OrchestrationDispatchError> =>
    projectionSnapshotQuery.getThreadDetailById(threadId).pipe(
      Effect.map((threadOption) =>
        Option.match(threadOption, {
          onNone: () => model,
          onSome: (thread) => overlayThread(model, thread),
        }),
      ),
      Effect.mapError(
        (error) =>
          new OrchestrationCommandInternalError({
            commandId: command.commandId,
            commandType: command.type,
            detail: `Failed to load thread detail for command validation: ${error.message}`,
          }),
      ),
    );

  const buildDeciderReadModel = (
    command: OrchestrationCommand,
  ): Effect.Effect<OrchestrationReadModel, OrchestrationDispatchError> => {
    switch (command.type) {
      case "thread.handoff.create":
      case "thread.fork.create":
        return loadThreadDetailForDecider(command, commandReadModel, command.sourceThreadId);
      case "thread.turn.start":
        return command.sourceProposedPlan
          ? loadThreadDetailForDecider(
              command,
              commandReadModel,
              command.sourceProposedPlan.threadId,
            )
          : Effect.succeed(commandReadModel);
      case "thread.conversation.rollback":
      case "thread.message.edit-and-resend":
      case "thread.message.assistant.complete":
        return loadThreadDetailForDecider(command, commandReadModel, command.threadId);
      default:
        return Effect.succeed(commandReadModel);
    }
  };

  // Rebuild only the project/space projection rows and snapshot cursors.
  // Existing thread/chat projection rows stay in place so older installs do not
  // lose history that is no longer fully represented in orchestration_events.
  const resetDerivedProjectionState = sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`DELETE FROM projection_spaces`;
      yield* sql`DELETE FROM projection_projects`;
      yield* sql`
        DELETE FROM projection_state
        WHERE projector IN ${sql.in(PROJECT_METADATA_SNAPSHOT_PROJECTORS)}
      `;
    }),
  );

  const backupDerivedProjectionState = sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`DROP TABLE IF EXISTS temp_repair_projection_spaces`;
      yield* sql`DROP TABLE IF EXISTS temp_repair_projection_projects`;
      yield* sql`DROP TABLE IF EXISTS temp_repair_projection_state`;
      yield* sql`CREATE TEMP TABLE temp_repair_projection_spaces AS SELECT * FROM projection_spaces`;
      yield* sql`CREATE TEMP TABLE temp_repair_projection_projects AS SELECT * FROM projection_projects`;
      yield* sql`CREATE TEMP TABLE temp_repair_projection_state AS SELECT * FROM projection_state`;
    }),
  );

  const restoreDerivedProjectionState = sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`DELETE FROM projection_spaces`;
      yield* sql`INSERT INTO projection_spaces SELECT * FROM temp_repair_projection_spaces`;
      yield* sql`DELETE FROM projection_projects`;
      yield* sql`INSERT INTO projection_projects SELECT * FROM temp_repair_projection_projects`;
      yield* sql`DELETE FROM projection_state`;
      yield* sql`INSERT INTO projection_state SELECT * FROM temp_repair_projection_state`;
    }),
  );

  const dropProjectionRepairBackup = sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`DROP TABLE IF EXISTS temp_repair_projection_spaces`;
      yield* sql`DROP TABLE IF EXISTS temp_repair_projection_projects`;
      yield* sql`DROP TABLE IF EXISTS temp_repair_projection_state`;
    }),
  );

  const verifyProjectionRepairFence = (repairFence: number) =>
    Effect.gen(function* () {
      if (repairFence === 0) {
        return;
      }
      const rows = yield* sql<{
        readonly projector: string;
        readonly lastAppliedSequence: number;
      }>`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence"
        FROM projection_state
        WHERE projector IN ${sql.in(REQUIRED_REPAIR_PROJECTORS)}
      `;
      const cursorByProjector = new Map(
        rows.map((row) => [row.projector, row.lastAppliedSequence] as const),
      );
      const laggingProjectors = REQUIRED_REPAIR_PROJECTORS.filter(
        (projector) => (cursorByProjector.get(projector) ?? -1) < repairFence,
      );
      if (laggingProjectors.length > 0) {
        return yield* new OrchestrationCommandInternalError({
          commandId: "repair-local-state",
          commandType: ORCHESTRATION_WS_METHODS.repairState,
          detail:
            `Rebuilt local projections did not reach captured event fence ${repairFence}. ` +
            `Lagging projectors: ${laggingProjectors.join(", ")}.`,
        });
      }
    }).pipe(
      Effect.catchTag("SqlError", (sqlError) =>
        Effect.fail(
          new OrchestrationCommandInternalError({
            commandId: "repair-local-state",
            commandType: ORCHESTRATION_WS_METHODS.repairState,
            detail: `Failed to verify the rebuilt projection fence: ${sqlError.message}`,
          }),
        ),
      ),
    );

  // Callers must build this effect inside a fiber (see `runEnvelope`): the body
  // runs synchronously, so anything it throws is only contained when it is raised
  // while an effect is being evaluated.
  const processEnvelope = (envelope: CommandEnvelope): Effect.Effect<void, never> => {
    const dispatchStartSequence = commandReadModel.snapshotSequence;
    const remainingBudgetMs = Math.max(0, envelope.deadlineAtMs - Date.now());
    const commandFingerprint = fingerprintOrchestrationCommand(envelope.command);
    const reconcileCommandReadModelAfterDispatchFailure = Effect.gen(function* () {
      const persistedEvents = yield* Stream.runCollect(
        eventStore.readFromSequence(dispatchStartSequence),
      ).pipe(Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)));
      if (persistedEvents.length === 0) {
        return;
      }

      let nextCommandReadModel = commandReadModel;
      for (const persistedEvent of persistedEvents) {
        nextCommandReadModel = yield* projectEvent(nextCommandReadModel, persistedEvent);
      }
      commandReadModel = nextCommandReadModel;

      for (const persistedEvent of persistedEvents) {
        yield* publishCommittedEvent(persistedEvent);
      }
    });

    const runCommand = Effect.gen(function* () {
      const shouldSkip = yield* Ref.modify(envelope.executionState, (state) => {
        if (state === "abandoned") {
          return [true, state] as const;
        }
        return [false, "in-flight"] as const;
      });
      if (shouldSkip) {
        return;
      }

      if (remainingBudgetMs === 0) {
        return yield* makeCommandTimeoutError(envelope.command);
      }

      const existingReceipt = yield* commandReceiptRepository.getByCommandId({
        commandId: envelope.command.commandId,
      });
      if (Option.isSome(existingReceipt)) {
        const identityResult = yield* Effect.result(
          validateCommandReceiptIdentity(existingReceipt.value, commandFingerprint),
        );
        if (identityResult._tag === "Failure") {
          yield* Deferred.fail(envelope.result, identityResult.failure);
          return;
        }
        if (existingReceipt.value.status === "accepted") {
          yield* validateAcceptedAttachmentRetry(envelope.command, envelope.attachmentPrincipal);
          yield* Deferred.succeed(envelope.result, {
            sequence: existingReceipt.value.resultSequence,
          });
          return;
        }
        yield* Deferred.fail(
          envelope.result,
          new OrchestrationCommandPreviouslyRejectedError({
            commandId: envelope.command.commandId,
            detail: existingReceipt.value.error ?? "Previously rejected.",
          }),
        );
        return;
      }

      let command: OrchestrationCommand = envelope.command;
      if (command.type === "thread.turn.start") {
        const startCommand = command;
        const attachments = yield* Effect.forEach(
          startCommand.message.attachments,
          (attachment) => {
            if (attachment.type === "assistant-selection") {
              return Effect.succeed<ChatAttachment>(attachment);
            }
            return managedAttachments
              .findServerOwned({
                attachmentId: attachment.id,
                ownerThreadId: startCommand.threadId,
                ownerKind: envelope.attachmentPrincipal.ownerKind,
                ownerId: envelope.attachmentPrincipal.ownerId,
                now: new Date().toISOString(),
              })
              .pipe(
                Effect.flatMap((found) =>
                  Option.match(found, {
                    onNone: () =>
                      Effect.fail(
                        new OrchestrationCommandInvariantError({
                          commandType: startCommand.type,
                          detail: `Managed attachment ${attachment.id} is unavailable, expired, or owned by another session/thread.`,
                        }),
                      ),
                    onSome: (blob) => {
                      if (blob.kind !== "image" && blob.kind !== "file") {
                        return Effect.fail(
                          new OrchestrationCommandInvariantError({
                            commandType: startCommand.type,
                            detail: `Managed attachment ${attachment.id} has unsupported kind '${blob.kind}'.`,
                          }),
                        );
                      }
                      return Effect.succeed<ChatAttachment>({
                        type: blob.kind,
                        id: blob.attachmentId,
                        name: blob.originalName,
                        mimeType: blob.mimeType,
                        sizeBytes: blob.sizeBytes!,
                      });
                    },
                  }),
                ),
              );
          },
          { concurrency: 1 },
        );
        command = {
          ...startCommand,
          message: { ...startCommand.message, attachments },
        };
      }

      const baseDeciderReadModel = yield* buildDeciderReadModel(command);
      let governance = yield* supervisedGovernanceRepository.getSnapshot();
      let governanceDecisionState = governanceDecisionStateFromSnapshot({
        governance,
        runtime: baseDeciderReadModel.supervised,
      });
      if (command.type === "thread.turn.start") {
        const frozenLead = governanceDecisionState.leads.find(
          (lead) => lead.activeThreadId === command.threadId && lead.status === "rotating",
        );
        if (frozenLead) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: command.type,
            detail:
              "Lead dispatch is frozen while replacement is in progress. The draft remains available after the active Lead pointer settles.",
          });
        }
      }
      const threadBootstrapDecision =
        command.type === "thread.turn.start" && command.threadBootstrap !== undefined
          ? yield* decideOrchestrationCommand({
              command: {
                type: "thread.create",
                commandId: command.commandId,
                threadId: command.threadId,
                ...command.threadBootstrap,
              },
              readModel: baseDeciderReadModel,
              workspacePaths: deciderWorkspacePaths,
            })
          : null;
      const deciderReadModel =
        threadBootstrapDecision === null
          ? baseDeciderReadModel
          : yield* projectEvent(baseDeciderReadModel, {
              ...threadBootstrapDecision,
              sequence: baseDeciderReadModel.snapshotSequence,
            });
      const supervisedBootstrapDecision =
        command.type === "thread.turn.start" && command.supervisedBootstrap !== undefined
          ? yield* Effect.gen(function* () {
              const bootstrap = command.supervisedBootstrap!;
              if (bootstrap.profileSnapshot === undefined) {
                return yield* new OrchestrationCommandInvariantError({
                  commandType: command.type,
                  detail: "Server-resolved Supervised profile snapshot is required.",
                });
              }
              return yield* decideSupervisedGovernanceCommand({
                state: governanceDecisionState,
                command:
                  bootstrap.kind === "lead"
                    ? {
                        type: "supervised.lead.enroll",
                        commandId: command.commandId,
                        aggregateId: SupervisedGovernanceAggregateId.makeUnsafe("supervised"),
                        actor: { kind: "user", actorId: "owner" },
                        expectedRevision: 0,
                        createdAt: command.createdAt,
                        profilePresetId: bootstrap.profilePresetId,
                        profileSnapshot: bootstrap.profileSnapshot,
                        lead: bootstrap.lead,
                      }
                    : {
                        type: "supervised.supervisor.create",
                        commandId: command.commandId,
                        aggregateId: SupervisedGovernanceAggregateId.makeUnsafe("supervised"),
                        actor: { kind: "user", actorId: "owner" },
                        expectedRevision: 0,
                        createdAt: command.createdAt,
                        profilePresetId: bootstrap.profilePresetId,
                        profileSnapshot: bootstrap.profileSnapshot,
                        supervisor: bootstrap.supervisor,
                        initialMission: bootstrap.initialMission,
                      },
              });
            })
          : null;
      let commandDeciderReadModel = deciderReadModel;
      if (supervisedBootstrapDecision !== null) {
        for (const decision of Array.isArray(supervisedBootstrapDecision)
          ? supervisedBootstrapDecision
          : [supervisedBootstrapDecision]) {
            const projectedDecision = {
              ...decision,
              sequence: commandDeciderReadModel.snapshotSequence,
            };
            commandDeciderReadModel = yield* projectEvent(
              commandDeciderReadModel,
              projectedDecision,
            );
            governanceDecisionState = projectSupervisedGovernanceDecisionEvent(
              governanceDecisionState,
              projectedDecision,
            );
          }
        governance = reconcileGovernanceProjection({
          governance,
          state: governanceDecisionState,
          runtime: commandDeciderReadModel.supervised,
          at: command.createdAt,
          source: "canonical",
        });
      }
      const supervisedRoomLifecycleDecisions =
        command.type === "thread.turn.start" || command.type === "thread.session.set"
          ? yield* decideSupervisedRoomLifecycleForThreadCommand({
              command,
              projectId:
                commandDeciderReadModel.threads.find(
                  (thread) => thread.id === command.threadId,
                )?.projectId ?? null,
              governance,
              runtime: commandDeciderReadModel.supervised,
            })
          : [];
      for (const decision of supervisedRoomLifecycleDecisions) {
        commandDeciderReadModel = yield* projectEvent(commandDeciderReadModel, {
          ...decision,
          sequence: commandDeciderReadModel.snapshotSequence,
        });
      }
      const commandEventBase =
        command.type === "supervised.lead.create"
          ? yield* Effect.gen(function* () {
              if (command.profileSnapshot === undefined) {
                return yield* new OrchestrationCommandInvariantError({
                  commandType: command.type,
                  detail: "Server-resolved Lead profile snapshot is required.",
                });
              }
              const project = commandDeciderReadModel.projects.find(
                (candidate) =>
                  candidate.id === command.room.projectId && candidate.deletedAt === null,
              );
              const supervisor = governanceDecisionState.supervisors.find(
                (candidate) =>
                  candidate.id === command.supervisorSeatId &&
                  candidate.status === "active" &&
                  candidate.activeThreadId === command.actor.actorId,
              );
              const supervisorSeat = governance.agentSeats.find(
                (candidate) =>
                  candidate.id === command.supervisorSeatId &&
                  candidate.identityRole === "supervisor" &&
                  candidate.threadId === supervisor?.activeThreadId &&
                  (candidate.lifecycleState === "ready" ||
                    candidate.lifecycleState === "active"),
              );
              if (
                !project ||
                !supervisor ||
                !supervisorSeat ||
                command.actor.kind !== "seat" ||
                command.actor.seatId !== command.supervisorSeatId ||
                command.threadId !== command.room.id ||
                command.room.leadSeatId !== command.leadSeatId ||
                command.room.status !== "active" ||
                command.room.revision !== 0 ||
                command.room.graphRevision !== 0
              ) {
                return yield* new OrchestrationCommandInvariantError({
                  commandType: command.type,
                  detail:
                    "Lead creation requires an active scoped Supervisor, Project, and a fresh atomically bound Room.",
                });
              }
              const runtimeMode =
                command.profileSnapshot.runtime.sandboxMode === "danger-full-access"
                  ? ("full-access" as const)
                  : ("approval-required" as const);
              const threadDecision = yield* decideOrchestrationCommand({
                command: {
                  type: "thread.create",
                  commandId: command.commandId,
                  threadId: command.threadId,
                  projectId: command.room.projectId,
                  title: command.room.title,
                  modelSelection: {
                    provider: command.profileSnapshot.runtime.provider,
                    model: command.profileSnapshot.runtime.model,
                    options: command.profileSnapshot.runtime.providerOptions ?? {},
                  } as never,
                  runtimeMode,
                  interactionMode: "default",
                  envMode: "local",
                  branch: null,
                  worktreePath: null,
                  workingDirectory: command.workingDirectory,
                  parentThreadId: supervisor.activeThreadId,
                  creationSource: "supervised_native",
                  sourceThreadId: supervisor.activeThreadId,
                  subagentAgentId: null,
                  subagentNickname: null,
                  subagentRole: "lead",
                  lastKnownPr: null,
                  createdAt: command.createdAt,
                },
                readModel: commandDeciderReadModel,
                workspacePaths: deciderWorkspacePaths,
              });
              const readModelWithThread = yield* projectEvent(commandDeciderReadModel, {
                ...threadDecision,
                sequence: commandDeciderReadModel.snapshotSequence,
              });
              const leadDecision = yield* decideSupervisedGovernanceCommand({
                state: governanceDecisionState,
                command: {
                  type: "supervised.lead.enroll",
                  commandId: command.commandId,
                  aggregateId: SupervisedGovernanceAggregateId.makeUnsafe("supervised"),
                  actor: {
                    kind: "thread",
                    actorId: supervisor.activeThreadId,
                    threadId: supervisor.activeThreadId,
                  },
                  expectedRevision: 0,
                  createdAt: command.createdAt,
                  profilePresetId: command.profilePresetId,
                  profileSnapshot: command.profileSnapshot,
                  lead: {
                    id: command.leadSeatId,
                    projectId: command.room.projectId,
                    activeThreadId: command.threadId,
                    predecessorThreadIds: [],
                    profileSnapshotId: command.profileSnapshot.id,
                    status: "active",
                    createdAt: command.createdAt,
                    updatedAt: command.createdAt,
                    archivedAt: null,
                    revision: 0,
                  },
                },
              });
              let governanceStateWithLead = governanceDecisionState;
              for (const decision of Array.isArray(leadDecision)
                ? leadDecision
                : [leadDecision]) {
                governanceStateWithLead = projectSupervisedGovernanceDecisionEvent(
                  governanceStateWithLead,
                  {
                    ...decision,
                    sequence: readModelWithThread.snapshotSequence,
                  },
                );
              }
              const governanceWithLead = reconcileGovernanceProjection({
                governance,
                state: governanceStateWithLead,
                runtime: readModelWithThread.supervised,
                at: command.createdAt,
                source: "canonical",
              });
              const roomDecision = yield* decideSupervisedCommand({
                command: {
                  type: "supervised.room.create",
                  commandId: command.commandId,
                  aggregateId: command.room.id,
                  actor: command.actor,
                  ...(command.authorityReceiptId === undefined
                    ? {}
                    : { authorityReceiptId: command.authorityReceiptId }),
                  expectedRevision: 0,
                  idempotencyKey: `lead-room:${command.room.id}`,
                  createdAt: command.createdAt,
                  room: command.room,
                },
                state: readModelWithThread.supervised,
                governance: governanceWithLead,
              });
              const turnDecision =
                command.initialPrompt === undefined
                  ? []
                  : yield* (() => {
                      const messageId = MessageId.makeUnsafe(
                        `lead:${command.leadSeatId}:initial`,
                      );
                      return decideOrchestrationCommand({
                        command: {
                          type: "thread.turn.start",
                          commandId: command.commandId,
                          threadId: command.threadId,
                          message: {
                            messageId,
                            role: "thread",
                            text: command.initialPrompt,
                            attachments: [],
                          },
                          dispatchMode: "queue",
                          dispatchOrigin: "agent",
                          threadOrigin: {
                            messageId,
                            rootThreadId: supervisor.activeThreadId,
                            senderThreadId: supervisor.activeThreadId,
                            targetThreadId: command.threadId,
                            assignmentId: command.leadSeatId,
                            runId: null,
                            correlationId: command.commandId,
                            replyToMessageId: null,
                            hopCount: 0,
                            artifactRefs: [],
                          },
                          runtimeMode,
                          interactionMode: "default",
                          createdAt: command.createdAt,
                        },
                        readModel: readModelWithThread,
                        workspacePaths: deciderWorkspacePaths,
                      });
                    })();
              return [
                threadDecision,
                ...(Array.isArray(leadDecision) ? leadDecision : [leadDecision]),
                ...(Array.isArray(roomDecision) ? roomDecision : [roomDecision]),
                ...(Array.isArray(turnDecision) ? turnDecision : [turnDecision]),
              ];
            })
          : command.type === "supervised.task-graph.create"
            ? yield* Effect.gen(function* () {
                const room = commandDeciderReadModel.supervised.rooms.find(
                  (candidate) => candidate.id === command.task.roomId,
                );
                const nextGraphRevision = (room?.graphRevision ?? -1) + 1;
                const nodeIds = new Set(command.nodes.map(({ taskNode }) => taskNode.id));
                const graphShapeValid =
                  room !== undefined &&
                  room.leadSeatId !== null &&
                  command.task.revision === 0 &&
                  command.task.activeGraphRevision === nextGraphRevision &&
                  nodeIds.size === command.nodes.length &&
                  command.nodes.every(({ taskNode, taskNodeRevision }) =>
                    taskNode.taskId === command.task.id &&
                    taskNode.roomId === command.task.roomId &&
                    taskNode.revision === 0 &&
                    taskNode.graphRevision === nextGraphRevision &&
                    taskNode.activeRevisionId === taskNodeRevision.id &&
                    taskNodeRevision.taskNodeId === taskNode.id &&
                    taskNodeRevision.graphRevision === nextGraphRevision &&
                    taskNodeRevision.dependencyNodeIds.every(
                      (dependencyId) =>
                        dependencyId !== taskNode.id && nodeIds.has(dependencyId),
                    )
                  );
                if (!graphShapeValid) {
                  return yield* new OrchestrationCommandInvariantError({
                    commandType: command.type,
                    detail:
                      "Task Graph creation requires one fresh Task, unique in-graph nodes, and a single next graph revision.",
                  });
                }
                const dependenciesByNode = new Map(
                  command.nodes.map(({ taskNode, taskNodeRevision }) => [
                    taskNode.id,
                    taskNodeRevision.dependencyNodeIds,
                  ]),
                );
                const visiting = new Set<string>();
                const visited = new Set<string>();
                const hasCycle = (nodeId: string): boolean => {
                  if (visiting.has(nodeId)) return true;
                  if (visited.has(nodeId)) return false;
                  visiting.add(nodeId);
                  for (const dependencyId of dependenciesByNode.get(nodeId) ?? []) {
                    if (hasCycle(dependencyId)) return true;
                  }
                  visiting.delete(nodeId);
                  visited.add(nodeId);
                  return false;
                };
                if ([...nodeIds].some(hasCycle)) {
                  return yield* new OrchestrationCommandInvariantError({
                    commandType: command.type,
                    detail: "Task Graph dependencies must be acyclic.",
                  });
                }

                let graphReadModel = commandDeciderReadModel;
                const decisions: Array<Omit<OrchestrationEvent, "sequence">> = [];
                const decideAndProject = (
                  nestedCommand: Extract<
                    SupervisedCommand,
                    {
                      readonly type:
                        | "supervised.room.update"
                        | "supervised.task.create"
                        | "supervised.task-node.commit";
                    }
                  >,
                ) =>
                  Effect.gen(function* () {
                    const decision = yield* decideSupervisedCommand({
                      command: nestedCommand,
                      state: graphReadModel.supervised,
                      governance,
                    });
                    for (const next of Array.isArray(decision) ? decision : [decision]) {
                      decisions.push(next);
                      graphReadModel = yield* projectEvent(graphReadModel, {
                        ...next,
                        sequence: graphReadModel.snapshotSequence,
                      });
                    }
                  });
                const nestedBase = {
                  commandId: command.commandId,
                  actor: command.actor,
                  ...(command.authorityReceiptId === undefined
                    ? {}
                    : { authorityReceiptId: command.authorityReceiptId }),
                  createdAt: command.createdAt,
                };
                yield* decideAndProject({
                  ...nestedBase,
                  type: "supervised.room.update",
                  aggregateId: room!.id,
                  expectedRevision: room!.revision,
                  idempotencyKey: `task-graph-room:${command.task.id}`,
                  room: {
                    ...room!,
                    graphRevision: nextGraphRevision,
                    updatedAt: command.createdAt,
                  },
                });
                yield* decideAndProject({
                  ...nestedBase,
                  type: "supervised.task.create",
                  aggregateId: command.task.id,
                  expectedRevision: 0,
                  idempotencyKey: `task-graph-task:${command.task.id}`,
                  task: command.task,
                });
                for (const { taskNode, taskNodeRevision } of command.nodes) {
                  yield* decideAndProject({
                    ...nestedBase,
                    type: "supervised.task-node.commit",
                    aggregateId: command.task.id,
                    expectedRevision: 0,
                    idempotencyKey: `task-graph-node:${taskNode.id}`,
                    taskNode,
                    taskNodeRevision,
                  });
                }
                return decisions;
              })
            : command.type === "supervised.peer.create"
          ? yield* Effect.gen(function* () {
              if (command.profileSnapshot === undefined) {
                return yield* new OrchestrationCommandInvariantError({
                  commandType: command.type,
                  detail: "Server-resolved Peer profile snapshot is required.",
                });
              }
              const room = commandDeciderReadModel.supervised.rooms.find(
                (candidate) =>
                  candidate.id === command.roomId &&
                  candidate.projectId === command.projectId &&
                  candidate.leadSeatId === command.leadSeatId,
              );
              const lead = governanceDecisionState.leads.find(
                (candidate) =>
                  candidate.id === command.leadSeatId &&
                  candidate.projectId === command.projectId &&
                  candidate.activeThreadId === command.leadThreadId &&
                  candidate.status === "active",
              );
              if (!room || !lead) {
                return yield* new OrchestrationCommandInvariantError({
                  commandType: command.type,
                  detail: "Peer creation requires the Room's active Lead authority.",
                });
              }
              const runtimeMode =
                command.profileSnapshot.runtime.sandboxMode === "danger-full-access"
                  ? ("full-access" as const)
                  : ("approval-required" as const);
              const threadDecision = yield* decideOrchestrationCommand({
                command: {
                  type: "thread.create",
                  commandId: command.commandId,
                  threadId: command.threadId,
                  projectId: command.projectId,
                  title: command.title,
                  modelSelection: {
                    provider: command.profileSnapshot.runtime.provider,
                    model: command.profileSnapshot.runtime.model,
                    options: command.profileSnapshot.runtime.providerOptions ?? {},
                  } as never,
                  runtimeMode,
                  interactionMode: "default",
                  envMode: "local",
                  branch: null,
                  worktreePath: null,
                  workingDirectory: command.workingDirectory,
                  parentThreadId: command.leadThreadId,
                  creationSource: "supervised_native",
                  sourceThreadId: command.leadThreadId,
                  subagentAgentId: null,
                  subagentNickname: null,
                  subagentRole: "peer",
                  lastKnownPr: null,
                  createdAt: command.createdAt,
                },
                readModel: commandDeciderReadModel,
                workspacePaths: deciderWorkspacePaths,
              });
              const readModelWithThread = yield* projectEvent(commandDeciderReadModel, {
                ...threadDecision,
                sequence: commandDeciderReadModel.snapshotSequence,
              });
              const peerDecision = yield* decideSupervisedGovernanceCommand({
                state: governanceDecisionState,
                command: {
                  type: "supervised.peer.bind",
                  commandId: command.commandId,
                  aggregateId: SupervisedGovernanceAggregateId.makeUnsafe("supervised"),
                  actor: { kind: "user", actorId: "owner" },
                  expectedRevision: 0,
                  createdAt: command.createdAt,
                  profilePresetId: command.profilePresetId,
                  profileSnapshot: command.profileSnapshot,
                  peer: {
                    threadId: command.threadId,
                    projectId: command.projectId,
                    leadSeatId: command.leadSeatId,
                    rootThreadId: command.leadThreadId,
                    profileSnapshotId: command.profileSnapshot.id,
                    status: "active",
                    createdAt: command.createdAt,
                    updatedAt: command.createdAt,
                    archivedAt: null,
                    revision: 0,
                  },
                },
              });
              const peerSpecialtyDecision = yield* decideSupervisedCommand({
                command,
                state: readModelWithThread.supervised,
                governance,
              });
              const turnDecision =
                command.initialPrompt === undefined
                  ? []
                  : yield* (() => {
                      const messageId = MessageId.makeUnsafe(
                        `peer:${command.peerSpecialty.id}:initial`,
                      );
                      return decideOrchestrationCommand({
                        command: {
                          type: "thread.turn.start",
                          commandId: command.commandId,
                          threadId: command.threadId,
                          message: {
                            messageId,
                            role: "thread",
                            text: command.initialPrompt,
                            attachments: [],
                          },
                          dispatchMode: "queue",
                          dispatchOrigin: "agent",
                          threadOrigin: {
                            messageId,
                            rootThreadId: command.leadThreadId,
                            senderThreadId: command.leadThreadId,
                            targetThreadId: command.threadId,
                            assignmentId: command.peerSpecialty.id,
                            runId: null,
                            correlationId: command.commandId,
                            replyToMessageId: null,
                            hopCount: 0,
                            artifactRefs: [],
                          },
                          runtimeMode,
                          interactionMode: "default",
                          createdAt: command.createdAt,
                        },
                        readModel: readModelWithThread,
                        workspacePaths: deciderWorkspacePaths,
                      });
                    })();
              return [
                threadDecision,
                ...(Array.isArray(peerDecision) ? peerDecision : [peerDecision]),
                ...(Array.isArray(peerSpecialtyDecision)
                  ? peerSpecialtyDecision
                  : [peerSpecialtyDecision]),
                ...(Array.isArray(turnDecision) ? turnDecision : [turnDecision]),
              ];
            })
          : Schema.is(SupervisedGovernanceCommand)(command)
            ? yield* decideSupervisedGovernanceCommand({
                command,
                state: governanceDecisionState,
              })
            : Schema.is(SupervisedCommand)(command)
              ? yield* decideSupervisedCommand({
                  command,
                  state: commandDeciderReadModel.supervised,
                  governance,
                })
              : Schema.is(TaskProcessCommand)(command)
                ? yield* Effect.gen(function* () {
                    const storedEvents = yield* eventStore
                      .readAggregateEvents({
                        aggregateKind: "task_process",
                        aggregateId: command.processId,
                      })
                      .pipe(
                        Effect.mapError((error) =>
                          makeCommandInternalError(
                            command,
                            `Failed to load TaskProcess aggregate: ${error.message}`,
                          ),
                        ),
                      );
                    const taskProcessEvents = storedEvents.filter(
                      Schema.is(TaskProcessDomainEvent),
                    );
                    if (taskProcessEvents.length !== storedEvents.length) {
                      return yield* makeCommandInternalError(
                        command,
                        "TaskProcess stream contains an event with the wrong aggregate schema.",
                      );
                    }
                    const state = replayTaskProcessEvents(taskProcessEvents);
                    return yield* decideTaskProcessCommand({
                      command,
                      state,
                      readModel: commandDeciderReadModel,
                    });
                  })
                : yield* decideOrchestrationCommand({
                    command,
                    readModel: commandDeciderReadModel,
                    workspacePaths: deciderWorkspacePaths,
                  });
      const eventBase = [
        ...(threadBootstrapDecision === null ? [] : [threadBootstrapDecision]),
        ...(supervisedBootstrapDecision === null
          ? []
          : Array.isArray(supervisedBootstrapDecision)
            ? supervisedBootstrapDecision
            : [supervisedBootstrapDecision]),
        ...(command.type === "thread.session.set" ? [] : supervisedRoomLifecycleDecisions),
        ...(Array.isArray(commandEventBase) ? commandEventBase : [commandEventBase]),
        ...(command.type === "thread.session.set" ? supervisedRoomLifecycleDecisions : []),
      ];
      const eventBases = Array.isArray(eventBase) ? eventBase : [eventBase];
      const transactionalCommitEffect: Effect.Effect<
        CommittedCommandResult,
        OrchestrationDispatchError,
        never
      > = Effect.gen(function* () {
        const committedEvents: OrchestrationEvent[] = [];
        let nextCommandReadModel = commandReadModel;

        if (command.type === "thread.turn.start") {
          const attachmentIds = command.message.attachments
            .filter((attachment) => attachment.type === "image" || attachment.type === "file")
            .map((attachment) => attachment.id);
          const claim = yield* managedAttachments.claimForAcceptedTurn({
            attachmentIds,
            ownerThreadId: command.threadId,
            ownerKind: envelope.attachmentPrincipal.ownerKind,
            ownerId: envelope.attachmentPrincipal.ownerId,
            commandId: command.commandId,
            messageId: command.message.messageId,
            now: new Date().toISOString(),
          });
          if (claim.status !== "claimed") {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: `Managed attachment claim was rejected: ${claim.reason}.`,
            });
          }
        }

        for (const nextEvent of eventBases) {
          const savedEvent = yield* eventStore.append(nextEvent);
          nextCommandReadModel = yield* projectEvent(nextCommandReadModel, savedEvent);
          if (isShellMetadataEvent(savedEvent)) {
            yield* projectionPipeline.projectMetadataEvent(savedEvent);
          } else {
            yield* projectionPipeline.projectHotEventInCurrentTransaction(savedEvent);
          }
          committedEvents.push(savedEvent);
        }

        const lastSavedEvent = committedEvents.at(-1) ?? null;
        if (lastSavedEvent === null) {
          return yield* new OrchestrationCommandInvariantError({
            commandType: envelope.command.type,
            detail: "Command produced no events.",
          });
        }

        const receiptInserted = yield* commandReceiptRepository.insert({
          commandId: envelope.command.commandId,
          aggregateKind: lastSavedEvent.aggregateKind,
          aggregateId: lastSavedEvent.aggregateId,
          acceptedAt: lastSavedEvent.occurredAt,
          resultSequence: lastSavedEvent.sequence,
          status: "accepted",
          error: null,
          fingerprintVersion: commandFingerprint.version,
          commandFingerprint: commandFingerprint.value,
        });
        if (!receiptInserted) {
          return yield* new OrchestrationCommandIdentityCollisionError({
            commandId: envelope.command.commandId,
            detail: "A receipt with this command ID appeared while the command was committing.",
          });
        }

        return {
          committedEvents,
          lastSequence: lastSavedEvent.sequence,
          nextCommandReadModel,
        } as const;
      }).pipe(
        Effect.catchCause((cause): Effect.Effect<never, OrchestrationDispatchError, never> => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.interrupt;
          }
          const typedFailure = Cause.findErrorOption(cause);
          if (
            Option.isSome(typedFailure) &&
            (typedFailure.value instanceof OrchestrationCommandInvariantError ||
              typedFailure.value instanceof OrchestrationCommandIdentityCollisionError)
          ) {
            return Effect.fail(typedFailure.value);
          }
          return Effect.logError(
            "orchestration command crashed inside persistence transaction",
          ).pipe(
            Effect.annotateLogs({
              commandId: envelope.command.commandId,
              commandType: envelope.command.type,
              cause: Cause.pretty(cause),
            }),
            Effect.flatMap(() =>
              Effect.fail(
                makeCommandInternalError(
                  envelope.command,
                  "The command hit an unexpected internal error before it could be saved.",
                ),
              ),
            ),
          );
        }),
      );

      const committedCommand = yield* sql
        .withTransaction(transactionalCommitEffect)
        .pipe(
          Effect.catchTag("SqlError", (sqlError) =>
            Effect.fail(
              toPersistenceSqlError("OrchestrationEngine.processEnvelope:transaction")(sqlError),
            ),
          ),
        );

      commandReadModel = committedCommand.nextCommandReadModel;
      yield* Effect.forEach(
        committedCommand.committedEvents,
        (event) =>
          Effect.gen(function* () {
            const isDeferredProjectionDirty = yield* Ref.get(deferredProjectionDirty);
            if (isDeferredProjectionDirty) {
              yield* scheduleDeferredProjectionCatchUp({
                eventType: event.type,
                sequence: event.sequence,
              });
              return;
            }

            const deferredProjectionOutcome = yield* projectionPipeline
              .projectDeferredEvent(event)
              .pipe(
                Effect.matchCause({
                  onFailure: (cause) => ({ _tag: "failure" as const, cause }),
                  onSuccess: () => ({ _tag: "success" as const }),
                }),
              );

            if (deferredProjectionOutcome._tag === "success") {
              return;
            }

            yield* Ref.set(deferredProjectionDirty, true);
            yield* Effect.logWarning("deferred orchestration projector failed", {
              sequence: event.sequence,
              eventType: event.type,
              cause: Cause.pretty(deferredProjectionOutcome.cause),
            });
            yield* scheduleDeferredProjectionCatchUp({
              eventType: event.type,
              sequence: event.sequence,
            });
          }),
        { concurrency: 1 },
      );
      for (const event of committedCommand.committedEvents) {
        yield* publishCommittedEvent(event);
      }
      yield* Deferred.succeed(envelope.result, { sequence: committedCommand.lastSequence });
    }).pipe(
      Effect.timeoutOption(remainingBudgetMs),
      Effect.flatMap((outcome) =>
        Option.match(outcome, {
          onNone: () => Effect.fail(makeCommandTimeoutError(envelope.command)),
          onSome: Effect.succeed,
        }),
      ),
      Effect.catch((error: OrchestrationDispatchError) =>
        Effect.gen(function* () {
          yield* reconcileCommandReadModelAfterDispatchFailure.pipe(
            Effect.catch(() =>
              Effect.logWarning(
                "failed to reconcile orchestration read model after dispatch failure",
              ).pipe(
                Effect.annotateLogs({
                  commandId: envelope.command.commandId,
                  snapshotSequence: commandReadModel.snapshotSequence,
                }),
              ),
            ),
          );

          if (Schema.is(OrchestrationCommandTimeoutError)(error)) {
            const resolvedTimeoutOutcome = yield* resolveStoredCommandOutcome(
              envelope.command,
              envelope.attachmentPrincipal,
            ).pipe(
              Effect.match({
                onFailure: (resolvedError) => ({ _tag: "Left" as const, left: resolvedError }),
                onSuccess: (value) => ({ _tag: "Right" as const, right: value }),
              }),
            );
            if (resolvedTimeoutOutcome._tag === "Right") {
              yield* Deferred.succeed(envelope.result, resolvedTimeoutOutcome.right);
              return;
            }
            error = resolvedTimeoutOutcome.left;
          }

          if (Schema.is(OrchestrationCommandInvariantError)(error)) {
            const aggregateRef = commandToAggregateRef(envelope.command);
            yield* commandReceiptRepository
              .insert({
                commandId: envelope.command.commandId,
                aggregateKind: aggregateRef.aggregateKind,
                aggregateId: aggregateRef.aggregateId,
                acceptedAt: new Date().toISOString(),
                resultSequence: commandReadModel.snapshotSequence,
                status: "rejected",
                error: error.message,
                fingerprintVersion: commandFingerprint.version,
                commandFingerprint: commandFingerprint.value,
              })
              .pipe(Effect.catch(() => Effect.void));
          }
          yield* Deferred.fail(envelope.result, error);
        }),
      ),
      Effect.catchCause((cause): Effect.Effect<void, never, never> => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.interrupt;
        }
        return Effect.gen(function* () {
          yield* reconcileCommandReadModelAfterDispatchFailure.pipe(
            Effect.catch(() =>
              Effect.logWarning(
                "failed to reconcile orchestration read model after unexpected worker failure",
              ).pipe(
                Effect.annotateLogs({
                  commandId: envelope.command.commandId,
                  snapshotSequence: commandReadModel.snapshotSequence,
                }),
              ),
            ),
          );

          yield* Effect.logError("orchestration worker crashed while processing command").pipe(
            Effect.annotateLogs({
              commandId: envelope.command.commandId,
              commandType: envelope.command.type,
              cause: Cause.pretty(cause),
            }),
          );

          const resolvedCrashOutcome = yield* resolveStoredCommandOutcome(
            envelope.command,
            envelope.attachmentPrincipal,
          ).pipe(
            Effect.match({
              onFailure: (resolvedError) => ({ _tag: "Left" as const, left: resolvedError }),
              onSuccess: (value) => ({ _tag: "Right" as const, right: value }),
            }),
          );

          if (resolvedCrashOutcome._tag === "Right") {
            yield* Deferred.succeed(envelope.result, resolvedCrashOutcome.right);
            return;
          }

          const resolvedError = resolvedCrashOutcome.left;
          yield* Deferred.fail(
            envelope.result,
            Schema.is(OrchestrationCommandTimeoutError)(resolvedError)
              ? makeCommandInternalError(envelope.command)
              : resolvedError,
          );
        });
      }),
    );

    return maintenanceLock.withPermits(1)(runCommand);
  };

  yield* projectionPipeline.bootstrap;

  commandReadModel = yield* projectionSnapshotQuery.getCommandReadModel();

  const finishEnvelope = Ref.modify(engineAdmissionState, (current) => {
    const outstanding = Math.max(0, current.outstanding - 1);
    return [
      outstanding === 0 ? current.idle : null,
      {
        ...current,
        outstanding,
      },
    ] as const;
  }).pipe(
    Effect.flatMap((idle) =>
      idle === null ? Effect.void : Deferred.succeed(idle, undefined).pipe(Effect.orDie),
    ),
  );

  /**
   * Runs one envelope with the worker's structural safety net.
   *
   * `processEnvelope` builds its effect synchronously, so a throw raised while
   * building it (schema/normalization helpers, read-model access, anything added
   * to that body later) would otherwise propagate into the worker's `flatMap`
   * before `Effect.ensuring` is attached: the envelope would never be finished
   * (`outstanding` leaks, `drain` hangs, the caller waits out the dispatch
   * timeout) and the defect would kill the worker fiber, wedging every later
   * command. Building it inside `Effect.suspend` turns that into a defect of this
   * effect, which is contained per envelope so one poisoned command fails alone.
   */
  const runEnvelope = (envelope: CommandEnvelope): Effect.Effect<void> =>
    Effect.suspend(() => processEnvelope(envelope)).pipe(
      Effect.catchCause((cause): Effect.Effect<void> => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.interrupt;
        }
        return Effect.logError("orchestration worker defect while processing command").pipe(
          Effect.annotateLogs({
            commandId: envelope.command.commandId,
            commandType: envelope.command.type,
            cause: Cause.pretty(cause),
          }),
          Effect.andThen(
            Deferred.fail(envelope.result, makeCommandInternalError(envelope.command)),
          ),
          Effect.asVoid,
        );
      }),
      // Last resort: even a defect raised by the handler above (a throwing getter
      // on the command, say) must not escape into the worker loop.
      Effect.catchCause(
        (cause): Effect.Effect<void> =>
          Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.void,
      ),
      Effect.ensuring(finishEnvelope),
    );

  const worker = Effect.forever(
    takeNextOrchestrationCommand(commandQueues).pipe(Effect.flatMap(runEnvelope)),
  );
  const workerFiber = yield* Effect.forkScoped(worker);

  const drain: OrchestrationEngineShape["drain"] = Effect.suspend(
    function awaitIdle(): Effect.Effect<void> {
      return Ref.get(engineAdmissionState).pipe(
        Effect.flatMap((current) => Deferred.await(current.idle)),
        Effect.andThen(Ref.get(engineAdmissionState)),
        Effect.flatMap((current) =>
          current.outstanding === 0 ? Effect.void : Effect.suspend(awaitIdle),
        ),
      );
    },
  );

  const quiesce: OrchestrationEngineShape["quiesce"] = Ref.update(
    engineAdmissionState,
    (current): EngineAdmissionState =>
      current.phase === "running"
        ? {
            ...current,
            phase: "quiescing",
          }
        : current,
  );

  const stop: OrchestrationEngineShape["stop"] = Effect.uninterruptible(
    Ref.update(
      engineAdmissionState,
      (current): EngineAdmissionState =>
        current.phase === "stopped"
          ? current
          : {
              ...current,
              phase: "draining",
            },
    ).pipe(
      Effect.andThen(
        Effect.all(
          [
            Queue.interrupt(commandQueues.control),
            Queue.interrupt(commandQueues.user),
            Queue.interrupt(commandQueues.normal),
            Queue.interrupt(commandQueues.wake),
          ],
          { discard: true },
        ),
      ),
      Effect.andThen(Fiber.await(workerFiber).pipe(Effect.asVoid)),
      Effect.andThen(drain),
      Effect.andThen(
        Ref.update(
          engineAdmissionState,
          (current): EngineAdmissionState => ({
            ...current,
            phase: "stopped",
          }),
        ),
      ),
    ),
  );

  // Registered after the worker so LIFO finalization gracefully drains queued
  // commands before forkScoped can interrupt the consumer. The event bus closes
  // only after the worker has finished every durable publication.
  yield* Effect.addFinalizer(() => stop.pipe(Effect.andThen(PubSub.shutdown(eventPubSub))));
  yield* Effect.log("orchestration engine started").pipe(
    Effect.annotateLogs({ sequence: commandReadModel.snapshotSequence }),
  );

  const readEvents: OrchestrationEngineShape["readEvents"] = (fromSequenceExclusive) =>
    eventStore.readFromSequence(fromSequenceExclusive);
  const readEventsThrough: OrchestrationEngineShape["readEventsThrough"] = (
    fromSequenceExclusive,
    throughSequenceInclusive,
  ) =>
    eventStore.readFromSequence(
      fromSequenceExclusive,
      Number.MAX_SAFE_INTEGER,
      throughSequenceInclusive,
    );
  const getEventHighWaterSequence = eventStore.getHighWaterSequence();
  const subscribeDomainEvents: OrchestrationEngineShape["subscribeDomainEvents"] = PubSub.subscribe(
    eventPubSub,
  ).pipe(Effect.map((subscription) => Stream.fromEffectRepeat(PubSub.take(subscription))));

  // Compatibility bridge for older tests and out-of-tree callers. Production
  // code should use ProjectionSnapshotQuery directly instead of depending on
  // the command engine to own a hydrated read model.
  const getReadModel = () => Effect.sync(() => commandReadModel);
  const refreshCommandReadModel: OrchestrationEngineShape["refreshCommandReadModel"] = () =>
    maintenanceLock.withPermits(1)(refreshCommandReadModelFromProjectionState);

  const dispatch: OrchestrationEngineShape["dispatch"] = (command, context) =>
    Effect.gen(function* () {
      const result = yield* Deferred.make<{ sequence: number }, OrchestrationDispatchError>();
      const executionState = yield* Ref.make<CommandExecutionState>("queued");
      const envelope: CommandEnvelope = {
        command,
        attachmentPrincipal: context?.attachmentPrincipal ?? LOCAL_LOOPBACK_ATTACHMENT_PRINCIPAL,
        result,
        executionState,
        deadlineAtMs: Date.now() + ORCHESTRATION_DISPATCH_TIMEOUT_MS,
      };
      const nextIdle = yield* Deferred.make<void>();
      const admission = yield* Ref.modify(
        engineAdmissionState,
        (current): readonly [OrchestrationCommandAdmissionDecision, EngineAdmissionState] => {
          if (
            current.phase === "draining" ||
            current.phase === "stopped" ||
            (current.phase === "quiescing" && !usesReservedCommandAdmission(command.type))
          ) {
            return [{ accepted: false, reason: "stopped" as const }, current] as const;
          }
          const decision = tryAdmitOrchestrationCommand({
            queues: commandQueues,
            envelope,
            commandType: command.type,
          });
          if (!decision.accepted) {
            return [decision, current] as const;
          }
          return [
            decision,
            {
              ...current,
              outstanding: current.outstanding + 1,
              idle: current.outstanding === 0 ? nextIdle : current.idle,
            },
          ] as const;
        },
      );
      if (!admission.accepted) {
        return yield* new OrchestrationCommandAdmissionError({
          commandId: command.commandId,
          commandType: command.type,
          capacity: ORCHESTRATION_COMMAND_QUEUE_CAPACITY,
          reservedCapacity: ORCHESTRATION_COMMAND_CONTROL_RESERVE,
          reason: admission.reason,
        });
      }
      return yield* Deferred.await(result).pipe(
        Effect.timeoutOption(`${ORCHESTRATION_DISPATCH_TIMEOUT_MS} millis`),
        Effect.flatMap((outcome) =>
          Option.match(outcome, {
            onNone: () =>
              Ref.modify(
                executionState,
                (state): readonly [DispatchTimeoutDecision, CommandExecutionState] =>
                  state === "queued"
                    ? [{ kind: "abandon" }, "abandoned"]
                    : [{ kind: "wait" }, state],
              ).pipe(
                Effect.flatMap((decision) =>
                  decision.kind === "wait"
                    ? Effect.logWarning(
                        "orchestration dispatch exceeded queue timeout while command was already in flight",
                      ).pipe(
                        Effect.annotateLogs({
                          commandId: command.commandId,
                          commandType: command.type,
                          timeoutMs: ORCHESTRATION_DISPATCH_TIMEOUT_MS,
                        }),
                        Effect.flatMap(() => Deferred.await(result)),
                      )
                    : Effect.logWarning(
                        "orchestration dispatch timed out before command started",
                      ).pipe(
                        Effect.annotateLogs({
                          commandId: command.commandId,
                          commandType: command.type,
                          timeoutMs: ORCHESTRATION_DISPATCH_TIMEOUT_MS,
                        }),
                        Effect.flatMap(() => Effect.fail(makeCommandTimeoutError(command))),
                      ),
                ),
              ),
            onSome: Effect.succeed,
          }),
        ),
      );
    });

  // Used by the settings screen to rebuild local indexes without deleting chats.
  const repairState: OrchestrationEngineShape["repairState"] = () =>
    maintenanceLock.withPermits(1)(
      Effect.gen(function* () {
        yield* Effect.log("repairing orchestration projection state");
        const previousCommandReadModel = commandReadModel;
        const repairFence = yield* eventStore.getHighWaterSequence().pipe(
          Effect.mapError(
            (error) =>
              new OrchestrationCommandInternalError({
                commandId: "repair-local-state",
                commandType: ORCHESTRATION_WS_METHODS.repairState,
                detail: `Failed to capture the durable event fence before repair: ${error.message}`,
              }),
          ),
        );

        yield* backupDerivedProjectionState.pipe(
          Effect.catchTag("SqlError", (sqlError) =>
            Effect.logError("failed to back up derived orchestration projection state").pipe(
              Effect.annotateLogs({
                cause: Cause.pretty(Cause.fail(sqlError)),
              }),
              Effect.flatMap(() =>
                Effect.fail(
                  new OrchestrationCommandInternalError({
                    commandId: "repair-local-state",
                    commandType: ORCHESTRATION_WS_METHODS.repairState,
                    detail: "Failed to stage the current local state before rebuilding it.",
                  }),
                ),
              ),
            ),
          ),
        );

        yield* resetDerivedProjectionState.pipe(
          Effect.catchTag("SqlError", (sqlError) =>
            Effect.logError("failed to reset derived orchestration projection state").pipe(
              Effect.annotateLogs({
                cause: Cause.pretty(Cause.fail(sqlError)),
              }),
              Effect.tap(() =>
                restoreDerivedProjectionState.pipe(
                  Effect.catchCause(() =>
                    Effect.logWarning(
                      "failed to restore orchestration projection backup after reset failure",
                    ),
                  ),
                ),
              ),
              Effect.flatMap(() =>
                Effect.fail(
                  new OrchestrationCommandInternalError({
                    commandId: "repair-local-state",
                    commandType: ORCHESTRATION_WS_METHODS.repairState,
                    detail: "Failed to clear the local projection cache before rebuilding it.",
                  }),
                ),
              ),
            ),
          ),
        );

        const rebuildResult = yield* Effect.exit(
          projectionPipeline.bootstrap.pipe(
            Effect.flatMap(() => verifyProjectionRepairFence(repairFence)),
          ),
        );
        if (rebuildResult._tag === "Failure") {
          const restoreResult = yield* Effect.exit(restoreDerivedProjectionState);
          if (restoreResult._tag === "Failure") {
            commandReadModel = previousCommandReadModel;
            return yield* Effect.logError(
              "failed to restore orchestration projection backup after rebuild failure",
            ).pipe(
              Effect.annotateLogs({
                rebuildCause: Cause.pretty(rebuildResult.cause),
                restoreCause: Cause.pretty(restoreResult.cause),
              }),
              Effect.flatMap(() =>
                Effect.fail(
                  new OrchestrationCommandInternalError({
                    commandId: "repair-local-state",
                    commandType: ORCHESTRATION_WS_METHODS.repairState,
                    detail:
                      "Projection repair failed and its staged backup could not be restored. Restart Synara before retrying repair.",
                  }),
                ),
              ),
            );
          }

          commandReadModel = previousCommandReadModel;
          yield* dropProjectionRepairBackup.pipe(Effect.catchCause(() => Effect.void));
          const typedFailure = Cause.findErrorOption(rebuildResult.cause);
          const repairError = Option.filter(
            typedFailure,
            (error): error is OrchestrationCommandInternalError =>
              Schema.is(OrchestrationCommandInternalError)(error),
          );
          return yield* Effect.logError(
            "failed to rebuild orchestration projections from event log",
          ).pipe(
            Effect.annotateLogs({
              cause: Cause.pretty(rebuildResult.cause),
            }),
            Effect.flatMap(() =>
              Effect.fail(
                Option.getOrElse(
                  repairError,
                  () =>
                    new OrchestrationCommandInternalError({
                      commandId: "repair-local-state",
                      commandType: ORCHESTRATION_WS_METHODS.repairState,
                      detail: "Failed to rebuild local projections from the saved event history.",
                    }),
                ),
              ),
            ),
          );
        }

        const snapshot = yield* refreshCommandReadModelFromProjectionState;
        yield* dropProjectionRepairBackup.pipe(Effect.catchCause(() => Effect.void));
        return snapshot;
      }),
    );

  return {
    quiesce,
    drain,
    stop,
    getProjectionCatchUpStatus,
    getReadModel,
    refreshCommandReadModel,
    readEvents,
    readEventsThrough,
    getEventHighWaterSequence,
    subscribeDomainEvents,
    dispatch,
    repairState,
    // Each access creates a fresh PubSub subscription so that multiple
    // consumers (Effect RPC, ProviderRuntimeIngestion, CheckpointReactor, etc.)
    // each independently receive all domain events.
    get streamDomainEvents(): OrchestrationEngineShape["streamDomainEvents"] {
      return Stream.unwrap(subscribeDomainEvents);
    },
  } satisfies OrchestrationEngineShape;
});

export const OrchestrationEngineLive = Layer.effect(
  OrchestrationEngineService,
  makeOrchestrationEngine,
).pipe(
  Layer.provideMerge(ManagedAttachmentRepositoryLive),
  Layer.provideMerge(SupervisedGovernanceRepositoryLive),
);
