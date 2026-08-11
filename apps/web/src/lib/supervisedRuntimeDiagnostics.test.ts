import { describe, expect, it } from "vitest";

import {
  formatSupervisedRuntimeDiagnostics,
  supervisedRuntimeTraceEntries,
} from "./supervisedRuntimeDiagnostics";

describe("Supervised runtime diagnostics", () => {
  it("orders trace entries by event time without copying signal context", () => {
    const entries = supervisedRuntimeTraceEntries({
      audit: [],
      signals: [
        {
          id: "signal-1",
          kind: "ContextPressureHigh",
          subscriptionId: "subscription-1",
          scope: { kind: "global" },
          subjectId: "lead-1",
          state: "triggered",
          measuredValue: 82,
          threshold: { operator: "gte", value: 80 },
          sourceEventIds: ["event-1"],
          metricSampleIds: ["metric-1"],
          aggregationReceiptHash: `sha256:${"a".repeat(64)}`,
          context: { protectedPrompt: "must-not-copy" },
          triggeredAt: "2026-08-07T08:00:00.000Z",
          resetAt: null,
          revision: 0,
        },
      ],
      deliveries: [],
    } as never);

    expect(entries[0]?.kind).toBe("signal");
    expect(JSON.stringify(entries)).not.toContain("must-not-copy");
  });

  it("builds bounded diagnostics without raw child command lines", () => {
    const output = formatSupervisedRuntimeDiagnostics({
      runtime: {
        snapshotSequence: 12,
        health: { status: "healthy", daemonEpoch: 2 },
        rooms: [],
        tasks: [],
        taskNodes: [],
        runs: [],
        subscriptions: [],
        plugins: [],
        signals: [],
        deliveries: [],
        deadLetters: [],
        audit: [],
      } as never,
      server: {
        generatedAt: "2026-08-07T08:00:00.000Z",
        logsDirectory: "/tmp/veylen/logs",
        serverLogPath: "/tmp/veylen/logs/server.log",
        process: { pid: 42, uptimeSeconds: 10, memory: {} },
        childProcesses: [{ command: "secret-child-command" }],
        childProcessTotalCount: 1,
        childProcessTotalRssBytes: 1024,
        projection: { projectCount: 1, threadCount: 2 },
      } as never,
    });

    expect(output).toContain('"daemonEpoch": 2');
    expect(output).not.toContain("secret-child-command");
  });

  it("includes bounded RLM episode, session, and provider receipt lineage", () => {
    const at = "2026-08-09T00:00:00.000Z";
    const runtime = {
      snapshotSequence: 42,
      health: { status: "healthy", daemonEpoch: 3 },
      rooms: [],
      tasks: [],
      taskNodes: [],
      runs: [],
      subscriptions: [],
      plugins: [],
      signals: [],
      deliveries: [],
      deadLetters: [],
      audit: [],
      rlmEpisodes: [
        {
          id: "episode-1",
          runId: "run-1",
          admission: {
            episodeId: "episode-1",
            requestedMode: "recursive",
            selectedMode: "recursive",
            estimatedContextPercent: 10,
            estimatedInputTokens: 500,
            independentEvidenceBranches: 2,
            reasons: ["Independent evidence requested"],
            admittedByPolicyId: "policy-1",
            createdAt: at,
          },
          status: "completed",
          rootModelSessionId: "session-root",
          branchModelSessionIds: ["session-a", "session-b"],
          branchCount: 2,
          completedBranchCount: 2,
          staleBranchCount: 0,
          coveragePercent: 100,
          contradictionCount: 0,
          evidenceRefs: ["evidence-a", "evidence-b", "evidence-root"],
          failureSummaries: [],
          revision: 5,
          createdAt: at,
          updatedAt: "2026-08-09T00:00:04.000Z",
        },
      ],
      modelSessions: [
        {
          id: "session-a",
          rlmEpisodeId: "episode-1",
          parentSessionId: "session-root",
          threadId: "thread-a",
          runId: "run-1",
          taskId: "task-1",
          taskNodeId: null,
          role: "rlm_branch",
          status: "completed",
          provider: "codex",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          providerSessionId: null,
          providerCallId: "turn-a",
          promptHash: `sha256:${"a".repeat(64)}`,
          contextView: { id: "context-view-a" },
          inputSummary: "secret branch prompt",
          items: [{ content: "secret transcript" }],
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            contextTokens: 12_000,
            providerLimitTokens: 128_000,
            contextUsagePercent: 9.375,
          },
          retryCount: 0,
          durationMs: 2_000,
          synthesisDestination: "session-root",
          revision: 2,
          updatedAt: "2026-08-09T00:00:03.000Z",
        },
      ],
      evidence: [
        {
          id: "evidence-a",
          kind: "provider_receipt",
          scope: { kind: "room", roomId: "room-1" },
          summary: "secret provider response",
          sourceEventIds: ["event-tool", "event-turn"],
          modelSessionId: "session-a",
          createdBy: { kind: "daemon", actorId: "rlm-daemon" },
          createdAt: "2026-08-09T00:00:03.000Z",
        },
      ],
    } as never;
    const output = formatSupervisedRuntimeDiagnostics({
      runtime,
      server: {
        generatedAt: "2026-08-09T00:00:05.000Z",
        logsDirectory: "/tmp/veylen/logs",
        serverLogPath: "/tmp/veylen/logs/server.log",
        process: { pid: 42, uptimeSeconds: 10, memory: {} },
        childProcesses: [],
        childProcessTotalCount: 0,
        childProcessTotalRssBytes: 0,
        projection: { projectCount: 1, threadCount: 3 },
      } as never,
    });
    const trace = supervisedRuntimeTraceEntries(runtime);

    expect(output).toContain('"rlmEpisodes": 1');
    expect(output).toContain('"modelSessions": 1');
    expect(output).toContain('"evidence": 1');
    expect(output).toContain('"rlmModelSessions": 1');
    expect(output).toContain('"rlmEvidence": 1');
    expect(output).toContain('"rootModelSessionId": "session-root"');
    expect(output).toContain('"providerCallId": "turn-a"');
    expect(output).toContain('"sourceEventIds": [');
    expect(output).not.toContain("secret branch prompt");
    expect(output).not.toContain("secret transcript");
    expect(output).not.toContain("secret provider response");
    expect(trace.some((entry) => entry.kind === "rlm" && entry.id === "rlm:episode-1")).toBe(true);
    expect(trace.some((entry) => entry.kind === "model_session")).toBe(true);
    expect(trace.some((entry) => entry.kind === "evidence")).toBe(true);
  });
});
