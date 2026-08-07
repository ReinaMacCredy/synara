import { TaskProcessId } from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { PanelStateMessage } from "~/components/chat/PanelStateMessage";
import { taskProcessGraphQueryOptions } from "~/lib/serverReactQuery";
import { resolveTaskProcessNavigationTarget } from "~/lib/taskProcessNavigation";

function ProcessRouteView() {
  const navigate = useNavigate();
  const processId = Route.useParams({
    select: (params) => TaskProcessId.makeUnsafe(params.processId),
  });
  const graphQuery = useQuery(taskProcessGraphQueryOptions(processId));

  useEffect(() => {
    const owner = graphQuery.data?.graph.process.owner;
    if (!owner) return;
    const target = resolveTaskProcessNavigationTarget(processId, owner);
    if (target.mode === "orchestrator") {
      void navigate({
        to: "/supervised/$roomId/tasks/$processId",
        params: { roomId: target.rootThreadId, processId: target.processId },
        replace: true,
      });
      return;
    }
    void navigate({
      to: "/tasks/$processId",
      params: { processId: target.processId },
      replace: true,
    });
  }, [graphQuery.data?.graph.process.owner, navigate, processId]);

  return (
    <RouteInsetSurface>
      <PanelStateMessage>
        {graphQuery.isError ? "Unable to resolve this task board." : "Opening task board…"}
      </PanelStateMessage>
    </RouteInsetSurface>
  );
}

export const Route = createFileRoute("/_chat/process/$processId")({
  component: ProcessRouteView,
});
