import { createFileRoute, Outlet } from "@tanstack/react-router";

function OrchestratorRouteLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/_chat/orchestrator")({
  component: OrchestratorRouteLayout,
});
