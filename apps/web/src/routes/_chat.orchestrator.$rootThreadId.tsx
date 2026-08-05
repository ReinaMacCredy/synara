import { ThreadId } from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { RouteInsetSurface } from "../components/RouteInsetSurface";
import {
  DeferredChatView,
  noopChatSurfaceAction,
} from "../components/chat/ChatThreadSurfacePrimitives";
import { PanelStateMessage } from "../components/chat/PanelStateMessage";
import {
  CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME,
  CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
} from "../components/chat/composerPickerStyles";
import { OrchestratorSurface } from "../components/orchestrator/OrchestratorSurface";
import { orchestratorRootQueryOptions } from "../lib/orchestratorRoots";
import { useStore } from "../store";
import { createThreadSelector } from "../storeSelectors";
import { cn } from "../lib/utils";
import { resolveOrchestratorRootRouteState } from "./-orchestratorRootRouteState";
import type { SplitViewPanePanelState } from "../splitViewStore";

export interface OrchestratorRootSearch {
  readonly selectedThreadId?: string;
}

const ORCHESTRATOR_LOADING_PANEL_STATE: SplitViewPanePanelState = {
  panel: null,
  diffTurnId: null,
  diffFilePath: null,
  hasOpenedPanel: false,
  lastOpenPanel: "browser",
};

function OrchestratorRootRouteView() {
  const navigate = useNavigate();
  const rootThreadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.rootThreadId),
  });
  const search = Route.useSearch();
  const rootQuery = useQuery(orchestratorRootQueryOptions(rootThreadId));
  const routeState = resolveOrchestratorRootRouteState(rootQuery);
  // First-send navigates here from the draft route. Prefer the live transcript
  // over a blank "Loading…" shell so Working/Thinking never disappear mid-turn.
  const promotedThread = useStore(useMemo(() => createThreadSelector(rootThreadId), [rootThreadId]));

  if (routeState.kind === "loading") {
    if (promotedThread) {
      return (
        <div
          className={cn(CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME, CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME)}
          data-orchestrator-root-loading={rootThreadId}
        >
          <RouteInsetSurface>
            <DeferredChatView
              threadId={rootThreadId}
              paneScopeId={`orchestrator:${rootThreadId}`}
              deferMount={false}
              surfaceMode="single"
              isFocusedPane
              panelState={ORCHESTRATOR_LOADING_PANEL_STATE}
              onToggleDiff={noopChatSurfaceAction}
              onToggleBrowser={noopChatSurfaceAction}
              onOpenBrowserUrl={noopChatSurfaceAction}
              onOpenTurnDiff={noopChatSurfaceAction}
              orchestratorMode
            />
          </RouteInsetSurface>
        </div>
      );
    }
    return (
      <RouteInsetSurface>
        <PanelStateMessage>Loading Orchestrator Root…</PanelStateMessage>
      </RouteInsetSurface>
    );
  }
  if (routeState.kind === "fatal") {
    return (
      <RouteInsetSurface>
        <PanelStateMessage className="text-destructive">
          Unable to load this Orchestrator Root.
        </PanelStateMessage>
      </RouteInsetSurface>
    );
  }
  const rootResult = routeState.result;
  const selectedThreadId =
    search.selectedThreadId &&
    rootResult.snapshot.ownershipEdges.some(
      (edge) => edge.childThreadId === search.selectedThreadId,
    )
      ? ThreadId.makeUnsafe(search.selectedThreadId)
      : rootThreadId;
  const selectThread = (threadId: ThreadId) => {
    void navigate({
      to: "/orchestrator/$rootThreadId",
      params: { rootThreadId },
      search: threadId === rootThreadId ? {} : { selectedThreadId: threadId },
      replace: true,
    });
  };
  return (
    <OrchestratorSurface
      snapshot={rootResult.snapshot}
      projectionBehind={routeState.projectionBehind}
      selectedThreadId={selectedThreadId}
      onSelectThread={selectThread}
    />
  );
}

export const Route = createFileRoute("/_chat/orchestrator/$rootThreadId")({
  component: OrchestratorRootRouteView,
  validateSearch: (raw: Record<string, unknown>): OrchestratorRootSearch =>
    typeof raw.selectedThreadId === "string" && raw.selectedThreadId.trim()
      ? { selectedThreadId: raw.selectedThreadId }
      : {},
});
