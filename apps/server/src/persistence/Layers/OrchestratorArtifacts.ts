import { ArtifactId, OrchestratorArtifact, OrchestratorRunId, ThreadId } from "@synara/contracts";
import { Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { PersistenceSqlError, toPersistenceSqlError } from "../Errors.ts";
import {
  OrchestratorArtifactRepository,
  type OrchestratorArtifactRepositoryShape,
} from "../Services/OrchestratorArtifacts.ts";

type ArtifactDbRow = {
  readonly artifactId: string;
  readonly rootThreadId: string;
  readonly runId: string | null;
  readonly round: number | null;
  readonly kind: string;
  readonly contentHash: string;
  readonly content: string;
  readonly producerThreadId: string;
  readonly visibility: string;
  readonly sourceRefsJson: string;
  readonly supersedesArtifactId: string | null;
  readonly schemaVersion: number;
  readonly createdAt: string;
};

const decodeArtifact = (row: ArtifactDbRow): typeof OrchestratorArtifact.Type =>
  Schema.decodeUnknownSync(OrchestratorArtifact)({
    id: ArtifactId.makeUnsafe(row.artifactId),
    rootThreadId: ThreadId.makeUnsafe(row.rootThreadId),
    runId: row.runId === null ? null : OrchestratorRunId.makeUnsafe(row.runId),
    round: row.round,
    kind: row.kind,
    contentHash: row.contentHash,
    content: row.content,
    producerThreadId: ThreadId.makeUnsafe(row.producerThreadId),
    visibility: row.visibility,
    sourceRefs: JSON.parse(row.sourceRefsJson),
    supersedesArtifactId:
      row.supersedesArtifactId === null ? null : ArtifactId.makeUnsafe(row.supersedesArtifactId),
    schemaVersion: row.schemaVersion,
    createdAt: row.createdAt,
  });

const artifactSelect = `
  artifact_id AS "artifactId", root_thread_id AS "rootThreadId", run_id AS "runId",
  round, kind, content_hash AS "contentHash", content,
  producer_thread_id AS "producerThreadId", visibility,
  source_refs_json AS "sourceRefsJson", supersedes_artifact_id AS "supersedesArtifactId",
  schema_version AS "schemaVersion", created_at AS "createdAt"
`;

const makeOrchestratorArtifactRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const publish: OrchestratorArtifactRepositoryShape["publish"] = (artifact) =>
    sql`
      INSERT INTO orchestrator_artifacts (
        artifact_id, root_thread_id, run_id, round, kind, content_hash, content,
        producer_thread_id, visibility, source_refs_json, supersedes_artifact_id,
        schema_version, created_at
      ) VALUES (
        ${artifact.id}, ${artifact.rootThreadId}, ${artifact.runId}, ${artifact.round},
        ${artifact.kind}, ${artifact.contentHash}, ${artifact.content},
        ${artifact.producerThreadId}, ${artifact.visibility}, ${JSON.stringify(artifact.sourceRefs)},
        ${artifact.supersedesArtifactId}, ${artifact.schemaVersion}, ${artifact.createdAt}
      )
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("OrchestratorArtifactRepository.publish:query")),
    );

  const read: OrchestratorArtifactRepositoryShape["read"] = (input) =>
    sql
      .unsafe<ArtifactDbRow>(
        `SELECT ${artifactSelect}
       FROM orchestrator_artifacts
       WHERE root_thread_id = ? AND artifact_id = ?`,
        [input.rootThreadId, input.artifactId],
      )
      .pipe(
        Effect.map((rows) => (rows[0] ? Option.some(decodeArtifact(rows[0])) : Option.none())),
        Effect.mapError(toPersistenceSqlError("OrchestratorArtifactRepository.read:query")),
      );

  const list: OrchestratorArtifactRepositoryShape["list"] = (input) => {
    const hasCursor = input.beforeCreatedAt !== undefined && input.beforeArtifactId !== undefined;
    return sql
      .unsafe<ArtifactDbRow>(
        `SELECT ${artifactSelect}
       FROM orchestrator_artifacts
       WHERE root_thread_id = ?
         AND (? = 0 OR created_at < ? OR (created_at = ? AND artifact_id < ?))
       ORDER BY created_at DESC, artifact_id DESC
       LIMIT ?`,
        [
          input.rootThreadId,
          hasCursor ? 1 : 0,
          input.beforeCreatedAt ?? "",
          input.beforeCreatedAt ?? "",
          input.beforeArtifactId ?? "",
          input.limit,
        ],
      )
      .pipe(
        Effect.map((rows) => rows.map(decodeArtifact)),
        Effect.mapError(toPersistenceSqlError("OrchestratorArtifactRepository.list:query")),
      );
  };

  const release: OrchestratorArtifactRepositoryShape["release"] = (input) =>
    Effect.gen(function* () {
      yield* sql`
        UPDATE orchestrator_artifacts
        SET visibility = ${input.visibility}
        WHERE root_thread_id = ${input.rootThreadId}
          AND artifact_id = ${input.artifactId}
          AND (
            visibility = ${input.visibility}
            OR (visibility = 'private' AND ${input.visibility} IN ('root_released', 'public'))
            OR (visibility = 'sealed' AND ${input.visibility} = 'round_released')
            OR (visibility = 'round_released' AND ${input.visibility} IN ('root_released', 'public'))
            OR (visibility = 'root_released' AND ${input.visibility} = 'public')
          )
      `;
      const rows = yield* sql<{ readonly count: number }>`SELECT changes() AS count`;
      if (rows[0]?.count !== 1) {
        return yield* new PersistenceSqlError({
          operation: "OrchestratorArtifactRepository.release:transition",
          detail: "Artifact does not exist in the Root scope or visibility transition is illegal",
        });
      }
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof PersistenceSqlError
          ? cause
          : toPersistenceSqlError("OrchestratorArtifactRepository.release:query")(cause),
      ),
    );

  return { publish, read, list, release } satisfies OrchestratorArtifactRepositoryShape;
});

export const OrchestratorArtifactRepositoryLive = Layer.effect(
  OrchestratorArtifactRepository,
  makeOrchestratorArtifactRepository,
);
