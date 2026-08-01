import { describe, expect, it } from "vitest";

import { anonymizeProposals } from "./anonymization.ts";

describe("Council anonymization", () => {
  it("assigns stable labels independently of input ordering", () => {
    const proposals = [
      {
        artifactId: "artifact-b",
        content: "Proposal B",
        declaredIdentity: { provider: "Claude", threadId: "thread-b" },
      },
      {
        artifactId: "artifact-a",
        content: "Proposal A",
        declaredIdentity: { provider: "Codex", threadId: "thread-a" },
      },
    ];
    const first = anonymizeProposals(proposals);
    const second = anonymizeProposals([...proposals].reverse());
    expect(second).toEqual(first);
  });

  it("normalizes Unicode and removes declared provider, model, thread, author and style labels", () => {
    const dossier = anonymizeProposals([
      {
        artifactId: "artifact-1",
        content: "Ｃｏｄｅｘ gpt-5.6 thread-root Alice writes in terse-style.",
        declaredIdentity: {
          provider: "Codex",
          model: "gpt-5.6",
          threadId: "thread-root",
          authorName: "Alice",
          styleLabel: "terse-style",
        },
      },
    ]);
    expect(dossier.proposals[0]?.content).toBe(
      "[identity-redacted] [identity-redacted] [identity-redacted] [identity-redacted] writes in [identity-redacted].",
    );
    expect(JSON.stringify(dossier.proposals)).not.toContain("artifact-1");
    expect(dossier.attributionByLabel.Alpha).toBe("artifact-1");
  });
});
