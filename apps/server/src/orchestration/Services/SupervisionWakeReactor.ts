import type { OrchestrationEvent } from "@synara/contracts";
import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export interface SupervisionWakeReactorShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  readonly reconcileEvent: (event: OrchestrationEvent) => Effect.Effect<void, unknown>;
  readonly reconcileQueued: Effect.Effect<void, unknown>;
}

export class SupervisionWakeReactor extends ServiceMap.Service<
  SupervisionWakeReactor,
  SupervisionWakeReactorShape
>()("synara/orchestration/Services/SupervisionWakeReactor") {}
