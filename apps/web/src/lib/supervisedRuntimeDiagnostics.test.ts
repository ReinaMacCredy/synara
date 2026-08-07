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
        logsDirectory: "/tmp/synara/logs",
        serverLogPath: "/tmp/synara/logs/server.log",
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
});
