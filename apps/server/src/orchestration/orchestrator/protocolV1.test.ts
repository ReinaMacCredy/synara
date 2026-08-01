import { describe, expect, it } from "vitest";

import { sealCouncilBrief } from "./briefs.ts";
import {
  decodeCompiledProposal,
  orchestratorInstructionForRole,
  renderBlindArbiterPrompt,
  renderCouncilParticipantPrompt,
} from "./protocolV1.ts";

describe("ORCHESTRATOR_PROTOCOL_V1", () => {
  it("renders byte-identical participant prompts without participant identity", () => {
    const brief = sealCouncilBrief({
      originalRequest: "Design X",
      immutableUserConstraints: ["Preserve scope"],
      acceptanceCriteria: ["Evidence"],
      evidence: [],
    });
    const claudePrompt = renderCouncilParticipantPrompt(brief);
    const codexPrompt = renderCouncilParticipantPrompt(brief);
    expect(Buffer.from(claudePrompt)).toEqual(Buffer.from(codexPrompt));
    expect(claudePrompt).not.toMatch(/claude|codex|participant-[a-z0-9]/iu);
  });

  it("pins Root authority and native monitoring behavior", () => {
    const root = orchestratorInstructionForRole("root");
    expect(root).toContain("user alone controls this Root's lifecycle");
    expect(root).toContain("native notify, heartbeat, schedule, or event waits");
    expect(root).toContain("worktree only as a last-resort");
  });

  it("prevents compiler winner, score, merge and recommendation output", () => {
    const valid = {
      proposalLabel: "Alpha",
      artifactHash: "sha256:alpha",
      claims: [],
    };
    expect(decodeCompiledProposal(valid)).toEqual(valid);
    for (const forbidden of ["winner", "score", "mergedProposal", "recommendation"] as const) {
      expect(() => decodeCompiledProposal({ ...valid, [forbidden]: "Beta" })).toThrow();
    }
  });

  it("gives Primary and Shadow the exact same blind arbiter bytes", () => {
    const input = { anonymousDossierBytes: "dossier", neutralRubricBytes: "rubric" };
    const primary = renderBlindArbiterPrompt(input);
    const shadow = renderBlindArbiterPrompt(input);
    expect(primary).toBe(shadow);
    expect(primary).not.toMatch(/primary|shadow/iu);
  });
});
