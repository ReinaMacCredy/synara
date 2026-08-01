import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Schema } from "effect";

import {
  ArbiterVerdict,
  ChildContinuity,
  CompiledProposal,
  ListOrchestratorRootsInput,
  OrchestratorAssignmentStatusReportCommand,
  OrchestratorRootRestoreCommand,
  OrchestratorToolName,
} from "./orchestrator";

describe("Orchestrator contracts", () => {
  it("exposes the exact agent tool catalogue without detach", () => {
    const tools = Schema.decodeUnknownSync(Schema.Array(OrchestratorToolName))([
      "create_task_process",
      "read_task_process",
      "assign_task",
      "read_thread",
      "wait_for_event",
    ]);
    assert.equal(tools.includes("assign_task"), true);
    assert.throws(() =>
      Schema.decodeUnknownSync(OrchestratorToolName)("detach_child_thread"),
    );
  });

  it("keeps continuity strategy explicit", () => {
    const continuity = Schema.decodeUnknownSync(ChildContinuity)({
      kind: "reuse",
      threadId: "child-1",
    });
    assert.equal(continuity.kind, "reuse");
  });

  it("rejects compiler winner fields", () => {
    assert.throws(() =>
      Schema.decodeUnknownSync(CompiledProposal)({
        proposalLabel: "Alpha",
        artifactHash: "sha256:abc",
        claims: [],
        winner: "Alpha",
      }),
    );
  });

  it("requires task identity on assignment status reports", () => {
    assert.throws(() =>
      Schema.decodeUnknownSync(OrchestratorAssignmentStatusReportCommand)({
        type: "orchestrator.assignment.status.report",
        commandId: "command-1",
        rootThreadId: "root-1",
        projectId: "project-1",
        actor: { kind: "thread", threadId: "child-1" },
        protocolVersion: 1,
        expectedRevision: 2,
        createdAt: "2026-08-01T00:00:00.000Z",
        assignmentId: "assignment-1",
        state: "reported_complete",
        summary: "done",
        evidence: null,
      }),
    );
  });

  it("bounds root list pages", () => {
    assert.throws(() => Schema.decodeUnknownSync(ListOrchestratorRootsInput)({ limit: 101 }));
  });

  it("decodes the user-owned Root restore command", () => {
    const command = Schema.decodeUnknownSync(OrchestratorRootRestoreCommand)({
      type: "orchestrator.root.restore",
      commandId: "restore-root-1",
      rootThreadId: "root-1",
      projectId: "project-1",
      actor: { kind: "user", actorId: "owner" },
      protocolVersion: 1,
      expectedRevision: 4,
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    assert.equal(command.type, "orchestrator.root.restore");
    assert.equal(command.expectedRevision, 4);
  });

  it("validates blind arbiter verdicts without peer-verdict fields", () => {
    const verdict = Schema.decodeUnknownSync(ArbiterVerdict)({
      arbiterArtifactId: "artifact-1",
      decisions: [],
      userConstraintConflicts: [],
      criticalRisks: [],
      preferredProposal: null,
      synthesisRequirements: [],
      confidence: 0.75,
      confidenceReasons: ["Evidence is complete"],
      unresolvedDisputes: [],
      recommendedDisposition: "auto_actionable",
    });
    assert.equal(verdict.confidence, 0.75);
  });
});
