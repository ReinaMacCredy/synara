import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      const columns = yield* sql<{ readonly name: string }>`
        SELECT name FROM pragma_table_info('projection_supervised_subscriptions')
      `;
      const names = new Set(columns.map((column) => column.name));
      if (names.has("supervisor_seat_id") && !names.has("owner_lead_seat_id")) {
        yield* sql`
          ALTER TABLE projection_supervised_subscriptions
          RENAME COLUMN supervisor_seat_id TO owner_lead_seat_id
        `;
      }

      yield* sql`
        UPDATE projection_supervised_subscriptions
        SET entity_json = CASE
          WHEN json_extract(entity_json, '$.destination.kind') = 'supervisor_seat' THEN
            json_set(
              json_remove(entity_json, '$.supervisorSeatId', '$.destination.supervisorSeatId'),
              '$.ownerLeadSeatId', json_extract(entity_json, '$.supervisorSeatId'),
              '$.destination.kind', 'lead_seat',
              '$.destination.leadSeatId', json_extract(entity_json, '$.destination.supervisorSeatId')
            )
          ELSE
            json_set(
              json_remove(entity_json, '$.supervisorSeatId'),
              '$.ownerLeadSeatId', json_extract(entity_json, '$.supervisorSeatId')
            )
        END
        WHERE json_type(entity_json, '$.supervisorSeatId') IS NOT NULL
      `;
    }),
  );
});
