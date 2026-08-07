import type {
  DerivedSignal,
  SubscriptionDefinition,
  SubscriptionDelivery,
} from "@synara/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

export class SupervisedSignalDeliveryError extends Schema.TaggedErrorClass<SupervisedSignalDeliveryError>()(
  "SupervisedSignalDeliveryError",
  { detail: Schema.String, cause: Schema.optional(Schema.Defect) },
) {}

export interface SupervisedSignalDeliveryShape {
  readonly deliver: (input: {
    readonly subscription: SubscriptionDefinition;
    readonly signal: DerivedSignal;
    readonly delivery: SubscriptionDelivery;
  }) => Effect.Effect<void, SupervisedSignalDeliveryError>;
}

export class SupervisedSignalDelivery extends ServiceMap.Service<
  SupervisedSignalDelivery,
  SupervisedSignalDeliveryShape
>()("synara/orchestration/Services/SupervisedSignalDelivery") {}
