import {
  AssignmentId,
  ChildResultId,
  ContextBundleId,
  ProjectTaskId,
  ThreadId,
  type AssignmentContract,
  type ChildResultEnvelope,
  type OrchestratorOwnershipEdge,
} from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { projectOrchestratorChildren } from "./childProjections.ts";

const now = "2026-08-02T00:00:00.000Z";
const rootThreadId = ThreadId.makeUnsafe("root-projection");
const childThreadId = ThreadId.makeUnsafe("child-projection");
const assignmentId = AssignmentId.makeUnsafe("assignment-projection");
const taskId = ProjectTaskId.makeUnsafe("task-projection");

const edge: OrchestratorOwnershipEdge = {
  rootThreadId,
  parentThreadId: rootThreadId,
  childThreadId,
  role: "participant",
  capabilities: ["assignment.report"],
  contractVersion: 1,
  sourceThreadId: rootThreadId,
  sourceTurnId: null,
  sourceOperationId: null,
  activeFrom: now,
  retiredAt: null,
  decisionReason: {
    summary: "projection fixture",
    taskFit: [],
    contextHealth: "healthy",
    cacheEconomics: "reuse",
    selectedAt: now,
  },
};

const assignment: AssignmentContract = {
  assignmentId,
  version: 1,
  taskId,
  ownerThreadId: rootThreadId,
  assigneeThreadId: childThreadId,
  goal: "Return result",
  acceptanceCriteria: [],
  immutableUserConstraints: [],
  workingAssumptions: [],
  contextBundleId: ContextBundleId.makeUnsafe("context-projection"),
  continuity: { kind: "reuse", threadId: childThreadId },
  modelTarget: {
    provider: "codex",
    model: "gpt-5.6-luna",
    runtimeMode: "full-access",
    workspaceRoot: "/workspace",
  },
  decisionReason: edge.decisionReason,
  pathOwnershipClaims: [],
  dependencyRefs: [],
  expectedApis: [],
  allowedCapabilities: ["assignment.report"],
  evidenceRequirements: [],
  verifierClass: "root",
  state: "reported_complete",
  supersedesVersion: null,
  createdAt: now,
  updatedAt: now,
};

const result: ChildResultEnvelope = {
  resultId: ChildResultId.makeUnsafe("result-projection"),
  rootThreadId,
  childThreadId,
  assignmentId,
  taskId,
  finalMessage: "Done",
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
    assignmentId,
    taskId,
    summary: "Done",
    changedPaths: ["src/a.ts"],
    diffRef: "diff:a",
    checks: [],
    consumerEvidenceRefs: [],
    artifactRefs: [],
    risks: [],
    deviations: [],
    reportedAt: now,
  },
};

describe("projectOrchestratorChildren", () => {
  it("keeps a submitted result ready until Root explicitly accepts it", () => {
    const [pending] = projectOrchestratorChildren({
      rootThreadId,
      ownershipEdges: [edge],
      assignments: [assignment],
      childResults: [result],
    });
    expect(pending).toMatchObject({
      orchestrationState: "ready",
      pendingResultId: result.resultId,
      diffSummary: result.diffSummary,
    });

    const [accepted] = projectOrchestratorChildren({
      rootThreadId,
      ownershipEdges: [edge],
      assignments: [{ ...assignment, state: "accepted" }],
      childResults: [
        {
          ...result,
          revision: 2,
          reviewState: "accepted",
          reviewedAt: now,
          reviewedByThreadId: rootThreadId,
        },
      ],
    });
    expect(accepted).toMatchObject({
      orchestrationState: "available",
      pendingResultId: null,
      resultReviewState: "accepted",
    });
  });
});
