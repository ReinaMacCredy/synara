import { ContextBundleId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { sealContextBundle, verifyContextBundle } from "./contextBundles.ts";

const makeInput = () => ({
  id: ContextBundleId.makeUnsafe("context-1"),
  version: 1,
  assignmentId: null,
  originalBrief: "Explore independently",
  immutableUserConstraints: ["Keep A", "Keep B"],
  acceptedDecisions: ["Use events"],
  rejectedAlternatives: ["Generic patch"],
  ownershipClaims: ["src/b", "src/a"],
  dependencyRefs: ["task-b", "task-a"],
  sourceRefs: ["file-b", "file-a"],
  threadMessageRefs: [],
  artifactRefs: [],
  capabilityCeiling: ["message.send" as const, "state.read" as const],
  createdBy: { kind: "user" as const, actorId: "owner" },
  createdAt: "2026-08-01T00:00:00.000Z",
});

describe("ContextBundle sealing", () => {
  it("hashes canonical immutable content independently of reference ordering", () => {
    const first = sealContextBundle(makeInput());
    const second = sealContextBundle({
      ...makeInput(),
      ownershipClaims: [...makeInput().ownershipClaims].reverse(),
      capabilityCeiling: [...makeInput().capabilityCeiling].reverse(),
    });
    expect(second).toEqual(first);
    expect(verifyContextBundle(first)).toBe(true);
  });

  it("detects content changed after sealing", () => {
    const bundle = sealContextBundle(makeInput());
    expect(verifyContextBundle({ ...bundle, originalBrief: "Changed" })).toBe(false);
  });
});
