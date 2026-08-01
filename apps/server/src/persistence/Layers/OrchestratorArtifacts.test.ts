import { ArtifactId, ThreadId } from "@synara/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Exit, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { OrchestratorArtifactRepositoryLive } from "./OrchestratorArtifacts.ts";
import { OrchestratorArtifactRepository } from "../Services/OrchestratorArtifacts.ts";

const layer = it.layer(
  Layer.mergeAll(
    OrchestratorArtifactRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

const now = "2026-08-01T00:00:00.000Z";

layer("OrchestratorArtifactRepository", (it) => {
  it.effect("keeps artifact content immutable and releases visibility monotonically", () =>
    Effect.gen(function* () {
      const repository = yield* OrchestratorArtifactRepository;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
        ) VALUES ('project-a', 'project', 'A', '/workspace/a', '[]', ${now}, ${now})
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, created_at, updated_at,
          runtime_mode, interaction_mode, env_mode
        ) VALUES ('root-a', 'project-a', 'Root', ${now}, ${now},
          'full-access', 'default', 'local')
      `;
      yield* sql`
        INSERT INTO projection_orchestrator_roots (
          root_thread_id, project_id, protocol_version, state, active_process_id,
          resource_policy_version, revision, high_water_cursor, created_at, archived_at
        ) VALUES ('root-a', 'project-a', 1, 'active', NULL, 1, 1, 'cursor-1', ${now}, NULL)
      `;

      const artifactId = ArtifactId.makeUnsafe("artifact-a");
      yield* repository.publish({
        id: artifactId,
        rootThreadId: ThreadId.makeUnsafe("root-a"),
        runId: null,
        round: null,
        kind: "proposal",
        contentHash: "sha256:proposal",
        content: "Independent proposal",
        producerThreadId: ThreadId.makeUnsafe("root-a"),
        visibility: "sealed",
        sourceRefs: ["thread:root-a"],
        supersedesArtifactId: null,
        schemaVersion: 1,
        createdAt: now,
      });

      const illegalRelease = yield* repository
        .release({
          rootThreadId: ThreadId.makeUnsafe("root-a"),
          artifactId,
          visibility: "public",
        })
        .pipe(Effect.exit);
      assert.ok(Exit.isFailure(illegalRelease));
      yield* repository.release({
        rootThreadId: ThreadId.makeUnsafe("root-a"),
        artifactId,
        visibility: "round_released",
      });

      const mutation = yield* sql`
        UPDATE orchestrator_artifacts SET content = 'rewritten'
        WHERE artifact_id = 'artifact-a'
      `.pipe(Effect.exit);
      assert.ok(Exit.isFailure(mutation));

      const artifact = yield* repository.read({
        rootThreadId: ThreadId.makeUnsafe("root-a"),
        artifactId,
      });
      assert.ok(Option.isSome(artifact));
      assert.strictEqual(Option.getOrNull(artifact)?.content, "Independent proposal");
      assert.strictEqual(Option.getOrNull(artifact)?.visibility, "round_released");
    }),
  );
});
