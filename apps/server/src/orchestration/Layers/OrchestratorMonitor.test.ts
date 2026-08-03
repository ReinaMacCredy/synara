import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MonitorId,
  ProjectId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestratorMonitor as OrchestratorMonitorRecord,
} from "@synara/contracts";
import { Effect, Layer, Option, Stream } from "effect";
import { describe, expect, it } from "vitest";

import {
  OrchestrationCommandReceiptRepository,
  type OrchestrationCommandReceiptRepositoryShape,
} from "../../persistence/Services/OrchestrationCommandReceipts.ts";
import {
  ProjectionOrchestratorRepository,
  type ProjectionOrchestratorRepositoryShape,
  type ProjectionOrchestratorRootRecord,
} from "../../persistence/Services/ProjectionOrchestrator.ts";
import {
  QueuedTurnPromotionRepository,
  type QueuedTurnPromotionRepositoryShape,
} from "../../persistence/Services/QueuedTurnPromotions.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { makeOrchestratorMonitor } from "./OrchestratorMonitor.ts";

const now = "2026-08-01T00:00:10.000Z";
const projectId = ProjectId.makeUnsafe("project");
const rootThreadId = ThreadId.makeUnsafe("root");
const childThreadId = ThreadId.makeUnsafe("child");

const makeThread = (
  id: ThreadId,
  pendingPermission = false,
): OrchestrationReadModel["threads"][number] => ({
  id,
  projectId,
  title: id,
  modelSelection: { provider: "codex", model: "gpt-5.6" },
  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
  runtimeMode: "full-access",
  envMode: "local",
  branch: null,
  worktreePath: null,
  workingDirectory: "/repo",
  associatedWorktreePath: null,
  associatedWorktreeBranch: null,
  associatedWorktreeRef: null,
  createBranchFlowCompleted: false,
  isPinned: false,
  parentThreadId: null,
  creationSource: null,
  sourceThreadId: null,
  sourceTurnId: null,
  gatewayOperationId: null,
  gatewayOperationIndex: null,
  subagentAgentId: null,
  subagentNickname: null,
  subagentRole: null,
  forkSourceThreadId: null,
  sidechatSourceThreadId: null,
  lastKnownPr: null,
  latestTurn: null,
  latestUserMessageAt: null,
  hasPendingApprovals: pendingPermission,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  deletedAt: null,
  handoff: null,
  messages: [],
  activities: [],
  proposedPlans: [],
  checkpoints: [],
  session: pendingPermission
    ? {
        threadId: id,
        status: "running",
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: "turn-active" as never,
        lastError: null,
        updatedAt: now,
      }
    : null,
});

const monitor = (patch: Partial<OrchestratorMonitorRecord> = {}): OrchestratorMonitorRecord => ({
  id: MonitorId.makeUnsafe("monitor"),
  rootThreadId,
  targetThreadId: childThreadId,
  kind: "schedule",
  condition: JSON.stringify({ eventTypes: [] }),
  cadenceMs: 1_000,
  nextWakeAt: now,
  maxRuns: 2,
  runCount: 0,
  expiresAt: "2026-08-01T01:00:00.000Z",
  ownerThreadId: rootThreadId,
  state: "active",
  ...patch,
});

