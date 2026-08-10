import {
  AgentSeat,
  DirectIntervention,
  EffectiveAuthorityReceipt,
  GovernedProviderSession,
  GovernanceHandoff,
  HumanDirective,
  LeadReplacement,
  ModelCapabilityProfile,
  ModelSelectionReceipt,
  ModelTelemetryAggregate,
  RootAuthorityLease,
  RoleAssumption,
  StandingMandate,
  SupervisedOrchestrationSnapshot,
  SupervisedWorkspace,
  SupervisorNotebookEntry,
  SupervisorNotebookCompactionReceipt,
  SupervisorNotebookCursor,
  UserModelPreferenceProfile,
} from "@synara/contracts";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  isPersistenceError,
  toPersistenceDecodeCauseError,
  toPersistenceSqlError,
} from "../Errors.ts";
import {
  SupervisedGovernanceRepository,
  type SupervisedGovernanceRepositoryShape,
} from "../Services/SupervisedGovernanceRepository.ts";
import { DEFAULT_SUPERVISED_PROFILES } from "../../orchestration/supervised/profileSeeds.ts";

type EntityRow = { readonly entityJson: string };
type StateRow = {
  readonly revision: number;
  readonly orchestrationJson: string;
  readonly updatedAt: string;
};
type RevisionRow = { readonly revision: number };

const decodeRows = <A>(
  schema: Schema.Schema<A>,
  operation: string,
  rows: ReadonlyArray<EntityRow>,
) =>
  Effect.forEach(
    rows,
    (row) =>
      Effect.try({
        try: () =>
          Schema.decodeUnknownSync(schema as Schema.Decoder<A>)(JSON.parse(row.entityJson)),
        catch: toPersistenceDecodeCauseError(operation),
      }),
    { concurrency: 1 },
  );

const persistenceError = (operation: string) => (error: unknown) =>
  isPersistenceError(error) ? error : toPersistenceSqlError(operation)(error);

const decodeOrchestration = (value: string) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(SupervisedOrchestrationSnapshot)(JSON.parse(value)),
    catch: toPersistenceDecodeCauseError("SupervisedGovernance.getSnapshot.orchestration"),
  }).pipe(
    Effect.map((snapshot) => {
      const existing = new Set(snapshot.profiles.map((profile) => profile.id));
      return {
        ...snapshot,
        profiles: [
          ...snapshot.profiles,
          ...DEFAULT_SUPERVISED_PROFILES.filter((profile) => !existing.has(profile.id)),
        ],
      };
    }),
  );

const orderNotebookEntriesForInsert = (
  entries: ReadonlyArray<SupervisorNotebookEntry>,
): ReadonlyArray<SupervisorNotebookEntry> => {
  const remaining = entries.toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
  const ordered: SupervisorNotebookEntry[] = [];
  const inserted = new Set<string>();
  while (remaining.length > 0) {
    const nextIndex = remaining.findIndex(
      (entry) => entry.supersedesEntryId === null || inserted.has(entry.supersedesEntryId),
    );
    if (nextIndex < 0) return [...ordered, ...remaining];
    const [entry] = remaining.splice(nextIndex, 1);
    ordered.push(entry!);
    inserted.add(entry!.id);
  }
  return ordered;
};

const makeSupervisedGovernanceRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const advanceRevision = (expectedRevision: number, updatedAt: string) =>
    Effect.gen(function* () {
      yield* sql`
        UPDATE supervised_governance_state
        SET revision = revision + 1, updated_at = ${updatedAt}
        WHERE singleton_id = 1 AND revision = ${expectedRevision}
      `;
      const changedRows = yield* sql<{ readonly changed: number }>`SELECT changes() AS changed`;
      if ((changedRows[0]?.changed ?? 0) !== 1) {
        return yield* Effect.fail(
          new Error(`Governance snapshot revision conflict: expected ${expectedRevision}.`),
        );
      }
    });

  const getSnapshot: SupervisedGovernanceRepositoryShape["getSnapshot"] = () =>
    Effect.gen(function* () {
      const stateRows = yield* sql<StateRow>`
        SELECT revision, orchestration_json AS "orchestrationJson", updated_at AS "updatedAt"
        FROM supervised_governance_state
        WHERE singleton_id = 1
      `;
      const orchestration = yield* decodeOrchestration(
        stateRows[0]?.orchestrationJson ??
          '{"revision":0,"profiles":[],"profileSnapshots":[],"missions":[],"workflowDirectives":[],"workflowConflicts":[],"advice":[],"observationCursors":[],"wakeQueue":[],"rotations":[],"updatedAt":"1970-01-01T00:00:00.000Z"}',
      );
      const workspaceRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_workspaces
        ORDER BY updated_at DESC, workspace_id
      `;
      const seatRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_agent_seats
        ORDER BY updated_at DESC, seat_id
      `;
      const providerSessionRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_provider_sessions
        ORDER BY updated_at DESC, provider_session_id
      `;
      const authorityReceiptRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_authority_receipts
        ORDER BY issued_at DESC, receipt_id
      `;
      const rootLeaseRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_root_authority_leases
        ORDER BY updated_at DESC, lease_id
      `;
      const handoffRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_handoffs
        ORDER BY updated_at DESC, handoff_id
      `;
      const roleAssumptionRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_role_assumptions
        ORDER BY updated_at DESC, role_assumption_id
      `;
      const leadReplacementRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_lead_replacements
        ORDER BY updated_at DESC, replacement_id
      `;
      const humanDirectiveRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_human_directives
        ORDER BY updated_at DESC, directive_id
      `;
      const standingMandateRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_standing_mandates
        ORDER BY updated_at DESC, mandate_id
      `;
      const interventionRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_direct_interventions
        ORDER BY updated_at DESC, intervention_id
      `;
      const notebookRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_notebook_entries
        ORDER BY created_at DESC, entry_id
      `;
      const notebookCursorRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_notebook_cursors
        ORDER BY updated_at DESC, cursor_id
      `;
      const notebookCompactionRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_notebook_compactions
        ORDER BY created_at DESC, receipt_id
      `;
      const capabilityProfileRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM supervised_model_capability_profiles
        ORDER BY updated_at DESC, profile_id
      `;
      const preferenceProfileRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM supervised_user_model_preference_profiles
        ORDER BY updated_at DESC, preference_profile_id
      `;
      const telemetryRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM supervised_model_telemetry_aggregates
        ORDER BY updated_at DESC, aggregate_id
      `;
      const modelSelectionRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM supervised_model_selection_receipts
        ORDER BY created_at DESC, receipt_id
      `;
      const agentSeats = yield* decodeRows(
        AgentSeat,
        "SupervisedGovernance.getSnapshot.agentSeats",
        seatRows,
      );

      return {
        revision: stateRows[0]?.revision ?? 0,
        workspaces: yield* decodeRows(
          SupervisedWorkspace,
          "SupervisedGovernance.getSnapshot.workspaces",
          workspaceRows,
        ),
        agentSeats,
        providerSessions: yield* decodeRows(
          GovernedProviderSession,
          "SupervisedGovernance.getSnapshot.providerSessions",
          providerSessionRows,
        ),
        authorityReceipts: yield* decodeRows(
          EffectiveAuthorityReceipt,
          "SupervisedGovernance.getSnapshot.authorityReceipts",
          authorityReceiptRows,
        ),
        rootLeases: yield* decodeRows(
          RootAuthorityLease,
          "SupervisedGovernance.getSnapshot.rootLeases",
          rootLeaseRows,
        ),
        handoffs: yield* decodeRows(
          GovernanceHandoff,
          "SupervisedGovernance.getSnapshot.handoffs",
          handoffRows,
        ),
        roleAssumptions: yield* decodeRows(
          RoleAssumption,
          "SupervisedGovernance.getSnapshot.roleAssumptions",
          roleAssumptionRows,
        ),
        leadReplacements: yield* decodeRows(
          LeadReplacement,
          "SupervisedGovernance.getSnapshot.leadReplacements",
          leadReplacementRows,
        ),
        humanDirectives: yield* decodeRows(
          HumanDirective,
          "SupervisedGovernance.getSnapshot.humanDirectives",
          humanDirectiveRows,
        ),
        standingMandates: yield* decodeRows(
          StandingMandate,
          "SupervisedGovernance.getSnapshot.standingMandates",
          standingMandateRows,
        ),
        directInterventions: yield* decodeRows(
          DirectIntervention,
          "SupervisedGovernance.getSnapshot.directInterventions",
          interventionRows,
        ),
        notebookEntries: yield* decodeRows(
          SupervisorNotebookEntry,
          "SupervisedGovernance.getSnapshot.notebookEntries",
          notebookRows,
        ),
        notebookCursors: yield* decodeRows(
          SupervisorNotebookCursor,
          "SupervisedGovernance.getSnapshot.notebookCursors",
          notebookCursorRows,
        ),
        notebookCompactionReceipts: yield* decodeRows(
          SupervisorNotebookCompactionReceipt,
          "SupervisedGovernance.getSnapshot.notebookCompactionReceipts",
          notebookCompactionRows,
        ),
        modelCapabilityProfiles: yield* decodeRows(
          ModelCapabilityProfile,
          "SupervisedGovernance.getSnapshot.modelCapabilityProfiles",
          capabilityProfileRows,
        ),
        userModelPreferenceProfiles: yield* decodeRows(
          UserModelPreferenceProfile,
          "SupervisedGovernance.getSnapshot.userModelPreferenceProfiles",
          preferenceProfileRows,
        ),
        modelTelemetryAggregates: yield* decodeRows(
          ModelTelemetryAggregate,
          "SupervisedGovernance.getSnapshot.modelTelemetryAggregates",
          telemetryRows,
        ),
        modelSelectionReceipts: yield* decodeRows(
          ModelSelectionReceipt,
          "SupervisedGovernance.getSnapshot.modelSelectionReceipts",
          modelSelectionRows,
        ),
        orchestration: { ...orchestration, agentSeats },
        updatedAt: stateRows[0]?.updatedAt ?? "1970-01-01T00:00:00.000Z",
      };
    }).pipe(Effect.mapError(persistenceError("SupervisedGovernance.getSnapshot")));

  const getModelRoutingState: SupervisedGovernanceRepositoryShape["getModelRoutingState"] = () =>
    Effect.gen(function* () {
      const stateRows = yield* sql<RevisionRow>`
        SELECT revision
        FROM supervised_governance_state
        WHERE singleton_id = 1
      `;
      const capabilityProfileRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM supervised_model_capability_profiles
        ORDER BY updated_at DESC, profile_id
      `;
      const preferenceProfileRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM supervised_user_model_preference_profiles
        ORDER BY updated_at DESC, preference_profile_id
      `;
      const telemetryRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM supervised_model_telemetry_aggregates
        ORDER BY updated_at DESC, aggregate_id
      `;
      return {
        revision: stateRows[0]?.revision ?? 0,
        modelCapabilityProfiles: yield* decodeRows(
          ModelCapabilityProfile,
          "SupervisedGovernance.getModelRoutingState.modelCapabilityProfiles",
          capabilityProfileRows,
        ),
        userModelPreferenceProfiles: yield* decodeRows(
          UserModelPreferenceProfile,
          "SupervisedGovernance.getModelRoutingState.userModelPreferenceProfiles",
          preferenceProfileRows,
        ),
        modelTelemetryAggregates: yield* decodeRows(
          ModelTelemetryAggregate,
          "SupervisedGovernance.getModelRoutingState.modelTelemetryAggregates",
          telemetryRows,
        ),
      };
    }).pipe(Effect.mapError(persistenceError("SupervisedGovernance.getModelRoutingState")));

  const getNotebookState: SupervisedGovernanceRepositoryShape["getNotebookState"] = (input) =>
    Effect.gen(function* () {
      const limit = Math.max(1, Math.min(input.limit, 512));
      const entryIds = input.entryIds ? [...new Set(input.entryIds)] : null;
      const roomIds = input.roomIds ? [...new Set(input.roomIds)] : null;
      const taskNodeIds = input.taskNodeIds ? [...new Set(input.taskNodeIds)] : null;
      const protectionClasses = input.allowedProtectionClasses
        ? [...new Set(input.allowedProtectionClasses)]
        : null;
      const entryIdFilter =
        entryIds === null
          ? sql``
          : entryIds.length === 0
            ? sql`AND 1 = 0`
            : sql`AND entry_id IN ${sql.in(entryIds)}`;
      const roomFilter =
        roomIds === null
          ? sql``
          : roomIds.length === 0
            ? input.includeWorkspaceEntries === false
              ? sql`AND 1 = 0`
              : sql`AND room_id IS NULL`
            : input.includeWorkspaceEntries === false
              ? sql`AND room_id IN ${sql.in(roomIds)}`
              : sql`AND (room_id IS NULL OR room_id IN ${sql.in(roomIds)})`;
      const taskNodeFilter =
        taskNodeIds === null
          ? sql``
          : taskNodeIds.length === 0
            ? input.includeUnscopedTaskNodes === false
              ? sql`AND 1 = 0`
              : sql`AND task_node_id IS NULL`
            : input.includeUnscopedTaskNodes === false
              ? sql`AND task_node_id IN ${sql.in(taskNodeIds)}`
              : sql`AND (task_node_id IS NULL OR task_node_id IN ${sql.in(taskNodeIds)})`;
      const concernFilter =
        input.concern === undefined ? sql`` : sql`AND concern = ${input.concern}`;
      const queryFilter =
        input.query === undefined
          ? sql``
          : sql`AND instr(
              lower(concern || char(10) || coalesce(json_extract(entity_json, '$.content'), '')),
              lower(${input.query})
            ) > 0`;
      const protectionFilter =
        protectionClasses === null
          ? sql``
          : protectionClasses.length === 0
            ? sql`AND 1 = 0`
            : sql`AND json_extract(entity_json, '$.protectionClass') IN ${sql.in(protectionClasses)}`;
      const redactionFilter =
        input.includeRedacted === false
          ? sql`AND json_extract(entity_json, '$.redactedAt') IS NULL`
          : sql``;
      const entryRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_notebook_entries
        WHERE workspace_id = ${input.workspaceId}
        ${entryIdFilter}
        ${roomFilter}
        ${taskNodeFilter}
        ${concernFilter}
        ${queryFilter}
        ${protectionFilter}
        ${redactionFilter}
        ORDER BY created_at DESC, entry_id DESC
        LIMIT ${limit}
      `;
      const compactionRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_notebook_compactions
        WHERE workspace_id = ${input.workspaceId}
          AND summary_entry_id IN (
            SELECT entry_id
            FROM projection_supervised_notebook_entries
            WHERE workspace_id = ${input.workspaceId}
            ${entryIdFilter}
            ${roomFilter}
            ${taskNodeFilter}
            ${concernFilter}
            ${queryFilter}
            ${protectionFilter}
            ${redactionFilter}
          )
        ORDER BY created_at DESC, receipt_id DESC
        LIMIT ${limit}
      `;
      const cursorRows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM projection_supervised_notebook_cursors
        WHERE workspace_id = ${input.workspaceId} AND seat_id = ${input.seatId}
        LIMIT 1
      `;
      const cursors = yield* decodeRows(
        SupervisorNotebookCursor,
        "SupervisedGovernance.getNotebookState.cursor",
        cursorRows,
      );
      return {
        entries: yield* decodeRows(
          SupervisorNotebookEntry,
          "SupervisedGovernance.getNotebookState.entries",
          entryRows,
        ),
        compactionReceipts: yield* decodeRows(
          SupervisorNotebookCompactionReceipt,
          "SupervisedGovernance.getNotebookState.compactions",
          compactionRows,
        ),
        cursor: cursors[0] ?? null,
      };
    }).pipe(Effect.mapError(persistenceError("SupervisedGovernance.getNotebookState")));

  const appendNotebookEntry: SupervisedGovernanceRepositoryShape["appendNotebookEntry"] = (entry) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          if (entry.supersedesEntryId === entry.id) {
            return yield* Effect.fail(new Error("Notebook entry cannot supersede itself."));
          }
          if (entry.supersedesEntryId !== null) {
            const supersededRows = yield* sql<{ readonly count: number }>`
                SELECT COUNT(*) AS count
                FROM projection_supervised_notebook_entries
                WHERE entry_id = ${entry.supersedesEntryId}
                  AND workspace_id = ${entry.workspaceId}
              `;
            if ((supersededRows[0]?.count ?? 0) === 0) {
              return yield* Effect.fail(
                new Error("Superseded notebook entry is unavailable in this workspace."),
              );
            }
          }
          yield* sql`
              INSERT OR IGNORE INTO projection_supervised_notebook_entries (
                entry_id, workspace_id, room_id, task_node_id, concern, kind,
                author_seat_id, supersedes_entry_id, created_at, entity_json
              ) VALUES (
                ${entry.id}, ${entry.workspaceId}, ${entry.roomId}, ${entry.taskNodeId},
                ${entry.concern}, ${entry.kind}, ${entry.authorSeatId}, ${entry.supersedesEntryId},
                ${entry.createdAt}, ${JSON.stringify(entry)}
              )
            `;
          const changedRows = yield* sql<{ readonly changed: number }>`SELECT changes() AS changed`;
          if ((changedRows[0]?.changed ?? 0) === 0) return false;
          yield* sql`
              UPDATE supervised_governance_state
              SET revision = revision + 1, updated_at = ${entry.createdAt}
              WHERE singleton_id = 1
            `;
          return true;
        }),
      )
      .pipe(Effect.mapError(persistenceError("SupervisedGovernance.appendNotebookEntry")));

  const appendNotebookCompaction: SupervisedGovernanceRepositoryShape["appendNotebookCompaction"] =
    (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const entry = input.summaryEntry;
            const receipt = input.receipt;
            if (
              receipt.workspaceId !== entry.workspaceId ||
              receipt.summaryEntryId !== entry.id ||
              receipt.createdBySeatId !== entry.authorSeatId
            ) {
              return yield* Effect.fail(
                new Error("Notebook compaction receipt does not match its summary entry."),
              );
            }
            const existingRows = yield* sql<{ readonly count: number }>`
              SELECT COUNT(*) AS count
              FROM projection_supervised_notebook_compactions
              WHERE receipt_id = ${receipt.id}
            `;
            if ((existingRows[0]?.count ?? 0) > 0) return false;

            const sourceIds = new Set(receipt.sourceEntryIds);
            const sourceRows = yield* sql<EntityRow>`
              SELECT entity_json AS "entityJson"
              FROM projection_supervised_notebook_entries
              WHERE workspace_id = ${entry.workspaceId}
                AND entry_id IN ${sql.in([...sourceIds])}
            `;
            const sources = yield* decodeRows(
              SupervisorNotebookEntry,
              "SupervisedGovernance.appendNotebookCompaction.sources",
              sourceRows,
            );
            const expectedEvidenceRefs = [
              ...new Set(sources.flatMap((source) => source.evidenceRefs)),
            ].toSorted();
            const summaryEvidenceRefs = [...new Set(entry.evidenceRefs)].toSorted();
            const receiptEvidenceRefs = [...new Set(receipt.evidenceRefs)].toSorted();
            const scopeSource = sources[0];
            if (
              sourceIds.size !== receipt.sourceEntryIds.length ||
              sourceIds.has(entry.id) ||
              sources.length !== sourceIds.size ||
              !scopeSource ||
              sources.some(
                (source) =>
                  source.workspaceId !== entry.workspaceId ||
                  source.roomId !== entry.roomId ||
                  source.taskNodeId !== entry.taskNodeId ||
                  source.protectionClass !== entry.protectionClass ||
                  source.redactedAt !== null,
              ) ||
              entry.kind !== "lesson" ||
              entry.redactedAt !== null ||
              entry.supersedesEntryId !== null ||
              entry.evidenceRefs.length !== summaryEvidenceRefs.length ||
              receipt.evidenceRefs.length !== receiptEvidenceRefs.length ||
              JSON.stringify(expectedEvidenceRefs) !== JSON.stringify(summaryEvidenceRefs) ||
              JSON.stringify(expectedEvidenceRefs) !== JSON.stringify(receiptEvidenceRefs)
            ) {
              return yield* Effect.fail(
                new Error("Notebook compaction sources or evidence lineage are invalid."),
              );
            }

            const encodedEntry = JSON.stringify(entry);
            const existingEntryRows = yield* sql<EntityRow>`
              SELECT entity_json AS "entityJson"
              FROM projection_supervised_notebook_entries
              WHERE entry_id = ${entry.id}
              LIMIT 1
            `;
            if (existingEntryRows[0] && existingEntryRows[0].entityJson !== encodedEntry) {
              return yield* Effect.fail(
                new Error("Notebook compaction summary identity conflicts with an existing entry."),
              );
            }
            if (!existingEntryRows[0]) {
              yield* sql`
                INSERT INTO projection_supervised_notebook_entries (
                  entry_id, workspace_id, room_id, task_node_id, concern, kind,
                  author_seat_id, supersedes_entry_id, created_at, entity_json
                ) VALUES (
                  ${entry.id}, ${entry.workspaceId}, ${entry.roomId}, ${entry.taskNodeId},
                  ${entry.concern}, ${entry.kind}, ${entry.authorSeatId}, ${entry.supersedesEntryId},
                  ${entry.createdAt}, ${encodedEntry}
                )
              `;
            }
            yield* sql`
              INSERT INTO projection_supervised_notebook_compactions (
                receipt_id, workspace_id, summary_entry_id, created_by_seat_id,
                created_at, entity_json
              ) VALUES (
                ${receipt.id}, ${receipt.workspaceId}, ${receipt.summaryEntryId},
                ${receipt.createdBySeatId}, ${receipt.createdAt}, ${JSON.stringify(receipt)}
              )
            `;
            yield* sql`
              UPDATE supervised_governance_state
              SET revision = revision + 1, updated_at = ${receipt.createdAt}
              WHERE singleton_id = 1
            `;
            return true;
          }),
        )
        .pipe(Effect.mapError(persistenceError("SupervisedGovernance.appendNotebookCompaction")));

  const putNotebookCursor: SupervisedGovernanceRepositoryShape["putNotebookCursor"] = (cursor) =>
    sql`
      INSERT INTO projection_supervised_notebook_cursors (
        cursor_id, workspace_id, seat_id, last_created_at, last_entry_id, updated_at, entity_json
      ) VALUES (
        ${cursor.id}, ${cursor.workspaceId}, ${cursor.seatId}, ${cursor.lastCreatedAt},
        ${cursor.lastEntryId}, ${cursor.updatedAt}, ${JSON.stringify(cursor)}
      )
      ON CONFLICT (workspace_id, seat_id) DO UPDATE SET
        cursor_id = excluded.cursor_id,
        last_created_at = excluded.last_created_at,
        last_entry_id = excluded.last_entry_id,
        updated_at = excluded.updated_at,
        entity_json = excluded.entity_json
      WHERE
        projection_supervised_notebook_cursors.last_created_at IS NULL OR
        excluded.last_created_at > projection_supervised_notebook_cursors.last_created_at OR
        (
          excluded.last_created_at = projection_supervised_notebook_cursors.last_created_at AND
          excluded.last_entry_id > projection_supervised_notebook_cursors.last_entry_id
        )
    `.pipe(
      Effect.asVoid,
      Effect.mapError(persistenceError("SupervisedGovernance.putNotebookCursor")),
    );

  const replaceSnapshot: SupervisedGovernanceRepositoryShape["replaceSnapshot"] = (snapshot) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* advanceRevision(snapshot.revision, snapshot.updatedAt);
          yield* sql`
          UPDATE supervised_governance_state
          SET orchestration_json = ${JSON.stringify({
            ...snapshot.orchestration,
            agentSeats: [],
          })}
          WHERE singleton_id = 1
        `;
          yield* sql`DELETE FROM supervised_model_selection_receipts`;
          yield* sql`DELETE FROM supervised_model_telemetry_aggregates`;
          yield* sql`DELETE FROM supervised_user_model_preference_profiles`;
          yield* sql`DELETE FROM supervised_model_capability_profiles`;
          yield* sql`DELETE FROM projection_supervised_notebook_compactions`;
          yield* sql`DELETE FROM projection_supervised_notebook_cursors`;
          yield* sql`DELETE FROM projection_supervised_notebook_entries`;
          yield* sql`DELETE FROM projection_supervised_direct_interventions`;
          yield* sql`DELETE FROM projection_supervised_lead_replacements`;
          yield* sql`DELETE FROM projection_supervised_role_assumptions`;
          yield* sql`DELETE FROM projection_supervised_handoffs`;
          yield* sql`DELETE FROM projection_supervised_provider_sessions`;
          yield* sql`DELETE FROM projection_supervised_standing_mandates`;
          yield* sql`DELETE FROM projection_supervised_human_directives`;
          yield* sql`DELETE FROM projection_supervised_root_authority_leases`;
          yield* sql`DELETE FROM projection_supervised_agent_seats`;
          yield* sql`DELETE FROM projection_supervised_authority_receipts`;
          yield* sql`DELETE FROM projection_supervised_workspaces`;

          yield* Effect.forEach(
            snapshot.workspaces,
            (workspace) => sql`
            INSERT INTO projection_supervised_workspaces (
              workspace_id, owner_namespace, lifecycle_state, revision, updated_at, entity_json
            ) VALUES (
              ${workspace.id}, ${workspace.ownerNamespace}, ${workspace.lifecycleState},
              ${workspace.revision}, ${workspace.updatedAt}, ${JSON.stringify(workspace)}
            )
          `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.authorityReceipts,
            (receipt) => sql`
            INSERT INTO projection_supervised_authority_receipts (
              receipt_id, actor_seat_id, identity_role, effective_role,
              issued_at, expires_at, revoked_at, entity_json
            ) VALUES (
              ${receipt.id}, ${receipt.actorSeatId}, ${receipt.identityRole}, ${receipt.effectiveRole},
              ${receipt.issuedAt}, ${receipt.expiresAt}, ${receipt.revokedAt}, ${JSON.stringify(receipt)}
            )
          `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.agentSeats,
            (seat) => sql`
            INSERT INTO projection_supervised_agent_seats (
              seat_id, workspace_id, identity_role, effective_role, profile_id,
              lifecycle_state, work_state, authority_receipt_id, revision, updated_at, entity_json
            ) VALUES (
              ${seat.id}, ${seat.workspaceId}, ${seat.identityRole}, ${seat.effectiveRole},
              ${seat.profileId}, ${seat.lifecycleState}, ${seat.workState}, ${seat.authorityReceiptId},
              ${seat.revision}, ${seat.updatedAt}, ${JSON.stringify(seat)}
            )
          `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.providerSessions,
            (session) => sql`
            INSERT INTO projection_supervised_provider_sessions (
              provider_session_id, workspace_id, seat_id, lifecycle_state,
              revision, updated_at, entity_json
            ) VALUES (
              ${session.id}, ${session.workspaceId}, ${session.seatId}, ${session.lifecycleState},
              ${session.revision}, ${session.updatedAt}, ${JSON.stringify(session)}
            )
          `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.rootLeases,
            (lease) => sql`
            INSERT INTO projection_supervised_root_authority_leases (
              lease_id, workspace_id, room_id, holder_seat_id, status,
              authority_receipt_id, revision, updated_at, entity_json
            ) VALUES (
              ${lease.id}, ${lease.workspaceId}, ${lease.roomId}, ${lease.holderSeatId}, ${lease.status},
              ${lease.acquiredUnderReceiptId}, ${lease.revision}, ${lease.updatedAt}, ${JSON.stringify(lease)}
            )
          `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.handoffs,
            (handoff) => sql`
            INSERT INTO projection_supervised_handoffs (
              handoff_id, workspace_id, room_id, from_seat_id, to_seat_id,
              lifecycle_state, revision, updated_at, entity_json
            ) VALUES (
              ${handoff.id}, ${handoff.workspaceId}, ${handoff.roomId}, ${handoff.fromSeatId},
              ${handoff.toSeatId}, ${handoff.lifecycleState}, ${handoff.revision},
              ${handoff.updatedAt}, ${JSON.stringify(handoff)}
            )
          `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.roleAssumptions,
            (assumption) => sql`
            INSERT INTO projection_supervised_role_assumptions (
              role_assumption_id, workspace_id, room_id, actor_seat_id,
              lifecycle_state, revision, updated_at, entity_json
            ) VALUES (
              ${assumption.id}, ${assumption.workspaceId}, ${assumption.roomId},
              ${assumption.actorSeatId}, ${assumption.lifecycleState}, ${assumption.revision},
              ${assumption.updatedAt}, ${JSON.stringify(assumption)}
            )
          `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.leadReplacements,
            (replacement) => sql`
            INSERT INTO projection_supervised_lead_replacements (
              replacement_id, workspace_id, room_id, previous_lead_seat_id,
              replacement_lead_seat_id, lifecycle_state, revision, updated_at, entity_json
            ) VALUES (
              ${replacement.id}, ${replacement.workspaceId}, ${replacement.roomId},
              ${replacement.previousLeadSeatId}, ${replacement.replacementLeadSeatId},
              ${replacement.lifecycleState}, ${replacement.revision}, ${replacement.updatedAt},
              ${JSON.stringify(replacement)}
            )
          `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.humanDirectives,
            (directive) => sql`
            INSERT INTO projection_supervised_human_directives (
              directive_id, workspace_id, room_id, status, revision, updated_at, entity_json
            ) VALUES (
              ${directive.id}, ${directive.workspaceId}, ${directive.roomId}, ${directive.status},
              ${directive.revision}, ${directive.updatedAt}, ${JSON.stringify(directive)}
            )
          `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.standingMandates,
            (mandate) => sql`
            INSERT INTO projection_supervised_standing_mandates (
              mandate_id, workspace_id, source_directive_id, subject_seat_id,
              status, revision, updated_at, entity_json
            ) VALUES (
              ${mandate.id}, ${mandate.workspaceId}, ${mandate.sourceDirectiveId}, ${mandate.subjectSeatId},
              ${mandate.status}, ${mandate.revision}, ${mandate.updatedAt}, ${JSON.stringify(mandate)}
            )
          `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.directInterventions,
            (intervention) => sql`
            INSERT INTO projection_supervised_direct_interventions (
              intervention_id, workspace_id, room_id, supervisor_seat_id,
              target_peer_seat_id, root_holder_seat_id, lifecycle_state,
              revision, updated_at, entity_json
            ) VALUES (
              ${intervention.id}, ${intervention.workspaceId}, ${intervention.roomId},
              ${intervention.supervisorSeatId}, ${intervention.targetPeerSeatId},
              ${intervention.rootHolderSeatId}, ${intervention.lifecycleState},
              ${intervention.revision}, ${intervention.updatedAt}, ${JSON.stringify(intervention)}
            )
          `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            orderNotebookEntriesForInsert(snapshot.notebookEntries),
            (entry) => sql`
            INSERT INTO projection_supervised_notebook_entries (
              entry_id, workspace_id, room_id, task_node_id, concern, kind,
              author_seat_id, supersedes_entry_id, created_at, entity_json
            ) VALUES (
              ${entry.id}, ${entry.workspaceId}, ${entry.roomId}, ${entry.taskNodeId},
              ${entry.concern}, ${entry.kind}, ${entry.authorSeatId}, ${entry.supersedesEntryId},
              ${entry.createdAt}, ${JSON.stringify(entry)}
            )
          `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.notebookCursors,
            (cursor) => sql`
            INSERT INTO projection_supervised_notebook_cursors (
              cursor_id, workspace_id, seat_id, last_created_at, last_entry_id, updated_at, entity_json
            ) VALUES (
              ${cursor.id}, ${cursor.workspaceId}, ${cursor.seatId}, ${cursor.lastCreatedAt},
              ${cursor.lastEntryId}, ${cursor.updatedAt}, ${JSON.stringify(cursor)}
            )
          `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.notebookCompactionReceipts,
            (receipt) => sql`
            INSERT INTO projection_supervised_notebook_compactions (
              receipt_id, workspace_id, summary_entry_id, created_by_seat_id,
              created_at, entity_json
            ) VALUES (
              ${receipt.id}, ${receipt.workspaceId}, ${receipt.summaryEntryId},
              ${receipt.createdBySeatId}, ${receipt.createdAt}, ${JSON.stringify(receipt)}
            )
          `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.modelCapabilityProfiles,
            (profile) => sql`
            INSERT INTO supervised_model_capability_profiles (
              profile_id, provider, model, version, available, revision, updated_at, entity_json
            ) VALUES (
              ${profile.id}, ${profile.provider}, ${profile.model}, ${profile.version},
              ${profile.available ? 1 : 0}, ${profile.revision}, ${profile.updatedAt}, ${JSON.stringify(profile)}
            )
          `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.userModelPreferenceProfiles,
            (profile) => sql`
            INSERT INTO supervised_user_model_preference_profiles (
              preference_profile_id, user_id, revision, updated_at, entity_json
            ) VALUES (
              ${profile.id}, ${profile.userId}, ${profile.revision},
              ${profile.updatedAt}, ${JSON.stringify(profile)}
            )
          `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.modelTelemetryAggregates,
            (aggregate) => sql`
            INSERT INTO supervised_model_telemetry_aggregates (
              aggregate_id, model_profile_id, category, sample_count,
              confidence, revision, updated_at, entity_json
            ) VALUES (
              ${aggregate.id}, ${aggregate.modelProfileId}, ${aggregate.category},
              ${aggregate.sampleCount}, ${aggregate.confidence}, ${aggregate.revision},
              ${aggregate.updatedAt}, ${JSON.stringify(aggregate)}
            )
          `,
            { concurrency: 1, discard: true },
          );
          yield* Effect.forEach(
            snapshot.modelSelectionReceipts,
            (receipt) => sql`
            INSERT INTO supervised_model_selection_receipts (
              receipt_id, workspace_id, room_id, task_node_id, actor_seat_id,
              selected_model_id, created_at, entity_json
            ) VALUES (
              ${receipt.id}, ${receipt.workspaceId}, ${receipt.roomId}, ${receipt.taskNodeId},
              ${receipt.actorSeatId}, ${receipt.selectedModelId}, ${receipt.createdAt},
              ${JSON.stringify(receipt)}
            )
          `,
            { concurrency: 1, discard: true },
          );
        }),
      )
      .pipe(Effect.mapError(persistenceError("SupervisedGovernance.replaceSnapshot")));

  const replaceOrchestration: SupervisedGovernanceRepositoryShape["replaceOrchestration"] = (
    input,
  ) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* advanceRevision(input.expectedRevision, input.updatedAt);
          yield* sql`
              UPDATE supervised_governance_state
              SET orchestration_json = ${JSON.stringify({
                ...input.orchestration,
                agentSeats: [],
              })}
              WHERE singleton_id = 1
            `;
        }),
      )
      .pipe(Effect.mapError(persistenceError("SupervisedGovernance.replaceOrchestration")));

  const putModelCapabilityProfile: SupervisedGovernanceRepositoryShape["putModelCapabilityProfile"] =
    (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            yield* advanceRevision(input.expectedRevision, input.profile.updatedAt);
            yield* sql`
              INSERT INTO supervised_model_capability_profiles (
                profile_id, provider, model, version, available, revision, updated_at, entity_json
              ) VALUES (
                ${input.profile.id}, ${input.profile.provider}, ${input.profile.model},
                ${input.profile.version}, ${input.profile.available ? 1 : 0},
                ${input.profile.revision}, ${input.profile.updatedAt}, ${JSON.stringify(input.profile)}
              )
              ON CONFLICT(profile_id) DO UPDATE SET
                provider = excluded.provider,
                model = excluded.model,
                version = excluded.version,
                available = excluded.available,
                revision = excluded.revision,
                updated_at = excluded.updated_at,
                entity_json = excluded.entity_json
            `;
          }),
        )
        .pipe(Effect.mapError(persistenceError("SupervisedGovernance.putModelCapabilityProfile")));

  const putUserModelPreferenceProfile: SupervisedGovernanceRepositoryShape["putUserModelPreferenceProfile"] =
    (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            yield* advanceRevision(input.expectedRevision, input.profile.updatedAt);
            yield* sql`
              INSERT INTO supervised_user_model_preference_profiles (
                preference_profile_id, user_id, revision, updated_at, entity_json
              ) VALUES (
                ${input.profile.id}, ${input.profile.userId}, ${input.profile.revision},
                ${input.profile.updatedAt}, ${JSON.stringify(input.profile)}
              )
              ON CONFLICT(preference_profile_id) DO UPDATE SET
                user_id = excluded.user_id,
                revision = excluded.revision,
                updated_at = excluded.updated_at,
                entity_json = excluded.entity_json
            `;
          }),
        )
        .pipe(
          Effect.mapError(persistenceError("SupervisedGovernance.putUserModelPreferenceProfile")),
        );

  const appendModelSelectionReceipt: SupervisedGovernanceRepositoryShape["appendModelSelectionReceipt"] =
    (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            yield* advanceRevision(input.expectedRevision, input.receipt.createdAt);
            yield* sql`
              INSERT INTO supervised_model_selection_receipts (
                receipt_id, workspace_id, room_id, task_node_id, actor_seat_id,
                selected_model_id, created_at, entity_json
              ) VALUES (
                ${input.receipt.id}, ${input.receipt.workspaceId}, ${input.receipt.roomId},
                ${input.receipt.taskNodeId}, ${input.receipt.actorSeatId},
                ${input.receipt.selectedModelId}, ${input.receipt.createdAt},
                ${JSON.stringify(input.receipt)}
              )
            `;
          }),
        )
        .pipe(
          Effect.mapError(persistenceError("SupervisedGovernance.appendModelSelectionReceipt")),
        );

  const putModelTelemetryAggregate: SupervisedGovernanceRepositoryShape["putModelTelemetryAggregate"] =
    (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            yield* advanceRevision(input.expectedRevision, input.aggregate.updatedAt);
            yield* sql`
              INSERT INTO supervised_model_telemetry_aggregates (
                aggregate_id, model_profile_id, category, sample_count,
                confidence, revision, updated_at, entity_json
              ) VALUES (
                ${input.aggregate.id}, ${input.aggregate.modelProfileId}, ${input.aggregate.category},
                ${input.aggregate.sampleCount}, ${input.aggregate.confidence},
                ${input.aggregate.revision}, ${input.aggregate.updatedAt},
                ${JSON.stringify(input.aggregate)}
              )
              ON CONFLICT(aggregate_id) DO UPDATE SET
                model_profile_id = excluded.model_profile_id,
                category = excluded.category,
                sample_count = excluded.sample_count,
                confidence = excluded.confidence,
                revision = excluded.revision,
                updated_at = excluded.updated_at,
                entity_json = excluded.entity_json
            `;
          }),
        )
        .pipe(Effect.mapError(persistenceError("SupervisedGovernance.putModelTelemetryAggregate")));

  return SupervisedGovernanceRepository.of({
    getSnapshot,
    getModelRoutingState,
    getNotebookState,
    replaceSnapshot,
    replaceOrchestration,
    appendNotebookEntry,
    appendNotebookCompaction,
    putNotebookCursor,
    putModelCapabilityProfile,
    putUserModelPreferenceProfile,
    appendModelSelectionReceipt,
    putModelTelemetryAggregate,
  });
});

export const SupervisedGovernanceRepositoryLive = Layer.effect(
  SupervisedGovernanceRepository,
  makeSupervisedGovernanceRepository,
);
