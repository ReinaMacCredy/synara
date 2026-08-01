import {
  AssignmentContract,
  OrchestratorCapacitySnapshot,
  OrchestratorCommunicationLink,
  OrchestratorMessageEnvelope,
  OrchestratorMonitor,
  OrchestratorOwnershipEdge,
  OrchestratorProviderCapability,
  OrchestratorRoot,
  OrchestratorRun,
  OrchestratorWriterClaim,
  ThreadId,
} from "@synara/contracts";
import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { PersistenceSqlError, toPersistenceSqlError } from "../Errors.ts";
import {
  ProjectionOrchestratorRepository,
  type ProjectionOrchestratorCore,
  type ProjectionOrchestratorRepositoryShape,
  type ProjectionOrchestratorRootRecord,
} from "../Services/ProjectionOrchestrator.ts";

type RootDbRow = {
  readonly rootThreadId: string;
  readonly projectId: string;
  readonly protocolVersion: 1;
  readonly state: "active" | "archived";
  readonly activeProcessId: string | null;
  readonly resourcePolicyVersion: number;
  readonly revision: number;
  readonly highWaterCursor: string;
  readonly createdAt: string;
  readonly archivedAt: string | null;
};

type OwnershipDbRow = {
  readonly rootThreadId: string;
  readonly parentThreadId: string;
  readonly childThreadId: string;
  readonly role: string;
  readonly capabilitiesJson: string;
  readonly contractVersion: number;
  readonly sourceThreadId: string;
  readonly sourceTurnId: string | null;
  readonly sourceOperationId: string | null;
  readonly activeFrom: string;
  readonly retiredAt: string | null;
  readonly decisionReasonJson: string;
};

type LinkDbRow = {
  readonly linkId: string;
  readonly rootThreadId: string;
  readonly sourceThreadId: string;
  readonly targetThreadId: string;
  readonly direction: string;
  readonly taskId: string | null;
  readonly runId: string | null;
  readonly capabilitiesJson: string;
  readonly requestedByJson: string;
  readonly grantedByJson: string | null;
  readonly reason: string;
  readonly state: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly updatedAt: string;
};

