import { ThreadId, type SupervisorSeatId } from "@synara/contracts";

import type { OpenPaneInput } from "~/rightDockStore.logic";

export const SUPERVISOR_DOCK_PANES = [
  { paneId: "supervision", kind: "supervision" },
] as const satisfies readonly OpenPaneInput[];

export function supervisorDockScopeId(supervisorSeatId: SupervisorSeatId): ThreadId {
  return ThreadId.makeUnsafe(`supervisor-dock:${supervisorSeatId}`);
}
