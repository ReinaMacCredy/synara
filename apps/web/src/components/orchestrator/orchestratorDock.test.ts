import { ProjectId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { ORCHESTRATOR_DOCK_PANES, orchestratorDockScopeId } from "./orchestratorDock";

describe("Orchestrator unified dock", () => {
  it("keeps Diff permanently first and omits the redundant Exchanges pane", () => {
    expect(ORCHESTRATOR_DOCK_PANES.map((pane) => pane.kind)).toEqual([
      "diff",
      "orchestratorTeam",
      "orchestratorProcess",
      "orchestratorRuns",
    ]);
  });

  it("shares one persisted dock identity across a Project draft and promoted Root", () => {
    const projectId = ProjectId.makeUnsafe("project-a");
    expect(orchestratorDockScopeId(projectId)).toBe(orchestratorDockScopeId(projectId));
    expect(orchestratorDockScopeId(projectId)).toBe("orchestrator-dock:project-a");
  });
});
