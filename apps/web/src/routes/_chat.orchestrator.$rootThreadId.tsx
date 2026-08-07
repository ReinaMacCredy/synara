import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/orchestrator/$rootThreadId")({
  beforeLoad: ({ params }) => {
    // TODO(supervised-runtime): Remove this read-only route adapter on or after 2026-11-01
    // once saved links and handoff packets no longer reference Orchestrator routes.
    throw redirect({
      to: "/supervised/$roomId",
      params: { roomId: params.rootThreadId },
    });
  },
});
