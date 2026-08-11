import { ProjectId, TaskProcessId, type TaskProcessGraphProjection } from "@veylen/contracts";
import { describe, expect, it } from "vitest";

import { ProcessWorkspace, resolveProcessAuthority } from "./ProcessWorkspace";

function process(
  owner: TaskProcessGraphProjection["process"]["owner"],
): TaskProcessGraphProjection {
  return {
    process: {
      id: TaskProcessId.makeUnsafe("process"),
      projectId: ProjectId.makeUnsafe("project"),
      title: "Process",
      owner,
      state: "active",
      revision: 1,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    tasks: [],
    dependencies: [],
    bindings: [],
    blockers: [],
    graphRevision: 1,
    highWaterCursor: "1",
  };
}

describe("ProcessWorkspace", () => {
  it("derives Project authority from the durable process owner", () => {
    expect(resolveProcessAuthority(process({ kind: "user" }))).toEqual({
      mode: "project",
      canEditGraph: true,
      canCreateProcess: true,
      canPauseProcess: true,
      canCancelOrReopenTask: true,
    });
  });

  it("exports the route workspace as a real component", () => {
    expect(typeof ProcessWorkspace).toBe("function");
  });
});
