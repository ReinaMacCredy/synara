import {
  CommandId,
  RoomId,
  type ProjectId,
  type ThreadId,
} from "@synara/contracts";

import { useComposerDraftStore } from "../composerDraftStore";
import { buildThreadHandoffImportedMessages } from "../lib/threadHandoff";
import { newThreadId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import type { Project, Thread } from "../types";

const SUPERVISED_HANDOFF_MESSAGE_LIMIT = 24;

export interface EnsureSupervisedDraftInput {
  readonly project: Project;
  readonly sourceThread?: Thread | null;
}

export function ensureSupervisedDraft(input: EnsureSupervisedDraftInput): ThreadId {
  if (
    (input.project.kind !== "project" && input.project.kind !== "chat") ||
    input.project.cwd.trim().length === 0
  ) {
    throw new Error("A Lead Room requires an active workspace container.");
  }
  if (input.sourceThread && input.sourceThread.projectId !== input.project.id) {
    throw new Error("A curated handoff must stay in the source thread's Project.");
  }

  const drafts = useComposerDraftStore.getState();
  const stagedHandoff = input.sourceThread
    ? {
        sourceThreadId: input.sourceThread.id,
        messages: buildThreadHandoffImportedMessages(input.sourceThread).slice(
          -SUPERVISED_HANDOFF_MESSAGE_LIMIT,
        ),
      }
    : null;
  const existing = drafts.getDraftThreadByProjectId(input.project.id, "supervised");
  if (existing) {
    drafts.setDraftThreadContext(existing.threadId, {
      supervisionMode: "supervise",
      ...(stagedHandoff
        ? {
            supervisedSourceThreadId: stagedHandoff.sourceThreadId,
            supervisedHandoffMessages: stagedHandoff.messages,
          }
        : {}),
    });
    return existing.threadId;
  }

  const threadId = newThreadId();
  drafts.setProjectDraftThreadId(input.project.id, threadId, {
    entryPoint: "supervised",
    supervisionMode: "supervise",
    envMode: "local",
    branch: null,
    worktreePath: null,
    workingDirectory: input.project.cwd,
    ...(stagedHandoff
      ? {
          supervisedSourceThreadId: stagedHandoff.sourceThreadId,
          supervisedHandoffMessages: stagedHandoff.messages,
        }
      : {}),
  });
  if (input.sourceThread) {
    drafts.setModelSelection(threadId, input.sourceThread.modelSelection);
    drafts.setRuntimeMode(threadId, input.sourceThread.runtimeMode);
  }
  return threadId;
}

export async function ensureSupervisedRoom(input: {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly title?: string;
}): Promise<RoomId> {
  const api = readNativeApi();
  if (!api) throw new Error("The Synara server is unavailable.");
  const roomId = RoomId.makeUnsafe(input.threadId);
  const readExisting = async () => {
    const snapshot = await api.orchestration.getSupervisedRuntime({
      includeDisabled: true,
      limit: 500,
    });
    return snapshot.rooms.find((room) => room.id === roomId) ?? null;
  };
  const existing = await readExisting();
  if (existing) {
    if (existing.projectId === input.projectId) {
      return roomId;
    }
    if (existing.status !== "draft" || existing.leadSeatId !== null) {
      throw new Error("The Lead Room belongs to a different Project.");
    }
    const updatedAt = new Date().toISOString();
    await api.orchestration.dispatchCommand({
      type: "supervised.room.update",
      commandId: CommandId.makeUnsafe(crypto.randomUUID()),
      actor: { kind: "user", actorId: "owner" },
      aggregateId: roomId,
      expectedRevision: existing.revision,
      idempotencyKey: `room-project:${roomId}:${input.projectId}:${existing.revision}`,
      createdAt: updatedAt,
      room: {
        ...existing,
        projectId: input.projectId,
        title: input.title?.trim() || existing.title,
        updatedAt,
      },
    });
    return roomId;
  }

  const createdAt = new Date().toISOString();
  try {
    await api.orchestration.dispatchCommand({
      type: "supervised.room.create",
      commandId: CommandId.makeUnsafe(crypto.randomUUID()),
      actor: { kind: "user", actorId: "owner" },
      aggregateId: roomId,
      expectedRevision: 0,
      idempotencyKey: `room-create:${roomId}`,
      createdAt,
      room: {
        id: roomId,
        projectId: input.projectId,
        title: input.title?.trim() || "Lead Room",
        leadSeatId: null,
        status: "draft",
        graphRevision: 0,
        revision: 0,
        createdAt,
        updatedAt: createdAt,
      },
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (!detail.includes("Room already exists")) throw cause;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const projected = await readExisting();
      if (projected) {
        if (projected.projectId !== input.projectId) {
          throw new Error("The Lead Room belongs to a different Project.");
        }
        return roomId;
      }
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
    throw new Error("The Lead Room was committed but its projection has not caught up yet.");
  }
  return roomId;
}
