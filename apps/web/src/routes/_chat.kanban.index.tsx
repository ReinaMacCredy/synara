import { createFileRoute } from "@tanstack/react-router";

import KanbanView from "~/components/kanban/KanbanView";
import { validateKanbanRouteSearch } from "~/lib/kanbanRouteSearch";

function KanbanOverviewRouteView() {
  const { surface } = Route.useSearch();
  return <KanbanView projectId={null} surface={surface ?? "projects"} />;
}

export const Route = createFileRoute("/_chat/kanban/")({
  validateSearch: validateKanbanRouteSearch,
  component: KanbanOverviewRouteView,
});
