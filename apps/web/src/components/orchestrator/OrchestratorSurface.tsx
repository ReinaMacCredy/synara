import type { OrchestratorSnapshot, ProjectTaskId, ThreadId } from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";

import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import {
  DeferredChatView,
  LazyDiffPanel,
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
import { selectRightDockState, useRightDockStore } from "~/rightDockStore";
import { ensurePanesInState, type RightDockPane } from "~/rightDockStore.logic";
import { useStore } from "~/store";
import { createAllThreadsSelector } from "~/storeSelectors";
import { cn } from "~/lib/utils";
import { useTaskProcessStore } from "~/taskProcessStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { ArrowLeftIcon, CopyIcon, MessageCircleIcon } from "~/lib/icons";

import { OrchestratorTranscriptProvider } from "./OrchestratorThreadMessageRow";
import { RunsPanel } from "./RunsPanel";
import { TeamPanel } from "./TeamPanel";
import { RightDockProcessPanel } from "./RightDockProcessPanel";
import { ORCHESTRATOR_DOCK_PANES, orchestratorDockScopeId } from "./orchestratorDock";

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
  const dockScopeId = orchestratorDockScopeId(props.snapshot.root.projectId);
  const navigate = useNavigate();
  const selectProcessTask = useTaskProcessStore((state) => state.selectTask);
  const threads = useStore(useMemo(() => createAllThreadsSelector(), []));
  const dockState = useRightDockStore(
    useMemo(() => selectRightDockState(dockScopeId), [dockScopeId]),
  );
  const ensurePanes = useRightDockStore((store) => store.ensurePanes);
  const setActivePane = useRightDockStore((store) => store.setActivePane);
  const setDockOpen = useRightDockStore((store) => store.setDockOpen);
  const updatePane = useRightDockStore((store) => store.updatePane);
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
  const selectedChild =
    props.selectedThreadId === rootThreadId
      ? null
      : (threads.find((thread) => thread.id === props.selectedThreadId) ?? null);

  const askRootAboutChild = useCallback(() => {
    if (!selectedChild) return;
    const store = useComposerDraftStore.getState();
    const existing = store.draftsByThreadId[rootThreadId]?.prompt.trim() ?? "";
    const reference = `@child[${selectedChild.title || selectedChild.id}](${selectedChild.id})`;
    store.setPrompt(rootThreadId, existing ? `${existing}\n${reference} ` : `${reference} `);
    props.onSelectThread(rootThreadId);
  }, [props, rootThreadId, selectedChild]);

  const copyChildReference = useCallback(() => {
    if (!selectedChild) return;
    void navigator.clipboard.writeText(
      `@child[${selectedChild.title || selectedChild.id}](${selectedChild.id})`,
    );
  }, [selectedChild]);

  useEffect(() => {
    ensurePanes(dockScopeId, ORCHESTRATOR_DOCK_PANES, "orchestrator-team");
  }, [dockScopeId, ensurePanes]);

  const openDiffPane = useCallback(() => {
    setActivePane(dockScopeId, "orchestrator-diff");
    setDockOpen(dockScopeId, true);
  }, [dockScopeId, setActivePane, setDockOpen]);

  const openProcessPane = useCallback(() => {
    setActivePane(dockScopeId, "orchestrator-process");
    setDockOpen(dockScopeId, true);
  }, [dockScopeId, setActivePane, setDockOpen]);

  const renderPane = (pane: RightDockPane) => {
    switch (pane.kind) {
      case "diff":
        return (
          <LazyDiffPanel
            mode="sidebar"
            threadId={props.selectedThreadId}
            hideHeader
            liveRefreshEnabled
            panelState={{
              panel: "diff",
              diffTurnId: pane.diffTurnId,
              diffFilePath: pane.diffFilePath,
            }}
            onUpdatePanelState={(patch) =>
              updatePane(dockScopeId, pane.id, {
                ...(patch.diffTurnId !== undefined ? { diffTurnId: patch.diffTurnId } : {}),
                ...(patch.diffFilePath !== undefined ? { diffFilePath: patch.diffFilePath } : {}),
              })
            }
          />
        );
      case "orchestratorTeam":
        return (
          <TeamPanel
            snapshot={props.snapshot}
            threads={threads}
            selectedThreadId={props.selectedThreadId}
            threadLabels={threadLabels}
            onSelectThread={props.onSelectThread}
            exchanges={exchanges}
            exchangesLoading={exchangesQuery.isPending}
            exchangesError={errorMessage(exchangesQuery.error)}
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
              void navigate({
                to: "/orchestrator/$rootThreadId/tasks/$processId",
                params: { rootThreadId, processId },
              });
            }}
            onOpenProcess={(processId) =>
              void navigate({
                to: "/orchestrator/$rootThreadId/tasks/$processId",
                params: { rootThreadId, processId },
              })
            }
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
            {selectedChild ? (
              <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-muted hover:text-foreground"
                  onClick={() => props.onSelectThread(rootThreadId)}
                >
                  <ArrowLeftIcon className="size-4" />
                  Back to Root
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-muted hover:text-foreground"
                  onClick={askRootAboutChild}
                >
                  <MessageCircleIcon className="size-4" />
                  Ask Root
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-muted hover:text-foreground"
                  onClick={copyChildReference}
                >
                  <CopyIcon className="size-4" />
                  Copy reference
                </button>
              </div>
            ) : null}
            {selectedThreadExists ? (
              <DeferredChatView
                threadId={props.selectedThreadId}
                paneScopeId={`orchestrator:${rootThreadId}`}
                deferMount={false}
                surfaceMode="single"
                isFocusedPane
                panelState={ORCHESTRATOR_PANEL_STATE}
                onToggleDiff={openDiffPane}
                onToggleBrowser={noopChatSurfaceAction}
                onOpenBrowserUrl={noopChatSurfaceAction}
                onOpenTurnDiff={noopChatSurfaceAction}
                adjacentRightDockOpen={displayDockState.open}
                onAdjacentRightDockOpenChange={(open) => setDockOpen(dockScopeId, open)}
                onOpenSessionProgressProcess={openProcessPane}
                orchestratorMode
                inspectOnly={selectedChild !== null}
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
        motionKey={dockScopeId}
        paneClosable={false}
        collapsible={false}
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
