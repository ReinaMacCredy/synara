import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/source")({
  component: SourceLayout,
});

function SourceLayout() {
  return <Outlet />;
}
