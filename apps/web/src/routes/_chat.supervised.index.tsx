import { type ProjectId, type ThreadId } from "@synara/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import {
  DeferredChatView,
  noopChatSurfaceAction,
} from "~/components/chat/ChatThreadSurfacePrimitives";
import { PanelStateMessage } from "~/components/chat/PanelStateMessage";
import {
  CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME,
  CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
} from "~/components/chat/composerPickerStyles";
import {
  ensureSupervisedDraft,
  ensureSupervisedRoom,
} from "~/hooks/useHandleNewSupervised";
import { ensureHomeChatProject, isHomeChatContainerProject } from "~/lib/chatProjects";
import { readNativeApi } from "~/nativeApi";
import type { SplitViewPanePanelState } from "~/splitViewStore";
import { useStore } from "~/store";
import { createAllThreadsSelector } from "~/storeSelectors";
import { useWorkspacePathsStore } from "~/workspacePathsStore";
import { cn } from "~/lib/utils";

export interface SupervisedIndexSearch {
  readonly projectId?: ProjectId;
  readonly sourceThreadId?: ThreadId;
}

const DRAFT_PANEL_STATE: SplitViewPanePanelState = {
  panel: null,
  diffTurnId: null,
  diffFilePath: null,
  hasOpenedPanel: false,
  lastOpenPanel: "browser",
};

function SupervisedIndexRouteView() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const projects = useStore((store) => store.projects);
  const threads = useStore(useMemo(() => createAllThreadsSelector(), []));
  const homeDir = useWorkspacePathsStore((state) => state.homeDir);
  const chatWorkspaceRoot = useWorkspacePathsStore((state) => state.chatWorkspaceRoot);
  const [preparationError, setPreparationError] = useState<string | null>(null);
  const realProjects = useMemo(
    () => projects.filter((project) => project.kind === "project" && project.cwd.trim().length > 0),
    [projects],
  );
  const sourceThread = search.sourceThreadId
    ? (threads.find((thread) => thread.id === search.sourceThreadId) ?? null)
    : null;
  const sourceProject = sourceThread
    ? (projects.find((project) => project.id === sourceThread.projectId) ?? null)
    : null;
  const explicitProject = search.projectId
    ? (realProjects.find((project) => project.id === search.projectId) ?? null)
    : null;
  const homeProject =
    projects.find((project) =>
      isHomeChatContainerProject(project, { homeDir, chatWorkspaceRoot }),
    ) ?? null;
  const selectedProject = sourceProject ?? explicitProject ?? homeProject;
  const [draftThreadId, setDraftThreadId] = useState<ThreadId | null>(null);

  useEffect(() => {
    if (sourceProject || explicitProject || homeProject || !homeDir) return;
    let cancelled = false;
    setPreparationError(null);
    void (async () => {
      const projectId = await ensureHomeChatProject({ homeDir, chatWorkspaceRoot });
      if (!projectId) throw new Error("Unable to prepare the Supervised workspace.");
      if (!useStore.getState().projects.some((project) => project.id === projectId)) {
        const api = readNativeApi();
        if (!api) throw new Error("The Synara server is unavailable.");
        useStore.getState().syncServerShellSnapshot(await api.orchestration.getShellSnapshot());
      }
    })().catch((error: unknown) => {
      if (!cancelled) setPreparationError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
    };
  }, [chatWorkspaceRoot, explicitProject, homeDir, homeProject, sourceProject]);

  useEffect(() => {
    if (!selectedProject) {
      setDraftThreadId(null);
      return;
    }
    let cancelled = false;
    setPreparationError(null);
    void (async () => {
      const threadId = ensureSupervisedDraft({ project: selectedProject, sourceThread });
      await ensureSupervisedRoom({ threadId, projectId: selectedProject.id });
      if (!cancelled) setDraftThreadId(threadId);
    })().catch((error: unknown) => {
      if (!cancelled) {
        setDraftThreadId(null);
        setPreparationError(error instanceof Error ? error.message : String(error));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedProject, sourceThread]);

  if (!selectedProject || !draftThreadId) {
    return (
      <RouteInsetSurface>
        <PanelStateMessage>{preparationError ?? "Preparing a Lead Room draft…"}</PanelStateMessage>
      </RouteInsetSurface>
    );
  }

  return (
    <div className={cn(CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME, CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME)}>
      <RouteInsetSurface>
        <DeferredChatView
          threadId={draftThreadId}
          paneScopeId={`supervised-draft:${selectedProject.id}`}
          deferMount={false}
          surfaceMode="single"
          isFocusedPane
          panelState={DRAFT_PANEL_STATE}
          supervisedMode
          onToggleDiff={noopChatSurfaceAction}
          onToggleBrowser={noopChatSurfaceAction}
          onOpenBrowserUrl={noopChatSurfaceAction}
          onOpenTurnDiff={noopChatSurfaceAction}
          viewModeAction={{
            label: "Room view",
            active: false,
            onClick: () =>
              void navigate({
                to: "/supervised/$roomId",
                params: { roomId: draftThreadId },
                search: { projectId: selectedProject.id },
              }),
          }}
        />
      </RouteInsetSurface>
    </div>
  );
}

export const Route = createFileRoute("/_chat/supervised/")({
  validateSearch: (raw: Record<string, unknown>): SupervisedIndexSearch => ({
    ...(typeof raw.projectId === "string" && raw.projectId.length > 0
      ? { projectId: raw.projectId as ProjectId }
      : {}),
    ...(typeof raw.sourceThreadId === "string" && raw.sourceThreadId.length > 0
      ? { sourceThreadId: raw.sourceThreadId as ThreadId }
      : {}),
  }),
  component: SupervisedIndexRouteView,
});