const makeHarness = (input: {
  readonly initialMonitor: OrchestratorMonitorRecord;
  readonly afterFirePersisted?: (
    monitor: OrchestratorMonitorRecord,
  ) => Effect.Effect<void, unknown>;
  readonly pendingPermission?: boolean;
  readonly mailboxReplyAlreadyWakesRoot?: boolean;
  readonly runs?: ReadonlyArray<{ readonly id: string; readonly state: string }>;
}) => {
  let currentMonitor = input.initialMonitor;
  let revision = 1;
  const dispatched: OrchestrationCommand[] = [];
  const receipts = new Map<string, { readonly status: "accepted" | "rejected" }>();
  let capacity: unknown = null;
  const rootRecord = (): ProjectionOrchestratorRootRecord => ({
    root: {
      rootThreadId,
      projectId,
      protocolVersion: 1,
      state: "active",
      activeProcessId: null,
      resourcePolicyVersion: 1,
      createdAt: now,
      archivedAt: null,
      revision,
    },
    highWaterCursor: String(revision),
  });
  const mailboxReplyCreatedAt = "2026-08-01T00:00:09.000Z";
  const repository = {
    getRoot: () => Effect.succeed(Option.some(rootRecord())),
    listRoots: () => Effect.succeed([rootRecord()]),
    findRootForThread: () => Effect.succeed(Option.some(rootThreadId)),
    listMonitors: () => Effect.succeed([currentMonitor]),
    listActiveWriterClaims: () => Effect.succeed([]),
    listMailboxMessages: () =>
      Effect.succeed(
        input.mailboxReplyAlreadyWakesRoot
          ? [
              {
                messageId: "message:child-reply",
                rootThreadId,
                senderThreadId: childThreadId,
                targetThreadId: rootThreadId,
                deliveryState: "processing",
                createdAt: mailboxReplyCreatedAt,
              },
            ]
          : [],
      ),
    upsertCapacity: (value: { readonly capacity: unknown }) =>
      Effect.sync(() => {
        capacity = value.capacity;
      }),
    getCore: () =>
      Effect.succeed(
        Option.some({
          root: rootRecord(),
          ownershipEdges: [],
          communicationLinks: [],
          assignments: [],
          runs: (input.runs ?? []) as never,
          providerCapabilities: [],
          capacity: null,
        }),
      ),
  } as unknown as ProjectionOrchestratorRepositoryShape;
  const commandReceipts = {
    getByCommandId: ({ commandId }: { readonly commandId: string }) => {
      const receipt = receipts.get(commandId);
      return Effect.succeed(
        receipt === undefined
          ? Option.none()
          : Option.some({
              commandId: CommandId.makeUnsafe(commandId),
              aggregateKind: "thread" as const,
              aggregateId: rootThreadId,
              acceptedAt: now,
              resultSequence: 1,
              status: receipt.status,
              error: null,
              fingerprintVersion: 1,
              commandFingerprint: "a".repeat(64),
            }),
      );
    },
  } as unknown as OrchestrationCommandReceiptRepositoryShape;
  const rootThread = makeThread(rootThreadId, input.pendingPermission);
  const readModel = {
    threads: [
      input.mailboxReplyAlreadyWakesRoot
        ? {
            ...rootThread,
            latestTurn: {
              turnId: "turn-mailbox-reply",
              state: "running",
              requestedAt: mailboxReplyCreatedAt,
              startedAt: mailboxReplyCreatedAt,
              completedAt: null,
              assistantMessageId: null,
            },
          }
        : rootThread,
      makeThread(childThreadId),
    ],
  } as unknown as OrchestrationReadModel;
  const queuedTurnPromotions = {
    hasPendingMessage: () => Effect.succeed(false),
  } as unknown as QueuedTurnPromotionRepositoryShape;
  const engine = {
    getReadModel: () => Effect.succeed(readModel),
    streamDomainEvents: Stream.empty,
    dispatch: (command: OrchestrationCommand) =>
      Effect.sync(() => {
        dispatched.push(command);
        if (command.type === "orchestrator.monitor.fire") {
          const expired = command.createdAt >= currentMonitor.expiresAt;
          const nextRun = currentMonitor.runCount + 1;
          currentMonitor = {
            ...currentMonitor,
            runCount: nextRun,
            state: expired
              ? "expired"
              : currentMonitor.kind === "schedule" && nextRun < currentMonitor.maxRuns
                ? "active"
                : "fired",
            nextWakeAt:
              !expired && currentMonitor.kind === "schedule" && nextRun < currentMonitor.maxRuns
                ? "2026-08-01T00:00:11.000Z"
                : null,
          };
          revision += 1;
        } else if (command.type === "orchestrator.monitor.cancel") {
          currentMonitor = { ...currentMonitor, state: "cancelled" };
          revision += 1;
        } else if (command.type === "thread.turn.start") {
          receipts.set(command.commandId, { status: "accepted" });
        }
        return { sequence: dispatched.length };
      }),
  } as unknown as OrchestrationEngineShape;
  const fullLayer = Layer.mergeAll(
    Layer.succeed(OrchestrationEngineService, engine),
    Layer.succeed(ProjectionOrchestratorRepository, repository),
    Layer.succeed(OrchestrationCommandReceiptRepository, commandReceipts),
    Layer.succeed(QueuedTurnPromotionRepository, queuedTurnPromotions),
  );
  return {
    dispatched,
    getMonitor: () => currentMonitor,
    getCapacity: () => capacity,
    effect: makeOrchestratorMonitor({
      now: () => now,
      ...(input.afterFirePersisted ? { afterFirePersisted: input.afterFirePersisted } : {}),
    }).pipe(Effect.provide(fullLayer)),
  };
};

