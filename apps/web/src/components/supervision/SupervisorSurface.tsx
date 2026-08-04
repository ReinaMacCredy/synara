import type { SupervisionSnapshot, SupervisorSeatId } from "@synara/contracts";
import { useEffect, useMemo } from "react";

import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import {
  DeferredChatView,
  noopChatSurfaceAction,
} from "~/components/chat/ChatThreadSurfacePrimitives";
import { PanelStateMessage } from "~/components/chat/PanelStateMessage";
import { RightDock } from "~/components/chat/RightDock";
import {
  CHAT_BACKGROUND_CLASS_NAME,
  CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME,
  CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
} from "~/components/chat/composerPickerStyles";
import { activeMissionsForSupervisor } from "~/lib/supervision";
import { cn } from "~/lib/utils";
import { selectRightDockState, useRightDockStore } from "~/rightDockStore";
import { ensurePanesInState, type RightDockPane } from "~/rightDockStore.logic";
import type { SplitViewPanePanelState } from "~/splitViewStore";

import { MissionStrips } from "./MissionStrips";
import { SupervisionPanel } from "./SupervisionPanel";
import { SUPERVISOR_DOCK_PANES, supervisorDockScopeId } from "./supervisorDock";

const PANEL_STATE: SplitViewPanePanelState = {
  panel: null,
  diffTurnId: null,
  diffFilePath: null,
  hasOpenedPanel: false,
  lastOpenPanel: "browser",
};

export function SupervisorSurface(props: {
  readonly snapshot: SupervisionSnapshot;
  readonly supervisorSeatId: SupervisorSeatId;
}) {
  const seat = props.snapshot.supervisors.find(
    (candidate) => candidate.id === props.supervisorSeatId,
  );
  const missions = activeMissionsForSupervisor(props.snapshot, props.supervisorSeatId);
  const dockScopeId = supervisorDockScopeId(props.supervisorSeatId);
  const dockState = useRightDockStore(
    useMemo(() => selectRightDockState(dockScopeId), [dockScopeId]),
  );
  const ensurePanes = useRightDockStore((state) => state.ensurePanes);
  const setActivePane = useRightDockStore((state) => state.setActivePane);
  const setDockOpen = useRightDockStore((state) => state.setDockOpen);

  useEffect(() => {
    ensurePanes(dockScopeId, SUPERVISOR_DOCK_PANES, "supervision");
  }, [dockScopeId, ensurePanes]);

  const displayDockState = useMemo(
    () => ensurePanesInState(dockState, SUPERVISOR_DOCK_PANES, "supervision"),
    [dockState],
  );

  if (!seat) {
    return (
      <RouteInsetSurface>
        <PanelStateMessage>This Supervisor seat is unavailable.</PanelStateMessage>
      </RouteInsetSurface>
    );
  }

  const renderPane = (pane: RightDockPane) =>
    pane.kind === "supervision" ? (
      <SupervisionPanel snapshot={props.snapshot} supervisorSeatId={props.supervisorSeatId} />
    ) : (
      <PanelStateMessage>This panel is unavailable for Supervisor tasks.</PanelStateMessage>
    );

  return (
    <div
      className={cn(CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME, CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME)}
      data-supervisor-seat-id={seat.id}
      data-supervisor-thread-id={seat.activeThreadId}
    >
      <div className="relative flex min-h-0 min-w-0 flex-1">
        <RouteInsetSurface surfaceClassName={CHAT_BACKGROUND_CLASS_NAME}>
          <DeferredChatView
            threadId={seat.activeThreadId}
            paneScopeId={`supervisor:${seat.id}`}
            deferMount={false}
            surfaceMode="single"
            isFocusedPane
            panelState={PANEL_STATE}
            onToggleDiff={noopChatSurfaceAction}
            onToggleBrowser={noopChatSurfaceAction}
            onOpenBrowserUrl={noopChatSurfaceAction}
            onOpenTurnDiff={noopChatSurfaceAction}
            adjacentRightDockOpen={displayDockState.open}
            onAdjacentRightDockOpenChange={(open) => setDockOpen(dockScopeId, open)}
            supervisionMissionStrips={<MissionStrips missions={missions} />}
            orchestratorMode
          />
        </RouteInsetSurface>
      </div>
      <RightDock
        state={displayDockState}
        minWidth={320}
        defaultWidth="max(22rem, 34vw)"
        shouldAcceptWidth={({ nextWidth }) => nextWidth >= 320}
        addMenuKinds={[]}
        motionKey={dockScopeId}
        paneClosable={false}
        collapsible
        onSelectPane={(paneId) => setActivePane(dockScopeId, paneId)}
        onClosePane={noopChatSurfaceAction}
        onCollapse={() => setDockOpen(dockScopeId, false)}
        onOpenChange={(open) => setDockOpen(dockScopeId, open)}
        onAddPane={noopChatSurfaceAction}
        renderPane={renderPane}
      />
    </div>
  );
}
