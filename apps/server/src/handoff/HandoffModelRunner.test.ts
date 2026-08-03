import { ProjectId, ThreadId, type HandoffCapsuleV1 } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { buildHandoffTurnInput } from "./HandoffModelRunner.ts";

const capsule: HandoffCapsuleV1 = {
  schemaVersion: 1,
  sourceThreadId: ThreadId.makeUnsafe("source-thread"),
  sourceTitle: "Source thread",
  sourceMode: "project",
  sourceProvider: "codex",
  projectId: ProjectId.makeUnsafe("project"),
  projectTitle: "Synara",
  workspaceRoot: "/tmp/synara",
  environment: { mode: "local", branch: "main", worktreePath: null },
  sourceCursor: 12,
  sourceDigest: "source-digest",
  items: [],
  omissions: [],
  sealedAt: "2026-08-02T00:00:00.000Z",
  capsuleHash: "capsule-hash",
};

describe("buildHandoffTurnInput", () => {
  it("includes the owner-authored Handoff prompt in the one-shot agent turn", () => {
    const input = buildHandoffTurnInput({
      capsule,
      handoffPrompt: "Resume from the accepted architecture and preserve dissent.",
    });

    expect(input).toContain("Prepare the handoff packet from this sealed capsule:");
    expect(input).toContain('"sourceThreadId":"source-thread"');
    expect(input).toContain(
      "One-time handoff prompt:\nResume from the accepted architecture and preserve dissent.",
    );
  });
});