describe("OrchestratorMonitor", () => {
  it("fires a due schedule, queues one native wake, and coalesces reconciliation", async () => {
    const harness = makeHarness({ initialMonitor: monitor() });
    const service = await Effect.runPromise(harness.effect);
    const first = await Effect.runPromise(service.reconcileRoot(rootThreadId));
    const second = await Effect.runPromise(service.reconcileRoot(rootThreadId));
    expect(first.monitorsFired).toBe(1);
    expect(first.wakesDispatched).toBe(1);
    expect(second.wakesDispatched).toBe(0);
    expect(harness.dispatched.map((command) => command.type)).toEqual([
      "orchestrator.monitor.fire",
      "thread.turn.start",
    ]);
    expect(harness.dispatched[1]).toMatchObject({
      type: "thread.turn.start",
      dispatchMode: "queue",
      dispatchOrigin: "automation",
    });
    expect(harness.getCapacity()).not.toBeNull();
  });

  it("recovers a persisted fire after a crash without firing or waking twice", async () => {
    let crash = true;
    const harness = makeHarness({
      initialMonitor: monitor({ maxRuns: 1 }),
      afterFirePersisted: () => (crash ? Effect.fail(new Error("crash after fire")) : Effect.void),
    });
    const firstService = await Effect.runPromise(harness.effect);
    await expect(Effect.runPromise(firstService.reconcileRoot(rootThreadId))).rejects.toThrow(
      "crash after fire",
    );
    crash = false;
    const restarted = await Effect.runPromise(harness.effect);
    const result = await Effect.runPromise(restarted.reconcileRoot(rootThreadId));
    expect(result.wakesDispatched).toBe(1);
    expect(
      harness.dispatched.filter((command) => command.type === "orchestrator.monitor.fire"),
    ).toHaveLength(1);
    expect(
      harness.dispatched.filter((command) => command.type === "thread.turn.start"),
    ).toHaveLength(1);
  });

  it("expires a wait and queues its wake behind pending provider interaction", async () => {
    const harness = makeHarness({
      initialMonitor: monitor({
        kind: "wait",
        cadenceMs: null,
        nextWakeAt: null,
        maxRuns: 1,
        expiresAt: now,
      }),
      pendingPermission: true,
    });
    const service = await Effect.runPromise(harness.effect);
    const result = await Effect.runPromise(service.reconcileRoot(rootThreadId));
    expect(result.monitorsExpired).toBe(1);
    expect(harness.getMonitor().state).toBe("expired");
    expect(harness.dispatched.at(-1)).toMatchObject({
      type: "thread.turn.start",
      dispatchMode: "queue",
    });
  });

  it("cancels monitors whose explicit run scope is terminal", async () => {
    const harness = makeHarness({
      initialMonitor: monitor({
        kind: "wait",
        cadenceMs: null,
        nextWakeAt: null,
        maxRuns: 1,
        condition: JSON.stringify({ runId: "run-terminal", eventTypes: [] }),
      }),
      runs: [{ id: "run-terminal", state: "cancelled" }],
    });
    const service = await Effect.runPromise(harness.effect);
    const result = await Effect.runPromise(service.reconcileRoot(rootThreadId));
    expect(result.monitorsCancelled).toBe(1);
    expect(harness.dispatched.map((command) => command.type)).toEqual([
      "orchestrator.monitor.cancel",
    ]);
  });

  it("coalesces duplicate target-settled events into one durable wake", async () => {
    const harness = makeHarness({
      initialMonitor: monitor({
        kind: "notify",
        cadenceMs: null,
        nextWakeAt: null,
        maxRuns: 1,
      }),
    });
    const service = await Effect.runPromise(harness.effect);
    const event = {
      aggregateKind: "thread",
      aggregateId: childThreadId,
      type: "thread.session-set",
      payload: {
        threadId: childThreadId,
        session: {
          threadId: childThreadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
      },
    } as unknown as OrchestrationEvent;
    await Effect.runPromise(service.reconcileEvent(event));
    await Effect.runPromise(service.reconcileEvent(event));
    expect(
      harness.dispatched.filter((command) => command.type === "thread.turn.start"),
    ).toHaveLength(1);
  });

  it("does not queue a monitor wake while the matching mailbox reply turn is running", async () => {
    const harness = makeHarness({
      initialMonitor: monitor({
        kind: "wait",
        cadenceMs: null,
        nextWakeAt: null,
        maxRuns: 1,
      }),
      mailboxReplyAlreadyWakesRoot: true,
    });
    const service = await Effect.runPromise(harness.effect);
    const event = {
      aggregateKind: "thread",
      aggregateId: childThreadId,
      type: "thread.session-set",
      payload: {
        threadId: childThreadId,
        session: {
          threadId: childThreadId,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
      },
    } as unknown as OrchestrationEvent;

    const result = await Effect.runPromise(service.reconcileEvent(event));

    expect(result.monitorsFired).toBe(1);
    expect(result.wakesDispatched).toBe(0);
    expect(harness.dispatched.map((command) => command.type)).toEqual([
      "orchestrator.monitor.fire",
    ]);
  });
});
