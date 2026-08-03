import { HandoffId, ProjectId, ThreadId, type HandoffDraftV1 } from "@synara/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ComposerHandoffPacketRail } from "./ComposerHandoffPacketRail";
import { ComposerColumnFrame } from "./ComposerColumnFrame";

const createdAt = "2026-08-02T00:00:00.000Z";
const sourceThreadId = ThreadId.makeUnsafe("source-thread");
const projectId = ProjectId.makeUnsafe("project");

const capsule = {
  schemaVersion: 1 as const,
  sourceThreadId,
  sourceTitle: "Source architecture thread",
  sourceMode: "project" as const,
  sourceProvider: "codex" as const,
  projectId,
  projectTitle: "Synara",
  workspaceRoot: "/tmp/synara",
  environment: { mode: "local" as const, branch: "main", worktreePath: null },
  sourceCursor: 12,
  sourceDigest: "source-digest",
  items: [],
  omissions: [],
  sealedAt: createdAt,
  capsuleHash: "capsule-hash",
};

const draft: HandoffDraftV1 = {
  schemaVersion: 1,
  handoffId: HandoffId.makeUnsafe("handoff-1"),
  sourceThreadId,
  sourceTitle: capsule.sourceTitle,
  sourceMode: "project",
  destinationMode: "orchestrator_root",
  sourceProvider: "codex",
  sourceCursor: 12,
  sourceDigest: "source-digest",
  capsule,
  handoffPrompt: "Preserve dissent",
  attemptId: null,
  preparationState: "failed",
  preparationPhase: "Handoff Agent failed",
  runtime: { provider: "codex", model: "gpt-5.6-luna", effort: "high" },
  settingsRevision: 1,
  packet: null,
  error: "failed",
  sourceLinkOnly: false,
  stagedAt: createdAt,
  updatedAt: createdAt,
};

describe("ComposerHandoffPacketRail", () => {
  it("keeps recovery controls on a failed draft packet", () => {
    const markup = renderToStaticMarkup(
      <ComposerColumnFrame>
        <ComposerHandoffPacketRail
          handoff={draft}
          attachedToPrevious={false}
          onDetach={() => undefined}
          onUseSourceLinkOnly={() => undefined}
          onRetry={async () => undefined}
        />
      </ComposerColumnFrame>,
    );

    expect(markup).toContain("Handoff packet");
    expect(markup).toContain("Needs attention");
    expect(markup).toContain("Retry");
    expect(markup).toContain("Use source link only");
  });

  it("shows real elapsed time while preparation is active without a fake percent", () => {
    const stagedAt = new Date().toISOString();
    const markup = renderToStaticMarkup(
      <ComposerColumnFrame>
        <ComposerHandoffPacketRail
          handoff={{
            ...draft,
            preparationState: "preparing",
            preparationPhase: "Preparing cited handoff packet",
            preparationProgressPercent: 55,
            stagedAt,
          }}
          attachedToPrevious={false}
          onDetach={() => undefined}
          onUseSourceLinkOnly={() => undefined}
          onRetry={async () => undefined}
        />
      </ComposerColumnFrame>,
    );

    expect(markup).toContain("Preparing handoff");
    expect(markup).toContain("Preparing cited handoff packet");
    expect(markup).toContain("Handoff preparation active for 0s");
    expect(markup).toContain("handoff-magic-border");
    expect(markup).not.toContain("55%");
    expect(markup).not.toContain("animate-pulse");
    expect(markup).not.toContain("data-progress-target");
    expect(markup).not.toContain("Steer");
  });

  it("replaces 100% with a completed check on an already-ready packet", () => {
    const markup = renderToStaticMarkup(
      <ComposerColumnFrame>
        <ComposerHandoffPacketRail
          handoff={{
            ...draft,
            preparationState: "ready",
            preparationPhase: "Handoff packet ready",
            preparationProgressPercent: 100,
          }}
          attachedToPrevious={false}
          onDetach={() => undefined}
          onUseSourceLinkOnly={() => undefined}
          onRetry={async () => undefined}
        />
      </ComposerColumnFrame>,
    );

    expect(markup).toContain("Completed");
    expect(markup).not.toContain("handoff-magic-border");
    expect(markup).not.toContain("100%");
  });
});
