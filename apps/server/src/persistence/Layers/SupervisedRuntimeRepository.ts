import {
  CapabilityLease,
  ContextRecord,
  ControlPlaneEvent,
  ContextWorkspace,
  DeadLetter,
  DeliveryCursor,
  DerivedSignal,
  EventSchema,
  HarnessPatch,
  Intervention,
  KernelExecution,
  KernelSession,
  LeadNotification,
  MetricSample,
  ModelSessionTrace,
  PluginInstallation,
  PluginHealth,
  Reconciliation,
  RlmEpisode,
  Room,
  Run,
  RunPolicy,
  Specialist,
  SpecialistSnapshot,
  SubscriptionDefinition,
  SubscriptionDelivery,
  SubscriptionEvaluationGroupState,
  SubscriptionEvaluationState,
  SupervisedActor,
  SupervisedRuntimeHealth,
  SupervisedRuntimeSnapshot,
  SupervisedDomainEvent,
  Task,
  TaskNode,
  TaskNodeRevision,
  WorkClaim,
} from "@synara/contracts";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  isPersistenceError,
  toPersistenceDecodeCauseError,
  toPersistenceSqlError,
} from "../Errors.ts";
import {
  SupervisedRuntimeRepository,
  type SupervisedRuntimeRepositoryShape,
} from "../Services/SupervisedRuntimeRepository.ts";

type EntityRow = { readonly entityJson: string };
type ControlPlaneEventRow = { readonly sequence: number; readonly eventJson: string };
type HealthRow = {
  readonly snapshotSequence: number;
  readonly healthJson: string;
  readonly updatedAt: string;
};
type SubscriptionGroupRow = {
  readonly groupKey: string;
  readonly stateJson: string;
};
type PluginHealthRow = {
  readonly pluginId: string;
  readonly consecutiveFailures: number;
  readonly circuitState: string;
  readonly circuitOpenedUntil: string | null;
  readonly queueDepth: number;
  readonly lagMs: number;
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
  readonly lastError: string | null;
  readonly updatedAt: string;
};
type AuditRow = {
  readonly sequence: number;
  readonly action: string;
  readonly actorJson: string;
  readonly targetKind: string;
  readonly targetId: string;
  readonly outcome: string;
  readonly detailJson: string;
  readonly occurredAt: string;
};

const decodeJson = <A, I>(schema: Schema.Schema<A, I>, operation: string, value: string) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(schema)(JSON.parse(value)),
    catch: toPersistenceDecodeCauseError(operation),
  });

const decodeRows = <A, I>(schema: Schema.Schema<A, I>, operation: string, rows: ReadonlyArray<EntityRow>) =>
  Effect.forEach(rows, (row) => decodeJson(schema, operation, row.entityJson), { concurrency: 1 });

const persistenceError = (operation: string) => (error: unknown) =>
  isPersistenceError(error) ? error : toPersistenceSqlError(operation)(error);

const scopeId = (scope: { readonly kind: string } & Record<string, unknown>) =>
  scope.kind === "profile"
    ? String(scope.profilePresetId)
    : scope.kind === "project"
      ? String(scope.projectId)
      : scope.kind === "room"
        ? String(scope.roomId)
        : scope.kind === "task"
          ? String(scope.taskId)
          : scope.kind === "task_node"
            ? String(scope.taskNodeId)
            : scope.kind;

const signalGroupKey = (signal: DerivedSignal) => {
  const context = signal.context as Record<string, unknown>;
  const graphRevision = context.graphRevision;
  const roomId = context.roomId;
  const leadSeatId = context.leadSeatId;
  if (typeof graphRevision === "number") return `${signal.subjectId}:revision:${graphRevision}`;
  if (typeof roomId === "string" || typeof leadSeatId === "string") {
    return `${signal.subjectId}:room:${String(roomId ?? "")}:lead:${String(leadSeatId ?? "")}`;
  }
  return `${signal.subjectId}:scope:${JSON.stringify(signal.scope)}`;
};

const makeSupervisedRuntimeRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const getSnapshot: SupervisedRuntimeRepositoryShape["getSnapshot"] = (input = {}) =>
    Effect.gen(function* () {
      const limit = Math.max(1, Math.min(input.limit ?? 500, 500));
      const roomRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_rooms
        ORDER BY updated_at DESC, room_id
        LIMIT ${limit}
      `;
      const taskRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_tasks
        ORDER BY updated_at DESC, task_id
        LIMIT ${limit}
      `;
        const taskNodeRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_task_nodes
        ORDER BY updated_at DESC, task_node_id
          LIMIT ${limit}
        `;
        const taskNodeRevisionRows = yield* sql<EntityRow>`
          SELECT entity_json AS "entityJson"
          FROM projection_supervised_task_node_revisions
          ORDER BY created_at DESC, task_node_revision_id
          LIMIT ${limit}
        `;
      const runRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_runs
        ORDER BY updated_at DESC, run_id
        LIMIT ${limit}
      `;
        const policyRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_run_policies
        ORDER BY updated_at DESC, policy_id
          LIMIT ${limit}
        `;
        const workClaimRows = yield* sql<EntityRow>`
          SELECT entity_json AS "entityJson"
          FROM projection_supervised_work_claims
          ORDER BY expires_at DESC, claim_id
          LIMIT ${limit}
        `;
        const capabilityLeaseRows = yield* sql<EntityRow>`
          SELECT entity_json AS "entityJson"
          FROM projection_supervised_capability_leases
          ORDER BY expires_at DESC, lease_id
          LIMIT ${limit}
        `;
        const contextRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_context_workspaces
        ORDER BY updated_at DESC, workspace_id
          LIMIT ${limit}
        `;
        const contextRecordRows = yield* sql<EntityRow>`
          SELECT entity_json AS "entityJson"
          FROM projection_context_records
          ORDER BY updated_at DESC, record_id
          LIMIT ${limit}
        `;
        const rlmEpisodeRows = yield* sql<EntityRow>`
          SELECT entity_json AS "entityJson"
          FROM projection_supervised_rlm_episodes
          ORDER BY updated_at DESC, episode_id
          LIMIT ${limit}
        `;
        const modelSessionRows = yield* sql<EntityRow>`
          SELECT entity_json AS "entityJson"
          FROM projection_supervised_model_sessions
          ORDER BY updated_at DESC, model_session_id
          LIMIT ${limit}
        `;
        const harnessPatchRows = yield* sql<EntityRow>`
          SELECT entity_json AS "entityJson"
          FROM projection_harness_patches
          ORDER BY updated_at DESC, patch_id
          LIMIT ${limit}
        `;
        const specialistRows = yield* sql<EntityRow>`
          SELECT entity_json AS "entityJson"
          FROM projection_retained_specialists
          ORDER BY updated_at DESC, specialist_id
          LIMIT ${limit}
        `;
        const specialistSnapshotRows = yield* sql<EntityRow>`
          SELECT entity_json AS "entityJson"
          FROM projection_specialist_snapshots
          ORDER BY expires_at DESC, specialist_snapshot_id
          LIMIT ${limit}
        `;
        const kernelSessionRows = yield* sql<EntityRow>`
          SELECT entity_json AS "entityJson"
          FROM projection_kernel_sessions
          ORDER BY last_used_at DESC, kernel_session_id
          LIMIT ${limit}
        `;
        const kernelExecutionRows = yield* sql<EntityRow>`
          SELECT entity_json AS "entityJson"
          FROM projection_kernel_executions
          ORDER BY COALESCE(finished_at, started_at) DESC, kernel_execution_id
          LIMIT ${limit}
        `;
        const interventionRows = yield* sql<EntityRow>`
          SELECT entity_json AS "entityJson"
          FROM projection_supervised_interventions
          ORDER BY updated_at DESC, intervention_id
          LIMIT ${limit}
        `;
        const leadNotificationRows = yield* sql<EntityRow>`
          SELECT entity_json AS "entityJson"
          FROM projection_supervised_lead_notifications
          ORDER BY created_at DESC, notification_id
          LIMIT ${limit}
        `;
        const reconciliationRows = yield* sql<EntityRow>`
          SELECT entity_json AS "entityJson"
          FROM projection_supervised_reconciliations
          ORDER BY COALESCE(resolved_at, '') DESC, reconciliation_id
          LIMIT ${limit}
        `;
      const subscriptionRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_subscriptions
        ORDER BY updated_at DESC, subscription_id
        LIMIT ${limit}
      `;
      const cursorRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_delivery_cursors
        ORDER BY subscription_id
        LIMIT ${limit}
      `;
      const pluginRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM supervised_plugin_installations
        ORDER BY updated_at DESC, plugin_id
        LIMIT ${limit}
      `;
      const pluginHealthRows = yield* sql<PluginHealthRow>`
        SELECT
          plugin_id AS "pluginId",
          consecutive_failures AS "consecutiveFailures",
          circuit_state AS "circuitState",
          circuit_opened_until AS "circuitOpenedUntil",
          queue_depth AS "queueDepth",
          lag_ms AS "lagMs",
          last_success_at AS "lastSuccessAt",
          last_failure_at AS "lastFailureAt",
          last_error AS "lastError",
          updated_at AS "updatedAt"
        FROM supervised_plugin_health
        ORDER BY updated_at DESC, plugin_id
        LIMIT ${limit}
      `;
      const schemaRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM supervised_event_schemas
        ORDER BY event_type, version
        LIMIT ${limit}
      `;
      const signalRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_signals
        ORDER BY triggered_at DESC, signal_id
        LIMIT ${limit}
      `;
      const deliveryRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM supervised_subscription_deliveries
        ORDER BY updated_at DESC, delivery_id
        LIMIT ${limit}
      `;
      const deadLetterRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM supervised_dead_letters
        ORDER BY updated_at DESC, dead_letter_id
        LIMIT ${limit}
      `;
      const auditRows = yield* sql<AuditRow>`
        SELECT
          audit_sequence AS "sequence",
          action,
          actor_json AS "actorJson",
          target_kind AS "targetKind",
          target_id AS "targetId",
          outcome,
          detail_json AS "detailJson",
          occurred_at AS "occurredAt"
        FROM supervised_runtime_audit
        ORDER BY audit_sequence DESC
        LIMIT ${limit}
      `;
      const healthRows = yield* sql<HealthRow>`
        SELECT snapshot_sequence AS "snapshotSequence", health_json AS "healthJson", updated_at AS "updatedAt"
        FROM supervised_runtime_state
        WHERE singleton_id = 1
      `;

      const rooms = yield* decodeRows(Room, "SupervisedRuntime.getSnapshot:rooms", roomRows);
        const tasks = yield* decodeRows(Task, "SupervisedRuntime.getSnapshot:tasks", taskRows);
        const taskNodes = yield* decodeRows(TaskNode, "SupervisedRuntime.getSnapshot:taskNodes", taskNodeRows);
        const taskNodeRevisions = yield* decodeRows(
          TaskNodeRevision,
          "SupervisedRuntime.getSnapshot:taskNodeRevisions",
          taskNodeRevisionRows,
        );
        const runs = yield* decodeRows(Run, "SupervisedRuntime.getSnapshot:runs", runRows);
        const runPolicies = yield* decodeRows(RunPolicy, "SupervisedRuntime.getSnapshot:runPolicies", policyRows);
        const workClaims = yield* decodeRows(
          WorkClaim,
          "SupervisedRuntime.getSnapshot:workClaims",
          workClaimRows,
        );
        const capabilityLeases = yield* decodeRows(
          CapabilityLease,
          "SupervisedRuntime.getSnapshot:capabilityLeases",
          capabilityLeaseRows,
        );
      const contextWorkspaces = yield* decodeRows(
        ContextWorkspace,
        "SupervisedRuntime.getSnapshot:contextWorkspaces",
          contextRows,
        );
        const contextRecords = yield* decodeRows(
          ContextRecord,
          "SupervisedRuntime.getSnapshot:contextRecords",
          contextRecordRows,
        );
        const rlmEpisodes = yield* decodeRows(
          RlmEpisode,
          "SupervisedRuntime.getSnapshot:rlmEpisodes",
          rlmEpisodeRows,
        );
        const modelSessions = yield* decodeRows(
          ModelSessionTrace,
          "SupervisedRuntime.getSnapshot:modelSessions",
          modelSessionRows,
        );
        const harnessPatches = yield* decodeRows(
          HarnessPatch,
          "SupervisedRuntime.getSnapshot:harnessPatches",
          harnessPatchRows,
        );
        const specialists = yield* decodeRows(
          Specialist,
          "SupervisedRuntime.getSnapshot:specialists",
          specialistRows,
        );
        const specialistSnapshots = yield* decodeRows(
          SpecialistSnapshot,
          "SupervisedRuntime.getSnapshot:specialistSnapshots",
          specialistSnapshotRows,
        );
        const kernelSessions = yield* decodeRows(
          KernelSession,
          "SupervisedRuntime.getSnapshot:kernelSessions",
          kernelSessionRows,
        );
        const kernelExecutions = yield* decodeRows(
          KernelExecution,
          "SupervisedRuntime.getSnapshot:kernelExecutions",
          kernelExecutionRows,
        );
        const interventions = yield* decodeRows(
          Intervention,
          "SupervisedRuntime.getSnapshot:interventions",
          interventionRows,
        );
        const leadNotifications = yield* decodeRows(
          LeadNotification,
          "SupervisedRuntime.getSnapshot:leadNotifications",
          leadNotificationRows,
        );
        const reconciliations = yield* decodeRows(
          Reconciliation,
          "SupervisedRuntime.getSnapshot:reconciliations",
          reconciliationRows,
        );
      const subscriptions = yield* decodeRows(
        SubscriptionDefinition,
        "SupervisedRuntime.getSnapshot:subscriptions",
        subscriptionRows,
      );
      const cursors = yield* decodeRows(
        DeliveryCursor,
        "SupervisedRuntime.getSnapshot:cursors",
        cursorRows,
      );
      const cursorBySubscription = new Map(cursors.map((cursor) => [cursor.subscriptionId, cursor]));
      const subscriptionsWithCursors = subscriptions.map((subscription) => {
        const cursor = cursorBySubscription.get(subscription.id);
        return cursor
          ? {
              ...subscription,
              cursor: {
                ...subscription.cursor,
                lastSequence: cursor.lastSequence,
                lastEventTime: cursor.lastEventTime,
              },
            }
          : subscription;
      });
      const plugins = yield* decodeRows(
        PluginInstallation,
        "SupervisedRuntime.getSnapshot:plugins",
        pluginRows,
      );
      const pluginHealth = yield* Effect.forEach(
        pluginHealthRows,
        (row) =>
          Effect.try({
            try: () =>
              Schema.decodeUnknownSync(PluginHealth)({
                pluginId: row.pluginId,
                consecutiveFailures: row.consecutiveFailures,
                circuitState: row.circuitState,
                circuitOpenedUntil: row.circuitOpenedUntil,
                queueDepth: row.queueDepth,
                lagMs: row.lagMs,
                lastSuccessAt: row.lastSuccessAt,
                lastFailureAt: row.lastFailureAt,
                lastError: row.lastError,
                updatedAt: row.updatedAt,
              }),
            catch: toPersistenceDecodeCauseError("SupervisedRuntime.getSnapshot:pluginHealth"),
          }),
        { concurrency: 1 },
      );
      const schemas = yield* decodeRows(EventSchema, "SupervisedRuntime.getSnapshot:schemas", schemaRows);
      const signals = yield* decodeRows(DerivedSignal, "SupervisedRuntime.getSnapshot:signals", signalRows);
      const deliveries = yield* decodeRows(
        SubscriptionDelivery,
        "SupervisedRuntime.getSnapshot:deliveries",
        deliveryRows,
      );
      const deadLetters = yield* decodeRows(
        DeadLetter,
        "SupervisedRuntime.getSnapshot:deadLetters",
        deadLetterRows,
      );
      const audit = yield* Effect.forEach(
        auditRows,
        (row) =>
          Effect.try({
            try: () => ({
              sequence: row.sequence,
              action: row.action,
              actor: Schema.decodeUnknownSync(SupervisedActor)(JSON.parse(row.actorJson)),
              targetKind: row.targetKind,
              targetId: row.targetId,
              outcome: row.outcome,
              detail: JSON.parse(row.detailJson) as Record<string, unknown>,
              occurredAt: row.occurredAt,
            }),
            catch: toPersistenceDecodeCauseError("SupervisedRuntime.getSnapshot:audit"),
          }),
        { concurrency: 1 },
      );
      const health = healthRows[0]
        ? yield* decodeJson(
            SupervisedRuntimeHealth,
            "SupervisedRuntime.getSnapshot:health",
            healthRows[0].healthJson,
          )
        : Schema.decodeUnknownSync(SupervisedRuntimeHealth)({
            daemonEpoch: 1,
            status: "stopped",
            journalLag: 0,
            deliveryQueueDepth: 0,
            deadLetterCount: 0,
            unhealthyPluginCount: 0,
            lastRecoveryAt: null,
            updatedAt: new Date(0).toISOString(),
          });

      const projectId = input.projectId;
      const roomId = input.roomId;
      const visibleRooms = rooms.filter(
        (room) => (!projectId || room.projectId === projectId) && (!roomId || room.id === roomId),
      );
        const roomIds = new Set(visibleRooms.map((room) => room.id));
        const visibleTasks = tasks.filter((task) => roomIds.has(task.roomId));
        const taskIds = new Set(visibleTasks.map((task) => task.id));
        const visibleTaskNodes = taskNodes.filter((node) => taskIds.has(node.taskId));
        const taskNodeIds = new Set(visibleTaskNodes.map((node) => node.id));
        const visibleRuns = runs.filter((run) => roomIds.has(run.roomId));
        const runIds = new Set(visibleRuns.map((run) => run.id));
        const visibleContextWorkspaces = contextWorkspaces.filter(
          (workspace) =>
            (!projectId || workspace.projectId === projectId) &&
            (!roomId || workspace.roomId === roomId),
        );
        const workspaceIds = new Set(visibleContextWorkspaces.map((workspace) => workspace.id));
      const visibleSubscriptions = subscriptionsWithCursors.filter(
        (subscription) => input.includeDisabled || subscription.state === "enabled",
      );

      return Schema.decodeUnknownSync(SupervisedRuntimeSnapshot)({
        snapshotSequence: healthRows[0]?.snapshotSequence ?? 0,
          rooms: visibleRooms,
          tasks: visibleTasks,
          taskNodes: visibleTaskNodes,
          taskNodeRevisions: taskNodeRevisions.filter((revision) => taskNodeIds.has(revision.taskNodeId)),
          runs: visibleRuns,
          runPolicies,
          workClaims: workClaims.filter((claim) => runIds.has(claim.runId)),
          capabilityLeases: capabilityLeases.filter((lease) => runIds.has(lease.runId)),
          contextWorkspaces: visibleContextWorkspaces,
          contextRecords: contextRecords.filter((record) => workspaceIds.has(record.workspaceId)),
          rlmEpisodes: rlmEpisodes.filter((episode) => runIds.has(episode.runId)),
          modelSessions: modelSessions.filter((session) => runIds.has(session.runId)),
          harnessPatches,
          specialists,
          specialistSnapshots,
          kernelSessions: kernelSessions.filter((session) => runIds.has(session.runId)),
          kernelExecutions: kernelExecutions.filter((execution) =>
            kernelSessions.some(
              (session) => session.id === execution.kernelSessionId && runIds.has(session.runId),
            ),
          ),
          interventions: interventions.filter((intervention) => roomIds.has(intervention.roomId)),
          leadNotifications: leadNotifications.filter((notification) => roomIds.has(notification.roomId)),
          reconciliations: reconciliations.filter((reconciliation) => roomIds.has(reconciliation.roomId)),
        subscriptions: visibleSubscriptions,
        plugins,
        pluginHealth,
        schemas,
        signals: signals.filter((signal) =>
          visibleSubscriptions.some((subscription) => subscription.id === signal.subscriptionId),
        ),
        deliveries: deliveries.filter((delivery) =>
          visibleSubscriptions.some((subscription) => subscription.id === delivery.subscriptionId),
        ),
        deadLetters: deadLetters.filter((letter) =>
          visibleSubscriptions.some((subscription) => subscription.id === letter.subscriptionId),
        ),
        audit,
        health,
        updatedAt: healthRows[0]?.updatedAt ?? health.updatedAt,
      });
    }).pipe(Effect.mapError(persistenceError("SupervisedRuntime.getSnapshot")));

  const setHealth: SupervisedRuntimeRepositoryShape["setHealth"] = (health, snapshotSequence) =>
    sql`
      INSERT INTO supervised_runtime_state (
        singleton_id, daemon_epoch, status, snapshot_sequence, health_json, updated_at
      ) VALUES (
        1, ${health.daemonEpoch}, ${health.status}, ${snapshotSequence}, ${JSON.stringify(health)}, ${health.updatedAt}
      )
      ON CONFLICT (singleton_id) DO UPDATE SET
        daemon_epoch = excluded.daemon_epoch,
        status = excluded.status,
        snapshot_sequence = excluded.snapshot_sequence,
        health_json = excluded.health_json,
        updated_at = excluded.updated_at
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("SupervisedRuntime.setHealth")),
    );

  const upsertEventSchema: SupervisedRuntimeRepositoryShape["upsertEventSchema"] = (schema) =>
    sql`
      INSERT INTO supervised_event_schemas (
        schema_id, event_type, version, compatibility, status, updated_at, entity_json
      ) VALUES (
        ${schema.id}, ${schema.eventType}, ${schema.version}, ${schema.compatibility},
        ${schema.status}, ${schema.updatedAt}, ${JSON.stringify(schema)}
      )
      ON CONFLICT (schema_id) DO UPDATE SET
        event_type = excluded.event_type,
        version = excluded.version,
        compatibility = excluded.compatibility,
        status = excluded.status,
        updated_at = excluded.updated_at,
        entity_json = excluded.entity_json
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("SupervisedRuntime.upsertEventSchema")),
    );

  const upsertRunPolicy: SupervisedRuntimeRepositoryShape["upsertRunPolicy"] = (policy) =>
    sql`
      INSERT INTO projection_supervised_run_policies (
        policy_id, revision, updated_at, entity_json
      ) VALUES (
        ${policy.id}, ${policy.revision}, ${policy.updatedAt}, ${JSON.stringify(policy)}
      )
      ON CONFLICT (policy_id) DO UPDATE SET
        revision = excluded.revision,
        updated_at = excluded.updated_at,
        entity_json = excluded.entity_json
      WHERE projection_supervised_run_policies.revision <= excluded.revision
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("SupervisedRuntime.upsertRunPolicy")),
    );

  const upsertSubscription: SupervisedRuntimeRepositoryShape["upsertSubscription"] = (
    subscription,
    runtime = {},
  ) =>
    sql`
      INSERT INTO projection_supervised_subscriptions (
        subscription_id, owner_lead_seat_id, concern, state, armed, replay_policy,
        next_eligible_at, last_triggered_at, last_reset_at, revision, updated_at, entity_json
      ) VALUES (
        ${subscription.id}, ${subscription.ownerLeadSeatId}, ${subscription.concern},
        ${subscription.state}, ${subscription.armed ? 1 : 0}, ${subscription.replayPolicy},
        ${runtime.nextEligibleAt ?? null}, ${runtime.lastTriggeredAt ?? null},
        ${runtime.lastResetAt ?? null}, ${subscription.revision}, ${subscription.updatedAt},
        ${JSON.stringify(subscription)}
      )
      ON CONFLICT (subscription_id) DO UPDATE SET
        owner_lead_seat_id = excluded.owner_lead_seat_id,
        concern = excluded.concern,
        state = excluded.state,
        armed = excluded.armed,
        replay_policy = excluded.replay_policy,
        next_eligible_at = excluded.next_eligible_at,
        last_triggered_at = excluded.last_triggered_at,
        last_reset_at = excluded.last_reset_at,
        revision = excluded.revision,
        updated_at = excluded.updated_at,
        entity_json = excluded.entity_json
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("SupervisedRuntime.upsertSubscription")),
    );

  const upsertCursor: SupervisedRuntimeRepositoryShape["upsertCursor"] = (cursor) =>
    sql`
      INSERT INTO projection_supervised_delivery_cursors (
        subscription_id, last_sequence, last_event_time, watermark, updated_at, entity_json
      ) VALUES (
        ${cursor.subscriptionId}, ${cursor.lastSequence}, ${cursor.lastEventTime},
        ${cursor.watermark}, ${cursor.updatedAt}, ${JSON.stringify(cursor)}
      )
      ON CONFLICT (subscription_id) DO UPDATE SET
        last_sequence = excluded.last_sequence,
        last_event_time = excluded.last_event_time,
        watermark = excluded.watermark,
        updated_at = excluded.updated_at,
        entity_json = excluded.entity_json
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("SupervisedRuntime.upsertCursor")),
    );

  const getSubscriptionEvaluationState: SupervisedRuntimeRepositoryShape["getSubscriptionEvaluationState"] =
    (subscriptionId) =>
      Effect.gen(function* () {
        const rows = yield* sql<SubscriptionGroupRow>`
          SELECT group_key AS "groupKey", state_json AS "stateJson"
          FROM projection_supervised_subscription_groups
          WHERE subscription_id = ${subscriptionId}
          ORDER BY group_key
        `;
        const groups = yield* Effect.forEach(
          rows,
          (row) =>
            decodeJson(
              SubscriptionEvaluationGroupState,
              "SupervisedRuntime.getSubscriptionEvaluationState:group",
              row.stateJson,
            ).pipe(Effect.map((state) => [row.groupKey, state] as const)),
          { concurrency: 1 },
        );
        return Schema.decodeUnknownSync(SubscriptionEvaluationState)({
          groups: Object.fromEntries(groups),
        });
      }).pipe(
        Effect.mapError(persistenceError("SupervisedRuntime.getSubscriptionEvaluationState")),
      );

  const putSubscriptionEvaluationState: SupervisedRuntimeRepositoryShape["putSubscriptionEvaluationState"] =
    (subscriptionId, state, updatedAt) =>
      sql.withTransaction(
        Effect.gen(function* () {
          const keys = Object.keys(state.groups);
          if (keys.length === 0) {
            yield* sql`
              DELETE FROM projection_supervised_subscription_groups
              WHERE subscription_id = ${subscriptionId}
            `;
            return;
          }
          const placeholders = keys.map(() => "?").join(", ");
          yield* sql.unsafe(
            `DELETE FROM projection_supervised_subscription_groups
             WHERE subscription_id = ? AND group_key NOT IN (${placeholders})`,
            [subscriptionId, ...keys],
          );
          yield* Effect.forEach(
            Object.entries(state.groups),
            ([groupKey, group]) => sql`
              INSERT INTO projection_supervised_subscription_groups (
                subscription_id, group_key, armed, next_eligible_at, pending_since,
                active_signal_id, sample_count, updated_at, state_json
              ) VALUES (
                ${subscriptionId}, ${groupKey}, ${group.armed ? 1 : 0},
                ${group.nextEligibleAt}, ${group.pendingSince}, ${group.activeSignal?.id ?? null},
                ${group.samples.length}, ${updatedAt}, ${JSON.stringify(group)}
              )
              ON CONFLICT (subscription_id, group_key) DO UPDATE SET
                armed = excluded.armed,
                next_eligible_at = excluded.next_eligible_at,
                pending_since = excluded.pending_since,
                active_signal_id = excluded.active_signal_id,
                sample_count = excluded.sample_count,
                updated_at = excluded.updated_at,
                state_json = excluded.state_json
            `,
            { concurrency: 1, discard: true },
          );
        }),
      ).pipe(
        Effect.mapError(persistenceError("SupervisedRuntime.putSubscriptionEvaluationState")),
      );

  const recordMetricSample: SupervisedRuntimeRepositoryShape["recordMetricSample"] = (sample) =>
    sql`
      INSERT INTO projection_supervised_metric_samples (
        metric_sample_id, metric_name, scope_kind, subject_id, event_time,
        revision, aggregation_receipt_hash, entity_json
      ) VALUES (
        ${sample.id}, ${sample.metric}, ${sample.scope.kind}, ${sample.subjectId},
        ${sample.eventTime}, ${sample.revision}, ${sample.aggregationReceiptHash},
        ${JSON.stringify(sample)}
      )
      ON CONFLICT (metric_sample_id) DO UPDATE SET
        metric_name = excluded.metric_name,
        scope_kind = excluded.scope_kind,
        subject_id = excluded.subject_id,
        event_time = excluded.event_time,
        revision = excluded.revision,
        aggregation_receipt_hash = excluded.aggregation_receipt_hash,
        entity_json = excluded.entity_json
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("SupervisedRuntime.recordMetricSample")),
    );

  const upsertSignal: SupervisedRuntimeRepositoryShape["upsertSignal"] = (signal) =>
    sql`
      INSERT INTO projection_supervised_signals (
        signal_id, subscription_id, kind, subject_id, group_key, state, triggered_at,
        reset_at, revision, aggregation_receipt_hash, entity_json
      ) VALUES (
        ${signal.id}, ${signal.subscriptionId}, ${signal.kind}, ${signal.subjectId},
        ${signalGroupKey(signal)}, ${signal.state}, ${signal.triggeredAt}, ${signal.resetAt}, ${signal.revision},
        ${signal.aggregationReceiptHash}, ${JSON.stringify(signal)}
      )
      ON CONFLICT (signal_id) DO UPDATE SET
        state = excluded.state,
        reset_at = excluded.reset_at,
        revision = excluded.revision,
        aggregation_receipt_hash = excluded.aggregation_receipt_hash,
        entity_json = excluded.entity_json
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("SupervisedRuntime.upsertSignal")),
    );

  const appendControlPlaneEvent: SupervisedRuntimeRepositoryShape["appendControlPlaneEvent"] =
    (event) =>
      sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT OR IGNORE INTO supervised_control_plane_events (
              event_id, schema_id, schema_version, event_type, scope_kind, subject_id,
              event_time, recorded_at, revision, causation_event_id, correlation_id, event_json
            ) VALUES (
              ${event.eventId}, ${event.schemaId}, ${event.schemaVersion}, ${event.type},
              ${event.scope.kind}, ${event.subjectId}, ${event.eventTime}, ${event.recordedAt},
              ${event.revision}, ${event.causationEventId}, ${event.correlationId},
              ${JSON.stringify(event)}
            )
          `;
          const rows = yield* sql<{ readonly sequence: number }>`
            SELECT sequence FROM supervised_control_plane_events WHERE event_id = ${event.eventId}
          `;
          if (!rows[0]) {
            return yield* Effect.fail(new Error("Control-plane event append did not return a sequence."));
          }
          return rows[0].sequence;
        }),
      ).pipe(Effect.mapError(persistenceError("SupervisedRuntime.appendControlPlaneEvent")));

  const listControlPlaneEvents: SupervisedRuntimeRepositoryShape["listControlPlaneEvents"] =
    ({ afterSequence, throughSequence = Number.MAX_SAFE_INTEGER, limit }) =>
      sql<ControlPlaneEventRow>`
        SELECT sequence, event_json AS "eventJson"
        FROM supervised_control_plane_events
        WHERE sequence > ${Math.max(0, afterSequence)}
          AND sequence <= ${Math.max(0, throughSequence)}
        ORDER BY sequence
        LIMIT ${Math.max(1, Math.min(limit, 1_000))}
      `.pipe(
        Effect.mapError(toPersistenceSqlError("SupervisedRuntime.listControlPlaneEvents:query")),
        Effect.flatMap((rows) =>
          Effect.forEach(
            rows,
            (row) =>
              Effect.try({
                try: () =>
                  Schema.decodeUnknownSync(ControlPlaneEvent)({
                    ...(JSON.parse(row.eventJson) as object),
                    sequence: row.sequence,
                  }),
                catch: toPersistenceDecodeCauseError("SupervisedRuntime.listControlPlaneEvents:decode"),
              }),
            { concurrency: 1 },
          ),
        ),
      );

  const enqueueDelivery: SupervisedRuntimeRepositoryShape["enqueueDelivery"] = (delivery) =>
    Effect.gen(function* () {
      yield* sql`
        INSERT OR IGNORE INTO supervised_subscription_deliveries (
          delivery_id, subscription_id, signal_id, dedupe_key, status, attempt_count,
          available_at, lease_owner, lease_expires_at, replay, updated_at, entity_json
        ) VALUES (
          ${delivery.id}, ${delivery.subscriptionId}, ${delivery.signalId}, ${delivery.dedupeKey},
          ${delivery.status}, ${delivery.attemptCount}, ${delivery.availableAt}, NULL, NULL,
          ${delivery.replay ? 1 : 0}, ${delivery.updatedAt}, ${JSON.stringify(delivery)}
        )
      `;
      const rows = yield* sql<{ readonly changed: number }>`SELECT changes() AS changed`;
      return (rows[0]?.changed ?? 0) === 1;
    }).pipe(Effect.mapError(toPersistenceSqlError("SupervisedRuntime.enqueueDelivery")));

  const claimDeliveries: SupervisedRuntimeRepositoryShape["claimDeliveries"] = (input) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const rows = yield* sql<EntityRow & { readonly deliveryId: string }>`
          SELECT delivery_id AS "deliveryId", entity_json AS "entityJson"
          FROM supervised_subscription_deliveries
          WHERE available_at <= ${input.now}
            AND (
              status IN ('queued', 'failed') OR
              (status = 'delivering' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ${input.now})
            )
          ORDER BY available_at, delivery_id
          LIMIT ${Math.max(1, Math.min(input.limit, 100))}
        `;
        const claimed = yield* Effect.forEach(
          rows,
          (row) =>
            decodeJson(
              SubscriptionDelivery,
              "SupervisedRuntime.claimDeliveries:decode",
              row.entityJson,
            ).pipe(
              Effect.map((delivery) => ({
                ...delivery,
                status: "delivering" as const,
                updatedAt: input.now,
              })),
              Effect.tap((delivery) =>
                sql`
                  UPDATE supervised_subscription_deliveries
                  SET status = 'delivering',
                      lease_owner = ${input.workerId},
                      lease_expires_at = ${input.leaseExpiresAt},
                      updated_at = ${input.now},
                      entity_json = ${JSON.stringify(delivery)}
                  WHERE delivery_id = ${row.deliveryId}
                `,
              ),
            ),
          { concurrency: 1 },
        );
        return claimed;
      }),
    ).pipe(Effect.mapError(persistenceError("SupervisedRuntime.claimDeliveries")));

  const updateDelivery: SupervisedRuntimeRepositoryShape["updateDelivery"] = (delivery) =>
    sql`
      UPDATE supervised_subscription_deliveries
      SET status = ${delivery.status},
          attempt_count = ${delivery.attemptCount},
          available_at = ${delivery.availableAt},
          lease_owner = NULL,
          lease_expires_at = NULL,
          replay = ${delivery.replay ? 1 : 0},
          updated_at = ${delivery.updatedAt},
          entity_json = ${JSON.stringify(delivery)}
      WHERE delivery_id = ${delivery.id}
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("SupervisedRuntime.updateDelivery")),
    );

  const putDeadLetter: SupervisedRuntimeRepositoryShape["putDeadLetter"] = (letter) =>
    sql`
      INSERT INTO supervised_dead_letters (
        dead_letter_id, subscription_id, delivery_id, plugin_id, status,
        created_at, updated_at, entity_json
      ) VALUES (
        ${letter.id}, ${letter.subscriptionId}, ${letter.deliveryId}, ${letter.pluginId},
        ${letter.status}, ${letter.createdAt}, ${letter.updatedAt}, ${JSON.stringify(letter)}
      )
      ON CONFLICT (dead_letter_id) DO UPDATE SET
        status = excluded.status,
        updated_at = excluded.updated_at,
        entity_json = excluded.entity_json
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("SupervisedRuntime.putDeadLetter")),
    );

  const upsertPlugin: SupervisedRuntimeRepositoryShape["upsertPlugin"] = (plugin) =>
    sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`
          INSERT INTO supervised_plugin_installations (
            plugin_id, name, version, status, revision, updated_at, entity_json
          ) VALUES (
            ${plugin.pluginId}, ${plugin.manifest.name}, ${plugin.manifest.version},
            ${plugin.status}, ${plugin.revision}, ${plugin.updatedAt}, ${JSON.stringify(plugin)}
          )
          ON CONFLICT (plugin_id) DO UPDATE SET
            name = excluded.name,
            version = excluded.version,
            status = excluded.status,
            revision = excluded.revision,
            updated_at = excluded.updated_at,
            entity_json = excluded.entity_json
        `;
        yield* sql`
          INSERT INTO supervised_plugin_grants (
            grant_id, plugin_id, status, revision, updated_at, entity_json
          ) VALUES (
            ${plugin.grant.id}, ${plugin.pluginId}, ${plugin.grant.status}, ${plugin.grant.revision},
            ${plugin.updatedAt}, ${JSON.stringify(plugin.grant)}
          )
          ON CONFLICT (grant_id) DO UPDATE SET
            status = excluded.status,
            revision = excluded.revision,
            updated_at = excluded.updated_at,
            entity_json = excluded.entity_json
        `;
        yield* sql`
      INSERT INTO supervised_plugin_health (
        plugin_id, consecutive_failures, circuit_state, queue_depth, lag_ms,
            last_success_at, last_failure_at, last_error, updated_at, circuit_opened_until
          ) VALUES (${plugin.pluginId}, 0, 'closed', 0, 0, NULL, NULL, NULL, ${plugin.updatedAt}, NULL)
          ON CONFLICT (plugin_id) DO NOTHING
        `;
      }),
    ).pipe(Effect.mapError(persistenceError("SupervisedRuntime.upsertPlugin")));

  const updatePluginHealth: SupervisedRuntimeRepositoryShape["updatePluginHealth"] = (health) =>
    sql`
      INSERT INTO supervised_plugin_health (
        plugin_id, consecutive_failures, circuit_state, queue_depth, lag_ms,
        last_success_at, last_failure_at, last_error, updated_at, circuit_opened_until
      ) VALUES (
        ${health.pluginId}, ${health.consecutiveFailures}, ${health.circuitState},
        ${health.queueDepth}, ${health.lagMs}, ${health.lastSuccessAt},
        ${health.lastFailureAt}, ${health.lastError}, ${health.updatedAt},
        ${health.circuitOpenedUntil}
      )
      ON CONFLICT (plugin_id) DO UPDATE SET
        consecutive_failures = excluded.consecutive_failures,
        circuit_state = excluded.circuit_state,
        queue_depth = excluded.queue_depth,
        lag_ms = excluded.lag_ms,
        last_success_at = excluded.last_success_at,
        last_failure_at = excluded.last_failure_at,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at,
        circuit_opened_until = excluded.circuit_opened_until
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("SupervisedRuntime.updatePluginHealth")),
    );

  const appendAudit: SupervisedRuntimeRepositoryShape["appendAudit"] = (input) =>
    sql<{ readonly auditSequence: number }>`
      INSERT INTO supervised_runtime_audit (
        action, actor_json, target_kind, target_id, outcome, detail_json, occurred_at
      ) VALUES (
        ${input.action}, ${JSON.stringify(input.actor)}, ${input.targetKind}, ${input.targetId},
        ${input.outcome}, ${JSON.stringify(input.detail)}, ${input.occurredAt}
      )
      RETURNING audit_sequence AS "auditSequence"
    `.pipe(
      Effect.mapError(toPersistenceSqlError("SupervisedRuntime.appendAudit")),
      Effect.flatMap((rows) =>
        rows[0]
          ? Effect.succeed(rows[0].auditSequence)
          : Effect.fail(toPersistenceSqlError("SupervisedRuntime.appendAudit")(new Error("No audit sequence returned."))),
      ),
    );

  const applyDomainEvent: SupervisedRuntimeRepositoryShape["applyDomainEvent"] = (event) =>
    Effect.gen(function* () {
      const payload = event.payload;
      switch (event.type) {
        case "supervised.room-created":
        case "supervised.room-updated": {
          if (!payload.room) return;
          const room = payload.room;
          yield* sql`
            INSERT INTO projection_supervised_rooms (
              room_id, project_id, lead_seat_id, status, graph_revision, revision, updated_at, entity_json
            ) VALUES (
              ${room.id}, ${room.projectId}, ${room.leadSeatId}, ${room.status},
              ${room.graphRevision}, ${room.revision}, ${room.updatedAt}, ${JSON.stringify(room)}
            )
            ON CONFLICT (room_id) DO UPDATE SET
              lead_seat_id = excluded.lead_seat_id,
              status = excluded.status,
              graph_revision = excluded.graph_revision,
              revision = excluded.revision,
              updated_at = excluded.updated_at,
              entity_json = excluded.entity_json
          `;
          break;
        }
        case "supervised.task-created": {
          if (!payload.task) return;
          const task = payload.task;
          yield* sql`
            INSERT INTO projection_supervised_tasks (
              task_id, room_id, lifecycle, graph_revision, revision, updated_at, entity_json
            ) VALUES (
              ${task.id}, ${task.roomId}, ${task.lifecycle}, ${task.activeGraphRevision},
              ${task.revision}, ${task.updatedAt}, ${JSON.stringify(task)}
            )
            ON CONFLICT (task_id) DO UPDATE SET
              lifecycle = excluded.lifecycle,
              graph_revision = excluded.graph_revision,
              revision = excluded.revision,
              updated_at = excluded.updated_at,
              entity_json = excluded.entity_json
          `;
          break;
        }
        case "supervised.task-node-committed": {
          if (!payload.taskNode) return;
          const node = payload.taskNode;
          yield* sql`
            INSERT INTO projection_supervised_task_nodes (
              task_node_id, task_id, room_id, active_revision_id, lifecycle,
              graph_revision, revision, updated_at, entity_json
            ) VALUES (
              ${node.id}, ${node.taskId}, ${node.roomId}, ${node.activeRevisionId},
              ${node.lifecycle}, ${node.graphRevision}, ${node.revision}, ${node.updatedAt},
              ${JSON.stringify(node)}
            )
            ON CONFLICT (task_node_id) DO UPDATE SET
              active_revision_id = excluded.active_revision_id,
              lifecycle = excluded.lifecycle,
              graph_revision = excluded.graph_revision,
              revision = excluded.revision,
              updated_at = excluded.updated_at,
              entity_json = excluded.entity_json
          `;
          if (payload.taskNodeRevision) {
            const revision = payload.taskNodeRevision;
            yield* sql`
              INSERT OR IGNORE INTO projection_supervised_task_node_revisions (
                task_node_revision_id, task_node_id, graph_revision, created_at, entity_json
              ) VALUES (
                ${revision.id}, ${revision.taskNodeId}, ${revision.graphRevision},
                ${revision.createdAt}, ${JSON.stringify(revision)}
              )
            `;
          }
          break;
        }
        case "supervised.run-requested":
        case "supervised.run-transitioned": {
          if (!payload.run) return;
          const run = payload.run;
          yield* sql`
            INSERT INTO projection_supervised_runs (
              run_id, room_id, task_id, task_node_id, status, daemon_epoch,
              revision, last_progress_at, updated_at, entity_json
            ) VALUES (
              ${run.id}, ${run.roomId}, ${run.taskId}, ${run.taskNodeId}, ${run.status},
              ${run.daemonEpoch}, ${run.revision}, ${run.lastProgressAt}, ${run.updatedAt},
              ${JSON.stringify(run)}
            )
            ON CONFLICT (run_id) DO UPDATE SET
              status = excluded.status,
              daemon_epoch = excluded.daemon_epoch,
              revision = excluded.revision,
              last_progress_at = excluded.last_progress_at,
              updated_at = excluded.updated_at,
              entity_json = excluded.entity_json
          `;
          break;
        }
          case "supervised.run-policy-upserted":
            if (payload.runPolicy) yield* upsertRunPolicy(payload.runPolicy);
            break;
          case "supervised.claim-acquired":
          case "supervised.claim-state-changed": {
            if (!payload.workClaim) return;
            const claim = payload.workClaim;
            yield* sql`
              INSERT INTO projection_supervised_work_claims (
                claim_id, task_node_id, task_node_revision_id, run_id, status,
                expires_at, revision, entity_json
              ) VALUES (
                ${claim.id}, ${claim.taskNodeId}, ${claim.taskNodeRevisionId}, ${claim.runId},
                ${claim.status}, ${claim.expiresAt}, ${claim.revision}, ${JSON.stringify(claim)}
              )
              ON CONFLICT (claim_id) DO UPDATE SET
                status = excluded.status,
                expires_at = excluded.expires_at,
                revision = excluded.revision,
                entity_json = excluded.entity_json
            `;
            break;
          }
          case "supervised.lease-granted":
          case "supervised.lease-state-changed": {
            if (!payload.capabilityLease) return;
            const lease = payload.capabilityLease;
            yield* sql`
              INSERT INTO projection_supervised_capability_leases (
                lease_id, run_id, holder_seat_id, capability, status, expires_at, revision, entity_json
              ) VALUES (
                ${lease.id}, ${lease.runId}, ${lease.holderSeatId}, ${lease.capability},
                ${lease.status}, ${lease.expiresAt}, ${lease.revision}, ${JSON.stringify(lease)}
              )
              ON CONFLICT (lease_id) DO UPDATE SET
                status = excluded.status,
                expires_at = excluded.expires_at,
                revision = excluded.revision,
                entity_json = excluded.entity_json
            `;
            break;
          }
          case "supervised.context-workspace-upserted": {
            if (!payload.contextWorkspace) return;
            const workspace = payload.contextWorkspace;
            yield* sql`
              INSERT INTO projection_context_workspaces (
                workspace_id, project_id, room_id, revision, high_water_sequence, updated_at, entity_json
              ) VALUES (
                ${workspace.id}, ${workspace.projectId}, ${workspace.roomId}, ${workspace.revision},
                ${workspace.highWaterSequence}, ${workspace.updatedAt}, ${JSON.stringify(workspace)}
              )
              ON CONFLICT (workspace_id) DO UPDATE SET
                room_id = excluded.room_id,
                revision = excluded.revision,
                high_water_sequence = excluded.high_water_sequence,
                updated_at = excluded.updated_at,
                entity_json = excluded.entity_json
            `;
            break;
          }
          case "supervised.context-appended": {
            if (!payload.contextRecord) return;
            if (payload.contextWorkspace) {
              const workspace = payload.contextWorkspace;
              yield* sql`
                UPDATE projection_context_workspaces
                SET revision = ${workspace.revision},
                    high_water_sequence = ${workspace.highWaterSequence},
                    updated_at = ${workspace.updatedAt},
                    entity_json = ${JSON.stringify(workspace)}
                WHERE workspace_id = ${workspace.id}
              `;
            }
            const record = payload.contextRecord;
          yield* sql`
            INSERT INTO projection_context_records (
              record_id, workspace_id, kind, status, content_revision, blob_hash, updated_at, entity_json
            ) VALUES (
              ${record.id}, ${record.workspaceId}, ${record.kind}, ${record.status},
              ${record.contentRevision}, ${record.blob?.hash ?? null}, ${record.updatedAt},
              ${JSON.stringify(record)}
            )
            ON CONFLICT (record_id) DO UPDATE SET
              status = excluded.status,
              content_revision = excluded.content_revision,
              blob_hash = excluded.blob_hash,
              updated_at = excluded.updated_at,
              entity_json = excluded.entity_json
          `;
            break;
          }
          case "supervised.rlm-upserted": {
            if (!payload.rlmEpisode) return;
            const episode = payload.rlmEpisode;
            yield* sql`
              INSERT INTO projection_supervised_rlm_episodes (
                episode_id, run_id, status, completed_branch_count, updated_at, entity_json
              ) VALUES (
                ${episode.id}, ${episode.runId}, ${episode.status}, ${episode.completedBranchCount},
                ${episode.updatedAt}, ${JSON.stringify(episode)}
              )
              ON CONFLICT (episode_id) DO UPDATE SET
                status = excluded.status,
                completed_branch_count = excluded.completed_branch_count,
                updated_at = excluded.updated_at,
                entity_json = excluded.entity_json
            `;
            break;
          }
          case "supervised.model-session-upserted": {
            if (!payload.modelSession) return;
            const session = payload.modelSession;
            yield* sql`
              INSERT INTO projection_supervised_model_sessions (
                model_session_id, room_id, run_id, task_node_id, rlm_episode_id,
                parent_session_id, role, status, revision, updated_at, entity_json
              ) VALUES (
                ${session.id}, ${session.roomId}, ${session.runId}, ${session.taskNodeId},
                ${session.rlmEpisodeId}, ${session.parentSessionId}, ${session.role},
                ${session.status}, ${session.revision}, ${session.updatedAt}, ${JSON.stringify(session)}
              )
              ON CONFLICT (model_session_id) DO UPDATE SET
                status = excluded.status,
                revision = excluded.revision,
                updated_at = excluded.updated_at,
                entity_json = excluded.entity_json
            `;
            break;
          }
        case "supervised.patch-upserted": {
          if (!payload.patch) return;
          const patch = payload.patch;
          yield* sql`
            INSERT INTO projection_harness_patches (
              patch_id, scope_kind, scope_id, status, version, base_policy_hash, updated_at, entity_json
            ) VALUES (
              ${patch.id}, ${patch.scope.kind}, ${scopeId(patch.scope as typeof patch.scope & Record<string, unknown>)},
              ${patch.status}, ${patch.version}, ${patch.basePolicyHash}, ${patch.updatedAt}, ${JSON.stringify(patch)}
            )
            ON CONFLICT (patch_id) DO UPDATE SET
              status = excluded.status,
              version = excluded.version,
              updated_at = excluded.updated_at,
              entity_json = excluded.entity_json
          `;
          break;
        }
          case "supervised.specialist-upserted": {
          if (!payload.specialist) return;
          const specialist = payload.specialist;
          yield* sql`
            INSERT INTO projection_retained_specialists (
              specialist_id, profile_preset_id, concern, status, latest_snapshot_id,
              expires_at, revision, updated_at, entity_json
            ) VALUES (
              ${specialist.id}, ${specialist.profilePresetId}, ${specialist.concern},
              ${specialist.status}, ${specialist.latestSnapshotId}, ${specialist.expiresAt},
              ${specialist.revision}, ${specialist.updatedAt}, ${JSON.stringify(specialist)}
            )
            ON CONFLICT (specialist_id) DO UPDATE SET
              status = excluded.status,
              latest_snapshot_id = excluded.latest_snapshot_id,
              expires_at = excluded.expires_at,
              revision = excluded.revision,
              updated_at = excluded.updated_at,
              entity_json = excluded.entity_json
          `;
          if (payload.specialistSnapshot) {
            const snapshot = payload.specialistSnapshot;
            yield* sql`
              INSERT OR IGNORE INTO projection_specialist_snapshots (
                specialist_snapshot_id, specialist_id, profile_content_hash, expires_at, entity_json
              ) VALUES (
                ${snapshot.id}, ${snapshot.specialistId}, ${snapshot.profileContentHash},
                ${snapshot.expiresAt}, ${JSON.stringify(snapshot)}
              )
            `;
          }
            break;
          }
          case "supervised.kernel-session-upserted": {
            if (!payload.kernelSession) return;
            const session = payload.kernelSession;
            yield* sql`
              INSERT INTO projection_kernel_sessions (
                kernel_session_id, run_id, language, status, process_id, last_used_at, entity_json
              ) VALUES (
                ${session.id}, ${session.runId}, ${session.language}, ${session.status},
                ${session.processId}, ${session.lastUsedAt}, ${JSON.stringify(session)}
              )
              ON CONFLICT (kernel_session_id) DO UPDATE SET
                status = excluded.status,
                process_id = excluded.process_id,
                last_used_at = excluded.last_used_at,
                entity_json = excluded.entity_json
            `;
            break;
          }
          case "supervised.kernel-execution-upserted": {
            if (!payload.kernelExecution) return;
            const execution = payload.kernelExecution;
            yield* sql`
              INSERT INTO projection_kernel_executions (
                kernel_execution_id, kernel_session_id, status, started_at, finished_at, entity_json
              ) VALUES (
                ${execution.id}, ${execution.kernelSessionId}, ${execution.status}, ${execution.startedAt},
                ${execution.finishedAt}, ${JSON.stringify(execution)}
              )
              ON CONFLICT (kernel_execution_id) DO UPDATE SET
                status = excluded.status,
                started_at = excluded.started_at,
                finished_at = excluded.finished_at,
                entity_json = excluded.entity_json
            `;
            break;
          }
        case "supervised.subscription-upserted":
        case "supervised.subscription-state-changed":
          if (payload.subscription) yield* upsertSubscription(payload.subscription);
          break;
        case "supervised.plugin-installed":
        case "supervised.plugin-upgraded":
        case "supervised.plugin-state-changed":
          if (payload.plugin) yield* upsertPlugin(payload.plugin);
          break;
        case "supervised.plugin-circuit-reset":
          if (payload.pluginHealth) yield* updatePluginHealth(payload.pluginHealth);
          break;
        case "supervised.metric-recorded":
          if (payload.metricSample) yield* recordMetricSample(payload.metricSample);
          break;
        case "supervised.signal-derived":
        case "supervised.signal-acknowledged":
        case "supervised.signal-reset":
          if (payload.signal) yield* upsertSignal(payload.signal);
          break;
        case "supervised.delivery-enqueued":
          if (payload.delivery) yield* enqueueDelivery(payload.delivery);
          break;
        case "supervised.delivery-updated":
          if (payload.delivery) yield* updateDelivery(payload.delivery);
          if (payload.deadLetter) yield* putDeadLetter(payload.deadLetter);
          break;
        case "supervised.dead-lettered":
          if (payload.deadLetter) yield* putDeadLetter(payload.deadLetter);
          break;
          case "supervised.intervention-proposed":
          case "supervised.intervention-reconciled": {
            if (payload.intervention) {
              const intervention = payload.intervention;
              yield* sql`
                INSERT INTO projection_supervised_interventions (
                  intervention_id, room_id, requester_json, specialist_thread_id,
                  status, revision, updated_at, entity_json
                ) VALUES (
                  ${intervention.id}, ${intervention.roomId}, ${JSON.stringify(intervention.requestedBy)},
                  ${intervention.specialistThreadId}, ${intervention.status}, ${intervention.revision},
                  ${intervention.updatedAt}, ${JSON.stringify(intervention)}
                )
                ON CONFLICT (intervention_id) DO UPDATE SET
                  status = excluded.status,
                  revision = excluded.revision,
                  updated_at = excluded.updated_at,
                  entity_json = excluded.entity_json
              `;
            }
            if (payload.leadNotification) {
              const notification = payload.leadNotification;
              yield* sql`
                INSERT INTO projection_supervised_lead_notifications (
                  notification_id, intervention_id, room_id, lead_seat_id, status, created_at, entity_json
                ) VALUES (
                  ${notification.id}, ${notification.interventionId}, ${notification.roomId},
                  ${notification.leadSeatId}, ${notification.status}, ${notification.createdAt},
                  ${JSON.stringify(notification)}
                )
                ON CONFLICT (notification_id) DO UPDATE SET
                  status = excluded.status,
                  entity_json = excluded.entity_json
              `;
            }
            if (payload.reconciliation) {
              const reconciliation = payload.reconciliation;
              yield* sql`
                INSERT INTO projection_supervised_reconciliations (
                  reconciliation_id, intervention_id, room_id, lead_seat_id,
                  status, revision, resolved_at, entity_json
                ) VALUES (
                  ${reconciliation.id}, ${reconciliation.interventionId}, ${reconciliation.roomId},
                  ${reconciliation.leadSeatId}, ${reconciliation.status}, ${reconciliation.revision},
                  ${reconciliation.resolvedAt}, ${JSON.stringify(reconciliation)}
                )
                ON CONFLICT (reconciliation_id) DO UPDATE SET
                  status = excluded.status,
                  revision = excluded.revision,
                  resolved_at = excluded.resolved_at,
                  entity_json = excluded.entity_json
              `;
            }
            break;
          }
          case "supervised.compaction-requested":
        case "supervised.handoff-requested":
          break;
      }
      const current = yield* getSnapshot({ includeDisabled: true, limit: 1 });
      yield* setHealth(
        { ...current.health, updatedAt: event.occurredAt },
        Math.max(current.snapshotSequence, event.sequence),
      );
    }).pipe(Effect.mapError(persistenceError("SupervisedRuntime.applyDomainEvent")));

  const replaceSnapshot: SupervisedRuntimeRepositoryShape["replaceSnapshot"] = (snapshot) =>
    sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`DELETE FROM supervised_dead_letters`;
        yield* sql`DELETE FROM supervised_subscription_deliveries`;
        yield* sql`DELETE FROM projection_supervised_signals`;
        yield* sql`DELETE FROM projection_supervised_delivery_cursors`;
        yield* sql`DELETE FROM projection_supervised_subscriptions`;
        yield* sql`DELETE FROM supervised_plugin_grants`;
        yield* sql`DELETE FROM supervised_plugin_health`;
          yield* sql`DELETE FROM supervised_plugin_installations`;
          yield* sql`DELETE FROM supervised_event_schemas`;
          yield* sql`DELETE FROM projection_supervised_reconciliations`;
          yield* sql`DELETE FROM projection_supervised_lead_notifications`;
          yield* sql`DELETE FROM projection_supervised_interventions`;
          yield* sql`DELETE FROM projection_kernel_executions`;
          yield* sql`DELETE FROM projection_kernel_sessions`;
          yield* sql`DELETE FROM projection_specialist_snapshots`;
          yield* sql`DELETE FROM projection_retained_specialists`;
          yield* sql`DELETE FROM projection_harness_patches`;
          yield* sql`DELETE FROM projection_supervised_model_sessions`;
          yield* sql`DELETE FROM projection_supervised_rlm_episodes`;
          yield* sql`DELETE FROM projection_context_records`;
          yield* sql`DELETE FROM projection_context_workspaces`;
          yield* sql`DELETE FROM projection_supervised_capability_leases`;
          yield* sql`DELETE FROM projection_supervised_work_claims`;
        yield* sql`DELETE FROM projection_supervised_runs`;
        yield* sql`DELETE FROM projection_supervised_task_node_revisions`;
        yield* sql`DELETE FROM projection_supervised_task_nodes`;
        yield* sql`DELETE FROM projection_supervised_tasks`;
        yield* sql`DELETE FROM projection_supervised_rooms`;
        yield* sql`DELETE FROM projection_supervised_run_policies`;

        yield* Effect.forEach(
          snapshot.rooms,
          (room) => sql`
            INSERT INTO projection_supervised_rooms (
              room_id, project_id, lead_seat_id, status, graph_revision, revision, updated_at, entity_json
            ) VALUES (
              ${room.id}, ${room.projectId}, ${room.leadSeatId}, ${room.status},
              ${room.graphRevision}, ${room.revision}, ${room.updatedAt}, ${JSON.stringify(room)}
            )
          `,
          { concurrency: 1, discard: true },
        );
        yield* Effect.forEach(
          snapshot.tasks,
          (task) => sql`
            INSERT INTO projection_supervised_tasks (
              task_id, room_id, lifecycle, graph_revision, revision, updated_at, entity_json
            ) VALUES (
              ${task.id}, ${task.roomId}, ${task.lifecycle}, ${task.activeGraphRevision},
              ${task.revision}, ${task.updatedAt}, ${JSON.stringify(task)}
            )
          `,
          { concurrency: 1, discard: true },
        );
          yield* Effect.forEach(
            snapshot.taskNodes,
          (node) => sql`
            INSERT INTO projection_supervised_task_nodes (
              task_node_id, task_id, room_id, active_revision_id, lifecycle,
              graph_revision, revision, updated_at, entity_json
            ) VALUES (
              ${node.id}, ${node.taskId}, ${node.roomId}, ${node.activeRevisionId},
              ${node.lifecycle}, ${node.graphRevision}, ${node.revision}, ${node.updatedAt},
              ${JSON.stringify(node)}
            )
          `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.taskNodeRevisions,
            (revision) => sql`
              INSERT INTO projection_supervised_task_node_revisions (
                task_node_revision_id, task_node_id, graph_revision, created_at, entity_json
              ) VALUES (
                ${revision.id}, ${revision.taskNodeId}, ${revision.graphRevision},
                ${revision.createdAt}, ${JSON.stringify(revision)}
              )
            `,
            { concurrency: 1, discard: true },
          );
        yield* Effect.forEach(
          snapshot.runs,
          (run) => sql`
            INSERT INTO projection_supervised_runs (
              run_id, room_id, task_id, task_node_id, status, daemon_epoch,
              revision, last_progress_at, updated_at, entity_json
            ) VALUES (
              ${run.id}, ${run.roomId}, ${run.taskId}, ${run.taskNodeId}, ${run.status},
              ${run.daemonEpoch}, ${run.revision}, ${run.lastProgressAt}, ${run.updatedAt},
              ${JSON.stringify(run)}
            )
          `,
          { concurrency: 1, discard: true },
        );
          yield* Effect.forEach(
            snapshot.runPolicies,
          (policy) => sql`
            INSERT INTO projection_supervised_run_policies (policy_id, revision, updated_at, entity_json)
            VALUES (${policy.id}, ${policy.revision}, ${policy.updatedAt}, ${JSON.stringify(policy)})
          `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.workClaims,
            (claim) => sql`
              INSERT INTO projection_supervised_work_claims (
                claim_id, task_node_id, task_node_revision_id, run_id, status,
                expires_at, revision, entity_json
              ) VALUES (
                ${claim.id}, ${claim.taskNodeId}, ${claim.taskNodeRevisionId}, ${claim.runId},
                ${claim.status}, ${claim.expiresAt}, ${claim.revision}, ${JSON.stringify(claim)}
              )
            `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.capabilityLeases,
            (lease) => sql`
              INSERT INTO projection_supervised_capability_leases (
                lease_id, run_id, holder_seat_id, capability, status, expires_at, revision, entity_json
              ) VALUES (
                ${lease.id}, ${lease.runId}, ${lease.holderSeatId}, ${lease.capability},
                ${lease.status}, ${lease.expiresAt}, ${lease.revision}, ${JSON.stringify(lease)}
              )
            `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.contextWorkspaces,
          (workspace) => sql`
            INSERT INTO projection_context_workspaces (
              workspace_id, project_id, room_id, revision, high_water_sequence, updated_at, entity_json
            ) VALUES (
              ${workspace.id}, ${workspace.projectId}, ${workspace.roomId}, ${workspace.revision},
              ${workspace.highWaterSequence}, ${workspace.updatedAt}, ${JSON.stringify(workspace)}
            )
          `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.contextRecords,
            (record) => sql`
              INSERT INTO projection_context_records (
                record_id, workspace_id, kind, status, content_revision, blob_hash, updated_at, entity_json
              ) VALUES (
                ${record.id}, ${record.workspaceId}, ${record.kind}, ${record.status},
                ${record.contentRevision}, ${record.blob?.hash ?? null}, ${record.updatedAt},
                ${JSON.stringify(record)}
              )
            `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.rlmEpisodes,
            (episode) => sql`
              INSERT INTO projection_supervised_rlm_episodes (
                episode_id, run_id, status, completed_branch_count, updated_at, entity_json
              ) VALUES (
                ${episode.id}, ${episode.runId}, ${episode.status}, ${episode.completedBranchCount},
                ${episode.updatedAt}, ${JSON.stringify(episode)}
              )
            `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.modelSessions,
            (session) => sql`
              INSERT INTO projection_supervised_model_sessions (
                model_session_id, room_id, run_id, task_node_id, rlm_episode_id,
                parent_session_id, role, status, revision, updated_at, entity_json
              ) VALUES (
                ${session.id}, ${session.roomId}, ${session.runId}, ${session.taskNodeId},
                ${session.rlmEpisodeId}, ${session.parentSessionId}, ${session.role},
                ${session.status}, ${session.revision}, ${session.updatedAt}, ${JSON.stringify(session)}
              )
            `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.harnessPatches,
            (patch) => sql`
              INSERT INTO projection_harness_patches (
                patch_id, scope_kind, scope_id, status, version, base_policy_hash, updated_at, entity_json
              ) VALUES (
                ${patch.id}, ${patch.scope.kind}, ${scopeId(patch.scope as typeof patch.scope & Record<string, unknown>)},
                ${patch.status}, ${patch.version}, ${patch.basePolicyHash}, ${patch.updatedAt}, ${JSON.stringify(patch)}
              )
            `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.specialists,
            (specialist) => sql`
              INSERT INTO projection_retained_specialists (
                specialist_id, profile_preset_id, concern, status, latest_snapshot_id,
                expires_at, revision, updated_at, entity_json
              ) VALUES (
                ${specialist.id}, ${specialist.profilePresetId}, ${specialist.concern},
                ${specialist.status}, ${specialist.latestSnapshotId}, ${specialist.expiresAt},
                ${specialist.revision}, ${specialist.updatedAt}, ${JSON.stringify(specialist)}
              )
            `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.specialistSnapshots,
            (specialistSnapshot) => sql`
              INSERT INTO projection_specialist_snapshots (
                specialist_snapshot_id, specialist_id, profile_content_hash, expires_at, entity_json
              ) VALUES (
                ${specialistSnapshot.id}, ${specialistSnapshot.specialistId},
                ${specialistSnapshot.profileContentHash}, ${specialistSnapshot.expiresAt},
                ${JSON.stringify(specialistSnapshot)}
              )
            `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.kernelSessions,
            (session) => sql`
              INSERT INTO projection_kernel_sessions (
                kernel_session_id, run_id, language, status, process_id, last_used_at, entity_json
              ) VALUES (
                ${session.id}, ${session.runId}, ${session.language}, ${session.status},
                ${session.processId}, ${session.lastUsedAt}, ${JSON.stringify(session)}
              )
            `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.kernelExecutions,
            (execution) => sql`
              INSERT INTO projection_kernel_executions (
                kernel_execution_id, kernel_session_id, status, started_at, finished_at, entity_json
              ) VALUES (
                ${execution.id}, ${execution.kernelSessionId}, ${execution.status}, ${execution.startedAt},
                ${execution.finishedAt}, ${JSON.stringify(execution)}
              )
            `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.interventions,
            (intervention) => sql`
              INSERT INTO projection_supervised_interventions (
                intervention_id, room_id, requester_json, specialist_thread_id,
                status, revision, updated_at, entity_json
              ) VALUES (
                ${intervention.id}, ${intervention.roomId}, ${JSON.stringify(intervention.requestedBy)},
                ${intervention.specialistThreadId}, ${intervention.status}, ${intervention.revision},
                ${intervention.updatedAt}, ${JSON.stringify(intervention)}
              )
            `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.leadNotifications,
            (notification) => sql`
              INSERT INTO projection_supervised_lead_notifications (
                notification_id, intervention_id, room_id, lead_seat_id, status, created_at, entity_json
              ) VALUES (
                ${notification.id}, ${notification.interventionId}, ${notification.roomId},
                ${notification.leadSeatId}, ${notification.status}, ${notification.createdAt},
                ${JSON.stringify(notification)}
              )
            `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.reconciliations,
            (reconciliation) => sql`
              INSERT INTO projection_supervised_reconciliations (
                reconciliation_id, intervention_id, room_id, lead_seat_id,
                status, revision, resolved_at, entity_json
              ) VALUES (
                ${reconciliation.id}, ${reconciliation.interventionId}, ${reconciliation.roomId},
                ${reconciliation.leadSeatId}, ${reconciliation.status}, ${reconciliation.revision},
                ${reconciliation.resolvedAt}, ${JSON.stringify(reconciliation)}
              )
            `,
            { concurrency: 1, discard: true },
          );
        yield* Effect.forEach(snapshot.schemas, upsertEventSchema, { concurrency: 1, discard: true });
        yield* Effect.forEach(snapshot.plugins, upsertPlugin, { concurrency: 1, discard: true });
        yield* Effect.forEach(snapshot.pluginHealth, updatePluginHealth, {
          concurrency: 1,
          discard: true,
        });
        yield* Effect.forEach(snapshot.subscriptions, (subscription) => upsertSubscription(subscription), {
          concurrency: 1,
          discard: true,
        });
        yield* Effect.forEach(snapshot.signals, upsertSignal, { concurrency: 1, discard: true });
        yield* Effect.forEach(snapshot.deliveries, (delivery) => enqueueDelivery(delivery), {
          concurrency: 1,
          discard: true,
        });
        yield* Effect.forEach(snapshot.deadLetters, putDeadLetter, { concurrency: 1, discard: true });
        yield* setHealth(snapshot.health, snapshot.snapshotSequence);
      }),
    ).pipe(Effect.mapError(persistenceError("SupervisedRuntime.replaceSnapshot")));

  return {
    applyDomainEvent,
    getSnapshot,
    replaceSnapshot,
    setHealth,
    appendControlPlaneEvent,
    listControlPlaneEvents,
    upsertEventSchema,
    upsertRunPolicy,
    upsertSubscription,
    upsertCursor,
    getSubscriptionEvaluationState,
    putSubscriptionEvaluationState,
    recordMetricSample,
    upsertSignal,
    enqueueDelivery,
    claimDeliveries,
    updateDelivery,
    putDeadLetter,
    upsertPlugin,
    updatePluginHealth,
    appendAudit,
  } satisfies SupervisedRuntimeRepositoryShape;
});

export const SupervisedRuntimeRepositoryLive = Layer.effect(
  SupervisedRuntimeRepository,
  makeSupervisedRuntimeRepository,
);
