import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { ContextCompactionReceipt, ContextRecord, ContextWorkspace } from "@synara/contracts";

import { buildContextView, planContextCompaction, renderContextView } from "./ContextViews.ts";

const now = "2026-08-09T00:00:00.000Z";
const workspace = {
  id: "context-workspace:stage-5",
  projectId: "project:stage-5",
  roomId: "room:stage-5",
  revision: 4,
  highWaterSequence: 12,
  retention: { maxAgeMs: 86_400_000, maxInlineBytes: 8_192, compactAfterRecords: 50 },
  createdAt: now,
  updatedAt: now,
} as ContextWorkspace;

const record = (id: string, overrides: Partial<ContextRecord> = {}): ContextRecord =>
  ({
    id,
    workspaceId: workspace.id,
    kind: "evidence",
    scope: { kind: "room", roomId: workspace.roomId },
    title: id,
    inlineText: `content:${id}`,
    blob: null,
    sourceEventIds: [],
    evidenceRefs: [],
    sourceRecordIds: [],
    provenance: {},
    protectionClass: "workspace",
    estimatedTokens: 4,
    status: "current",
    contentRevision: 1,
    createdBy: { kind: "seat", actorId: "lead", seatId: "seat:lead" },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }) as ContextRecord;

const build = (
  records: ReadonlyArray<ContextRecord>,
  compactionReceipts: ReadonlyArray<ContextCompactionReceipt> = [],
) =>
  buildContextView({
    workspace,
    records,
    compactionReceipts,
    actorSeatId: "seat:lead",
    allowedScopes: [],
    allowedProtectionClasses: ["workspace"],
    provider: "codex",
    model: "gpt-5.6-sol",
    providerLimitTokens: 100_000,
    maxRecords: 10,
    maxEstimatedTokens: 100,
    createdAt: now,
  });

describe("scoped durable ContextViews", () => {
  it("filters scope and protection class before applying deterministic bounds", () => {
    const obligation = record("obligation", { kind: "obligation", updatedAt: now });
    const projectEvidence = record("project", {
      scope: { kind: "project", projectId: workspace.projectId },
      updatedAt: "2026-08-09T00:00:01.000Z",
    });
    const hiddenSeat = record("hidden-seat", {
      scope: { kind: "seat", seatId: "seat:other" },
    });
    const protectedRecord = record("protected", { protectionClass: "secret" });

    const result = build([projectEvidence, hiddenSeat, protectedRecord, obligation]);

    assert.deepEqual(result.view.recordIds, [obligation.id, projectEvidence.id]);
    assert.deepEqual(result.view.activeObligationRecordIds, [obligation.id]);
    assert.equal(renderContextView(result.records).includes("hidden-seat"), false);
    assert.equal(renderContextView(result.records).includes("protected"), false);
  });

  it("only hides compacted sources when the summary itself is visible", () => {
    const source = record("source", { evidenceRefs: ["evidence:source"] });
    const planned = planContextCompaction({
      workspace,
      records: [source],
      sourceRecordIds: [source.id],
      title: "Retained summary",
      summary: "Summary backed by retained source evidence.",
      createdBy: source.createdBy,
      protectionClass: "workspace",
      createdAt: now,
    });

    const hiddenSummary = { ...planned.summaryRecord, protectionClass: "secret" };
    const hiddenSummaryView = build([source, hiddenSummary], [planned.receipt]);
    assert.deepEqual(hiddenSummaryView.view.recordIds, [source.id]);

    const visibleSummary = planned.summaryRecord;
    const visibleSummaryView = build([source, visibleSummary], [planned.receipt]);
    assert.deepEqual(visibleSummaryView.view.recordIds, [visibleSummary.id]);
    assert.deepEqual(visibleSummaryView.view.evidenceRefs, ["evidence:source"]);
    assert.deepEqual(visibleSummary.sourceRecordIds, [source.id]);
    assert.deepEqual(planned.receipt.sourceRecordIds, [source.id]);
  });

  it("never exceeds the hard ContextView token budget", () => {
    const oversizedObligation = record("oversized", {
      kind: "obligation",
      estimatedTokens: 101,
    });
    const boundedEvidence = record("bounded", { estimatedTokens: 100 });

    const result = build([oversizedObligation, boundedEvidence]);

    assert.deepEqual(result.view.recordIds, [boundedEvidence.id]);
    assert.equal(result.view.estimatedTokens, 100);
    assert.ok(result.view.estimatedTokens <= 100);
  });

  it("rejects compaction that would widen authority scope or protection", () => {
    const source = record("source");
    for (const other of [
      record("other-scope", {
        scope: { kind: "project", projectId: workspace.projectId },
      }),
      record("other-protection", { protectionClass: "internal" }),
    ]) {
      assert.throws(() =>
        planContextCompaction({
          workspace,
          records: [source, other],
          sourceRecordIds: [source.id, other.id],
          title: "Invalid summary",
          summary: "This must not widen visibility.",
          createdBy: source.createdBy,
          protectionClass: source.protectionClass,
          createdAt: now,
        }),
      );
    }
  });
});
