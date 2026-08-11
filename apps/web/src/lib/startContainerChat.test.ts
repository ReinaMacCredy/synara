import { ProjectId, ThreadId } from "@veylen/contracts";
import { describe, expect, it, vi } from "vitest";

import { startContainerChat } from "./startContainerChat";

describe("startContainerChat", () => {
  it("returns the created thread so callers can attach context deterministically", async () => {
    const projectId = ProjectId.makeUnsafe("project-1");
    const threadId = ThreadId.makeUnsafe("thread-1");
    const handleNewThread = vi.fn(async () => threadId);

    await expect(
      startContainerChat({
        ensureProjectId: async () => projectId,
        handleNewThread,
        fresh: true,
        errorLabel: "failed",
      }),
    ).resolves.toEqual({ ok: true, threadId });

    expect(handleNewThread).toHaveBeenCalledWith(projectId, {
      fresh: true,
      envMode: "local",
      branch: null,
      worktreePath: null,
    });
  });

  it("forces a container draft into the local workspace", async () => {
    const projectId = ProjectId.makeUnsafe("chat-project");
    const threadId = ThreadId.makeUnsafe("chat-thread");
    const handleNewThread = vi.fn(async () => threadId);

    await startContainerChat({
      ensureProjectId: async () => projectId,
      handleNewThread,
      forceLocalWorkspace: true,
      errorLabel: "failed",
    });

    expect(handleNewThread).toHaveBeenCalledWith(projectId, {
      envMode: "local",
      branch: null,
      worktreePath: null,
    });
  });
});
