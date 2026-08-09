import type { SupervisedGovernanceSnapshot } from "@synara/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export interface SupervisedGovernanceRepositoryShape {
  readonly getSnapshot: () => Effect.Effect<
    SupervisedGovernanceSnapshot,
    ProjectionRepositoryError
  >;
  readonly replaceSnapshot: (
    snapshot: SupervisedGovernanceSnapshot,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class SupervisedGovernanceRepository extends ServiceMap.Service<
  SupervisedGovernanceRepository,
  SupervisedGovernanceRepositoryShape
>()("synara/persistence/Services/SupervisedGovernanceRepository/SupervisedGovernanceRepository") {}
