import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  ControlPlaneEvent,
  DerivedSignal,
  SupervisedDomainEvent,
  SubscriptionDefinition,
  SubscriptionDelivery,
} from "@synara/contracts";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { SupervisedRuntimeRepositoryLive } from "./SupervisedRuntimeRepository.ts";
import { SupervisedRuntimeRepository } from "../Services/SupervisedRuntimeRepository.ts";

const testLayer = it.layer(
  Layer.mergeAll(
    SupervisedRuntimeRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

const now = "2026-08-07T00:00:00.000Z";
const hash = `sha256:${"a".repeat(64)}`;
const actor = { kind: "user" as const, actorId: "owner" };

const subscription = Schema.decodeUnknownSync(SubscriptionDefinition)({
  id: "sub-review-loop",
  schemaVersion: "1.0.0",
  name: "Review loop",
  owner: actor,
  concern: "delivery",
  ownerLeadSeatId: null,
  selector: { sourceKind: "event", names: ["ReviewCompleted", "ReviewRejected"] },
  scope: [{ kind: "global" }],
  where: [],
  aggregation: { function: "count", field: null, groupBy: ["taskNodeId", "graphRevision"] },
  window: { kind: "sliding", durationMs: 3_600_000, allowedLatenessMs: 60_000, maxSamples: 10_000 },
  condition: { operator: "gt", value: 3 },
  hysteresis: { trigger: { operator: "gt", value: 3 }, reset: { operator: "lte", value: 1 } },
  debounceMs: 0,
  cooldownMs: 600_000,
  destination: { kind: "concern", concern: "delivery" },
  allowedActionRequests: ["supervised.intervention.propose"],
  cursor: { lastSequence: 0, lastEventTime: null, lastDeliveryKey: null },
  replayPolicy: "observe_only",
  state: "enabled",
  rateLimitPerMinute: 60,
  maxQueueDepth: 100,
  failurePolicy: { maxAttempts: 3, backoffMs: 1_000, deadLetterAfterAttempts: 3, critical: false },
  armed: true,
  createdBy: actor,
  updatedBy: actor,
  createdAt: now,
  updatedAt: now,
  revision: 0,
});

testLayer("SupervisedRuntimeRepository", (it) => {
  it.effect("updates the indexed Room Project when a draft moves", () =>
    Effect.gen(function* () {
      const repository = yield* SupervisedRuntimeRepository;
      const sql = yield* SqlClient.SqlClient;
      const room = {
        id: "room-project-move",
        projectId: "project-original",
        title: "Room",
        leadSeatId: null,
        status: "draft",
        graphRevision: 0,
        revision: 0,
        createdAt: now,
        updatedAt: now,
      } as const;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
        ) VALUES
          ('project-original', 'project', 'Original', '/tmp/original', '[]', ${now}, ${now}),
          ('project-selected', 'project', 'Selected', '/tmp/selected', '[]', ${now}, ${now})
      `;
      const event = (input: {
        sequence: number;
        eventId: string;
        type: "supervised.room-created" | "supervised.room-updated";
        room: typeof room | (Omit<typeof room, "projectId" | "revision"> & {
          projectId: "project-selected";
          revision: 1;
        });
      }) =>
        Schema.decodeUnknownSync(SupervisedDomainEvent)({
          sequence: input.sequence,
          eventId: input.eventId,
          aggregateKind: "supervised_room",
          aggregateId: room.id,
          type: input.type,
          payload: { acceptedRevision: input.room.revision, actor, room: input.room },
          occurredAt: now,
          commandId: null,
          causationEventId: null,
          correlationId: null,
          metadata: { schemaVersion: "1.0.0" },
        });

      yield* repository.applyDomainEvent(
        event({ sequence: 1, eventId: "event-room-created", type: "supervised.room-created", room }),
      );
      yield* repository.applyDomainEvent(
        event({
          sequence: 2,
          eventId: "event-room-moved",
          type: "supervised.room-updated",
          room: { ...room, projectId: "project-selected", revision: 1 },
        }),
      );

      const rows = yield* sql<{ readonly projectId: string; readonly jsonProjectId: string }>`
        SELECT project_id AS "projectId", json_extract(entity_json, '$.projectId') AS "jsonProjectId"
        FROM projection_supervised_rooms
        WHERE room_id = ${room.id}
      `;
      assert.equal(rows[0]?.projectId, "project-selected");
      assert.equal(rows[0]?.jsonProjectId, "project-selected");
    }),
  );

  it.effect("appends facts idempotently and replays from a durable cursor", () =>
    Effect.gen(function* () {
      const repository = yield* SupervisedRuntimeRepository;
      const event = Schema.decodeUnknownSync(ControlPlaneEvent)({
        sequence: 0,
        eventId: "event-review-1",
        schemaId: "schema-review",
        schemaVersion: "1.0.0",
        type: "ReviewCompleted",
        scope: { kind: "task_node", taskNodeId: "node-1" },
        subjectId: "node-1",
        eventTime: now,
        recordedAt: now,
        revision: 2,
        causationEventId: null,
        correlationId: null,
        payload: { graphRevision: 2, reviewerSeatId: "reviewer-1" },
        provenance: { actor: { kind: "daemon", actorId: "daemon-1" }, source: "review", confidence: 1 },
      });
      const first = yield* repository.appendControlPlaneEvent(event);
      const duplicate = yield* repository.appendControlPlaneEvent(event);
      assert.equal(first, duplicate);
      const events = yield* repository.listControlPlaneEvents({ afterSequence: 0, limit: 20 });
      assert.equal(events.length, 1);
      assert.equal(events[0]?.sequence, first);
    }),
  );

  it.effect("claims one at-least-once delivery once and keeps its durable projection", () =>
    Effect.gen(function* () {
      const repository = yield* SupervisedRuntimeRepository;
      yield* repository.upsertSubscription(subscription);
      const signal = Schema.decodeUnknownSync(DerivedSignal)({
        id: "signal-review-loop",
        kind: "ReviewLoopSuspected",
        subscriptionId: subscription.id,
        scope: { kind: "task_node", taskNodeId: "node-1" },
        subjectId: "node-1",
        state: "triggered",
        measuredValue: 4,
        threshold: { operator: "gt", value: 3 },
        sourceEventIds: ["event-review-1"],
        metricSampleIds: [],
        aggregationReceiptHash: hash,
        context: { graphRevision: 2 },
        triggeredAt: now,
        resetAt: null,
        revision: 0,
      });
      yield* repository.upsertSignal(signal);
      const delivery = Schema.decodeUnknownSync(SubscriptionDelivery)({
        id: "delivery-review-loop",
        subscriptionId: subscription.id,
        signalId: signal.id,
        dedupeKey: "sub-review-loop:node-1:revision-2:crossing-1",
        status: "queued",
        attemptCount: 0,
        availableAt: now,
        deliveredAt: null,
        lastError: null,
        payloadHash: hash,
        replay: false,
        createdAt: now,
        updatedAt: now,
      });
      assert.equal(yield* repository.enqueueDelivery(delivery), true);
      assert.equal(yield* repository.enqueueDelivery(delivery), false);

      const claimed = yield* repository.claimDeliveries({
        workerId: "daemon-1",
        now,
        leaseExpiresAt: "2026-08-07T00:01:00.000Z",
        limit: 10,
      });
      assert.equal(claimed.length, 1);
      assert.equal(claimed[0]?.status, "delivering");
      const secondClaim = yield* repository.claimDeliveries({
        workerId: "daemon-2",
        now,
        leaseExpiresAt: "2026-08-07T00:01:00.000Z",
        limit: 10,
      });
      assert.equal(secondClaim.length, 0);

      const snapshot = yield* repository.getSnapshot({ includeDisabled: true });
      assert.equal(snapshot.subscriptions.length, 1);
      assert.equal(snapshot.signals.length, 1);
      assert.equal(snapshot.deliveries[0]?.status, "delivering");
    }),
  );

  it.effect("persists bounded evaluator group state across daemon restarts", () =>
    Effect.gen(function* () {
      const repository = yield* SupervisedRuntimeRepository;
      yield* repository.upsertSubscription(subscription);
      yield* repository.putSubscriptionEvaluationState(
        subscription.id,
        {
          groups: {
            '[\"taskNodeId\",\"node-1\"]': {
              samples: [],
              armed: false,
              nextEligibleAt: "2026-08-07T00:10:00.000Z",
              pendingSince: null,
              activeSignal: null,
            },
          },
        },
        now,
      );
      const reloaded = yield* repository.getSubscriptionEvaluationState(subscription.id);
      const group = reloaded.groups['[\"taskNodeId\",\"node-1\"]'];
      assert.equal(group?.armed, false);
      assert.equal(group?.nextEligibleAt, "2026-08-07T00:10:00.000Z");
    }),
  );

  it.effect("retains context compaction lineage and published evidence", () =>
    Effect.gen(function* () {
      const repository = yield* SupervisedRuntimeRepository;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT OR IGNORE INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
        ) VALUES (
          'project-stage-5-context', 'project', 'Stage 5 context', '/tmp/stage-5-context',
          '[]', ${now}, ${now}
        )
      `;
      const base = {
        occurredAt: now,
        commandId: null,
        causationEventId: null,
        correlationId: null,
        metadata: { schemaVersion: "1.0.0" },
      } as const;
      const workspace = {
        id: "context-workspace-stage-5",
        projectId: "project-stage-5-context",
        roomId: null,
        revision: 0,
        highWaterSequence: 1,
        retention: {
          maxAgeMs: 86_400_000,
          maxInlineBytes: 64_000,
          compactAfterRecords: 200,
        },
        createdAt: now,
        updatedAt: now,
      } as const;
      yield* repository.applyDomainEvent({
        ...base,
        sequence: 201,
        eventId: "event-context-workspace-stage-5",
        aggregateKind: "context_workspace",
        aggregateId: workspace.id,
        type: "supervised.context-workspace-upserted",
        payload: { acceptedRevision: 0, actor, contextWorkspace: workspace },
      } as never);
      const sourceRecord = {
        id: "context-record-stage-5-source",
        workspaceId: workspace.id,
        kind: "evidence",
        scope: { kind: "project", projectId: workspace.projectId },
        title: "Source evidence",
        inlineText: "Retained source fact.",
        blob: null,
        sourceEventIds: [],
        evidenceRefs: ["evidence-stage-5"],
        sourceRecordIds: [],
        provenance: { source: "test" },
        protectionClass: "workspace",
        estimatedTokens: 5,
        status: "current",
        contentRevision: 1,
        createdBy: actor,
        createdAt: now,
        updatedAt: now,
      } as const;
      yield* repository.applyDomainEvent({
        ...base,
        sequence: 202,
        eventId: "event-context-source-stage-5",
        aggregateKind: "context_workspace",
        aggregateId: workspace.id,
        type: "supervised.context-appended",
        payload: {
          acceptedRevision: 1,
          actor,
          contextWorkspace: { ...workspace, revision: 1 },
          contextRecord: sourceRecord,
        },
      } as never);
      const summaryRecord = {
        ...sourceRecord,
        id: "context-record-stage-5-summary",
        kind: "summary",
        title: "Summary",
        inlineText: "Summary backed by retained source evidence.",
        sourceRecordIds: [sourceRecord.id],
        provenance: { compaction: true },
      } as const;
      const compactionReceipt = {
        id: "context-compaction-stage-5",
        workspaceId: workspace.id,
        summaryRecordId: summaryRecord.id,
        sourceRecordIds: [sourceRecord.id],
        evidenceRefs: sourceRecord.evidenceRefs,
        createdBy: actor,
        createdAt: now,
      } as const;
      yield* repository.applyDomainEvent({
        ...base,
        sequence: 203,
        eventId: "event-context-summary-stage-5",
        aggregateKind: "context_workspace",
        aggregateId: workspace.id,
        type: "supervised.context-appended",
        payload: {
          acceptedRevision: 2,
          actor,
          contextWorkspace: { ...workspace, revision: 2 },
          contextRecord: summaryRecord,
          contextCompactionReceipt: compactionReceipt,
        },
      } as never);
      const evidence = {
        id: "evidence-stage-5",
        scope: { kind: "project", projectId: workspace.projectId },
        kind: "provider_receipt",
        summary: "Visible provider evidence.",
        blob: null,
        sourceEventIds: [],
        modelSessionId: null,
        createdBy: actor,
        createdAt: now,
      } as const;
      yield* repository.applyDomainEvent({
        ...base,
        sequence: 204,
        eventId: "event-evidence-stage-5",
        aggregateKind: "evidence",
        aggregateId: evidence.id,
        type: "supervised.evidence-published",
        payload: { acceptedRevision: 0, actor, evidence },
      } as never);
      yield* repository.applyDomainEvent({
        ...base,
        sequence: 205,
        eventId: "event-evidence-stage-5-other-project",
        aggregateKind: "evidence",
        aggregateId: "evidence-stage-5-other-project",
        type: "supervised.evidence-published",
        payload: {
          acceptedRevision: 0,
          actor,
          evidence: {
            ...evidence,
            id: "evidence-stage-5-other-project",
            scope: { kind: "project", projectId: "project-stage-5-other" },
          },
        },
      } as never);

      const snapshot = yield* repository.getSnapshot({ includeDisabled: true });
      assert.ok(snapshot.contextRecords.some((record) => record.id === sourceRecord.id));
      assert.ok(snapshot.contextRecords.some((record) => record.id === summaryRecord.id));
      assert.deepEqual(
        snapshot.contextCompactionReceipts.find(
          (receipt) => receipt.id === compactionReceipt.id,
        )?.sourceRecordIds,
        [sourceRecord.id],
      );
      assert.equal(
        snapshot.evidence.find((candidate) => candidate.id === evidence.id)?.summary,
        evidence.summary,
      );
      const scoped = yield* repository.getSnapshot({
        projectId: workspace.projectId,
        includeDisabled: true,
      });
      assert.ok(scoped.evidence.some((candidate) => candidate.id === evidence.id));
      assert.ok(
        !scoped.evidence.some(
          (candidate) => candidate.id === "evidence-stage-5-other-project",
        ),
      );
      yield* sql`DELETE FROM projection_projects WHERE project_id = 'project-stage-5-context'`;
    }),
  );
});
