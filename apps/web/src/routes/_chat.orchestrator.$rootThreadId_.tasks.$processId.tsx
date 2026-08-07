import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/orchestrator/$rootThreadId_/tasks/$processId")({
  beforeLoad: ({ params }) => {
    // TODO(supervised-runtime): Remove this read-only route adapter on or after 2026-11-01
    // once saved task links no longer reference Orchestrator routes.
    throw redirect({
      to: "/supervised/$roomId/tasks/$processId",
      params: { roomId: params.rootThreadId, processId: params.processId },
    });
  },
});
