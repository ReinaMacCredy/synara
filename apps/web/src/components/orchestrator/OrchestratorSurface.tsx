import type { OrchestratorSnapshot, ProjectTaskId, ThreadId } from "@synara/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

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
import type { SplitViewPanePanelState } from "~/splitViewStore";
import {
  orchestratorArtifactsQueryOptions,
  orchestratorAuditQueryOptions,
  orchestratorExchangesQueryOptions,
} from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { selectRightDockState, useRightDockStore } from "~/rightDockStore";
import { ensurePanesInState, type OpenPaneInput, type RightDockPane } from "~/rightDockStore.logic";
import { useStore } from "~/store";
import { createAllThreadsSelector } from "~/storeSelectors";
import { cn } from "~/lib/utils";
import { orchestratorQueryKeys } from "~/lib/orchestratorRoots";
import { useTaskProcessStore } from "~/taskProcessStore";

import { ExchangesPanel } from "./ExchangesPanel";
import { OrchestratorTranscriptProvider } from "./OrchestratorThreadMessageRow";
import { RunsPanel } from "./RunsPanel";
import { TeamPanel } from "./TeamPanel";
import { RightDockProcessPanel } from "./RightDockProcessPanel";

const ORCHESTRATOR_DOCK_PANES = [
  { paneId: "orchestrator-team", kind: "orchestratorTeam" },
  { paneId: "orchestrator-process", kind: "orchestratorProcess" },
  { paneId: "orchestrator-exchanges", kind: "orchestratorExchanges" },
  { paneId: "orchestrator-runs", kind: "orchestratorRuns" },
] as const satisfies readonly OpenPaneInput[];

const ORCHESTRATOR_PANEL_STATE: SplitViewPanePanelState = {
  panel: null,
  diffTurnId: null,
  diffFilePath: null,
  hasOpenedPanel: false,
  lastOpenPanel: "browser",
};

function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : error ? String(error) : null;
}