type RunDbRow = {
  readonly runId: string;
  readonly rootThreadId: string;
  readonly mode: string;
  readonly state: string;
  readonly disposition: string | null;
  readonly briefHash: string | null;
  readonly participantsJson: string;
  readonly decisionPacketArtifactId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type MessageDbRow = {
  readonly messageId: string;
  readonly rootThreadId: string;
  readonly senderThreadId: string;
  readonly targetThreadId: string;
  readonly assignmentId: string | null;
  readonly runId: string | null;
  readonly correlationId: string | null;
  readonly replyToMessageId: string | null;
  readonly hopCount: number;
  readonly expiresAt: string;
  readonly body: string;
  readonly artifactRefsJson: string;
  readonly deliveryState: string;
  readonly deliveryAttemptId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

type MonitorDbRow = {
  readonly monitorId: string;
  readonly rootThreadId: string;
  readonly targetThreadId: string | null;
  readonly kind: string;
  readonly condition: string;
  readonly cadenceMs: number | null;
  readonly nextWakeAt: string | null;
  readonly maxRuns: number;
  readonly runCount: number;
  readonly expiresAt: string;
  readonly ownerThreadId: string;
  readonly state: string;
};

type WriterClaimDbRow = {
  readonly claimId: string;
  readonly rootThreadId: string;
  readonly workspaceRoot: string;
  readonly normalizedPathPrefix: string;
  readonly assignmentId: string;
  readonly threadId: string;
  readonly mode: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly releasedAt: string | null;
};

const decode = <S extends Schema.Top>(schema: S, value: unknown): Schema.Schema.Type<S> =>
  Schema.decodeUnknownSync(schema as never)(value) as Schema.Schema.Type<S>;
const json = (value: string): unknown => JSON.parse(value);

const toRoot = (row: RootDbRow): ProjectionOrchestratorRootRecord => ({
  root: decode(OrchestratorRoot, {
    rootThreadId: row.rootThreadId,
    projectId: row.projectId,
    protocolVersion: row.protocolVersion,
    state: row.state,
    activeProcessId: row.activeProcessId,
    resourcePolicyVersion: row.resourcePolicyVersion,
    revision: row.revision,
    createdAt: row.createdAt,
    archivedAt: row.archivedAt,
  }),
  highWaterCursor: row.highWaterCursor,
});

const toOwnership = (row: OwnershipDbRow): typeof OrchestratorOwnershipEdge.Type =>
  decode(OrchestratorOwnershipEdge, {
    rootThreadId: row.rootThreadId,
    parentThreadId: row.parentThreadId,
    childThreadId: row.childThreadId,
    role: row.role,
    capabilities: json(row.capabilitiesJson),
    contractVersion: row.contractVersion,
    sourceThreadId: row.sourceThreadId,
    sourceTurnId: row.sourceTurnId,
    sourceOperationId: row.sourceOperationId,
    activeFrom: row.activeFrom,
    retiredAt: row.retiredAt,
    decisionReason: json(row.decisionReasonJson),
  });

const toLink = (row: LinkDbRow): typeof OrchestratorCommunicationLink.Type =>
  decode(OrchestratorCommunicationLink, {
    id: row.linkId,
    rootThreadId: row.rootThreadId,
    sourceThreadId: row.sourceThreadId,
    targetThreadId: row.targetThreadId,
    direction: row.direction,
    taskId: row.taskId,
    runId: row.runId,
    capabilities: json(row.capabilitiesJson),
    requestedBy: json(row.requestedByJson),
    grantedBy: row.grantedByJson === null ? null : json(row.grantedByJson),
    reason: row.reason,
    state: row.state,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    updatedAt: row.updatedAt,
  });

const toRun = (row: RunDbRow): typeof OrchestratorRun.Type =>
  decode(OrchestratorRun, {
    id: row.runId,
    rootThreadId: row.rootThreadId,
    mode: row.mode,
    state: row.state,
    disposition: row.disposition,
    briefHash: row.briefHash,
    participants: json(row.participantsJson),
    decisionPacketArtifactId: row.decisionPacketArtifactId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

const toMessage = (row: MessageDbRow): typeof OrchestratorMessageEnvelope.Type =>
  decode(OrchestratorMessageEnvelope, {
    messageId: row.messageId,
    rootThreadId: row.rootThreadId,
    senderThreadId: row.senderThreadId,
    targetThreadId: row.targetThreadId,
    assignmentId: row.assignmentId,
    runId: row.runId,
    correlationId: row.correlationId,
    replyToMessageId: row.replyToMessageId,
    hopCount: row.hopCount,
    expiresAt: row.expiresAt,
    body: row.body,
    artifactRefs: json(row.artifactRefsJson),
    deliveryState: row.deliveryState,
    deliveryAttemptId: row.deliveryAttemptId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

const toMonitor = (row: MonitorDbRow): typeof OrchestratorMonitor.Type =>
  decode(OrchestratorMonitor, {
    id: row.monitorId,
    rootThreadId: row.rootThreadId,
    targetThreadId: row.targetThreadId,
    kind: row.kind,
    condition: row.condition,
    cadenceMs: row.cadenceMs,
    nextWakeAt: row.nextWakeAt,
    maxRuns: row.maxRuns,
    runCount: row.runCount,
    expiresAt: row.expiresAt,
    ownerThreadId: row.ownerThreadId,
    state: row.state,
  });

const toWriterClaim = (row: WriterClaimDbRow): typeof OrchestratorWriterClaim.Type =>
  decode(OrchestratorWriterClaim, {
    id: row.claimId,
    rootThreadId: row.rootThreadId,
    workspaceRoot: row.workspaceRoot,
    normalizedPathPrefix: row.normalizedPathPrefix,
    assignmentId: row.assignmentId,
    threadId: row.threadId,
    mode: row.mode,
    acquiredAt: row.acquiredAt,
    expiresAt: row.expiresAt,
    releasedAt: row.releasedAt,
  });

const rootSelect = `
  root_thread_id AS "rootThreadId", project_id AS "projectId",
  protocol_version AS "protocolVersion", state,
  active_process_id AS "activeProcessId",
  resource_policy_version AS "resourcePolicyVersion", revision,
  high_water_cursor AS "highWaterCursor", created_at AS "createdAt",
  archived_at AS "archivedAt"
`;

const makeProjectionOrchestratorRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRoot: ProjectionOrchestratorRepositoryShape["upsertRoot"] = (row) =>
    Effect.gen(function* () {
      yield* sql`
        INSERT INTO projection_orchestrator_roots (
          root_thread_id, project_id, protocol_version, state, active_process_id,
          resource_policy_version, revision, high_water_cursor, created_at, archived_at
        )
        SELECT
          ${row.root.rootThreadId}, ${row.root.projectId}, ${row.root.protocolVersion},
          ${row.root.state}, ${row.root.activeProcessId}, ${row.root.resourcePolicyVersion},
          ${row.root.revision}, ${row.highWaterCursor}, ${row.root.createdAt}, ${row.root.archivedAt}
        FROM projection_projects AS project
        JOIN projection_threads AS root_thread
          ON root_thread.thread_id = ${row.root.rootThreadId}
         AND root_thread.project_id = project.project_id
         AND root_thread.deleted_at IS NULL
        WHERE project.project_id = ${row.root.projectId}
          AND project.kind = 'project'
          AND project.deleted_at IS NULL
        ON CONFLICT (root_thread_id) DO UPDATE SET
          protocol_version = excluded.protocol_version,
          state = excluded.state,
          active_process_id = excluded.active_process_id,
          resource_policy_version = excluded.resource_policy_version,
          revision = excluded.revision,
          high_water_cursor = excluded.high_water_cursor,
          archived_at = excluded.archived_at
        WHERE projection_orchestrator_roots.project_id = excluded.project_id
      `;
      const persisted = yield* sql<{ readonly projectId: string }>`
        SELECT project_id AS "projectId"
        FROM projection_orchestrator_roots
        WHERE root_thread_id = ${row.root.rootThreadId}
      `;
      if (persisted[0]?.projectId !== row.root.projectId) {
        return yield* new PersistenceSqlError({
          operation: "ProjectionOrchestratorRepository.upsertRoot:scope",
          detail: "Root thread and project scope do not resolve to an active real project",
        });
      }
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof PersistenceSqlError
          ? cause
          : toPersistenceSqlError("ProjectionOrchestratorRepository.upsertRoot:query")(cause),
      ),
    );

  const getRoot: ProjectionOrchestratorRepositoryShape["getRoot"] = (rootThreadId) =>
    sql
      .unsafe<RootDbRow>(
        `SELECT ${rootSelect}
       FROM projection_orchestrator_roots
       WHERE root_thread_id = ?`,
        [rootThreadId],
      )
      .pipe(
        Effect.map((rows) => (rows[0] ? Option.some(toRoot(rows[0])) : Option.none())),
        Effect.mapError(toPersistenceSqlError("ProjectionOrchestratorRepository.getRoot:query")),
      );

  const listRoots: ProjectionOrchestratorRepositoryShape["listRoots"] = () =>
    sql
      .unsafe<RootDbRow>(
        `SELECT ${rootSelect}
       FROM projection_orchestrator_roots
       ORDER BY created_at, root_thread_id`,
        [],
      )
      .pipe(
        Effect.map((rows) => rows.map(toRoot)),
        Effect.mapError(toPersistenceSqlError("ProjectionOrchestratorRepository.listRoots:query")),
      );

  const listRootPage: ProjectionOrchestratorRepositoryShape["listRootPage"] = (input) => {
    const limit = Math.max(1, Math.min(101, Math.floor(input.limit)));
    const projectClause =
      input.projectId === undefined ? sql`` : sql`AND project_id = ${input.projectId}`;
    const archivedClause = input.includeArchived ? sql`` : sql`AND state <> 'archived'`;
    const cursorClause =
      input.beforeCreatedAt === undefined
        ? sql``
        : sql`AND (
            created_at > ${input.beforeCreatedAt}
            OR (
              created_at = ${input.beforeCreatedAt}
              AND root_thread_id > ${input.afterRootThreadIdAtTimestamp ?? ""}
            )
          )`;
    return sql<RootDbRow>`
      SELECT
        root_thread_id AS "rootThreadId", project_id AS "projectId",
        protocol_version AS "protocolVersion", state,
        active_process_id AS "activeProcessId",
        resource_policy_version AS "resourcePolicyVersion", revision,
        high_water_cursor AS "highWaterCursor", created_at AS "createdAt",
        archived_at AS "archivedAt"
      FROM projection_orchestrator_roots
      WHERE 1 = 1
        ${projectClause}
        ${archivedClause}
        ${cursorClause}
      ORDER BY created_at, root_thread_id
      LIMIT ${limit}
    `.pipe(
      Effect.map((rows) => rows.map(toRoot)),
      Effect.mapError(toPersistenceSqlError("ProjectionOrchestratorRepository.listRootPage:query")),
    );
  };

  const findRootForThread: ProjectionOrchestratorRepositoryShape["findRootForThread"] = (
    threadId,
  ) =>
    sql<{ readonly rootThreadId: string }>`
      SELECT root_thread_id AS "rootThreadId"
      FROM projection_orchestrator_roots
      WHERE root_thread_id = ${threadId} AND state = 'active'
      UNION ALL
      SELECT edge.root_thread_id AS "rootThreadId"
      FROM projection_orchestrator_ownership_edges AS edge
      JOIN projection_orchestrator_roots AS root
        ON root.root_thread_id = edge.root_thread_id
       AND root.state = 'active'
      WHERE edge.child_thread_id = ${threadId}
        AND edge.retired_at IS NULL
      LIMIT 2
    `.pipe(
      Effect.flatMap((rows) => {
        if (rows.length > 1) {
          return Effect.fail(
            new PersistenceSqlError({
              operation: "ProjectionOrchestratorRepository.findRootForThread:scope",
              detail: `Thread ${threadId} belongs to more than one active Orchestrator Root`,
            }),
          );
        }
        return Effect.succeed(
          rows[0] ? Option.some(ThreadId.makeUnsafe(rows[0].rootThreadId)) : Option.none(),
        );
      }),
      Effect.mapError((cause) =>
        cause instanceof PersistenceSqlError
          ? cause
          : toPersistenceSqlError("ProjectionOrchestratorRepository.findRootForThread:query")(
              cause,
            ),
      ),
    );

  const upsertOwnershipEdge: ProjectionOrchestratorRepositoryShape["upsertOwnershipEdge"] = (
    edge,
  ) =>
    Effect.gen(function* () {
      yield* sql`
        INSERT INTO projection_orchestrator_ownership_edges (
          root_thread_id, parent_thread_id, child_thread_id, role, capabilities_json,
          contract_version, source_thread_id, source_turn_id, source_operation_id,
          active_from, retired_at, decision_reason_json
        )
        SELECT
          ${edge.rootThreadId}, ${edge.parentThreadId}, ${edge.childThreadId}, ${edge.role},
          ${JSON.stringify(edge.capabilities)}, ${edge.contractVersion}, ${edge.sourceThreadId},
          ${edge.sourceTurnId}, ${edge.sourceOperationId}, ${edge.activeFrom}, ${edge.retiredAt},
          ${JSON.stringify(edge.decisionReason)}
        FROM projection_orchestrator_roots AS root
        JOIN projection_threads AS child
          ON child.thread_id = ${edge.childThreadId}
         AND child.project_id = root.project_id
         AND child.deleted_at IS NULL
        JOIN projection_threads AS parent
          ON parent.thread_id = ${edge.parentThreadId}
         AND parent.project_id = root.project_id
         AND parent.deleted_at IS NULL
        WHERE root.root_thread_id = ${edge.rootThreadId}
          AND (
            parent.thread_id = root.root_thread_id
            OR EXISTS (
              SELECT 1 FROM projection_orchestrator_ownership_edges AS parent_edge
              WHERE parent_edge.root_thread_id = root.root_thread_id
                AND parent_edge.child_thread_id = parent.thread_id
                AND parent_edge.retired_at IS NULL
            )
          )
        ON CONFLICT (root_thread_id, child_thread_id, contract_version) DO UPDATE SET
          role = excluded.role,
          capabilities_json = excluded.capabilities_json,
          retired_at = excluded.retired_at,
          decision_reason_json = excluded.decision_reason_json
      `;
      const rows = yield* sql<{ readonly count: number }>`SELECT changes() AS count`;
      if (rows[0]?.count !== 1) {
        return yield* new PersistenceSqlError({
          operation: "ProjectionOrchestratorRepository.upsertOwnershipEdge:scope",
          detail: "Ownership endpoints are not active threads in the Root project and tree",
        });
      }
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof PersistenceSqlError
          ? cause
          : toPersistenceSqlError("ProjectionOrchestratorRepository.upsertOwnershipEdge:query")(
              cause,
            ),
      ),
    );

  const upsertCommunicationLink: ProjectionOrchestratorRepositoryShape["upsertCommunicationLink"] =
    (link) =>
      sql`
        INSERT INTO projection_orchestrator_links (
          link_id, root_thread_id, source_thread_id, target_thread_id, direction,
          task_id, run_id, capabilities_json, requested_by_json, granted_by_json,
          reason, state, created_at, expires_at, updated_at
        ) VALUES (
          ${link.id}, ${link.rootThreadId}, ${link.sourceThreadId}, ${link.targetThreadId},
          ${link.direction}, ${link.taskId}, ${link.runId}, ${JSON.stringify(link.capabilities)},
          ${JSON.stringify(link.requestedBy)},
          ${link.grantedBy === null ? null : JSON.stringify(link.grantedBy)},
          ${link.reason}, ${link.state}, ${link.createdAt}, ${link.expiresAt}, ${link.updatedAt}
        )
        ON CONFLICT (link_id) DO UPDATE SET
          granted_by_json = excluded.granted_by_json,
          reason = excluded.reason,
          state = excluded.state,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
        WHERE projection_orchestrator_links.root_thread_id = excluded.root_thread_id
          AND projection_orchestrator_links.source_thread_id = excluded.source_thread_id
          AND projection_orchestrator_links.target_thread_id = excluded.target_thread_id
      `.pipe(
        Effect.asVoid,
        Effect.mapError(
          toPersistenceSqlError("ProjectionOrchestratorRepository.upsertCommunicationLink:query"),
        ),
      );

  const retireActiveOwnershipForChild: ProjectionOrchestratorRepositoryShape["retireActiveOwnershipForChild"] =
    (input) =>
      sql`
        UPDATE projection_orchestrator_ownership_edges
        SET retired_at = ${input.retiredAt}
        WHERE root_thread_id = ${input.rootThreadId}
          AND child_thread_id = ${input.childThreadId}
          AND retired_at IS NULL
      `.pipe(
        Effect.asVoid,
        Effect.mapError(
          toPersistenceSqlError(
            "ProjectionOrchestratorRepository.retireActiveOwnershipForChild:query",
          ),
        ),
      );

  const upsertAssignmentVersion: ProjectionOrchestratorRepositoryShape["upsertAssignmentVersion"] =
    (row) =>
      sql`
        INSERT INTO projection_orchestrator_assignments (
          assignment_id, contract_version, root_thread_id, process_id, task_id,
          owner_thread_id, assignee_thread_id, contract_json, state, created_at, updated_at
        ) VALUES (
          ${row.contract.assignmentId}, ${row.contract.version}, ${row.rootThreadId},
          ${row.processId}, ${row.contract.taskId}, ${row.contract.ownerThreadId},
          ${row.contract.assigneeThreadId}, ${JSON.stringify(row.contract)},
          ${row.contract.state}, ${row.contract.createdAt}, ${row.contract.updatedAt}
        )
        ON CONFLICT (assignment_id, contract_version) DO UPDATE SET
          contract_json = excluded.contract_json,
          state = excluded.state,
          updated_at = excluded.updated_at
        WHERE projection_orchestrator_assignments.root_thread_id = excluded.root_thread_id
          AND projection_orchestrator_assignments.process_id = excluded.process_id
          AND projection_orchestrator_assignments.task_id = excluded.task_id
          AND projection_orchestrator_assignments.owner_thread_id = excluded.owner_thread_id
          AND projection_orchestrator_assignments.assignee_thread_id = excluded.assignee_thread_id
      `.pipe(
        Effect.asVoid,
        Effect.mapError(
          toPersistenceSqlError("ProjectionOrchestratorRepository.upsertAssignmentVersion:query"),
        ),
      );

  const upsertRun: ProjectionOrchestratorRepositoryShape["upsertRun"] = (run) =>
    sql`
      INSERT INTO projection_orchestrator_runs (
        run_id, root_thread_id, mode, state, disposition, brief_hash,
        participants_json, decision_packet_artifact_id, created_at, updated_at
      ) VALUES (
        ${run.id}, ${run.rootThreadId}, ${run.mode}, ${run.state}, ${run.disposition},
        ${run.briefHash}, ${JSON.stringify(run.participants)}, ${run.decisionPacketArtifactId},
        ${run.createdAt}, ${run.updatedAt}
      )
      ON CONFLICT (run_id) DO UPDATE SET
        state = excluded.state,
        disposition = excluded.disposition,
        brief_hash = excluded.brief_hash,
        participants_json = excluded.participants_json,
        decision_packet_artifact_id = excluded.decision_packet_artifact_id,
        updated_at = excluded.updated_at
      WHERE projection_orchestrator_runs.root_thread_id = excluded.root_thread_id
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ProjectionOrchestratorRepository.upsertRun:query")),
    );

  const upsertMessage: ProjectionOrchestratorRepositoryShape["upsertMessage"] = (message) =>
    sql`
      INSERT INTO projection_orchestrator_messages (
        message_id, root_thread_id, sender_thread_id, target_thread_id,
        assignment_id, run_id, correlation_id, reply_to_message_id, hop_count,
        expires_at, body, artifact_refs_json, delivery_state,
        delivery_attempt_id, created_at, updated_at
      ) VALUES (
        ${message.messageId}, ${message.rootThreadId}, ${message.senderThreadId},
        ${message.targetThreadId}, ${message.assignmentId}, ${message.runId},
        ${message.correlationId}, ${message.replyToMessageId}, ${message.hopCount},
        ${message.expiresAt}, ${message.body}, ${JSON.stringify(message.artifactRefs)},
        ${message.deliveryState}, ${message.deliveryAttemptId}, ${message.createdAt},
        ${message.updatedAt}
      )
      ON CONFLICT (message_id) DO UPDATE SET
        delivery_state = excluded.delivery_state,
        delivery_attempt_id = excluded.delivery_attempt_id,
        updated_at = excluded.updated_at
      WHERE projection_orchestrator_messages.root_thread_id = excluded.root_thread_id
        AND projection_orchestrator_messages.sender_thread_id = excluded.sender_thread_id
        AND projection_orchestrator_messages.target_thread_id = excluded.target_thread_id
    `.pipe(
      Effect.asVoid,
      Effect.mapError(
        toPersistenceSqlError("ProjectionOrchestratorRepository.upsertMessage:query"),
      ),
    );

  const upsertMonitor: ProjectionOrchestratorRepositoryShape["upsertMonitor"] = (monitor) =>
    sql`
      INSERT INTO projection_orchestrator_monitors (
        monitor_id, root_thread_id, target_thread_id, kind, condition, cadence_ms,
        next_wake_at, max_runs, run_count, expires_at, owner_thread_id, state
      ) VALUES (
        ${monitor.id}, ${monitor.rootThreadId}, ${monitor.targetThreadId}, ${monitor.kind},
        ${monitor.condition}, ${monitor.cadenceMs}, ${monitor.nextWakeAt}, ${monitor.maxRuns},
        ${monitor.runCount}, ${monitor.expiresAt}, ${monitor.ownerThreadId}, ${monitor.state}
      )
      ON CONFLICT (monitor_id) DO UPDATE SET
        next_wake_at = excluded.next_wake_at,
        run_count = excluded.run_count,
        state = excluded.state
      WHERE projection_orchestrator_monitors.root_thread_id = excluded.root_thread_id
        AND projection_orchestrator_monitors.owner_thread_id = excluded.owner_thread_id
    `.pipe(
      Effect.asVoid,
      Effect.mapError(
        toPersistenceSqlError("ProjectionOrchestratorRepository.upsertMonitor:query"),
      ),
    );

  const upsertWriterClaim: ProjectionOrchestratorRepositoryShape["upsertWriterClaim"] = (claim) =>
    sql`
      INSERT INTO projection_orchestrator_writer_claims (
        claim_id, root_thread_id, workspace_root, normalized_path_prefix,
        assignment_id, thread_id, mode, acquired_at, expires_at, released_at
      ) VALUES (
        ${claim.id}, ${claim.rootThreadId}, ${claim.workspaceRoot},
        ${claim.normalizedPathPrefix}, ${claim.assignmentId}, ${claim.threadId},
        ${claim.mode}, ${claim.acquiredAt}, ${claim.expiresAt}, ${claim.releasedAt}
      )
      ON CONFLICT (claim_id) DO UPDATE SET
        released_at = excluded.released_at
      WHERE projection_orchestrator_writer_claims.root_thread_id = excluded.root_thread_id
        AND projection_orchestrator_writer_claims.assignment_id = excluded.assignment_id
        AND projection_orchestrator_writer_claims.thread_id = excluded.thread_id
    `.pipe(
      Effect.asVoid,
      Effect.mapError(
        toPersistenceSqlError("ProjectionOrchestratorRepository.upsertWriterClaim:query"),
      ),
    );

  const upsertProviderCapability: ProjectionOrchestratorRepositoryShape["upsertProviderCapability"] =
    (capability) =>
      sql`
        INSERT INTO projection_orchestrator_provider_capabilities (
          provider, model, capability_json, observed_at
        ) VALUES (
          ${capability.provider}, ${capability.model}, ${JSON.stringify(capability)},
          ${capability.observedAt}
        )
        ON CONFLICT (provider, model) DO UPDATE SET
          capability_json = excluded.capability_json,
          observed_at = excluded.observed_at
      `.pipe(
        Effect.asVoid,
        Effect.mapError(
          toPersistenceSqlError("ProjectionOrchestratorRepository.upsertProviderCapability:query"),
        ),
      );

  const upsertCapacity: ProjectionOrchestratorRepositoryShape["upsertCapacity"] = (input) =>
    sql`
      INSERT INTO projection_orchestrator_capacity (
        root_thread_id, capacity_json, observed_at
      ) VALUES (
        ${input.rootThreadId}, ${JSON.stringify(input.capacity)}, ${input.capacity.observedAt}
      )
      ON CONFLICT (root_thread_id) DO UPDATE SET
        capacity_json = excluded.capacity_json,
        observed_at = excluded.observed_at
    `.pipe(
      Effect.asVoid,
      Effect.mapError(
        toPersistenceSqlError("ProjectionOrchestratorRepository.upsertCapacity:query"),
      ),
    );

  const listMessages: ProjectionOrchestratorRepositoryShape["listMessages"] = (rootThreadId) =>
    sql<MessageDbRow>`
      SELECT
        message_id AS "messageId", root_thread_id AS "rootThreadId",
        sender_thread_id AS "senderThreadId", target_thread_id AS "targetThreadId",
        assignment_id AS "assignmentId", run_id AS "runId",
        correlation_id AS "correlationId", reply_to_message_id AS "replyToMessageId",
        hop_count AS "hopCount", expires_at AS "expiresAt", body,
        artifact_refs_json AS "artifactRefsJson", delivery_state AS "deliveryState",
        delivery_attempt_id AS "deliveryAttemptId", created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projection_orchestrator_messages
      WHERE root_thread_id = ${rootThreadId}
      ORDER BY created_at, message_id
    `.pipe(
      Effect.map((rows) => rows.map(toMessage)),
      Effect.mapError(toPersistenceSqlError("ProjectionOrchestratorRepository.listMessages:query")),
    );

  const listMessagePage: ProjectionOrchestratorRepositoryShape["listMessagePage"] = (input) => {
    const limit = Math.max(1, Math.min(101, Math.floor(input.limit)));
    const cursorClause =
      input.beforeCreatedAt === undefined
        ? sql``
        : sql`AND (
            created_at > ${input.beforeCreatedAt}
            OR (
              created_at = ${input.beforeCreatedAt}
              AND message_id > ${input.afterMessageIdAtTimestamp ?? ""}
            )
          )`;
    return sql<MessageDbRow>`
      SELECT
        message_id AS "messageId", root_thread_id AS "rootThreadId",
        sender_thread_id AS "senderThreadId", target_thread_id AS "targetThreadId",
        assignment_id AS "assignmentId", run_id AS "runId",
        correlation_id AS "correlationId", reply_to_message_id AS "replyToMessageId",
        hop_count AS "hopCount", expires_at AS "expiresAt", body,
        artifact_refs_json AS "artifactRefsJson", delivery_state AS "deliveryState",
        delivery_attempt_id AS "deliveryAttemptId", created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projection_orchestrator_messages
      WHERE root_thread_id = ${input.rootThreadId}
        ${cursorClause}
      ORDER BY created_at, message_id
      LIMIT ${limit}
    `.pipe(
      Effect.map((rows) => rows.map(toMessage)),
      Effect.mapError(
        toPersistenceSqlError("ProjectionOrchestratorRepository.listMessagePage:query"),
      ),
    );
  };

  const listMailboxMessages: ProjectionOrchestratorRepositoryShape["listMailboxMessages"] = (
    input,
  ) => {
    const limit = Math.max(1, Math.min(4_096, Math.floor(input.limit)));
    return sql<MessageDbRow>`
        SELECT
          message_id AS "messageId", root_thread_id AS "rootThreadId",
          sender_thread_id AS "senderThreadId", target_thread_id AS "targetThreadId",
          assignment_id AS "assignmentId", run_id AS "runId",
          correlation_id AS "correlationId", reply_to_message_id AS "replyToMessageId",
          hop_count AS "hopCount", expires_at AS "expiresAt", body,
          artifact_refs_json AS "artifactRefsJson", delivery_state AS "deliveryState",
          delivery_attempt_id AS "deliveryAttemptId", created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_orchestrator_messages
        WHERE root_thread_id = ${input.rootThreadId}
          AND delivery_state IN ('queued', 'processing', 'delivered')
        ORDER BY created_at, message_id
        LIMIT ${limit}
    `.pipe(
      Effect.map((rows) => rows.map(toMessage)),
      Effect.mapError(
        toPersistenceSqlError("ProjectionOrchestratorRepository.listMailboxMessages:query"),
      ),
    );
  };

  const listMonitors: ProjectionOrchestratorRepositoryShape["listMonitors"] = (input) => {
    const limit = Math.max(1, Math.min(4_096, Math.floor(input.limit)));
    return sql<MonitorDbRow>`
      SELECT
        monitor_id AS "monitorId", root_thread_id AS "rootThreadId",
        target_thread_id AS "targetThreadId", kind, condition,
        cadence_ms AS "cadenceMs", next_wake_at AS "nextWakeAt",
        max_runs AS "maxRuns", run_count AS "runCount", expires_at AS "expiresAt",
        owner_thread_id AS "ownerThreadId", state
      FROM projection_orchestrator_monitors
      WHERE root_thread_id = ${input.rootThreadId}
        AND state <> 'cancelled'
      ORDER BY CASE WHEN state = 'active' THEN 0 ELSE 1 END, expires_at DESC, monitor_id
      LIMIT ${limit}
    `.pipe(
      Effect.map((rows) => rows.map(toMonitor)),
      Effect.mapError(toPersistenceSqlError("ProjectionOrchestratorRepository.listMonitors:query")),
    );
  };

  const listActiveWriterClaims: ProjectionOrchestratorRepositoryShape["listActiveWriterClaims"] = (
    input,
  ) => {
    const limit = Math.max(1, Math.min(4_096, Math.floor(input.limit)));
    return sql<WriterClaimDbRow>`
        SELECT
          claim_id AS "claimId", root_thread_id AS "rootThreadId",
          workspace_root AS "workspaceRoot",
          normalized_path_prefix AS "normalizedPathPrefix",
          assignment_id AS "assignmentId", thread_id AS "threadId", mode,
          acquired_at AS "acquiredAt", expires_at AS "expiresAt",
          released_at AS "releasedAt"
        FROM projection_orchestrator_writer_claims
        WHERE root_thread_id = ${input.rootThreadId}
          AND released_at IS NULL
          AND expires_at > ${input.at}
        ORDER BY acquired_at, claim_id
        LIMIT ${limit}
      `.pipe(
      Effect.map((rows) => rows.map(toWriterClaim)),
      Effect.mapError(
        toPersistenceSqlError("ProjectionOrchestratorRepository.listActiveWriterClaims:query"),
      ),
    );
  };

  const getCore: ProjectionOrchestratorRepositoryShape["getCore"] = (rootThreadId) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const root = yield* getRoot(rootThreadId);
          if (Option.isNone(root)) return Option.none();
          const ownershipRows = yield* sql<OwnershipDbRow>`
          SELECT
            root_thread_id AS "rootThreadId", parent_thread_id AS "parentThreadId",
            child_thread_id AS "childThreadId", role, capabilities_json AS "capabilitiesJson",
            contract_version AS "contractVersion", source_thread_id AS "sourceThreadId",
            source_turn_id AS "sourceTurnId", source_operation_id AS "sourceOperationId",
            active_from AS "activeFrom", retired_at AS "retiredAt",
            decision_reason_json AS "decisionReasonJson"
          FROM projection_orchestrator_ownership_edges
          WHERE root_thread_id = ${rootThreadId}
          ORDER BY active_from, child_thread_id, contract_version
          LIMIT 512
        `;
          const linkRows = yield* sql<LinkDbRow>`
          SELECT
            link_id AS "linkId", root_thread_id AS "rootThreadId",
            source_thread_id AS "sourceThreadId", target_thread_id AS "targetThreadId",
            direction, task_id AS "taskId", run_id AS "runId",
            capabilities_json AS "capabilitiesJson", requested_by_json AS "requestedByJson",
            granted_by_json AS "grantedByJson", reason, state,
            created_at AS "createdAt", expires_at AS "expiresAt", updated_at AS "updatedAt"
          FROM projection_orchestrator_links
          WHERE root_thread_id = ${rootThreadId}
          ORDER BY created_at, link_id
          LIMIT 512
        `;
          const assignmentRows = yield* sql<{ readonly contractJson: string }>`
          SELECT assignment.contract_json AS "contractJson"
          FROM projection_orchestrator_assignments AS assignment
          JOIN (
            SELECT assignment_id, MAX(contract_version) AS contract_version
            FROM projection_orchestrator_assignments
            WHERE root_thread_id = ${rootThreadId}
            GROUP BY assignment_id
          ) AS latest
            ON latest.assignment_id = assignment.assignment_id
           AND latest.contract_version = assignment.contract_version
          WHERE assignment.root_thread_id = ${rootThreadId}
          ORDER BY assignment.updated_at, assignment.assignment_id
          LIMIT 512
        `;
          const runRows = yield* sql<RunDbRow>`
          SELECT
            run_id AS "runId", root_thread_id AS "rootThreadId", mode, state,
            disposition, brief_hash AS "briefHash", participants_json AS "participantsJson",
            decision_packet_artifact_id AS "decisionPacketArtifactId",
            created_at AS "createdAt", updated_at AS "updatedAt"
          FROM projection_orchestrator_runs
          WHERE root_thread_id = ${rootThreadId}
          ORDER BY created_at, run_id
          LIMIT 256
        `;
          const capabilityRows = yield* sql<{ readonly capabilityJson: string }>`
          SELECT capability_json AS "capabilityJson"
          FROM projection_orchestrator_provider_capabilities
          ORDER BY provider, model
          LIMIT 256
        `;
          const capacityRows = yield* sql<{ readonly capacityJson: string }>`
          SELECT capacity_json AS "capacityJson"
          FROM projection_orchestrator_capacity
          WHERE root_thread_id = ${rootThreadId}
        `;
          const result: ProjectionOrchestratorCore = {
            root: root.value,
            ownershipEdges: ownershipRows.map(toOwnership),
            communicationLinks: linkRows.map(toLink),
            assignments: assignmentRows.map((row) =>
              decode(AssignmentContract, json(row.contractJson)),
            ),
            runs: runRows.map(toRun),
            providerCapabilities: capabilityRows.map((row) =>
              decode(OrchestratorProviderCapability, json(row.capabilityJson)),
            ),
            capacity: capacityRows[0]
              ? decode(OrchestratorCapacitySnapshot, json(capacityRows[0].capacityJson))
              : null,
          };
          return Option.some(result);
        }),
      )
      .pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionOrchestratorRepository.getCore:query")),
      );

  return {
    upsertRoot,
    getRoot,
    listRoots,
    listRootPage,
    findRootForThread,
    upsertOwnershipEdge,
    retireActiveOwnershipForChild,
    upsertCommunicationLink,
    upsertAssignmentVersion,
    upsertRun,
    upsertMessage,
    upsertMonitor,
    upsertWriterClaim,
    upsertProviderCapability,
    upsertCapacity,
    getCore,
    listMessages,
    listMessagePage,
    listMailboxMessages,
    listMonitors,
    listActiveWriterClaims,
  } satisfies ProjectionOrchestratorRepositoryShape;
});

export const ProjectionOrchestratorRepositoryLive = Layer.effect(
  ProjectionOrchestratorRepository,
  makeProjectionOrchestratorRepository,
);
