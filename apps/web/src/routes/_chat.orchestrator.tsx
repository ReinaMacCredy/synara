import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { orchestratorQueryKeys } from "../lib/orchestratorRoots";
import { readNativeApi } from "../nativeApi";
import { shouldInvalidateOrchestratorQueriesForEvent } from "./-rootEventInvalidation";

function OrchestratorRouteLayout() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const api = readNativeApi();
    if (!api) return;
    return api.orchestration.onDomainEvent((event) => {
      if (shouldInvalidateOrchestratorQueriesForEvent(event)) {
        void queryClient.invalidateQueries({ queryKey: orchestratorQueryKeys.all });
      }
    });
  }, [queryClient]);

  return <Outlet />;
}

export const Route = createFileRoute("/_chat/orchestrator")({
  component: OrchestratorRouteLayout,
});
