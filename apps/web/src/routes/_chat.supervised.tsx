import { createFileRoute, Outlet } from "@tanstack/react-router";

function SupervisedRouteLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/_chat/supervised")({
  component: SupervisedRouteLayout,
});
