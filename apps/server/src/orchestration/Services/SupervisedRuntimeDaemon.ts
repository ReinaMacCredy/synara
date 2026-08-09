import type { ControlPlaneEvent, SupervisedRuntimeHealth } from "@synara/contracts";
import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";

export interface SupervisedRuntimeDaemonShape {
  readonly ingest: (
    event: ControlPlaneEvent,
  ) => Effect.Effect<number, ProjectionRepositoryError>;
  readonly reconcile: Effect.Effect<void, ProjectionRepositoryError>;
  readonly wake: Effect.Effect<void>;
  readonly restart: Effect.Effect<SupervisedRuntimeHealth, ProjectionRepositoryError>;
  readonly start: Effect.Effect<void, never, Scope.Scope>;
}

export class SupervisedRuntimeDaemon extends ServiceMap.Service<
  SupervisedRuntimeDaemon,
  SupervisedRuntimeDaemonShape
>()("synara/orchestration/Services/SupervisedRuntimeDaemon") {}
