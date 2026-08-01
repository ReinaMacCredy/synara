import { ThreadId } from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { OrchestratorSurface } from "../components/orchestrator/OrchestratorSurface";
import { orchestratorQueryKeys } from "../lib/orchestratorRoots";
import { readNativeApi } from "../nativeApi";

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

  if (rootQuery.isPending) return null;
  if (rootQuery.isError || !rootQuery.data) {
    return (
      <div className="p-4 text-sm text-destructive">Unable to load this Orchestrator Root.</div>
    );
  }
  const selectedThreadId =
    search.selectedThreadId &&
    rootQuery.data.snapshot.ownershipEdges.some(
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
      snapshot={rootQuery.data.snapshot}
      projectionBehind={rootQuery.data.projectionBehind}
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
