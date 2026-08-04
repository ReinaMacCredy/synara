import type { SupervisionSnapshot } from "@synara/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export interface ProjectionSupervisionRepositoryShape {
  readonly getSnapshot: () => Effect.Effect<SupervisionSnapshot, ProjectionRepositoryError>;
  readonly replaceSnapshot: (
    snapshot: SupervisionSnapshot,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionSupervisionRepository extends ServiceMap.Service<
  ProjectionSupervisionRepository,
  ProjectionSupervisionRepositoryShape
>()("synara/persistence/Services/ProjectionSupervision/ProjectionSupervisionRepository") {}
