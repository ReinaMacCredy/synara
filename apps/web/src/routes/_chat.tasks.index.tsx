import { createFileRoute } from "@tanstack/react-router";

import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { PanelStateMessage } from "~/components/chat/PanelStateMessage";

function TasksIndexRouteView() {
  return (
    <RouteInsetSurface>
      <PanelStateMessage>Select a Project to open its task board.</PanelStateMessage>
    </RouteInsetSurface>
  );
}

export const Route = createFileRoute("/_chat/tasks/")({
  component: TasksIndexRouteView,
});
