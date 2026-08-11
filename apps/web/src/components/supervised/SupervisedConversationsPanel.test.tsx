import { emptySupervisedRuntimeSnapshot } from "@veylen/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SupervisedConversationsPanel } from "./SupervisedConversationsPanel";

describe("SupervisedConversationsPanel", () => {
  it("exposes the canonical conversation groups and mounts the Supervisor transcript", () => {
    const markup = renderToStaticMarkup(
      <SupervisedConversationsPanel
        roomId="room-1"
        snapshot={emptySupervisedRuntimeSnapshot("2026-08-09T00:00:00.000Z")}
        supervisorConversation={<div>Primary Supervisor transcript</div>}
        leadConversation={<div>Lead transcript</div>}
        group="supervisor"
        selectedSessionId={null}
        onGroupChange={vi.fn()}
        onSelectSession={vi.fn()}
      />,
    );

    expect(markup).toContain("Supervisor");
    expect(markup).toContain("Leads");
    expect(markup).toContain("Peers");
    expect(markup).toContain("RLM");
    expect(markup).toContain("Primary Supervisor transcript");
    expect(markup).not.toContain("Lead transcript");
  });

  it("renders a complete Supervisor-origin RLM receipt without claiming Root authority", () => {
    const at = "2026-08-09T00:00:00.000Z";
    const rootSession = {
      id: "model-session:root",
      roomId: "room-1",
      runId: "run-1",
      taskId: "task-1",
      taskNodeId: null,
      actorSeatId: "seat:supervisor-primary",
      authorityReceiptId: "receipt:supervisor-rlm",
      effectiveRole: "supervisor",
      rootLeaseIds: [],
      rlmEpisodeId: "episode-1",
      parentSessionId: null,
      threadId: "thread:root",
      role: "rlm_root",
      title: "RLM synthesis",
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      providerSessionId: "provider-session:root",
      providerCallId: "provider-call:root",
      contextViewRefs: [],
      contextView: null,
      promptHash: `sha256:${"a".repeat(64)}`,
      inputSummary: "Synthesize the retained branch evidence.",
      items: [],
      usage: {
        inputTokens: 90,
        outputTokens: 40,
        contextTokens: 1_000,
        providerLimitTokens: 128_000,
        contextUsagePercent: 0.78125,
      },
      status: "completed",
      retryCount: 0,
      durationMs: 2_000,
      costUsd: 0.01,
      synthesisDestination: null,
      createdAt: at,
      updatedAt: "2026-08-09T00:00:04.000Z",
      revision: 2,
    };
    const branchSession = {
      ...rootSession,
      id: "model-session:branch-a",
      parentSessionId: rootSession.id,
      threadId: "thread:branch-a",
      role: "rlm_branch",
      title: "Branch A",
      providerSessionId: null,
      providerCallId: "provider-call:branch-a",
      promptHash: `sha256:${"b".repeat(64)}`,
      inputSummary: "Inspect the provider receipt path.",
      contextViewRefs: ["context-record:one"],
      contextView: {
        id: "context-view:branch-a",
        workspaceId: "context-workspace:room-1",
        workspaceRevision: 2,
        actorSeatId: "seat:supervisor-primary",
        recordIds: ["context-record:one"],
        evidenceRefs: [],
        activeObligationRecordIds: [],
        provider: "codex",
        model: "gpt-5.6-sol",
        estimatedTokens: 800,
        providerLimitTokens: 128_000,
        confidence: 1,
        createdAt: at,
      },
      items: [
        {
          id: "tool-call:one",
          type: "tool_call",
          callId: "call:one",
          toolName: "search",
          inputSummary: "Find the receipt source.",
          status: "completed",
          finishedAt: "2026-08-09T00:00:02.000Z",
          createdAt: "2026-08-09T00:00:01.000Z",
        },
        {
          id: "tool-result:one",
          type: "tool_result",
          callId: "call:one",
          outputSummary: "Receipt source retained.",
          errorSummary: null,
          createdAt: "2026-08-09T00:00:02.000Z",
        },
        {
          id: "evidence-item:one",
          type: "evidence",
          evidenceId: "evidence:branch-a",
          summary: "Branch A retained provider evidence.",
          createdAt: "2026-08-09T00:00:03.000Z",
        },
      ],
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        contextTokens: 12_000,
        providerLimitTokens: 128_000,
        contextUsagePercent: 9.375,
      },
      synthesisDestination: rootSession.id,
      updatedAt: "2026-08-09T00:00:03.000Z",
    };
    const snapshot = {
      ...emptySupervisedRuntimeSnapshot(at),
      runs: [{ id: "run-1", roomId: "room-1" }],
      rlmEpisodes: [
        {
          id: "episode-1",
          runId: "run-1",
          admission: {
            episodeId: "episode-1",
            requestedMode: "recursive",
            selectedMode: "recursive",
            estimatedContextPercent: 12.5,
            estimatedInputTokens: 2_400,
            independentEvidenceBranches: 2,
            reasons: ["Two independent evidence branches were requested."],
            admittedByPolicyId: "policy-1",
            createdAt: at,
          },
          status: "completed",
          rootModelSessionId: rootSession.id,
          branchModelSessionIds: [branchSession.id, "model-session:branch-b"],
          branchCount: 2,
          completedBranchCount: 2,
          staleBranchCount: 0,
          coveragePercent: 100,
          contradictionCount: 1,
          evidenceRefs: ["evidence:branch-a", "evidence:branch-b", "evidence:root"],
          failureSummaries: [],
          revision: 5,
          createdAt: at,
          updatedAt: "2026-08-09T00:00:04.000Z",
        },
      ],
      modelSessions: [rootSession, branchSession],
    } as never;

    const markup = renderToStaticMarkup(
      <SupervisedConversationsPanel
        roomId="room-1"
        snapshot={snapshot}
        supervisorConversation={null}
        leadConversation={<div>Lead transcript</div>}
        group="rlm"
        selectedSessionId={branchSession.id}
        onGroupChange={vi.fn()}
        onSelectSession={vi.fn()}
      />,
    );

    expect(markup).toContain("RLM episode receipt");
    expect(markup).toContain("episode-1");
    expect(markup).toContain("2 / 2");
    expect(markup).toContain("100%");
    expect(markup).toContain("evidence:branch-b");
    expect(markup).toContain("model-session:branch-b");
    expect(markup).toContain("Prompt SHA-256");
    expect(markup).toContain(`sha256:${"b".repeat(64)}`);
    expect(markup).toContain("not supplied by provider projection");
    expect(markup).toContain("context-view:branch-a");
    expect(markup).toContain("Caller seat");
    expect(markup).toContain("seat:supervisor-primary");
    expect(markup).toContain("Authority receipt");
    expect(markup).toContain("receipt:supervisor-rlm");
    expect(markup).toContain("Effective role");
    expect(markup).toContain("supervisor");
    expect(markup).toContain("Root leases");
    expect(markup).toContain("none (no Root authority)");
    expect(markup).not.toContain("Supervisor acting as Root");
    expect(markup).toContain("Tool call · search");
    expect(markup).toContain("Receipt source retained.");
    expect(markup).toContain("evidence:branch-a");
    expect(markup).toContain("Recorded context 9.375%");
    expect(markup).toContain("Destination · model-session:root");
  });
});
