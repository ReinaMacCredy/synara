import {
  CommandId,
  MessageId,
  SupervisedGovernanceAggregateId,
  SupervisionObservationId,
  type OrchestrationEvent,
  type ProjectId,
  type SupervisedGovernanceSnapshot,
  type SupervisionMission,
  type SupervisionWake,
} from "@veylen/contracts";
import { Cause, Effect, Layer, Option, Semaphore, Stream } from "effect";

import { OrchestrationCommandReceiptRepository } from "../../persistence/Services/OrchestrationCommandReceipts.ts";
import { SupervisedGovernanceRepository } from "../../persistence/Services/SupervisedGovernanceRepository.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  SupervisedWakeReactor,
  type SupervisedWakeReactorShape,
} from "../Services/SupervisedWakeReactor.ts";
import { missionScopeContainsLead } from "../supervised/missionScope.ts";
import {
  coalesceSupervisedWakePointers,
  isEligibleSupervisedWake,
} from "../supervised/wakePolicy.ts";

const AGGREGATE_ID = SupervisedGovernanceAggregateId.makeUnsafe("supervised");
const WAKE_DEBOUNCE_MS = 250;
const MAX_WAKE_ATTEMPTS = 3;

const commandId = (suffix: string) => CommandId.makeUnsafe(`server:supervised-wake:${suffix}`);

interface CanonicalLeadView {
  readonly id: string;
  readonly projectId: ProjectId;
  readonly activeThreadId: string;
  readonly status: "active" | "rotating" | "archived";
}

const canonicalLeadViews = (governance: SupervisedGovernanceSnapshot): CanonicalLeadView[] =>
  governance.agentSeats.flatMap((seat) =>
    seat.identityRole === "lead" && seat.threadId !== null && seat.projectId !== null
      ? [
          {
            id: seat.id,
            projectId: seat.projectId,
            activeThreadId: seat.threadId,
            status:
              seat.lifecycleState === "draining"
                ? "rotating"
                : seat.lifecycleState === "retired"
                  ? "archived"
                  : "active",
          },
        ]
      : [],
  );

const eventLeadCandidates = (
  event: OrchestrationEvent,
  leads: readonly CanonicalLeadView[],
): CanonicalLeadView[] => {
  if (event.aggregateKind === "thread") {
    return leads.filter((lead) => lead.activeThreadId === event.aggregateId);
  }
  const payload = event.payload as Record<string, unknown>;
  const payloadLead = payload.lead as { id?: unknown; projectId?: unknown } | undefined;
  const directive = payload.workflowDirective as { leadSeatId?: unknown } | undefined;
  const conflict = payload.workflowConflict as { leadSeatId?: unknown } | undefined;
  const projectId =
    typeof payload.projectId === "string"
      ? payload.projectId
      : typeof payloadLead?.projectId === "string"
        ? payloadLead.projectId
        : null;
  const leadSeatId =
    typeof payloadLead?.id === "string"
      ? payloadLead.id
      : typeof directive?.leadSeatId === "string"
        ? directive.leadSeatId
        : typeof conflict?.leadSeatId === "string"
          ? conflict.leadSeatId
          : null;
  return leads.filter(
    (lead) =>
      (projectId !== null && lead.projectId === projectId) ||
      (leadSeatId !== null && lead.id === leadSeatId),
  );
};

const wakeText = (wake: SupervisionWake, lead: CanonicalLeadView): string =>
  [
    "<veylen_supervised_wake>",
    "This is a durable bounded Lead-event doorbell, not a human owner instruction.",
    `mission_id: ${wake.missionId}`,
    `lead_seat_id: ${lead.id}`,
    `lead_thread_id: ${lead.activeThreadId}`,
    `episode_kind: ${wake.episodeKind}`,
    "event_pointers:",
    ...wake.pointers.map(
      (pointer) =>
        `- sequence=${pointer.sequence} type=${pointer.eventType} aggregate=${pointer.aggregateKind}:${pointer.aggregateId}`,
    ),
    "Read only the bounded Lead state needed to judge this episode. Do not poll, expand scope, or inspect Peer transcripts.",
    "Persist attributed advice only when a material correction is warranted.",
    "</veylen_supervised_wake>",
  ].join("\n");

