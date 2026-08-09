import {
  SupervisedToolInvocationReceiptId,
  type SupervisedToolInvocationReceipt,
  type SupervisedToolResultState,
} from "@synara/contracts";
import { ServiceMap } from "effect";
import type { Effect, Option } from "effect";

import type { PersistenceDecodeError, PersistenceSqlError } from "../Errors.ts";

export interface CompleteSupervisedToolReceiptInput {
  readonly id: SupervisedToolInvocationReceiptId;
  readonly state: Exclude<SupervisedToolResultState, "requested">;
  readonly completedAt: string;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

export interface SupervisedToolReceiptRepositoryShape {
  readonly insert: (
    receipt: SupervisedToolInvocationReceipt,
  ) => Effect.Effect<void, PersistenceSqlError>;
  readonly complete: (
    input: CompleteSupervisedToolReceiptInput,
  ) => Effect.Effect<SupervisedToolInvocationReceipt, PersistenceSqlError | PersistenceDecodeError>;
  readonly getById: (
    id: SupervisedToolInvocationReceiptId,
  ) => Effect.Effect<
    Option.Option<SupervisedToolInvocationReceipt>,
    PersistenceSqlError | PersistenceDecodeError
  >;
}

export class SupervisedToolReceiptRepository extends ServiceMap.Service<
  SupervisedToolReceiptRepository,
  SupervisedToolReceiptRepositoryShape
>()("synara/persistence/Services/SupervisedToolReceiptRepository") {}
