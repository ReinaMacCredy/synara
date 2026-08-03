import {
  AssignmentId,
  ChildResultId,
  MonitorId,
  OrchestratorLinkId,
  ProjectId,
  ProjectTaskId,
  ThreadId,
  WriterClaimId,
} from "@synara/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Exit, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionOrchestratorRepositoryLive } from "./ProjectionOrchestrator.ts";
import { ProjectionOrchestratorRepository } from "../Services/ProjectionOrchestrator.ts";

const layer = it.layer(
  Layer.mergeAll(
    ProjectionOrchestratorRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

const now = "2026-08-01T00:00:00.000Z";
const decisionReason = {
  summary: "Independent architecture pass",
  taskFit: ["architecture"],
  contextHealth: "healthy" as const,
  cacheEconomics: "reuse" as const,
  selectedAt: now,
};

layer("ProjectionOrchestratorRepository", (it) => {
  it.effect("projects a scoped Root tree and communication graph", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionOrchestratorRepository;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, kind, title, workspace_root, scripts_json, created_at, updated_at
        ) VALUES
          ('project-a', 'project', 'A', '/workspace/a', '[]', ${now}, ${now}),
          ('project-b', 'project', 'B', '/workspace/b', '[]', ${now}, ${now})
      `;
      for (const [threadId, projectId] of [
        ["root-a", "project-a"],
        ["child-b", "project-a"],
        ["child-c", "project-a"],
        ["foreign-child", "project-b"],
      ] as const) {
        yield* sql`
          INSERT INTO projection_threads (
            thread_id, project_id, title, created_at, updated_at,
            runtime_mode, interaction_mode, env_mode
          ) VALUES (${threadId}, ${projectId}, ${threadId}, ${now}, ${now},
            'full-access', 'default', 'local')
        `;
      }

      yield* repository.upsertRoot({
        root: {
          rootThreadId: ThreadId.makeUnsafe("root-a"),
          projectId: ProjectId.makeUnsafe("project-a"),
          protocolVersion: 1,
          state: "active",
          activeProcessId: null,
          resourcePolicyVersion: 1,
          createdAt: now,
          archivedAt: null,
          revision: 2,
        },
        highWaterCursor: "cursor-2",
      });
      yield* repository.upsertOwnershipEdge({
        rootThreadId: ThreadId.makeUnsafe("root-a"),
        parentThreadId: ThreadId.makeUnsafe("root-a"),
        childThreadId: ThreadId.makeUnsafe("child-b"),
        role: "child_owner",
        capabilities: ["state.read", "message.send"],
        contractVersion: 1,
        sourceThreadId: ThreadId.makeUnsafe("root-a"),
        sourceTurnId: null,
        sourceOperationId: null,
        activeFrom: now,
        retiredAt: null,
        decisionReason,
      });
      yield* repository.upsertOwnershipEdge({
        rootThreadId: ThreadId.makeUnsafe("root-a"),
        parentThreadId: ThreadId.makeUnsafe("child-b"),
        childThreadId: ThreadId.makeUnsafe("child-c"),
        role: "participant",
        capabilities: ["state.read", "message.send"],
        contractVersion: 1,
        sourceThreadId: ThreadId.makeUnsafe("root-a"),
        sourceTurnId: null,
        sourceOperationId: null,
        activeFrom: now,
        retiredAt: null,
        decisionReason,
      });
      yield* repository.upsertCommunicationLink({
        id: OrchestratorLinkId.makeUnsafe("link-b-c"),
        rootThreadId: ThreadId.makeUnsafe("root-a"),
        sourceThreadId: ThreadId.makeUnsafe("child-b"),
        targetThreadId: ThreadId.makeUnsafe("child-c"),
        direction: "bidirectional",
        taskId: null,
        runId: null,
        capabilities: ["message.send"],
        requestedBy: { kind: "thread", threadId: ThreadId.makeUnsafe("child-b") },
        grantedBy: { kind: "thread", threadId: ThreadId.makeUnsafe("root-a") },
        reason: "Coordinate dependencies",
        state: "granted",
        createdAt: now,
        expiresAt: "2026-08-02T00:00:00.000Z",
        updatedAt: now,
      });
      yield* repository.upsertMonitor({
        id: MonitorId.makeUnsafe("monitor-a"),
        rootThreadId: ThreadId.makeUnsafe("root-a"),
        targetThreadId: ThreadId.makeUnsafe("child-b"),
        kind: "heartbeat",
        condition: "heartbeat",
        cadenceMs: 1_000,
        nextWakeAt: "2026-08-01T00:00:01.000Z",
        maxRuns: 3,
        runCount: 0,
        expiresAt: "2026-08-02T00:00:00.000Z",
        ownerThreadId: ThreadId.makeUnsafe("root-a"),
        state: "active",
      });
      yield* repository.upsertWriterClaim({
        id: WriterClaimId.makeUnsafe("claim-a"),
        rootThreadId: ThreadId.makeUnsafe("root-a"),
        workspaceRoot: "/workspace/a",
        normalizedPathPrefix: "/workspace/a/apps/server",
        assignmentId: AssignmentId.makeUnsafe("assignment-a"),
        threadId: ThreadId.makeUnsafe("child-b"),
        mode: "write",
        acquiredAt: now,
        expiresAt: "2026-08-02T00:00:00.000Z",
        releasedAt: null,
      });
      const resultAssignmentId = AssignmentId.makeUnsafe("assignment-result-a");
      const resultTaskId = ProjectTaskId.makeUnsafe("task-result-a");
      yield* repository.upsertChildResult({
        resultId: ChildResultId.makeUnsafe("child-result-a"),
        rootThreadId: ThreadId.makeUnsafe("root-a"),
        childThreadId: ThreadId.makeUnsafe("child-b"),
        assignmentId: resultAssignmentId,
        taskId: resultTaskId,
        finalMessage: "Ready for Root review",
        artifactRefs: [],
        diffSummary: { changedPaths: ["src/a.ts"], diffRef: "diff:a" },
        contentHash: "sha256:a",
        revision: 1,
        reviewState: "pending",
        submittedAt: now,
        reviewedAt: null,
        reviewedByThreadId: null,
        feedback: null,
        evidence: {
          assignmentId: resultAssignmentId,
          taskId: resultTaskId,
          summary: "Ready for Root review",
          changedPaths: ["src/a.ts"],
          diffRef: "diff:a",
          checks: [],
          consumerEvidenceRefs: [],
          artifactRefs: [],
          risks: [],
          deviations: [],
          reportedAt: now,
        },
      });

      const core = yield* repository.getCore(ThreadId.makeUnsafe("root-a"));
      assert.ok(Option.isSome(core));
      if (Option.isNone(core)) return;
      assert.strictEqual(core.value.ownershipEdges.length, 2);
      assert.strictEqual(core.value.communicationLinks.length, 1);
      assert.deepStrictEqual(
        core.value.childResults.map((result) => result.resultId),
        ["child-result-a"],
      );
      assert.strictEqual(core.value.root.highWaterCursor, "cursor-2");
      const monitors = yield* repository.listMonitors({
        rootThreadId: ThreadId.makeUnsafe("root-a"),
        limit: 10,
      });
      const claims = yield* repository.listActiveWriterClaims({
        rootThreadId: ThreadId.makeUnsafe("root-a"),
        at: now,
        limit: 10,
      });
      assert.deepStrictEqual(
        monitors.map((monitor) => monitor.id),
        ["monitor-a"],
      );
      assert.deepStrictEqual(
        claims.map((claim) => claim.id),
        ["claim-a"],
      );
      const rootForRoot = yield* repository.findRootForThread(ThreadId.makeUnsafe("root-a"));
      const rootForDescendant = yield* repository.findRootForThread(ThreadId.makeUnsafe("child-c"));
      const rootForForeign = yield* repository.findRootForThread(
        ThreadId.makeUnsafe("foreign-child"),
      );
      assert.deepStrictEqual(Option.getOrNull(rootForRoot), ThreadId.makeUnsafe("root-a"));
      assert.deepStrictEqual(Option.getOrNull(rootForDescendant), ThreadId.makeUnsafe("root-a"));
      assert.strictEqual(Option.getOrNull(rootForForeign), null);

      const foreignEdge = yield* repository
        .upsertOwnershipEdge({
          rootThreadId: ThreadId.makeUnsafe("root-a"),
          parentThreadId: ThreadId.makeUnsafe("root-a"),
          childThreadId: ThreadId.makeUnsafe("foreign-child"),
          role: "participant",
          capabilities: ["state.read"],
          contractVersion: 1,
          sourceThreadId: ThreadId.makeUnsafe("root-a"),
          sourceTurnId: null,
          sourceOperationId: null,
          activeFrom: now,
          retiredAt: null,
          decisionReason,
        })
        .pipe(Effect.exit);
      assert.ok(Exit.isFailure(foreignEdge));
    }),
  );
});
