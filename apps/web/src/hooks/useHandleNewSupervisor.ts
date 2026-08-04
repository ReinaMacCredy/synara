import type { ProfilePresetId } from "@synara/contracts";

import { useComposerDraftStore } from "../composerDraftStore";
import { newThreadId } from "../lib/utils";
import type { Project } from "../types";

export function ensureSupervisorDraft(input: {
  readonly project: Project;
  readonly profilePresetId?: ProfilePresetId | null;
}) {
  if (
    (input.project.kind !== "project" && input.project.kind !== "chat") ||
    input.project.cwd.trim().length === 0
  ) {
    throw new Error("A Supervisor task requires an active workspace container.");
  }

  const drafts = useComposerDraftStore.getState();
  const existing = drafts.getDraftThreadByProjectId(input.project.id, "supervisor");
  if (existing) {
    if (input.profilePresetId && existing.profilePresetId === null) {
      drafts.setDraftThreadContext(existing.threadId, {
        profilePresetId: input.profilePresetId,
      });
    }
    return existing.threadId;
  }

  const threadId = newThreadId();
  drafts.setProjectDraftThreadId(input.project.id, threadId, {
    entryPoint: "supervisor",
    supervisionMode: "supervise",
    envMode: "local",
    branch: null,
    worktreePath: null,
    workingDirectory: input.project.cwd,
    profilePresetId: input.profilePresetId ?? null,
  });
  return threadId;
}
