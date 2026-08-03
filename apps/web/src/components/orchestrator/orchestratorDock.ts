import { ThreadId, type ProjectId } from "@synara/contracts";

import type { OpenPaneInput } from "~/rightDockStore.logic";

export const ORCHESTRATOR_DOCK_PANES = [
  { paneId: "orchestrator-diff", kind: "diff" },
  { paneId: "orchestrator-team", kind: "orchestratorTeam" },
  { paneId: "orchestrator-process", kind: "orchestratorProcess" },
  { paneId: "orchestrator-runs", kind: "orchestratorRuns" },
] as const satisfies readonly OpenPaneInput[];

export function orchestratorDockScopeId(projectId: ProjectId): ThreadId {
  return ThreadId.makeUnsafe(`orchestrator-dock:${projectId}`);
}
