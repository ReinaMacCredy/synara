import {
  type HandoffConversationMode,
  type HandoffDraftV1,
  type HandoffPreparationSnapshot,
  type HandoffRuntimeSelection,
  type ProjectId,
  type ThreadId,
} from "@synara/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useComposerDraftStore } from "../composerDraftStore";
import { ensureSupervisedDraft, ensureSupervisedRoom } from "./useHandleNewSupervised";
import { newThreadId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import type { Project, Thread } from "../types";

export const preparationToDraft = (
  snapshot: HandoffPreparationSnapshot,
  destinationMode: HandoffConversationMode,
): HandoffDraftV1 => ({
  schemaVersion: 1,
  handoffId: snapshot.handoffId,
  sourceThreadId: snapshot.capsule.sourceThreadId,
  sourceTitle: snapshot.capsule.sourceTitle,
  sourceMode: snapshot.capsule.sourceMode,
  destinationMode,
  sourceProvider: snapshot.capsule.sourceProvider,
  sourceCursor: snapshot.capsule.sourceCursor,
  sourceDigest: snapshot.capsule.sourceDigest,
  capsule: snapshot.capsule,
  handoffPrompt: snapshot.handoffPrompt,
  attemptId: snapshot.attemptId,
  preparationState: snapshot.state,
  preparationPhase: snapshot.phase,
  preparationProgressPercent: snapshot.progressPercent,
  runtime: snapshot.runtime,
  settingsRevision: snapshot.settingsRevision,
  packet: snapshot.packet,
  error: snapshot.error,
  sourceLinkOnly: false,
  stagedAt: snapshot.startedAt,
  updatedAt: snapshot.updatedAt,
});

export function applyHandoffPreparationIfActive(
  destinationThreadId: ThreadId,
  destinationMode: HandoffConversationMode,
  snapshot: HandoffPreparationSnapshot,
): boolean {
  const store = useComposerDraftStore.getState();
  const current = store.draftsByThreadId[destinationThreadId]?.handoffDraft;
  if (
    !current ||
    current.attemptId !== snapshot.attemptId ||
    current.preparationState !== "preparing"
  ) {
    return false;
  }
  store.setHandoffDraft(destinationThreadId, preparationToDraft(snapshot, destinationMode));
  return true;
}

export async function followHandoffPreparation(
  destinationThreadId: ThreadId,
  destinationMode: HandoffConversationMode,
  initial: HandoffPreparationSnapshot,
) {
  const api = readNativeApi();
  if (!api) return;
  let current = initial;
  while (current.state === "preparing") {
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    const active =
      useComposerDraftStore.getState().draftsByThreadId[destinationThreadId]?.handoffDraft;
    if (
      !active ||
      active.attemptId !== initial.attemptId ||
      active.preparationState !== "preparing"
    ) {
      return;
    }
    current = await api.orchestration.getHandoffPreparation({ attemptId: initial.attemptId });
    if (!applyHandoffPreparationIfActive(destinationThreadId, destinationMode, current)) return;
  }
}

export function useCrossModeHandoff(input: {
  readonly sourceThread: Thread | null | undefined;
  readonly sourceProject: Project | null | undefined;
  readonly sourceMode: HandoffConversationMode;
}) {
  const navigate = useNavigate();

  return async (handoffPrompt: string, runtime: HandoffRuntimeSelection) => {
    const sourceThread = input.sourceThread;
    const sourceProject = input.sourceProject;
    if (!sourceThread || !sourceProject) {
      throw new Error("The source thread and Project must be available before handoff.");
    }
    const api = readNativeApi();
    if (!api) throw new Error("Synara server is unavailable.");
    const destinationMode: HandoffConversationMode =
      input.sourceMode === "project" ? "supervised" : "project";
    const store = useComposerDraftStore.getState();
      let destinationThreadId: ThreadId;
      if (destinationMode === "supervised") {
        destinationThreadId = ensureSupervisedDraft({ project: sourceProject });
        await ensureSupervisedRoom({
          threadId: destinationThreadId,
          projectId: sourceProject.id,
        });
    } else {
      destinationThreadId = newThreadId();
      store.registerDraftThread(destinationThreadId, {
        projectId: sourceProject.id as ProjectId,
        entryPoint: "chat",
        envMode: sourceThread.envMode ?? "local",
        branch: sourceThread.branch,
        worktreePath: sourceThread.worktreePath,
        workingDirectory: sourceThread.workingDirectory ?? null,
        runtimeMode: sourceThread.runtimeMode,
        interactionMode: sourceThread.interactionMode,
      });
      store.setModelSelection(destinationThreadId, sourceThread.modelSelection);
    }
    const existingPacket =
      useComposerDraftStore.getState().draftsByThreadId[destinationThreadId]?.handoffDraft;
    if (existingPacket) {
      throw new Error(
        `This destination draft already has a handoff from “${existingPacket.sourceTitle}”. Detach it before starting another handoff.`,
      );
    }
    if (destinationMode === "supervised") {
      await navigate({ to: "/supervised", search: { projectId: sourceProject.id } });
    } else {
      await navigate({ to: "/$threadId", params: { threadId: destinationThreadId } });
    }
    const initial = await api.orchestration.startHandoffPreparation({
      sourceThreadId: sourceThread.id,
      destinationDraftThreadId: destinationThreadId,
      destinationMode,
      handoffPrompt,
      runtime,
    });
    store.setHandoffDraft(destinationThreadId, preparationToDraft(initial, destinationMode));
    void followHandoffPreparation(destinationThreadId, destinationMode, initial).catch(
      (error: unknown) => {
        const draft =
          useComposerDraftStore.getState().draftsByThreadId[destinationThreadId]?.handoffDraft;
        if (
          !draft ||
          draft.attemptId !== initial.attemptId ||
          draft.preparationState !== "preparing"
        )
          return;
        useComposerDraftStore.getState().setHandoffDraft(destinationThreadId, {
          ...draft,
          preparationState: "failed",
          preparationPhase: "Preparation connection failed",
          error: error instanceof Error ? error.message : String(error),
          updatedAt: new Date().toISOString(),
        });
      },
    );
    return destinationThreadId;
  };
}
