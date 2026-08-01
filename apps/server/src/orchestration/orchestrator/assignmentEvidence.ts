import type {
  AssignmentCompletionEvidence,
  AssignmentContract,
  ArtifactId,
  OrchestratorArtifact,
  ProjectTaskId,
  ThreadId,
} from "@synara/contracts";

export const assignmentReporterIsAuthorized = (input: {
  readonly assignment: AssignmentContract;
  readonly actorThreadId: ThreadId | null;
  readonly rootThreadId: ThreadId;
}): boolean =>
  input.actorThreadId === null ||
  input.actorThreadId === input.rootThreadId ||
  input.actorThreadId === input.assignment.assigneeThreadId;

export const assignmentCompletionEvidenceIssue = (input: {
  readonly assignment: AssignmentContract;
  readonly taskId: ProjectTaskId;
  readonly evidence: AssignmentCompletionEvidence | null;
  readonly progressEvidenceRefs: ReadonlyArray<ArtifactId>;
  readonly artifacts: ReadonlyArray<OrchestratorArtifact>;
}): string | null => {
  if (input.evidence === null) return "Completion evidence is required.";
  if (
    input.evidence.assignmentId !== input.assignment.assignmentId ||
    input.evidence.taskId !== input.taskId
  ) {
    return "Completion evidence assignment/task identity does not match the report.";
  }
  const progressRefs = new Set(input.progressEvidenceRefs);
  if (input.evidence.artifactRefs.some((artifactId) => !progressRefs.has(artifactId))) {
    return "Completion evidence artifacts must also be attached to the task progress entry.";
  }
  const durableArtifacts = new Set(input.artifacts.map((artifact) => artifact.id));
  if (input.progressEvidenceRefs.some((artifactId) => !durableArtifacts.has(artifactId))) {
    return "Assignment evidence references an artifact that is not durable in this Root.";
  }
  return null;
};

export const assignmentVerificationIssue = (input: {
  readonly assignment: AssignmentContract;
  readonly taskId: ProjectTaskId;
  readonly latestEvidence: AssignmentCompletionEvidence | null;
  readonly evidenceArtifactIds: ReadonlyArray<ArtifactId>;
  readonly artifacts: ReadonlyArray<OrchestratorArtifact>;
}): string | null => {
  if (input.assignment.state !== "reported_complete") {
    return "Only reported_complete Assignment evidence may be verified.";
  }
  if (
    input.latestEvidence === null ||
    input.latestEvidence.assignmentId !== input.assignment.assignmentId ||
    input.latestEvidence.taskId !== input.taskId
  ) {
    return "The Assignment has no matching durable completion evidence.";
  }
  if (input.evidenceArtifactIds.length === 0) {
    return "Verification requires at least one explicit evidence artifact.";
  }
  const reported = new Set(input.latestEvidence.artifactRefs);
  const durable = new Set(input.artifacts.map((artifact) => artifact.id));
  if (
    input.evidenceArtifactIds.some(
      (artifactId) => !reported.has(artifactId) || !durable.has(artifactId),
    )
  ) {
    return "Verification artifacts must be durable artifacts from the reported evidence.";
  }
  return null;
};
