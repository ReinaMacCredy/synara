import {
  ArtifactId,
  AssignmentId,
  ContextBundleId,
  ProjectTaskId,
  ThreadId,
  type AssignmentCompletionEvidence,
  type AssignmentContract,
  type OrchestratorArtifact,
} from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  assignmentCompletionEvidenceIssue,
  assignmentVerificationIssue,
} from "./assignmentEvidence.ts";

const now = "2026-08-01T00:00:00.000Z";
const assignmentId = AssignmentId.makeUnsafe("assignment");
const taskId = ProjectTaskId.makeUnsafe("task");
const artifactId = ArtifactId.makeUnsafe("evidence");
const assignment = {
  assignmentId,
  version: 1,
  taskId,
  ownerThreadId: ThreadId.makeUnsafe("root"),
  assigneeThreadId: ThreadId.makeUnsafe("child"),
  goal: "Implement",
  acceptanceCriteria: [],
  immutableUserConstraints: [],
  workingAssumptions: [],
  contextBundleId: ContextBundleId.makeUnsafe("context"),
  continuity: { kind: "reuse", threadId: ThreadId.makeUnsafe("child") },
  modelTarget: {
    provider: "codex",
    model: "gpt-5.6",
    runtimeMode: "full-access",
    workspaceRoot: "/repo",
  },
  decisionReason: {
    summary: "fit",
    taskFit: [],
    contextHealth: "healthy",
    cacheEconomics: "unknown",
    selectedAt: now,
  },
  pathOwnershipClaims: [],
  dependencyRefs: [],
  expectedApis: [],
  allowedCapabilities: [],
  evidenceRequirements: [],
  verifierClass: "root",
  state: "reported_complete",
  supersedesVersion: null,
  createdAt: now,
  updatedAt: now,
} satisfies AssignmentContract;
const evidence = {
  assignmentId,
  taskId,
  summary: "done",
  changedPaths: ["src/a.ts"],
  diffRef: null,
  checks: [{ command: "check", result: "pass", observedAt: now }],
  consumerEvidenceRefs: [],
  artifactRefs: [artifactId],
  risks: [],
  deviations: [],
  reportedAt: now,
} satisfies AssignmentCompletionEvidence;
const artifact = {
  id: artifactId,
  rootThreadId: ThreadId.makeUnsafe("root"),
  runId: null,
  round: null,
  kind: "evidence",
  contentHash: "sha256:evidence",
  content: "proof",
  producerThreadId: ThreadId.makeUnsafe("child"),
  visibility: "root_released",
  sourceRefs: [],
  supersedesArtifactId: null,
  schemaVersion: 1,
  createdAt: now,
} satisfies OrchestratorArtifact;

describe("assignment evidence", () => {
  it("requires completion evidence identities and durable artifact references", () => {
    expect(
      assignmentCompletionEvidenceIssue({
        assignment,
        taskId,
        evidence,
        progressEvidenceRefs: [artifactId],
        artifacts: [artifact],
      }),
    ).toBeNull();
    expect(
      assignmentCompletionEvidenceIssue({
        assignment,
        taskId,
        evidence,
        progressEvidenceRefs: [],
        artifacts: [artifact],
      }),
    ).toContain("progress entry");
  });

  it("verifies only explicit durable artifacts from the latest report", () => {
    expect(
      assignmentVerificationIssue({
        assignment,
        taskId,
        latestEvidence: evidence,
        evidenceArtifactIds: [artifactId],
        artifacts: [artifact],
      }),
    ).toBeNull();
    expect(
      assignmentVerificationIssue({
        assignment,
        taskId,
        latestEvidence: evidence,
        evidenceArtifactIds: [],
        artifacts: [artifact],
      }),
    ).toContain("at least one");
  });
});
