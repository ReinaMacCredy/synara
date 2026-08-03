import { type ProjectId, type ThreadId } from "@synara/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import {
  DeferredChatView,
  LazyDiffPanel,
  noopChatSurfaceAction,
} from "~/components/chat/ChatThreadSurfacePrimitives";
import { PanelStateMessage } from "~/components/chat/PanelStateMessage";
import { RightDock } from "~/components/chat/RightDock";
import {
  CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME,
  CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
} from "~/components/chat/composerPickerStyles";
import {
  ORCHESTRATOR_DOCK_PANES,
  orchestratorDockScopeId,
} from "~/components/orchestrator/orchestratorDock";
import { ensureOrchestratorDraft } from "~/hooks/useHandleNewOrchestrator";
import { ensureHomeChatProject, isHomeChatContainerProject } from "~/lib/chatProjects";
import { readNativeApi } from "~/nativeApi";
import type { SplitViewPanePanelState } from "~/splitViewStore";
import { useStore } from "~/store";
import { createAllThreadsSelector } from "~/storeSelectors";
import { useWorkspacePathsStore } from "~/workspacePathsStore";
import { selectRightDockState, useRightDockStore } from "~/rightDockStore";
import { ensurePanesInState, type RightDockPane } from "~/rightDockStore.logic";
import { cn } from "~/lib/utils";

export interface OrchestratorIndexSearch {
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

function OrchestratorIndexRouteView() {
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
  const dockScopeId = selectedProject ? orchestratorDockScopeId(selectedProject.id) : null;
  const dockState = useRightDockStore(
    useMemo(
      () => selectRightDockState(dockScopeId ?? ("orchestrator-dock:none" as ThreadId)),
      [dockScopeId],
    ),
  );
  const ensurePanes = useRightDockStore((state) => state.ensurePanes);
  const setActivePane = useRightDockStore((state) => state.setActivePane);
  const setDockOpen = useRightDockStore((state) => state.setDockOpen);
  const updatePane = useRightDockStore((state) => state.updatePane);

  useEffect(() => {
    if (sourceProject || explicitProject || homeProject || !homeDir) {
      return;
    }
    let cancelled = false;
    setPreparationError(null);
    void (async () => {
      const projectId = await ensureHomeChatProject({ homeDir, chatWorkspaceRoot });
      if (!projectId) {
        throw new Error("Unable to prepare the Orchestrator workspace.");
      }
      if (!useStore.getState().projects.some((project) => project.id === projectId)) {
        const api = readNativeApi();
        if (!api) {
          throw new Error("The Synara server is unavailable.");
        }
        useStore.getState().syncServerShellSnapshot(await api.orchestration.getShellSnapshot());
      }
    })().catch((error: unknown) => {
      if (!cancelled) {
        setPreparationError(error instanceof Error ? error.message : String(error));
      }
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
    setDraftThreadId(ensureOrchestratorDraft({ project: selectedProject, sourceThread }));
  }, [selectedProject, sourceThread]);

  useEffect(() => {
    if (!dockScopeId) return;
    ensurePanes(dockScopeId, ORCHESTRATOR_DOCK_PANES, "orchestrator-team");
  }, [dockScopeId, ensurePanes]);

  if (!selectedProject || !draftThreadId) {
    return (
      <RouteInsetSurface>
        <PanelStateMessage>
          {preparationError ?? "Preparing your Orchestrator Root draft…"}
        </PanelStateMessage>
      </RouteInsetSurface>
    );
  }

  const activeDockScopeId = orchestratorDockScopeId(selectedProject.id);
  const displayDockState = ensurePanesInState(
    dockState,
    ORCHESTRATOR_DOCK_PANES,
    "orchestrator-team",
  );
  const openDiffPane = () => {
    setActivePane(activeDockScopeId, "orchestrator-diff");
    setDockOpen(activeDockScopeId, true);
  };
  const renderPane = (pane: RightDockPane) => {
    if (pane.kind === "diff") {
      return (
        <LazyDiffPanel
          mode="sidebar"
          threadId={draftThreadId}
          hideHeader
          liveRefreshEnabled
          panelState={{
            panel: "diff",
            diffTurnId: pane.diffTurnId,
            diffFilePath: pane.diffFilePath,
          }}
          onUpdatePanelState={(patch) =>
            updatePane(activeDockScopeId, pane.id, {
              ...(patch.diffTurnId !== undefined ? { diffTurnId: patch.diffTurnId } : {}),
              ...(patch.diffFilePath !== undefined ? { diffFilePath: patch.diffFilePath } : {}),
            })
          }
        />
      );
    }
    const label =
      pane.kind === "orchestratorTeam"
        ? "Team becomes available after this draft is sent."
        : pane.kind === "orchestratorProcess"
          ? "No task plan is attached to this draft."
          : "No collaboration or Council runs exist for this draft.";
    return <PanelStateMessage>{label}</PanelStateMessage>;
  };

  return (
    <div className={cn(CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME, CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME)}>
      <div className="relative flex min-h-0 min-w-0 flex-1">
        <RouteInsetSurface>
          <DeferredChatView
            threadId={draftThreadId}
            paneScopeId={`orchestrator-draft:${selectedProject.id}`}
            deferMount={false}
            surfaceMode="single"
            isFocusedPane
            panelState={DRAFT_PANEL_STATE}
            onToggleDiff={openDiffPane}
            onToggleBrowser={noopChatSurfaceAction}
            onOpenBrowserUrl={noopChatSurfaceAction}
            onOpenTurnDiff={noopChatSurfaceAction}
            adjacentRightDockOpen={displayDockState.open}
            onAdjacentRightDockOpenChange={(open) => setDockOpen(activeDockScopeId, open)}
            orchestratorMode
            orchestratorRootDraft={{
              onSelectProject: (projectId) =>
                void navigate({ to: "/orchestrator", search: { projectId } }),
              onResetProject: () => void navigate({ to: "/orchestrator", search: {} }),
            }}
          />
        </RouteInsetSurface>
      </div>
      <RightDock
        state={displayDockState}
        minWidth={320}
        defaultWidth="max(22rem, 42vw)"
        shouldAcceptWidth={({ nextWidth }) => nextWidth >= 320}
        addMenuKinds={[]}
        motionKey={activeDockScopeId}
        paneClosable={false}
        collapsible={false}
        onSelectPane={(paneId) => setActivePane(activeDockScopeId, paneId)}
        onClosePane={noopChatSurfaceAction}
        onCollapse={() => setDockOpen(activeDockScopeId, false)}
        onOpenChange={(open) => setDockOpen(activeDockScopeId, open)}
        onAddPane={noopChatSurfaceAction}
        renderPane={renderPane}
      />
    </div>
  );
}

export const Route = createFileRoute("/_chat/orchestrator/")({
  validateSearch: (raw: Record<string, unknown>): OrchestratorIndexSearch => ({
    ...(typeof raw.projectId === "string" && raw.projectId.length > 0
      ? { projectId: raw.projectId as ProjectId }
      : {}),
    ...(typeof raw.sourceThreadId === "string" && raw.sourceThreadId.length > 0
      ? { sourceThreadId: raw.sourceThreadId as ThreadId }
      : {}),
  }),
  component: OrchestratorIndexRouteView,
});
