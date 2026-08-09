import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        UPDATE projection_harness_patches
        SET status = CASE status
              WHEN 'draft' THEN 'proposed'
              WHEN 'evaluating' THEN 'sandboxed'
              WHEN 'active' THEN 'revoked'
              WHEN 'reverted' THEN 'revoked'
              WHEN 'expired' THEN 'revoked'
              ELSE status
            END,
            entity_json = json_set(
              entity_json,
              '$.status',
              CASE json_extract(entity_json, '$.status')
                WHEN 'draft' THEN 'proposed'
                WHEN 'evaluating' THEN 'sandboxed'
                WHEN 'active' THEN 'revoked'
                WHEN 'reverted' THEN 'revoked'
                WHEN 'expired' THEN 'revoked'
                ELSE json_extract(entity_json, '$.status')
              END,
              '$.revision',
              COALESCE(json_extract(entity_json, '$.revision'), 0)
            )
      `;
    }),
  );
});
