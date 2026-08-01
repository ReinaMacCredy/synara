import {
  ArtifactId,
  OrchestratorArtifact,
  OrchestratorArtifactVisibility,
  ThreadId,
} from "@synara/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ReadOrchestratorArtifactRecordInput = Schema.Struct({
  rootThreadId: ThreadId,
  artifactId: ArtifactId,
});
export type ReadOrchestratorArtifactRecordInput = typeof ReadOrchestratorArtifactRecordInput.Type;

export const ListOrchestratorArtifactRecordsInput = Schema.Struct({
  rootThreadId: ThreadId,
  limit: Schema.Int.check(Schema.isGreaterThan(0)).check(Schema.isLessThanOrEqualTo(101)),
  beforeCreatedAt: Schema.optional(Schema.String),
  beforeArtifactId: Schema.optional(ArtifactId),
});
export type ListOrchestratorArtifactRecordsInput = typeof ListOrchestratorArtifactRecordsInput.Type;

export const ReleaseOrchestratorArtifactInput = Schema.Struct({
  rootThreadId: ThreadId,
  artifactId: ArtifactId,
  visibility: OrchestratorArtifactVisibility,
});
export type ReleaseOrchestratorArtifactInput = typeof ReleaseOrchestratorArtifactInput.Type;

export interface OrchestratorArtifactRepositoryShape {
  readonly publish: (
    artifact: typeof OrchestratorArtifact.Type,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly read: (
    input: ReadOrchestratorArtifactRecordInput,
  ) => Effect.Effect<Option.Option<typeof OrchestratorArtifact.Type>, ProjectionRepositoryError>;
  readonly list: (
    input: ListOrchestratorArtifactRecordsInput,
  ) => Effect.Effect<ReadonlyArray<typeof OrchestratorArtifact.Type>, ProjectionRepositoryError>;
  readonly release: (
    input: ReleaseOrchestratorArtifactInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class OrchestratorArtifactRepository extends ServiceMap.Service<
  OrchestratorArtifactRepository,
  OrchestratorArtifactRepositoryShape
>()("synara/persistence/Services/OrchestratorArtifacts/OrchestratorArtifactRepository") {}
