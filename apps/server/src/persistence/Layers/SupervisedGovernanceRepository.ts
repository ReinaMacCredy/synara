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
  SupervisedWorkspace,
  SupervisorNotebookEntry,
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

type EntityRow = { readonly entityJson: string };
type StateRow = { readonly revision: number; readonly updatedAt: string };

const decodeRows = <A, I>(
  schema: Schema.Schema<A, I>,
  operation: string,
  rows: ReadonlyArray<EntityRow>,
) =>
  Effect.forEach(
    rows,
    (row) =>
      Effect.try({
        try: () => Schema.decodeUnknownSync(schema)(JSON.parse(row.entityJson)),
        catch: toPersistenceDecodeCauseError(operation),
      }),
    { concurrency: 1 },
  );

const persistenceError = (operation: string) => (error: unknown) =>
  isPersistenceError(error) ? error : toPersistenceSqlError(operation)(error);

const orderNotebookEntriesForInsert = (
  entries: ReadonlyArray<SupervisorNotebookEntry>,
): ReadonlyArray<SupervisorNotebookEntry> => {
  const remaining = entries.toSorted(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
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

  const getSnapshot: SupervisedGovernanceRepositoryShape["getSnapshot"] = () =>
    Effect.gen(function* () {
      const stateRows = yield* sql<StateRow>`
        SELECT revision, updated_at AS "updatedAt"
        FROM supervised_governance_state
        WHERE singleton_id = 1
      `;
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

      return {
        revision: stateRows[0]?.revision ?? 0,
        workspaces: yield* decodeRows(
          SupervisedWorkspace,
          "SupervisedGovernance.getSnapshot.workspaces",
          workspaceRows,
        ),
        agentSeats: yield* decodeRows(
          AgentSeat,
          "SupervisedGovernance.getSnapshot.agentSeats",
          seatRows,
        ),
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
        updatedAt: stateRows[0]?.updatedAt ?? "1970-01-01T00:00:00.000Z",
      };
    }).pipe(Effect.mapError(persistenceError("SupervisedGovernance.getSnapshot")));

  const replaceSnapshot: SupervisedGovernanceRepositoryShape["replaceSnapshot"] = (snapshot) =>
    sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`
          UPDATE supervised_governance_state
          SET revision = revision + 1, updated_at = ${snapshot.updatedAt}
          WHERE singleton_id = 1 AND revision = ${snapshot.revision}
        `;
        const changedRows = yield* sql<{ readonly changed: number }>`SELECT changes() AS changed`;
        if ((changedRows[0]?.changed ?? 0) !== 1) {
          return yield* Effect.fail(
            new Error(`Governance snapshot revision conflict: expected ${snapshot.revision}.`),
          );
        }
        yield* sql`DELETE FROM supervised_model_selection_receipts`;
        yield* sql`DELETE FROM supervised_model_telemetry_aggregates`;
        yield* sql`DELETE FROM supervised_user_model_preference_profiles`;
        yield* sql`DELETE FROM supervised_model_capability_profiles`;
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
    ).pipe(Effect.mapError(persistenceError("SupervisedGovernance.replaceSnapshot")));

  return SupervisedGovernanceRepository.of({ getSnapshot, replaceSnapshot });
});

export const SupervisedGovernanceRepositoryLive = Layer.effect(
  SupervisedGovernanceRepository,
  makeSupervisedGovernanceRepository,
);
