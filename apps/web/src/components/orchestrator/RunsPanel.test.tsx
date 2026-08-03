import {
  ArtifactId,
  OrchestratorRunId,
  ThreadId,
  type OrchestratorArtifact,
  type OrchestratorRun,
} from "@synara/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RunsPanel } from "./RunsPanel";

const rootThreadId = ThreadId.makeUnsafe("root-a");
const primaryThreadId = ThreadId.makeUnsafe("arbiter-primary");
const shadowThreadId = ThreadId.makeUnsafe("arbiter-shadow");
const runId = OrchestratorRunId.makeUnsafe("run-disputed");

function run(): OrchestratorRun {
  return {
    id: runId,
    rootThreadId,
    mode: "council",
    state: "disputed",
    disposition: "owner_review_required",
    briefHash: "brief-immutable-hash",
    participants: [
      {
        threadId: primaryThreadId,
        role: "arbiter",
        anonymousLabel: "Primary",
        modelTarget: {
          provider: "codex",
          model: "gpt-5.6-luna",
          runtimeMode: "approval-required",
          workspaceRoot: "/workspace",
        },
        artifactIds: [ArtifactId.makeUnsafe("verdict-primary")],
      },
      {
        threadId: shadowThreadId,
        role: "arbiter",
        anonymousLabel: "Shadow",
        modelTarget: {
          provider: "claudeAgent",
          model: "sonnet-5",
          runtimeMode: "approval-required",
          workspaceRoot: "/workspace",
        },
        artifactIds: [ArtifactId.makeUnsafe("verdict-shadow")],
      },
    ],
    decisionPacketArtifactId: ArtifactId.makeUnsafe("packet-a"),
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:10:00.000Z",
  };
}

function artifact(
  input: Partial<OrchestratorArtifact> & Pick<OrchestratorArtifact, "id" | "kind" | "content">,
): OrchestratorArtifact {
  return {
    rootThreadId,
    runId,
    round: null,
    contentHash: `hash-${input.id}`,
    visibility: "root_released",
    sourceRefs: [],
    supersedesArtifactId: null,
    schemaVersion: 1,
    producerThreadId: rootThreadId,
    createdAt: "2026-08-02T00:05:00.000Z",
    ...input,
  };
}

describe("RunsPanel", () => {
  it("renders one selected-run model across queue, protocol, and evidence without a winner score", () => {
    const artifacts = [
      artifact({
        id: ArtifactId.makeUnsafe("ledger-a"),
        kind: "claim_ledger",
        content: JSON.stringify({
          claims: [{ id: "claim-1", claim: "Preserve lifecycle safety" }],
        }),
      }),
      artifact({
        id: ArtifactId.makeUnsafe("verdict-primary"),
        kind: "arbiter_verdict",
        producerThreadId: primaryThreadId,
        content: "Primary independently requires more evidence.",
      }),
      artifact({
        id: ArtifactId.makeUnsafe("verdict-shadow"),
        kind: "arbiter_verdict",
        producerThreadId: shadowThreadId,
        content: "Shadow independently identifies a material conflict.",
      }),
      artifact({
        id: ArtifactId.makeUnsafe("packet-a"),
        kind: "decision_packet",
        content: JSON.stringify({
          status: "disputed",
          goal: "Choose a durable architecture",
          decision: "Owner review is required.",
          primaryVerdictArtifactId: "verdict-primary",
          shadowVerdictArtifactId: "verdict-shadow",
        }),
      }),
    ];
    const markup = renderToStaticMarkup(
      <RunsPanel
        runs={[run()]}
        artifacts={artifacts}
        auditEvents={[]}
        threadLabels={new Map()}
        loading={false}
        error={null}
      />,
    );

    expect(markup).toContain("Needs attention");
    expect(markup).toContain("Sealed round");
    expect(markup).toContain("Anonymous claim ledger");
    expect(markup).toContain("Blind equal-weight verdicts");
    expect(markup).toContain("Primary");
    expect(markup).toContain("Shadow");
    expect(markup).toContain("Final Decision Packet");
    expect(markup).toContain("Open full packet");
    expect(markup).toContain("disabled");
    expect(markup.toLowerCase()).not.toContain("winner");
  });
});
