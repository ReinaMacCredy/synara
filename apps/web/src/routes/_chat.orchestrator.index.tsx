import { type ProjectId, type ThreadId } from "@synara/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import {
  DeferredChatView,
  noopChatSurfaceAction,
} from "~/components/chat/ChatThreadSurfacePrimitives";
import { PanelStateMessage } from "~/components/chat/PanelStateMessage";
import { CHAT_BACKGROUND_CLASS_NAME } from "~/components/chat/composerPickerStyles";
import { ensureOrchestratorDraft } from "~/hooks/useHandleNewOrchestrator";
import type { SplitViewPanePanelState } from "~/splitViewStore";
import { useStore } from "~/store";
import { createAllThreadsSelector } from "~/storeSelectors";

interface OrchestratorIndexSearch {
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
  const realProjects = useMemo(
    () => projects.filter((project) => project.kind === "project" && project.cwd.trim().length > 0),
    [projects],
  );
  const sourceThread = search.sourceThreadId
    ? (threads.find((thread) => thread.id === search.sourceThreadId) ?? null)
    : null;
  const selectedProject =
    realProjects.find((project) => project.id === (sourceThread?.projectId ?? search.projectId)) ??
    realProjects[0] ??
    null;
  const [draftThreadId, setDraftThreadId] = useState<ThreadId | null>(null);

  useEffect(() => {
    if (!selectedProject) {
      setDraftThreadId(null);
      return;
    }
    setDraftThreadId(ensureOrchestratorDraft({ project: selectedProject, sourceThread }));
  }, [selectedProject, sourceThread]);

  if (!selectedProject || !draftThreadId) {
    return (
      <RouteInsetSurface surfaceClassName={CHAT_BACKGROUND_CLASS_NAME}>
        <PanelStateMessage>
          {realProjects.length === 0
            ? "Add a real Project before creating an Orchestrator Root."
            : "Preparing your Orchestrator Root draft…"}
        </PanelStateMessage>
      </RouteInsetSurface>
    );
  }

  return (
    <RouteInsetSurface surfaceClassName={CHAT_BACKGROUND_CLASS_NAME}>
      <DeferredChatView
        threadId={draftThreadId}
        paneScopeId={`orchestrator-draft:${selectedProject.id}`}
        deferMount={false}
        surfaceMode="single"
        isFocusedPane
        panelState={DRAFT_PANEL_STATE}
        onToggleDiff={noopChatSurfaceAction}
        onToggleBrowser={noopChatSurfaceAction}
        onOpenBrowserUrl={noopChatSurfaceAction}
        onOpenTurnDiff={noopChatSurfaceAction}
        orchestratorRootDraft={{
          onSelectProject: (projectId) =>
            void navigate({ to: "/orchestrator", search: { projectId } }),
        }}
      />
    </RouteInsetSurface>
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