export const makeSupervisedWakeReactor = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const governanceRepository = yield* SupervisedGovernanceRepository;
  const commandReceiptRepository = yield* OrchestrationCommandReceiptRepository;
  const lock = yield* Semaphore.make(1);
  const loadState = Effect.fnUntraced(function* () {
    const [readModel, governance] = yield* Effect.all([
      engine.getReadModel(),
      governanceRepository.getSnapshot(),
    ]);
    return {
      readModel,
      governance,
      orchestration: governance.orchestration,
      leads: canonicalLeadViews(governance),
    };
  });

  const updateWake = Effect.fnUntraced(function* (
    wake: SupervisionWake,
    status: SupervisionWake["status"],
    error: string | null,
    attemptCount: number,
  ) {
    const at = new Date().toISOString();
    yield* engine.dispatch({
      type: "supervised.wake.update",
      commandId: commandId(`${wake.id}:update:${attemptCount}:${status}`),
      aggregateId: AGGREGATE_ID,
      actor: { kind: "server", actorId: "supervised-wake-reactor" },
      expectedRevision: wake.attemptCount,
      createdAt: at,
      wake: { ...wake, status, error, attemptCount, updatedAt: at },
    });
  });

  const dispatchWake = Effect.fnUntraced(function* (wake: SupervisionWake) {
    const { readModel, governance, orchestration, leads } = yield* loadState();
    const current = orchestration.wakeQueue.find((candidate) => candidate.id === wake.id);
    if (!current || current.status === "delivered" || current.attemptCount >= MAX_WAKE_ATTEMPTS) {
      return;
    }
    const mission = orchestration.missions.find(
      (candidate) => candidate.id === current.missionId && candidate.status === "active",
    );
    const seat = governance.agentSeats.find(
      (candidate) =>
        candidate.id === current.supervisorSeatId &&
        candidate.identityRole === "supervisor" &&
        candidate.threadId !== null &&
        candidate.lifecycleState !== "retired",
    );
    const lead = leads.find(
      (candidate) => candidate.id === current.leadSeatId && candidate.status !== "archived",
    );
    const thread = seat
      ? readModel.threads.find(
          (candidate) => candidate.id === seat.threadId && candidate.deletedAt === null,
        )
      : undefined;
    if (!mission || !seat || !lead || !thread) {
      yield* updateWake(
        current,
        "failed",
        "Mission, Supervisor seat, Lead seat, or active Supervisor thread is unavailable.",
        current.attemptCount + 1,
      );
      return;
    }
    const dispatching = {
      ...current,
      status: "dispatching" as const,
      attemptCount: current.attemptCount + 1,
      error: null,
      updatedAt: new Date().toISOString(),
    };
    yield* updateWake(current, "dispatching", null, dispatching.attemptCount);
    const turnCommandId = commandId(`${current.id}:turn`);
    const existingReceipt = yield* commandReceiptRepository.getByCommandId({
      commandId: turnCommandId,
    });
    if (
      Option.isSome(existingReceipt) &&
      (existingReceipt.value.status !== "accepted" ||
        existingReceipt.value.aggregateKind !== "thread" ||
        existingReceipt.value.aggregateId !== seat.threadId)
    ) {
      yield* updateWake(
        dispatching,
        "failed",
        existingReceipt.value.error ?? "The durable wake turn receipt is invalid.",
        dispatching.attemptCount,
      );
      return;
    }
    const outcome = Option.isSome(existingReceipt)
      ? null
      : yield* Effect.exit(
          engine.dispatch({
            type: "thread.turn.start",
            commandId: turnCommandId,
            threadId: seat.threadId!,
            message: {
              messageId: MessageId.makeUnsafe(`supervised-wake:${current.id}`),
              role: "user",
              text: wakeText(dispatching, lead),
              attachments: [],
            },
            dispatchMode: "queue",
            dispatchOrigin: "automation",
            runtimeMode: thread.runtimeMode,
            interactionMode: thread.interactionMode,
            createdAt: current.createdAt,
          }),
        );
    if (outcome?._tag === "Failure") {
      const error = Cause.pretty(outcome.cause);
      yield* updateWake(dispatching, "failed", error, dispatching.attemptCount);
      return;
    }
    const pointerSequence = Math.max(...dispatching.pointers.map((pointer) => pointer.sequence));
    const cursor = orchestration.observationCursors.find(
      (candidate) => candidate.missionId === mission.id && candidate.leadSeatId === lead.id,
    );
    yield* engine.dispatch({
      type: "supervised.observation.advance",
      commandId: commandId(`${current.id}:cursor:${pointerSequence}`),
      aggregateId: AGGREGATE_ID,
      actor: { kind: "server", actorId: "supervised-wake-reactor" },
      expectedRevision: cursor?.lastSequence ?? 0,
      createdAt: new Date().toISOString(),
      cursor: {
        id: SupervisionObservationId.makeUnsafe(`${mission.id}:${lead.id}`),
        missionId: mission.id,
        leadSeatId: lead.id,
        lastSequence: pointerSequence,
        updatedAt: new Date().toISOString(),
      },
    });
    yield* updateWake(dispatching, "delivered", null, dispatching.attemptCount);
  });

  const reconcileQueuedUnlocked = Effect.gen(function* () {
    const { orchestration } = yield* loadState();
    for (const wake of orchestration.wakeQueue) {
      if (
        wake.status === "queued" ||
        wake.status === "dispatching" ||
        (wake.status === "failed" && wake.attemptCount < MAX_WAKE_ATTEMPTS)
      ) {
        yield* dispatchWake(wake);
      }
    }
  });
  const reconcileQueued: SupervisedWakeReactorShape["reconcileQueued"] =
    lock.withPermits(1)(reconcileQueuedUnlocked);

  const reconcileMissionEndConditions = Effect.fnUntraced(function* (
    event: OrchestrationEvent | null,
    orchestration: SupervisedGovernanceSnapshot["orchestration"],
  ) {
    const now = new Date().toISOString();
    let changed = false;
    for (const mission of orchestration.missions) {
      if (mission.status !== "active") continue;
      const domainEnded =
        event !== null &&
        mission.endCondition.kind === "domain_event" &&
        mission.endCondition.eventType === event.type;
      const timeEnded =
        mission.endCondition.kind === "timestamp" && mission.endCondition.endsAt <= now;
      if (!domainEnded && !timeEnded) continue;
      changed = true;
      yield* engine.dispatch({
        type: "supervised.mission.update",
        commandId: commandId(`${mission.id}:expire:${domainEnded ? event.sequence : now}`),
        aggregateId: AGGREGATE_ID,
        actor: { kind: "server", actorId: "supervised-wake-reactor" },
        expectedRevision: mission.revision,
        createdAt: now,
        mission: { ...mission, status: "expired", updatedAt: now, completedAt: now },
      });
    }
    return changed;
  });

  const reconcileEventUnlocked = Effect.fnUntraced(function* (event: OrchestrationEvent) {
    const beforeEndConditions = yield* loadState();
    const missionChanged = yield* reconcileMissionEndConditions(
      event,
      beforeEndConditions.orchestration,
    );
    const currentState = missionChanged ? yield* loadState() : beforeEndConditions;
    const { readModel, orchestration, leads: canonicalLeads } = currentState;
    const leads = eventLeadCandidates(event, canonicalLeads).filter(
      (lead) => lead.status === "active" || lead.status === "rotating",
    );
    if (leads.length === 0) return;
    const leadThreadIds = new Set(leads.map((lead) => lead.activeThreadId as string));
    const peerThreadIds = new Set(
      readModel.threads
        .filter((thread) => thread.creationSource === "supervised_native")
        .map((thread) => thread.id as string),
    );
    if (
      !isEligibleSupervisedWake({
        eventType: event.type,
        aggregateThreadId: event.aggregateKind === "thread" ? event.aggregateId : null,
        leadThreadIds,
        peerThreadIds,
      })
    ) {
      return;
    }
    for (const lead of leads) {
      const missions = orchestration.missions.filter(
        (mission) =>
          mission.status === "active" &&
          mission.grants.includes("lead.observe") &&
          missionScopeContainsLead({ scope: mission.scope, lead, projects: readModel.projects }),
      );
      for (const mission of missions) {
        const cursor = orchestration.observationCursors.find(
          (candidate) => candidate.missionId === mission.id && candidate.leadSeatId === lead.id,
        );
        if ((cursor?.lastSequence ?? 0) >= event.sequence) continue;
        const existing = orchestration.wakeQueue.find(
          (wake) =>
            wake.missionId === mission.id &&
            wake.leadSeatId === lead.id &&
            wake.episodeKind === event.type &&
            (wake.status === "queued" || wake.status === "dispatching"),
        );
        const pointer = {
          sequence: event.sequence,
          eventType: event.type,
          aggregateKind: event.aggregateKind,
          aggregateId: event.aggregateId,
        };
        if (existing) {
          const pointers = coalesceSupervisedWakePointers([...existing.pointers, pointer]);
          yield* engine.dispatch({
            type: "supervised.wake.update",
            commandId: commandId(`${existing.id}:coalesce:${event.sequence}`),
            aggregateId: AGGREGATE_ID,
            actor: { kind: "server", actorId: "supervised-wake-reactor" },
            expectedRevision: existing.attemptCount,
            createdAt: event.occurredAt,
            wake: { ...existing, pointers: [...pointers], updatedAt: event.occurredAt },
          });
          continue;
        }
        const wake: SupervisionWake = {
          id: SupervisionObservationId.makeUnsafe(
            `wake:${mission.id}:${lead.id}:${event.type}:${event.sequence}`,
          ),
          missionId: mission.id,
          supervisorSeatId: mission.supervisorSeatId,
          leadSeatId: lead.id,
          episodeKind: event.type,
          pointers: [pointer],
          status: "queued",
          attemptCount: 0,
          error: null,
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt,
        };
        yield* engine.dispatch({
          type: "supervised.wake.enqueue",
          commandId: commandId(`${wake.id}:enqueue`),
          aggregateId: AGGREGATE_ID,
          actor: { kind: "server", actorId: "supervised-wake-reactor" },
          expectedRevision: 0,
          createdAt: event.occurredAt,
          wake,
        });
      }
    }
  });
  const reconcileEvent: SupervisedWakeReactorShape["reconcileEvent"] = (event) =>
    lock
      .withPermits(1)(reconcileEventUnlocked(event))
      .pipe(
        Effect.andThen(Effect.sleep(`${WAKE_DEBOUNCE_MS} millis`)),
        Effect.andThen(lock.withPermits(1)(reconcileQueuedUnlocked)),
      );

  const start: SupervisedWakeReactorShape["start"] = Effect.gen(function* () {
    const initialState = yield* loadState().pipe(Effect.catch(() => Effect.succeed(null)));
    if (initialState) {
      yield* reconcileMissionEndConditions(null, initialState.orchestration).pipe(
        Effect.catch(() => Effect.void),
      );
    }
    yield* reconcileQueued.pipe(Effect.catch(() => Effect.void));
    yield* engine.streamDomainEvents.pipe(
      Stream.runForEach((event) =>
        reconcileEvent(event).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Supervised wake reconciliation failed", {
              eventSequence: event.sequence,
              eventType: event.type,
              cause: Cause.pretty(cause),
            }),
          ),
        ),
      ),
      Effect.forkScoped,
    );
    yield* Effect.sleep("30 seconds").pipe(
      Effect.andThen(loadState()),
      Effect.flatMap((state) => reconcileMissionEndConditions(null, state.orchestration)),
      Effect.andThen(reconcileQueued),
      Effect.catch(() => Effect.void),
      Effect.forever,
      Effect.forkScoped,
    );
  });

  return { start, reconcileEvent, reconcileQueued } satisfies SupervisedWakeReactorShape;
});

export const SupervisedWakeReactorLive = Layer.effect(
  SupervisedWakeReactor,
  makeSupervisedWakeReactor,
);