export function OrchestratorSurface(props: {
  readonly snapshot: OrchestratorSnapshot;
  readonly projectionBehind: boolean;
  readonly selectedThreadId: ThreadId;
  readonly onSelectThread: (threadId: ThreadId) => void;
}) {
  const rootThreadId = props.snapshot.root.rootThreadId;
  const navigate = useNavigate();
  const selectProcessTask = useTaskProcessStore((state) => state.selectTask);
  const queryClient = useQueryClient();
  const threads = useStore(useMemo(() => createAllThreadsSelector(), []));
  const dockState = useRightDockStore(
    useMemo(() => selectRightDockState(rootThreadId), [rootThreadId]),
  );
  const ensurePanes = useRightDockStore((store) => store.ensurePanes);
  const setActivePane = useRightDockStore((store) => store.setActivePane);
  const setDockOpen = useRightDockStore((store) => store.setDockOpen);
  const [detachPendingThreadId, setDetachPendingThreadId] = useState<ThreadId | null>(null);
  const exchangesQuery = useQuery(orchestratorExchangesQueryOptions(rootThreadId));
  const artifactsQuery = useQuery(orchestratorArtifactsQueryOptions(rootThreadId));
  const auditQuery = useQuery(orchestratorAuditQueryOptions(rootThreadId));
  const exchanges = exchangesQuery.data?.items ?? [];
  const artifacts = artifactsQuery.data?.items ?? [];
  const displayDockState = useMemo(
    () => ensurePanesInState(dockState, ORCHESTRATOR_DOCK_PANES, "orchestrator-team"),
    [dockState],
  );
  const threadLabels = useMemo(() => {
    const labels = new Map<ThreadId, string>(
      threads.map((thread) => [thread.id, thread.title] as const),
    );
    if (!labels.has(rootThreadId)) labels.set(rootThreadId, "Root");
    for (const edge of props.snapshot.ownershipEdges) {
      if (!labels.has(edge.childThreadId)) labels.set(edge.childThreadId, edge.childThreadId);
    }
    return labels;
  }, [props.snapshot.ownershipEdges, rootThreadId, threads]);
  const exchangesByMessageId = useMemo(
    () =>
      new Map(
        (exchangesQuery.data?.items ?? []).map(
          (exchange) => [exchange.messageId, exchange] as const,
        ),
      ),
    [exchangesQuery.data?.items],
  );
  const transcriptContext = useMemo(
    () => ({ exchangesByMessageId, threadLabels, onOpenThread: props.onSelectThread }),
    [exchangesByMessageId, props.onSelectThread, threadLabels],
  );
  const selectedThreadExists = threads.some((thread) => thread.id === props.selectedThreadId);

  useEffect(() => {
    ensurePanes(rootThreadId, ORCHESTRATOR_DOCK_PANES, "orchestrator-team");
  }, [ensurePanes, rootThreadId]);

  const openProcessPane = useCallback(() => {
    setActivePane(rootThreadId, "orchestrator-process");
    setDockOpen(rootThreadId, true);
  }, [rootThreadId, setActivePane, setDockOpen]);

  const detachChild = async (childThreadId: ThreadId) => {
    if (detachPendingThreadId) return;
    setDetachPendingThreadId(childThreadId);
    try {
      const api = ensureNativeApi();
      await api.orchestration.detachOrchestratorChild({
        rootThreadId,
        childThreadId,
        expectedRevision: props.snapshot.root.revision,
        reason: "Detached by the user from Orchestrator Team",
      });
      if (props.selectedThreadId === childThreadId) props.onSelectThread(rootThreadId);
      await queryClient.invalidateQueries({ queryKey: orchestratorQueryKeys.root(rootThreadId) });
    } finally {
      setDetachPendingThreadId(null);
    }
  };

  const renderPane = (pane: RightDockPane) => {
    switch (pane.kind) {
      case "orchestratorTeam":
        return (
          <TeamPanel
            snapshot={props.snapshot}
            threads={threads}
            selectedThreadId={props.selectedThreadId}
            threadLabels={threadLabels}
            onSelectThread={props.onSelectThread}
            onDetachChild={detachChild}
            detachPendingThreadId={detachPendingThreadId}
          />
        );
      case "orchestratorProcess":
        return (
          <RightDockProcessPanel
            rootThreadId={rootThreadId}
            summary={props.snapshot.activeProcess}
            onOpenTask={(taskId: ProjectTaskId) => {
              const processId = props.snapshot.activeProcess?.process.id;
              if (!processId) return;
              selectProcessTask(processId, taskId);
              void navigate({ to: "/process/$processId", params: { processId } });
            }}
            onOpenProcess={(processId) =>
              void navigate({ to: "/process/$processId", params: { processId } })
            }
          />
        );
      case "orchestratorExchanges":
        return (
          <ExchangesPanel
              exchanges={exchanges}
              links={props.snapshot.communicationLinks}
              ownershipEdges={props.snapshot.ownershipEdges}
              threadLabels={threadLabels}
            onOpenThread={props.onSelectThread}
            loading={exchangesQuery.isPending}
            error={errorMessage(exchangesQuery.error)}
          />
        );
      case "orchestratorRuns":
        return (
          <RunsPanel
            runs={props.snapshot.runs}
            artifacts={artifacts}
            auditEvents={auditQuery.data?.items ?? []}
            threadLabels={threadLabels}
            loading={artifactsQuery.isPending || auditQuery.isPending}
            error={errorMessage(artifactsQuery.error ?? auditQuery.error)}
          />
        );
      default:
        return (
          <PanelStateMessage>This panel is not available in Orchestrator mode.</PanelStateMessage>
        );
    }
  };

  return (
    <div
      className={cn(CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME, CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME)}
      data-orchestrator-root-id={rootThreadId}
      data-selected-thread-id={props.selectedThreadId}
    >
      <div className="relative flex min-h-0 min-w-0 flex-1">
        {props.projectionBehind ? (
          <div className="absolute inset-x-0 top-0 z-20 bg-warning/10 px-3 py-1 text-center text-[10px] text-warning">
            Reconnecting orchestration projection…
          </div>
        ) : null}
        {props.snapshot.root.state === "archived" ? (
          <div className="absolute inset-x-0 top-0 z-20 bg-muted px-3 py-1 text-center text-[10px] text-muted-foreground">
            This Orchestrator Root is archived.
          </div>
        ) : null}
        <OrchestratorTranscriptProvider value={transcriptContext}>
          <RouteInsetSurface surfaceClassName={CHAT_BACKGROUND_CLASS_NAME}>
            {selectedThreadExists ? (
              <DeferredChatView
                threadId={props.selectedThreadId}
                paneScopeId={`orchestrator:${rootThreadId}`}
                deferMount={false}
                surfaceMode="single"
                isFocusedPane
                panelState={ORCHESTRATOR_PANEL_STATE}
                onToggleDiff={noopChatSurfaceAction}
                onToggleBrowser={noopChatSurfaceAction}
                onOpenBrowserUrl={noopChatSurfaceAction}
                onOpenTurnDiff={noopChatSurfaceAction}
                adjacentRightDockOpen={displayDockState.open}
                onToggleAdjacentRightDock={() =>
                  setDockOpen(rootThreadId, !displayDockState.open)
                }
                onOpenSessionProgressProcess={openProcessPane}
              />
            ) : (
              <PanelStateMessage>
                The selected thread is not available in the local projection.
              </PanelStateMessage>
            )}
          </RouteInsetSurface>
        </OrchestratorTranscriptProvider>
      </div>
      <RightDock
        state={displayDockState}
        minWidth={320}
        defaultWidth="max(22rem, 42vw)"
        shouldAcceptWidth={({ nextWidth }) => nextWidth >= 320}
        addMenuKinds={[]}
        motionKey={rootThreadId}
        paneClosable={false}
        collapsible
        onSelectPane={(paneId) => setActivePane(rootThreadId, paneId)}
        onClosePane={noopChatSurfaceAction}
        onCollapse={() => setDockOpen(rootThreadId, false)}
        onOpenChange={(open) => setDockOpen(rootThreadId, open)}
        onAddPane={noopChatSurfaceAction}
        renderPane={renderPane}
      />
    </div>
  );
}
