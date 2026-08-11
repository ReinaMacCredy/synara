import { SupervisedToolPolicy, type SupervisedIntentToolId } from "@veylen/contracts";
import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  isPersistenceError,
  toPersistenceDecodeCauseError,
  toPersistenceSqlError,
} from "../Errors.ts";
import {
  SupervisedToolPolicyRepository,
  type SupervisedToolPolicyRepositoryShape,
} from "../Services/SupervisedToolPolicies.ts";

type PolicyRow = { readonly entityJson: string };

const decodePolicy = (entityJson: string, operation: string) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(SupervisedToolPolicy)(JSON.parse(entityJson)),
    catch: toPersistenceDecodeCauseError(operation),
  });

const makeSupervisedToolPolicyRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const list: SupervisedToolPolicyRepositoryShape["list"] = () =>
    Effect.gen(function* () {
      const rows = yield* sql<PolicyRow>`
        SELECT entity_json AS "entityJson"
        FROM supervised_tool_policies
        ORDER BY canonical_tool_id ASC
      `;
      return yield* Effect.all(
        rows.map((row) =>
          decodePolicy(row.entityJson, "SupervisedToolPolicyRepository.list:decode"),
        ),
      );
    }).pipe(
      Effect.mapError((error) =>
        error &&
        typeof error === "object" &&
        "_tag" in error &&
        error._tag === "PersistenceDecodeError"
          ? error
          : toPersistenceSqlError("SupervisedToolPolicyRepository.list:query")(error),
      ),
    );

  const getByToolId: SupervisedToolPolicyRepositoryShape["getByToolId"] = (toolId) =>
    Effect.gen(function* () {
      const rows = yield* sql<PolicyRow>`
        SELECT entity_json AS "entityJson"
        FROM supervised_tool_policies
        WHERE canonical_tool_id = ${toolId}
      `;
      const row = rows[0];
      if (!row) return Option.none();
      return Option.some(
        yield* decodePolicy(row.entityJson, "SupervisedToolPolicyRepository.getByToolId:decode"),
      );
    }).pipe(
      Effect.mapError((error) =>
        error &&
        typeof error === "object" &&
        "_tag" in error &&
        error._tag === "PersistenceDecodeError"
          ? error
          : toPersistenceSqlError("SupervisedToolPolicyRepository.getByToolId:query")(error),
      ),
    );

  const put: SupervisedToolPolicyRepositoryShape["put"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const current = yield* getByToolId(input.policy.toolId);
          const currentRevision = Option.isSome(current) ? current.value.revision : 0;
          if (Option.isSome(current) && current.value.state === "revoked") {
            return yield* Effect.fail(
              toPersistenceSqlError("SupervisedToolPolicyRepository.put:revoked")(
                new Error(`Tool policy '${input.policy.toolId}' is permanently revoked.`),
              ),
            );
          }
          if (
            currentRevision !== input.expectedRevision ||
            input.policy.revision !== currentRevision + 1
          ) {
            return yield* Effect.fail(
              toPersistenceSqlError("SupervisedToolPolicyRepository.put:conflict")(
                new Error(
                  `Tool policy '${input.policy.toolId}' revision conflict: expected ${input.expectedRevision}, current ${currentRevision}.`,
                ),
              ),
            );
          }
          yield* sql`
          INSERT INTO supervised_tool_policies (
            canonical_tool_id, state, revision, reason, updated_at, revoked_at, entity_json
          ) VALUES (
            ${input.policy.toolId}, ${input.policy.state}, ${input.policy.revision},
            ${input.policy.reason}, ${input.policy.updatedAt}, ${input.policy.revokedAt},
            ${JSON.stringify(input.policy)}
          )
          ON CONFLICT(canonical_tool_id) DO UPDATE SET
            state = excluded.state,
            revision = excluded.revision,
            reason = excluded.reason,
            updated_at = excluded.updated_at,
            revoked_at = excluded.revoked_at,
            entity_json = excluded.entity_json
        `;
          yield* sql`
          INSERT INTO supervised_runtime_audit (
            action, actor_json, target_kind, target_id, outcome, detail_json, occurred_at
          ) VALUES (
            ${input.audit.action}, ${JSON.stringify(input.audit.actor)}, ${input.audit.targetKind},
            ${input.audit.targetId}, ${input.audit.outcome}, ${JSON.stringify(input.audit.detail)},
            ${input.audit.occurredAt}
          )
        `;
          return input.policy;
        }),
      )
      .pipe(
        Effect.mapError((error) =>
          isPersistenceError(error)
            ? error
            : toPersistenceSqlError("SupervisedToolPolicyRepository.put:query")(error),
        ),
      );

  return { list, getByToolId, put } satisfies SupervisedToolPolicyRepositoryShape;
});

export const SupervisedToolPolicyRepositoryLive = Layer.effect(
  SupervisedToolPolicyRepository,
  makeSupervisedToolPolicyRepository,
);
