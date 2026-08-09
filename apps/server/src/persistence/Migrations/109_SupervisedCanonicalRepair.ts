import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  ensurePeerModelSessionRoleConstraint,
  repairCanonicalProfiles,
} from "./supervisedCanonicalRepair.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* ensurePeerModelSessionRoleConstraint(sql);
      yield* repairCanonicalProfiles(sql);
    }),
  );
});
