import {
  CommandId,
  MessageId,
  SupervisionAggregateId,
  SupervisionObservationId,
  type LeadSeat,
  type OrchestrationEvent,
  type SupervisionMission,
  type SupervisionWake,
} from "@synara/contracts";
import { Cause, Effect, Layer, Semaphore, Stream } from "effect";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  SupervisionWakeReactor,
  type SupervisionWakeReactorShape,
} from "../Services/SupervisionWakeReactor.ts";
import { missionScopeContainsLead } from "../supervision/missionScope.ts";
import {
  coalesceSupervisionWakePointers,
  isEligibleSupervisionWake,
} from "../supervision/wakePolicy.ts";

const AGGREGATE_ID = SupervisionAggregateId.makeUnsafe("supervision");
const WAKE_DEBOUNCE_MS = 250;
const MAX_WAKE_ATTEMPTS = 3;

const commandId = (suffix: string) => CommandId.makeUnsafe(`server:supervision-wake:${suffix}`);

const eventLeadCandidates = (event: OrchestrationEvent, leads: readonly LeadSeat[]): LeadSeat[] => {
  if (event.aggregateKind === "thread" || event.aggregateKind === "orchestrator") {
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

const wakeText = (wake: SupervisionWake, lead: LeadSeat): string =>
  [
    "<synara_supervision_wake>",
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
    "</synara_supervision_wake>",
  ].join("\n");

export const makeSupervisionWakeReactor = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const lock = yield* Semaphore.make(1);

  const updateWake = Effect.fnUntraced(function* (
    wake: SupervisionWake,
    status: SupervisionWake["status"],
    error: string | null,
    attemptCount: number,
  ) {
    const at = new Date().toISOString();
    yield* engine.dispatch({
      type: "supervision.wake.update",
      commandId: commandId(`${wake.id}:update:${attemptCount}:${status}`),
      aggregateId: AGGREGATE_ID,
      actor: { kind: "server", actorId: "supervision-wake-reactor" },
      expectedRevision: wake.attemptCount,
      createdAt: at,
      wake: { ...wake, status, error, attemptCount, updatedAt: at },
    });
  });

  const dispatchWake = Effect.fnUntraced(function* (wake: SupervisionWake) {
    const readModel = yield* engine.getReadModel();
    const current = readModel.supervision.wakeQueue.find((candidate) => candidate.id === wake.id);
    if (!current || current.status === "delivered" || current.attemptCount >= MAX_WAKE_ATTEMPTS) {
      return;
    }
    const mission = readModel.supervision.missions.find(
      (candidate) => candidate.id === current.missionId && candidate.status === "active",
    );
    const seat = readModel.supervision.supervisors.find(
      (candidate) => candidate.id === current.supervisorSeatId && candidate.status !== "archived",
    );
    const lead = readModel.supervision.leads.find(
      (candidate) => candidate.id === current.leadSeatId && candidate.status !== "archived",
    );
    const thread = seat
      ? readModel.threads.find(
          (candidate) => candidate.id === seat.activeThreadId && candidate.deletedAt === null,
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
    const outcome = yield* Effect.exit(
      engine.dispatch({
        type: "thread.turn.start",
        commandId: commandId(`${current.id}:turn:${dispatching.attemptCount}`),
        threadId: seat.activeThreadId,
        message: {
          messageId: MessageId.makeUnsafe(
            `supervision-wake:${current.id}:${dispatching.attemptCount}`,
          ),
          role: "user",
          text: wakeText(dispatching, lead),
          attachments: [],
        },
        dispatchMode: "queue",
        dispatchOrigin: "automation",
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        createdAt: dispatching.updatedAt,
      }),
    );
    if (outcome._tag === "Failure") {
      const error = Cause.pretty(outcome.cause);
      yield* updateWake(dispatching, "failed", error, dispatching.attemptCount);
      return;
    }
    const pointerSequence = Math.max(...dispatching.pointers.map((pointer) => pointer.sequence));
    const cursor = readModel.supervision.observationCursors.find(
      (candidate) => candidate.missionId === mission.id && candidate.leadSeatId === lead.id,
    );
    yield* engine.dispatch({
      type: "supervision.observation.advance",
      commandId: commandId(`${current.id}:cursor:${pointerSequence}`),
      aggregateId: AGGREGATE_ID,
      actor: { kind: "server", actorId: "supervision-wake-reactor" },
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
    const readModel = yield* engine.getReadModel();
    for (const wake of readModel.supervision.wakeQueue) {
      if (
        wake.status === "queued" ||
        wake.status === "dispatching" ||
        (wake.status === "failed" && wake.attemptCount < MAX_WAKE_ATTEMPTS)
      ) {
        yield* dispatchWake(wake);
      }
    }
  });
  const reconcileQueued: SupervisionWakeReactorShape["reconcileQueued"] =
    lock.withPermits(1)(reconcileQueuedUnlocked);

  const reconcileMissionEndConditions = Effect.fnUntraced(function* (
    event: OrchestrationEvent | null,
  ) {
    const readModel = yield* engine.getReadModel();
    const now = new Date().toISOString();
    for (const mission of readModel.supervision.missions) {
      if (mission.status !== "active") continue;
      const domainEnded =
        event !== null &&
        mission.endCondition.kind === "domain_event" &&
        mission.endCondition.eventType === event.type;
      const timeEnded =
        mission.endCondition.kind === "timestamp" && mission.endCondition.endsAt <= now;
      if (!domainEnded && !timeEnded) continue;
      yield* engine.dispatch({
        type: "supervision.mission.update",
        commandId: commandId(`${mission.id}:expire:${domainEnded ? event.sequence : now}`),
        aggregateId: AGGREGATE_ID,
        actor: { kind: "server", actorId: "supervision-wake-reactor" },
        expectedRevision: mission.revision,
        createdAt: now,
        mission: { ...mission, status: "expired", updatedAt: now, completedAt: now },
      });
    }
  });

  const reconcileEventUnlocked = Effect.fnUntraced(function* (event: OrchestrationEvent) {
    yield* reconcileMissionEndConditions(event);
    const readModel = yield* engine.getReadModel();
    const leads = eventLeadCandidates(event, readModel.supervision.leads).filter(
      (lead) => lead.status === "active" || lead.status === "rotating",
    );
    if (leads.length === 0) return;
    const leadThreadIds = new Set(leads.map((lead) => lead.activeThreadId as string));
    const peerThreadIds = new Set(
      readModel.threads
        .filter((thread) => thread.creationSource === "orchestrator_native")
        .map((thread) => thread.id as string),
    );
    if (
      !isEligibleSupervisionWake({
        eventType: event.type,
        aggregateThreadId:
          event.aggregateKind === "thread" || event.aggregateKind === "orchestrator"
            ? event.aggregateId
            : null,
        leadThreadIds,
        peerThreadIds,
      })
    ) {
      return;
    }
    for (const lead of leads) {
      const missions = readModel.supervision.missions.filter(
        (mission) =>
          mission.status === "active" &&
          mission.grants.includes("lead.observe") &&
          missionScopeContainsLead({ scope: mission.scope, lead, projects: readModel.projects }),
      );
      for (const mission of missions) {
        const cursor = readModel.supervision.observationCursors.find(
          (candidate) => candidate.missionId === mission.id && candidate.leadSeatId === lead.id,
        );
        if ((cursor?.lastSequence ?? 0) >= event.sequence) continue;
        const existing = readModel.supervision.wakeQueue.find(
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
          const pointers = coalesceSupervisionWakePointers([...existing.pointers, pointer]);
          yield* engine.dispatch({
            type: "supervision.wake.update",
            commandId: commandId(`${existing.id}:coalesce:${event.sequence}`),
            aggregateId: AGGREGATE_ID,
            actor: { kind: "server", actorId: "supervision-wake-reactor" },
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
          type: "supervision.wake.enqueue",
          commandId: commandId(`${wake.id}:enqueue`),
          aggregateId: AGGREGATE_ID,
          actor: { kind: "server", actorId: "supervision-wake-reactor" },
          expectedRevision: 0,
          createdAt: event.occurredAt,
          wake,
        });
      }
    }
    yield* Effect.sleep(`${WAKE_DEBOUNCE_MS} millis`);
    yield* reconcileQueuedUnlocked;
  });
  const reconcileEvent: SupervisionWakeReactorShape["reconcileEvent"] = (event) =>
    lock.withPermits(1)(reconcileEventUnlocked(event));

  const start: SupervisionWakeReactorShape["start"] = Effect.gen(function* () {
    yield* reconcileMissionEndConditions(null).pipe(Effect.catch(() => Effect.void));
    yield* reconcileQueued.pipe(Effect.catch(() => Effect.void));
    yield* engine.streamDomainEvents.pipe(
      Stream.runForEach((event) =>
        reconcileEvent(event).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("supervision wake reconciliation failed", {
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
      Effect.andThen(reconcileMissionEndConditions(null)),
      Effect.andThen(reconcileQueued),
      Effect.catch(() => Effect.void),
      Effect.forever,
      Effect.forkScoped,
    );
  });

  return { start, reconcileEvent, reconcileQueued } satisfies SupervisionWakeReactorShape;
});

export const SupervisionWakeReactorLive = Layer.effect(
  SupervisionWakeReactor,
  makeSupervisionWakeReactor,
);
