import type {
  SupervisedIntentToolId,
  SupervisedToolPolicy,
} from "@synara/contracts";
import { ServiceMap } from "effect";
import type { Effect, Option } from "effect";

import type { PersistenceDecodeError, PersistenceSqlError } from "../Errors.ts";

export interface PutSupervisedToolPolicyInput {
  readonly policy: SupervisedToolPolicy;
  readonly expectedRevision: number;
}

export interface SupervisedToolPolicyRepositoryShape {
  readonly list: () => Effect.Effect<
    readonly SupervisedToolPolicy[],
    PersistenceSqlError | PersistenceDecodeError
  >;
  readonly getByToolId: (
    toolId: SupervisedIntentToolId,
  ) => Effect.Effect<
    Option.Option<SupervisedToolPolicy>,
    PersistenceSqlError | PersistenceDecodeError
  >;
  readonly put: (
    input: PutSupervisedToolPolicyInput,
  ) => Effect.Effect<SupervisedToolPolicy, PersistenceSqlError | PersistenceDecodeError>;
}

export class SupervisedToolPolicyRepository extends ServiceMap.Service<
  SupervisedToolPolicyRepository,
  SupervisedToolPolicyRepositoryShape
>()("synara/persistence/Services/SupervisedToolPolicyRepository") {}
