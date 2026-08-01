import { ThreadId } from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { RouteInsetSurface } from "../components/RouteInsetSurface";
import { PanelStateMessage } from "../components/chat/PanelStateMessage";
import { CHAT_BACKGROUND_CLASS_NAME } from "../components/chat/composerPickerStyles";
import { OrchestratorSurface } from "../components/orchestrator/OrchestratorSurface";
import { orchestratorQueryKeys } from "../lib/orchestratorRoots";
import { readNativeApi } from "../nativeApi";
import { resolveOrchestratorRootRouteState } from "./-orchestratorRootRouteState";

export interface OrchestratorRootSearch {
  readonly selectedThreadId?: string;
}

function OrchestratorRootRouteView() {
  const navigate = useNavigate();
  const rootThreadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.rootThreadId),
  });
  const search = Route.useSearch();
  const rootQuery = useQuery({
    queryKey: orchestratorQueryKeys.root(rootThreadId),
    queryFn: async () => {
      const api = readNativeApi();
      if (!api) throw new Error("The Synara server is unavailable.");
      return api.orchestration.getOrchestratorSnapshot({ rootThreadId });
    },
  });
  const routeState = resolveOrchestratorRootRouteState(rootQuery);

  if (routeState.kind === "loading") {
    return (
      <RouteInsetSurface surfaceClassName={CHAT_BACKGROUND_CLASS_NAME}>
        <PanelStateMessage>Loading Orchestrator Root…</PanelStateMessage>
      </RouteInsetSurface>
    );
  }
  if (routeState.kind === "fatal") {
    return (
      <RouteInsetSurface surfaceClassName={CHAT_BACKGROUND_CLASS_NAME}>
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
