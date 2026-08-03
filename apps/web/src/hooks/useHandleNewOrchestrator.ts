import { useComposerDraftStore } from "../composerDraftStore";
import { buildThreadHandoffImportedMessages } from "../lib/threadHandoff";
import { newThreadId } from "../lib/utils";
import type { Project, Thread } from "../types";

const ORCHESTRATOR_HANDOFF_MESSAGE_LIMIT = 24;

export interface EnsureOrchestratorDraftInput {
  readonly project: Project;
  readonly sourceThread?: Thread | null;
}

export function buildOrchestratorHandoffMessages(thread: Thread) {
  return buildThreadHandoffImportedMessages(thread).slice(-ORCHESTRATOR_HANDOFF_MESSAGE_LIMIT);
}

export function ensureOrchestratorDraft(input: EnsureOrchestratorDraftInput) {
  if (
    (input.project.kind !== "project" && input.project.kind !== "chat") ||
    input.project.cwd.trim().length === 0
  ) {
    throw new Error("An Orchestrator Root requires an active workspace container.");
  }
  if (input.sourceThread && input.sourceThread.projectId !== input.project.id) {
    throw new Error("A curated handoff must stay in the source thread's Project.");
  }

  const drafts = useComposerDraftStore.getState();
  const stagedHandoff = input.sourceThread
    ? {
        sourceThreadId: input.sourceThread.id,
        messages: buildOrchestratorHandoffMessages(input.sourceThread),
      }
    : null;
  const existing = drafts.getDraftThreadByProjectId(input.project.id, "orchestrator");
  if (existing) {
    if (stagedHandoff) {
      drafts.setDraftThreadContext(existing.threadId, {
        orchestratorSourceThreadId: stagedHandoff.sourceThreadId,
        orchestratorHandoffMessages: stagedHandoff.messages,
      });
    }
    return existing.threadId;
  }

  const threadId = newThreadId();
  drafts.setProjectDraftThreadId(input.project.id, threadId, {
    entryPoint: "orchestrator",
    envMode: "local",
    branch: null,
    worktreePath: null,
    workingDirectory: input.project.cwd,
    ...(stagedHandoff
      ? {
          orchestratorSourceThreadId: stagedHandoff.sourceThreadId,
          orchestratorHandoffMessages: stagedHandoff.messages,
        }
      : {}),
  });
  if (input.sourceThread) {
    drafts.setModelSelection(threadId, input.sourceThread.modelSelection);
    drafts.setRuntimeMode(threadId, input.sourceThread.runtimeMode);
  }
  return threadId;
}
