import {
  ArtifactId,
  AssignmentId,
  CommandId,
  ProjectId,
  ProjectTaskId,
  TaskProcessId,
  TaskProgressEntryId,
  ThreadId,
} from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { assignmentStatusProgressCommand, progressKindForAssignmentState } from "./progress.ts";

describe("assignment progress", () => {
  it("maps Assignment status to evidence kind without a task lifecycle field", () => {
    expect(progressKindForAssignmentState("needs_permission")).toBe("waiting");
    expect(progressKindForAssignmentState("reported_complete")).toBe("completion_evidence");
    const command = assignmentStatusProgressCommand({
      commandId: CommandId.makeUnsafe("command"),
      processId: TaskProcessId.makeUnsafe("process"),
      projectId: ProjectId.makeUnsafe("project"),
      actor: { kind: "thread", threadId: ThreadId.makeUnsafe("child") },
      expectedRevision: 3,
      createdAt: "2026-08-01T00:00:00.000Z",
      progressId: TaskProgressEntryId.makeUnsafe("progress"),
      taskId: ProjectTaskId.makeUnsafe("task"),
      assignmentId: AssignmentId.makeUnsafe("assignment"),
      threadId: ThreadId.makeUnsafe("child"),
      state: "reported_complete",
      summary: "Evidence ready",
      evidenceRefs: [ArtifactId.makeUnsafe("evidence")],
    });
    expect(command.kind).toBe("completion_evidence");
    expect(command).not.toHaveProperty("lifecycle");
    expect(command).not.toHaveProperty("readiness");
  });
});
