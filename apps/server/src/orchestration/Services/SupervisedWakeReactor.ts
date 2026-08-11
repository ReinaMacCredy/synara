import type { OrchestrationEvent } from "@veylen/contracts";
import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export interface SupervisedWakeReactorShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  readonly reconcileEvent: (event: OrchestrationEvent) => Effect.Effect<void, unknown>;
  readonly reconcileQueued: Effect.Effect<void, unknown>;
}

export class SupervisedWakeReactor extends ServiceMap.Service<
  SupervisedWakeReactor,
  SupervisedWakeReactorShape
>()("veylen/orchestration/Services/SupervisedWakeReactor") {}
