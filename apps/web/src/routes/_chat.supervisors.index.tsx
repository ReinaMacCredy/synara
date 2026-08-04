import { type ProjectId, type ThreadId } from "@synara/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

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
import { ensureSupervisorDraft } from "~/hooks/useHandleNewSupervisor";
import { cn } from "~/lib/utils";
import type { SplitViewPanePanelState } from "~/splitViewStore";
import { useStore } from "~/store";

export interface SupervisorIndexSearch {
  readonly projectId?: ProjectId;
}

const DRAFT_PANEL_STATE: SplitViewPanePanelState = {
  panel: null,
  diffTurnId: null,
  diffFilePath: null,
  hasOpenedPanel: false,
  lastOpenPanel: "browser",
};

function SupervisorIndexRouteView() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const projects = useStore((state) => state.projects);
  const supervision = useStore((state) => state.supervision);
  const selectedProject =
    projects.find(
      (project) =>
        project.id === search.projectId &&
        project.kind === "project" &&
        project.cwd.trim().length > 0,
    ) ??
    projects.find((project) => project.kind === "project" && project.cwd.trim().length > 0) ??
    null;
  const defaultProfile = supervision.profiles.find(
    (profile) => profile.archivedAt === null && profile.roleHints.includes("supervisor"),
  );
  const [draftThreadId, setDraftThreadId] = useState<ThreadId | null>(null);

  useEffect(() => {
    if (!selectedProject) {
      setDraftThreadId(null);
      return;
    }
    setDraftThreadId(
      ensureSupervisorDraft({
        project: selectedProject,
        profilePresetId: defaultProfile?.id ?? null,
      }),
    );
  }, [defaultProfile?.id, selectedProject]);

  if (!selectedProject || !draftThreadId) {
    return (
      <RouteInsetSurface>
        <PanelStateMessage>
          Create or select a Project before starting a Supervisor task.
        </PanelStateMessage>
      </RouteInsetSurface>
    );
  }

  return (
    <div className={cn(CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME, CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME)}>
      <RouteInsetSurface>
        <DeferredChatView
          threadId={draftThreadId}
          paneScopeId={`supervisor-draft:${selectedProject.id}`}
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
              void navigate({ to: "/supervisors", search: { projectId } }),
            onResetProject: () => void navigate({ to: "/supervisors", search: {} }),
          }}
          orchestratorMode
        />
      </RouteInsetSurface>
    </div>
  );
}

export const Route = createFileRoute("/_chat/supervisors/")({
  validateSearch: (raw: Record<string, unknown>): SupervisorIndexSearch => ({
    ...(typeof raw.projectId === "string" && raw.projectId.length > 0
      ? { projectId: raw.projectId as ProjectId }
      : {}),
  }),
  component: SupervisorIndexRouteView,
});
