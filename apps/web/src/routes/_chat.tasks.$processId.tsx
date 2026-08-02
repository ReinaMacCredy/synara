import { TaskProcessId } from "@synara/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { ProcessWorkspace } from "~/components/process/ProcessWorkspace";

function ProjectTasksRouteView() {
  const processId = Route.useParams({
    select: (params) => TaskProcessId.makeUnsafe(params.processId),
  });
  return <ProcessWorkspace processId={processId} />;
}

export const Route = createFileRoute("/_chat/tasks/$processId")({
  component: ProjectTasksRouteView,
});
