import { describe, expect, it } from "vitest";

import { sealCouncilBrief } from "./briefs.ts";

describe("Council briefs", () => {
  it("seals semantically identical evidence into byte-identical briefs", () => {
    const base = {
      originalRequest: "Design feature X",
      immutableUserConstraints: ["No worktree", "Preserve evidence"],
      acceptanceCriteria: ["Reliable", "Replayable"],
      evidence: [
        { ref: "b", contentHash: "sha256:b", content: "second" },
        { ref: "a", contentHash: "sha256:a", content: "first" },
      ],
    } as const;
    const first = sealCouncilBrief(base);
    const second = sealCouncilBrief({
      ...base,
      evidence: [...base.evidence].reverse(),
      immutableUserConstraints: [...base.immutableUserConstraints].reverse(),
    });

    expect(second).toEqual(first);
    expect(first.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("changes the hash when a user constraint changes", () => {
    const first = sealCouncilBrief({
      originalRequest: "Design X",
      immutableUserConstraints: ["A"],
      acceptanceCriteria: ["Works"],
      evidence: [],
    });
    const second = sealCouncilBrief({
      originalRequest: "Design X",
      immutableUserConstraints: ["B"],
      acceptanceCriteria: ["Works"],
      evidence: [],
    });
    expect(second.contentHash).not.toBe(first.contentHash);
  });
});
