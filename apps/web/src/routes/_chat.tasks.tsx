import { createFileRoute, Outlet } from "@tanstack/react-router";

function TasksRouteLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/_chat/tasks")({
  component: TasksRouteLayout,
});
