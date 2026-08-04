import type { LeadRotationId, OrchestrationEvent } from "@synara/contracts";
import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export interface LeadRotationReactorShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  readonly reconcileRotation: (rotationId: LeadRotationId) => Effect.Effect<void, unknown>;
  readonly reconcileEvent: (event: OrchestrationEvent) => Effect.Effect<void, unknown>;
  readonly reconcileAll: Effect.Effect<void, unknown>;
}

export class LeadRotationReactor extends ServiceMap.Service<
  LeadRotationReactor,
  LeadRotationReactorShape
>()("synara/orchestration/Services/LeadRotationReactor") {}
