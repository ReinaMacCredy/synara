import { createFileRoute } from "@tanstack/react-router";

import KanbanView from "~/components/kanban/KanbanView";
import { validateKanbanRouteSearch } from "~/lib/kanbanRouteSearch";

function KanbanProjectRouteView() {
  const { projectId } = Route.useParams();
  const { surface } = Route.useSearch();
  return <KanbanView projectId={projectId} surface={surface ?? "projects"} />;
}

export const Route = createFileRoute("/_chat/kanban/$projectId")({
  validateSearch: validateKanbanRouteSearch,
  component: KanbanProjectRouteView,
});
