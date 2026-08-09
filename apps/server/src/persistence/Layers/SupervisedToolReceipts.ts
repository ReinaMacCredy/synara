import {
  SupervisedToolInvocationReceipt,
  type SupervisedToolInvocationReceiptId,
} from "@synara/contracts";
import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  toPersistenceDecodeCauseError,
  toPersistenceSqlError,
} from "../Errors.ts";
import {
  SupervisedToolReceiptRepository,
  type SupervisedToolReceiptRepositoryShape,
} from "../Services/SupervisedToolReceipts.ts";

type EntityRow = { readonly entityJson: string };

const makeSupervisedToolReceiptRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const decodeReceipt = (entityJson: string, operation: string) =>
    Effect.try({
      try: () =>
        Schema.decodeUnknownSync(SupervisedToolInvocationReceipt)(JSON.parse(entityJson)),
      catch: toPersistenceDecodeCauseError(operation),
    });

  const listRecent: SupervisedToolReceiptRepositoryShape["listRecent"] = (limit) =>
    Effect.gen(function* () {
      const rows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM supervised_tool_invocation_receipts
        ORDER BY requested_at DESC, receipt_id DESC
        LIMIT ${Math.max(1, Math.min(500, Math.trunc(limit)))}
      `;
      return yield* Effect.all(
        rows.map((row) =>
          decodeReceipt(row.entityJson, "SupervisedToolReceiptRepository.listRecent:decode"),
        ),
      );
    }).pipe(
      Effect.mapError((error) =>
        error && typeof error === "object" && "_tag" in error && error._tag === "PersistenceDecodeError"
          ? error
          : toPersistenceSqlError("SupervisedToolReceiptRepository.listRecent:query")(error),
      ),
    );

  const getById: SupervisedToolReceiptRepositoryShape["getById"] = (id) =>
    Effect.gen(function* () {
      const rows = yield* sql<EntityRow>`
        SELECT entity_json AS "entityJson"
        FROM supervised_tool_invocation_receipts
        WHERE receipt_id = ${id}
      `;
      const row = rows[0];
      if (!row) return Option.none();
      const receipt = yield* decodeReceipt(
        row.entityJson,
        "SupervisedToolReceiptRepository.getById:decode",
      );
      return Option.some(receipt);
    }).pipe(
      Effect.mapError((error) =>
        error && typeof error === "object" && "_tag" in error && error._tag === "PersistenceDecodeError"
          ? error
          : toPersistenceSqlError("SupervisedToolReceiptRepository.getById:query")(error),
      ),
    );

  const insert: SupervisedToolReceiptRepositoryShape["insert"] = (receipt) =>
    sql`
      INSERT INTO supervised_tool_invocation_receipts (
        receipt_id, canonical_tool_id, actor_seat_id, authority_receipt_id,
        caller_thread_id, state, requested_at, completed_at, entity_json
      ) VALUES (
        ${receipt.id}, ${receipt.toolId}, ${receipt.actorSeatId}, ${receipt.authorityReceiptId},
        ${receipt.callerThreadId}, ${receipt.state}, ${receipt.requestedAt}, ${receipt.completedAt},
        ${JSON.stringify(receipt)}
      )
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("SupervisedToolReceiptRepository.insert:query")),
    );

  const complete: SupervisedToolReceiptRepositoryShape["complete"] = (input) =>
    Effect.gen(function* () {
      const current = yield* getById(input.id);
      if (Option.isNone(current)) {
        return yield* Effect.fail(
          toPersistenceSqlError("SupervisedToolReceiptRepository.complete:missing")(
            new Error(`Tool receipt '${input.id}' does not exist.`),
          ),
        );
      }
      const receipt = {
        ...current.value,
        state: input.state,
        completedAt: input.completedAt,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
      };
      yield* sql`
        UPDATE supervised_tool_invocation_receipts
        SET state = ${receipt.state},
            completed_at = ${receipt.completedAt},
            entity_json = ${JSON.stringify(receipt)}
        WHERE receipt_id = ${input.id}
      `.pipe(
        Effect.mapError(toPersistenceSqlError("SupervisedToolReceiptRepository.complete:query")),
      );
      return receipt;
    });

  return { listRecent, insert, complete, getById } satisfies SupervisedToolReceiptRepositoryShape;
});

export const SupervisedToolReceiptRepositoryLive = Layer.effect(
  SupervisedToolReceiptRepository,
  makeSupervisedToolReceiptRepository,
);
