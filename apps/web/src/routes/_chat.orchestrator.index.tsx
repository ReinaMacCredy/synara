import type { ProjectId, ThreadId } from "@synara/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";

interface LegacyOrchestratorIndexSearch {
  readonly projectId?: ProjectId;
  readonly sourceThreadId?: ThreadId;
}

export const Route = createFileRoute("/_chat/orchestrator/")({
  validateSearch: (raw: Record<string, unknown>): LegacyOrchestratorIndexSearch => ({
    ...(typeof raw.projectId === "string" && raw.projectId.length > 0
      ? { projectId: raw.projectId as ProjectId }
      : {}),
    ...(typeof raw.sourceThreadId === "string" && raw.sourceThreadId.length > 0
      ? { sourceThreadId: raw.sourceThreadId as ThreadId }
      : {}),
  }),
  beforeLoad: ({ search }) => {
    // TODO(supervised-runtime): Remove this read-only route adapter on or after 2026-11-01
    // once saved links and handoff packets no longer reference Orchestrator routes.
    throw redirect({ to: "/supervised", search });
  },
});
