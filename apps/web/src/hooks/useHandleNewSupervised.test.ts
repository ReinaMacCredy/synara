import {
  emptySupervisedRuntimeSnapshot,
  LeadSeatId,
  ProjectId,
  ThreadId,
} from "@synara/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useComposerDraftStore } from "../composerDraftStore";
import { resetComposerDraftStore } from "../composerDraftStoreTestFixtures";
import type { Project } from "../types";
import {
  activateSupervisedRoom,
  ensureSupervisedDraft,
  ensureSupervisedRoom,
} from "./useHandleNewSupervised";

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
      workingDirectory: project.cwd,
    });
    expect(
      useComposerDraftStore.getState().getDraftThreadByProjectId(project.id, "supervised"),
    ).toMatchObject({ threadId: firstThreadId, entryPoint: "supervised" });
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
        dispatchCommand: vi.fn().mockRejectedValue(
          new Error("Orchestration command invariant failed: Room already exists."),
        ),
      },
    });

    await expect(ensureSupervisedRoom({ threadId, projectId })).resolves.toBe(threadId);
    expect(getSupervisedRuntime).toHaveBeenCalledTimes(2);
  });

  it("activates a promoted Room through the governed command bus", async () => {
    const at = "2026-08-07T00:00:00.000Z";
    const projectId = ProjectId.makeUnsafe("project-workspace");
    const threadId = ThreadId.makeUnsafe("room-thread");
    const leadSeatId = LeadSeatId.makeUnsafe("lead-seat");
    const dispatchCommand = vi.fn().mockResolvedValue(undefined);
    nativeApiMocks.readNativeApi.mockReturnValue({
      orchestration: {
        getSupervisedRuntime: vi.fn().mockResolvedValue({
          ...emptySupervisedRuntimeSnapshot(at),
          rooms: [
            {
              id: threadId,
              projectId,
              title: "Lead Room",
              leadSeatId: null,
              status: "draft",
              graphRevision: 0,
              revision: 2,
              createdAt: at,
              updatedAt: at,
            },
          ],
        }),
        dispatchCommand,
      },
    });

    await expect(activateSupervisedRoom({ threadId, projectId, leadSeatId })).resolves.toBe(threadId);
    expect(dispatchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "supervised.room.update",
        aggregateId: threadId,
        expectedRevision: 2,
        idempotencyKey: "room-activate:room-thread:lead-seat:2",
        room: expect.objectContaining({
          leadSeatId,
          status: "active",
        }),
      }),
    );
  });

  it("rebinds a draft Room when the owner selects a different Project before sending", async () => {
    const at = "2026-08-07T00:00:00.000Z";
    const projectId = ProjectId.makeUnsafe("selected-project");
    const threadId = ThreadId.makeUnsafe("room-thread");
    const leadSeatId = LeadSeatId.makeUnsafe("lead-seat");
    const dispatchCommand = vi.fn().mockResolvedValue(undefined);
    nativeApiMocks.readNativeApi.mockReturnValue({
      orchestration: {
        getSupervisedRuntime: vi.fn().mockResolvedValue({
          ...emptySupervisedRuntimeSnapshot(at),
          rooms: [
            {
              id: threadId,
              projectId: ProjectId.makeUnsafe("original-project"),
              title: "Lead Room",
              leadSeatId: null,
              status: "draft",
              graphRevision: 0,
              revision: 1,
              createdAt: at,
              updatedAt: at,
            },
          ],
        }),
        dispatchCommand,
      },
    });

    await expect(activateSupervisedRoom({ threadId, projectId, leadSeatId })).resolves.toBe(threadId);
    expect(dispatchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "supervised.room.update",
        room: expect.objectContaining({
          projectId,
          leadSeatId,
          status: "active",
        }),
      }),
    );
  });

  it("repairs an active Room bound to a stale Lead seat", async () => {
    const at = "2026-08-07T00:00:00.000Z";
    const projectId = ProjectId.makeUnsafe("project-workspace");
    const threadId = ThreadId.makeUnsafe("room-thread");
    const leadSeatId = LeadSeatId.makeUnsafe("lead-current");
    const dispatchCommand = vi.fn().mockResolvedValue(undefined);
    nativeApiMocks.readNativeApi.mockReturnValue({
      orchestration: {
        getSupervisedRuntime: vi.fn().mockResolvedValue({
          ...emptySupervisedRuntimeSnapshot(at),
          rooms: [
            {
              id: threadId,
              projectId,
              title: "Lead Room",
              leadSeatId: LeadSeatId.makeUnsafe("lead-stale"),
              status: "active",
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

    await expect(activateSupervisedRoom({ threadId, projectId, leadSeatId })).resolves.toBe(threadId);
    expect(dispatchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 3,
        room: expect.objectContaining({ leadSeatId, status: "active" }),
      }),
    );
  });

  it("recovers the durable Lead seat after the local draft was reloaded", async () => {
    const at = "2026-08-07T00:00:00.000Z";
    const projectId = ProjectId.makeUnsafe("project-workspace");
    const threadId = ThreadId.makeUnsafe("room-thread");
    const leadSeatId = LeadSeatId.makeUnsafe("lead-durable");
    const dispatchCommand = vi.fn().mockResolvedValue(undefined);
    nativeApiMocks.readNativeApi.mockReturnValue({
      orchestration: {
        getSnapshot: vi.fn().mockResolvedValue({
          supervision: {
            leads: [{ id: leadSeatId, activeThreadId: threadId, status: "active" }],
          },
        }),
        getSupervisedRuntime: vi.fn().mockResolvedValue({
          ...emptySupervisedRuntimeSnapshot(at),
          rooms: [
            {
              id: threadId,
              projectId,
              title: "Lead Room",
              leadSeatId: LeadSeatId.makeUnsafe("room-thread"),
              status: "active",
              graphRevision: 0,
              revision: 4,
              createdAt: at,
              updatedAt: at,
            },
          ],
        }),
        dispatchCommand,
      },
    });

    await expect(activateSupervisedRoom({ threadId, projectId })).resolves.toBe(threadId);
    expect(dispatchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "room-activate:room-thread:lead-durable:4",
        room: expect.objectContaining({ leadSeatId }),
      }),
    );
  });
});
