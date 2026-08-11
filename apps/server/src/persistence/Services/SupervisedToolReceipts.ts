import {
  SupervisedToolInvocationReceiptId,
  type SupervisedToolInvocationReceipt,
  type SupervisedToolResultState,
} from "@veylen/contracts";
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
  readonly listRecent: (
    limit: number,
  ) => Effect.Effect<
    readonly SupervisedToolInvocationReceipt[],
    PersistenceSqlError | PersistenceDecodeError
  >;
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
>()("veylen/persistence/Services/SupervisedToolReceiptRepository") {}
