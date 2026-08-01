import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Schema } from "effect";

import {
  ArbiterVerdict,
  ChildContinuity,
  CompiledProposal,
  ListOrchestratorRootsInput,
  OrchestratorAssignmentStatusReportCommand,
  OrchestratorToolName,
} from "./orchestrator";

describe("Orchestrator contracts", () => {
  it("exposes the exact agent tool catalogue without detach", () => {
    const tools = Schema.decodeUnknownSync(Schema.Array(OrchestratorToolName))([
      "synara_task_process_create",
      "synara_task_process_get",
      "synara_orchestrator_assign_task",
      "synara_orchestrator_read_child",
      "synara_orchestrator_wait",
    ]);
    assert.equal(tools.includes("synara_orchestrator_assign_task"), true);
    assert.throws(() =>
      Schema.decodeUnknownSync(OrchestratorToolName)("synara_orchestrator_detach"),
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
