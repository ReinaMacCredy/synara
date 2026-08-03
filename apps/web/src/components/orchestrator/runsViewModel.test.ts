import {
  ArtifactId,
  OrchestratorRunId,
  ThreadId,
  type OrchestratorArtifact,
  type OrchestratorRun,
} from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  councilStageIndex,
  decisionPacketPreview,
  groupRunsForCommandCenter,
  runDisplayTitle,
  runQueueGroup,
} from "./runsViewModel";

function run(
  id: string,
  state: OrchestratorRun["state"],
  disposition: OrchestratorRun["disposition"] = null,
): OrchestratorRun {
  return {
    id: OrchestratorRunId.makeUnsafe(id),
    rootThreadId: ThreadId.makeUnsafe("root-a"),
    mode: "council",
    state,
    disposition,
    briefHash: "brief-hash",
    participants: [],
    decisionPacketArtifactId: null,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: `2026-08-02T00:00:0${id.length}.000Z`,
  };
}

function packet(): OrchestratorArtifact {
  return {
    id: ArtifactId.makeUnsafe("packet-a"),
    rootThreadId: ThreadId.makeUnsafe("root-a"),
    runId: OrchestratorRunId.makeUnsafe("run-a"),
    round: null,
    kind: "decision_packet",
    contentHash: "packet-hash",
    content: JSON.stringify({
      status: "disputed",
      goal: "Choose the durable architecture",
      decision: "Owner review is required.",
      primaryVerdictArtifactId: "verdict-primary",
      shadowVerdictArtifactId: "verdict-shadow",
    }),
    visibility: "root_released",
    sourceRefs: [],
    supersedesArtifactId: null,
    schemaVersion: 1,
    producerThreadId: ThreadId.makeUnsafe("root-a"),
    createdAt: "2026-08-02T00:00:00.000Z",
  };
}

describe("runsViewModel", () => {
  it("groups only from canonical run state and disposition", () => {
    const attention = run("attention", "disputed", "owner_review_required");
    const active = run("active", "arbitrating");
    const settled = run("settled", "packet_published", "auto_actionable");

    expect(runQueueGroup(attention)).toBe("attention");
    expect(runQueueGroup(active)).toBe("active");
    expect(runQueueGroup(settled)).toBe("settled");
    expect(groupRunsForCommandCenter([settled, active, attention])).toEqual({
      attention: [attention],
      active: [active],
      settled: [settled],
    });
  });

  it("derives the selected title and equal-weight verdict references from the immutable packet", () => {
    const preview = decisionPacketPreview([packet()]);
    expect(preview).toMatchObject({
      status: "disputed",
      primaryVerdictArtifactId: "verdict-primary",
      shadowVerdictArtifactId: "verdict-shadow",
    });
    expect(runDisplayTitle(run("run-a", "disputed"), [packet()])).toBe(
      "Choose the durable architecture",
    );
  });

  it("maps Council lifecycle to the legal three-stage rail", () => {
    expect(councilStageIndex("brief_sealed")).toBe(0);
    expect(councilStageIndex("compiled")).toBe(1);
    expect(councilStageIndex("arbitrating")).toBe(2);
    expect(councilStageIndex("disputed")).toBe(2);
  });
});
