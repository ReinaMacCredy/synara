import { emptySupervisedRuntimeSnapshot, ProjectId, ThreadId } from "@synara/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useComposerDraftStore } from "../composerDraftStore";
import { resetComposerDraftStore } from "../composerDraftStoreTestFixtures";
import type { Project } from "../types";
import { ensureSupervisedDraft, ensureSupervisedRoom } from "./useHandleNewSupervised";

const nativeApiMocks = vi.hoisted(() => ({
  readNativeApi: vi.fn(),
}));

vi.mock("../nativeApi", () => ({
  readNativeApi: nativeApiMocks.readNativeApi,
}));

function makeProject(kind: Project["kind"]): Project {
  return {
    id: ProjectId.makeUnsafe(`${kind}-workspace`),
    kind,
    name: kind === "chat" ? "Home" : "Project",
    remoteName: kind === "chat" ? "Home" : "Project",
    folderName: kind,
    localName: null,
    cwd: `/tmp/${kind}-workspace`,
    defaultModelSelection: null,
    expanded: true,
    spaceId: null,
    scripts: [],
  };
}

describe("ensureSupervisedDraft", () => {
  beforeEach(() => {
    resetComposerDraftStore();
    nativeApiMocks.readNativeApi.mockReset();
  });

  it("reuses the project Supervised draft", () => {
    const project = makeProject("project");
    const firstThreadId = ensureSupervisedDraft({ project });
    const secondThreadId = ensureSupervisedDraft({ project });
    const draft = useComposerDraftStore.getState().draftThreadsByThreadId[firstThreadId];

    expect(secondThreadId).toBe(firstThreadId);
    expect(draft).toMatchObject({
      projectId: project.id,
      entryPoint: "supervised",
      supervisionMode: "orchestrate",
      workingDirectory: project.cwd,
    });
    expect(
      useComposerDraftStore.getState().getDraftThreadByProjectId(project.id, "supervised"),
    ).toMatchObject({ threadId: firstThreadId, entryPoint: "supervised" });
  });

  it("preserves an explicitly staged direct-Lead handoff draft", () => {
    const project = makeProject("project");
    const threadId = ensureSupervisedDraft({
      project,
      supervisionMode: "supervise",
    });

    ensureSupervisedDraft({ project });

    expect(useComposerDraftStore.getState().draftThreadsByThreadId[threadId]?.supervisionMode).toBe(
      "supervise",
    );
  });

  it("converges when room creation committed before its projection became readable", async () => {
    const at = "2026-08-07T00:00:00.000Z";
    const projectId = ProjectId.makeUnsafe("project-workspace");
    const threadId = ThreadId.makeUnsafe("room-thread");
    const room = {
      id: threadId,
      projectId,
      title: "Lead Room",
      leadSeatId: null,
      status: "draft" as const,
      graphRevision: 0,
      revision: 0,
      createdAt: at,
      updatedAt: at,
    };
    const getSupervisedRuntime = vi
      .fn()
      .mockResolvedValueOnce(emptySupervisedRuntimeSnapshot(at))
      .mockResolvedValueOnce({ ...emptySupervisedRuntimeSnapshot(at), rooms: [room] });
    nativeApiMocks.readNativeApi.mockReturnValue({
      orchestration: {
        getSupervisedRuntime,
        dispatchCommand: vi
          .fn()
          .mockRejectedValue(
            new Error("Orchestration command invariant failed: Room already exists."),
          ),
      },
    });

    await expect(ensureSupervisedRoom({ threadId, projectId })).resolves.toBe(threadId);
    expect(getSupervisedRuntime).toHaveBeenCalledTimes(2);
  });

  it("moves an unassigned draft Room to the Project selected for first send", async () => {
    const at = "2026-08-07T00:00:00.000Z";
    const originalProjectId = ProjectId.makeUnsafe("home-workspace");
    const selectedProjectId = ProjectId.makeUnsafe("selected-workspace");
    const threadId = ThreadId.makeUnsafe("room-thread");
    const dispatchCommand = vi.fn().mockResolvedValue(undefined);
    nativeApiMocks.readNativeApi.mockReturnValue({
      orchestration: {
        getSupervisedRuntime: vi.fn().mockResolvedValue({
          ...emptySupervisedRuntimeSnapshot(at),
          rooms: [
            {
              id: threadId,
              projectId: originalProjectId,
              title: "Lead Room",
              leadSeatId: null,
              status: "draft",
              graphRevision: 0,
              revision: 3,
              createdAt: at,
              updatedAt: at,
            },
          ],
        }),
        dispatchCommand,
      },
    });

    await expect(
      ensureSupervisedRoom({ threadId, projectId: selectedProjectId, title: "Selected Room" }),
    ).resolves.toBe(threadId);
    expect(dispatchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "supervised.room.update",
        aggregateId: threadId,
        expectedRevision: 3,
        room: expect.objectContaining({
          id: threadId,
          projectId: selectedProjectId,
          title: "Selected Room",
          status: "draft",
        }),
      }),
    );
  });

  it("refuses to move a Room after it has left the unassigned draft state", async () => {
    const at = "2026-08-07T00:00:00.000Z";
    const threadId = ThreadId.makeUnsafe("room-thread");
    nativeApiMocks.readNativeApi.mockReturnValue({
      orchestration: {
        getSupervisedRuntime: vi.fn().mockResolvedValue({
          ...emptySupervisedRuntimeSnapshot(at),
          rooms: [
            {
              id: threadId,
              projectId: ProjectId.makeUnsafe("home-workspace"),
              title: "Lead Room",
              leadSeatId: null,
              status: "active",
              graphRevision: 0,
              revision: 3,
              createdAt: at,
              updatedAt: at,
            },
          ],
        }),
        dispatchCommand: vi.fn(),
      },
    });

    await expect(
      ensureSupervisedRoom({
        threadId,
        projectId: ProjectId.makeUnsafe("selected-workspace"),
      }),
    ).rejects.toThrow("The Lead Room belongs to a different Project.");
  });
});
